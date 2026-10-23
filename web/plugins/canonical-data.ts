import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Serves the canonical DB artifacts next to the Vite app.
 *
 *   GET /db/data.json            the SPA projection written by `cytus2db build`
 *   GET /db/text.json            snippet/name index for the narrative text stores
 *   GET /db/text?ref=…&lang=…    one full text record, with explicit fallback
 *   GET /db/search?q=…&lang=…    full-text over posts, logs, OA files, subtitles
 *
 * The text stores are the canonical ones written by the Python pipeline
 * (`build/text/*.jsonl`); this plugin only indexes and slices them, it does not
 * introduce a second model.
 */

const LANGUAGES = ["en", "ja", "zh-Hant", "ko", "zh-Hans"] as const;
type Lang = (typeof LANGUAGES)[number];

const FALLBACK_ORDER: readonly Lang[] = [
  "zh-Hans",
  "en",
  "zh-Hant",
  "ja",
  "ko",
];

const SNIPPET_TYPES: Record<string, true> = {
  im_post: true,
  os_log: true,
  oa_object: true,
  oa_document: true,
  oa_description: true,
  story_node: true,
};

const SEARCHABLE_TEXT_TYPES: Record<string, true> = {
  im_post: true,
  os_log: true,
  oa_document: true,
};

const SEARCH_GROUPS: readonly { type: string; label: string }[] = [
  { type: "im_post", label: "iM posts" },
  { type: "os_log", label: "OS logs" },
  { type: "oa_document", label: "OA documents" },
  { type: "subtitle_line", label: "Subtitle lines" },
];

const TEXT_FILES = ["im_os.jsonl", "oa.jsonl", "story.jsonl"] as const;

interface TextBlock {
  kind: string;
  [key: string]: unknown;
}

interface TextRecord {
  entity: string;
  lang: string;
  ref: string;
  text?: string | null;
  name?: string | null;
  blocks?: TextBlock[] | null;
  missing?: boolean;
}

interface ServedTextRecord extends TextRecord {
  requested_lang: Lang;
  fallback: boolean;
}

interface SearchText {
  raw: string;
  lower: string;
}

interface SearchRow {
  id: string;
  ref: string;
  type: string;
  lang: Lang;
  fallback: boolean;
  snippet: string;
  title: string;
  entity: Json | null;
}

type TextMatcher = (text: string) => boolean;

interface SearchHit {
  id: string;
  ref: string;
  type: string;
  title: string;
  snippet: string;
  lang: Lang;
  fallback: boolean;
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function isLang(value: string): value is Lang {
  return (LANGUAGES as readonly string[]).includes(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*##\w+.*$/gm, " ")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockText(block: TextBlock): string {
  const text = stringValue(block["text"]);
  const speaker = stringValue(block["speaker"]);
  switch (block.kind) {
    case "dialogue":
      return speaker ? `${speaker}：${text}` : text;
    case "narration":
      return text;
    case "mail": {
      const title = stringValue(block["title"]);
      const body = stringValue(block["body"]);
      return [title, body].filter(Boolean).join(" ");
    }
    case "sound":
    case "bgm":
    case "image":
    case "movie":
    case "imageviewer":
    case "booklet":
    case "note":
      return "";
    default:
      return text;
  }
}

function recordBody(record: TextRecord): string {
  let raw = record.text ?? "";
  if (!raw && record.blocks) {
    raw = record.blocks.map(blockText).filter(Boolean).join(" ");
  }
  return stripMarkup(raw);
}

function snippet(body: string, limit = 180): string {
  return body.length > limit ? `${body.slice(0, limit - 1)}…` : body;
}

function nonEmpty(record: TextRecord | undefined): record is TextRecord {
  return Boolean(
    record &&
      !record.missing &&
      ((record.text && record.text.trim()) ||
        (record.blocks && record.blocks.length > 0)),
  );
}

function matchSnippet(body: string, tokens: readonly string[]): string {
  const lower = body.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (index === -1 || found < index)) {
      index = found;
    }
  }
  if (index < 0) {
    return snippet(body);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(body.length, index + 150);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${
    end < body.length ? "…" : ""
  }`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Latin/number tokens match at a word start (so "OA" does not match
 * "groovecoaster"); CJK tokens stay plain substrings.
 */
function matcherFor(token: string): TextMatcher {
  if (/^[a-z0-9_-]+$/.test(token)) {
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(token)}`);
    return (text) => pattern.test(text);
  }
  return (text) => text.includes(token);
}

/* ------------------------------------------------------------ text store */
class TextStore {
  private readonly files: string[];
  private signature = "\u0000";
  private loading: Promise<void> | null = null;
  private readonly detail = new Map<string, Map<Lang, TextRecord>>();
  private readonly snippets: Record<string, Partial<Record<Lang, string>>> = {};
  private readonly names: Record<string, Partial<Record<Lang, string>>> = {};
  private readonly searchable = new Map<string, Map<Lang, SearchText>>();
  private readonly refTypes = new Map<string, string>();

  constructor(textDir: string) {
    this.files = TEXT_FILES.map((name) => path.join(textDir, name));
  }

  private async currentSignature(): Promise<string> {
    const parts: string[] = [];
    for (const file of this.files) {
      try {
        const stat = await fs.promises.stat(file);
        parts.push(`${stat.mtimeMs}:${stat.size}`);
      } catch {
        parts.push("missing");
      }
    }
    return parts.join("|");
  }

  async ensure(): Promise<void> {
    const signature = await this.currentSignature();
    if (signature === this.signature) {
      return;
    }
    if (!this.loading) {
      this.loading = this.build()
        .then(() => {
          this.signature = signature;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  private async build(): Promise<void> {
    this.detail.clear();
    this.searchable.clear();
    this.refTypes.clear();
    for (const key of Object.keys(this.snippets)) {
      delete this.snippets[key];
    }
    for (const key of Object.keys(this.names)) {
      delete this.names[key];
    }

    for (const file of this.files) {
      if (!fs.existsSync(file)) {
        continue;
      }
      const input = fs.createReadStream(file, { encoding: "utf8" });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isJson(parsed)) {
          continue;
        }
        const record = parsed as unknown as TextRecord;
        if (
          typeof record.ref !== "string" ||
          typeof record.entity !== "string"
        ) {
          continue;
        }
        const lang = isLang(record.lang) ? record.lang : null;
        if (!lang) {
          continue;
        }
        let byLang = this.detail.get(record.ref);
        if (!byLang) {
          byLang = new Map();
          this.detail.set(record.ref, byLang);
        }
        byLang.set(lang, record);
        this.refTypes.set(record.ref, record.entity);
        this.indexRecord(record, lang);
      }
    }
  }

  private indexRecord(record: TextRecord, lang: Lang): void {
    if (!nonEmpty(record)) {
      return;
    }
    const body = recordBody(record);
    if (!body) {
      return;
    }
    if (SNIPPET_TYPES[record.entity]) {
      let refSnippets = this.snippets[record.ref];
      if (!refSnippets) {
        refSnippets = {};
        this.snippets[record.ref] = refSnippets;
      }
      refSnippets[lang] = snippet(body);
    }
    if (record.name) {
      let refNames = this.names[record.ref];
      if (!refNames) {
        refNames = {};
        this.names[record.ref] = refNames;
      }
      refNames[lang] = record.name;
    }
    if (SEARCHABLE_TEXT_TYPES[record.entity]) {
      let byLang = this.searchable.get(record.ref);
      if (!byLang) {
        byLang = new Map();
        this.searchable.set(record.ref, byLang);
      }
      const name = record.name ?? "";
      byLang.set(lang, {
        raw: body,
        lower: `${body} ${name}`.toLowerCase(),
      });
    }
  }

  snippetIndex(): Record<string, Partial<Record<Lang, string>>> {
    return this.snippets;
  }

  nameIndex(): Record<string, Partial<Record<Lang, string>>> {
    return this.names;
  }

  nameFor(ref: string, lang: Lang): string {
    const byLang = this.names[ref];
    if (!byLang) {
      return "";
    }
    for (const code of [lang, ...FALLBACK_ORDER]) {
      const value = byLang[code];
      if (value) {
        return value;
      }
    }
    return "";
  }

  record(ref: string, lang: Lang): ServedTextRecord | null {
    const byLang = this.detail.get(ref);
    if (!byLang) {
      return null;
    }
    for (const code of [lang, ...FALLBACK_ORDER]) {
      const candidate = byLang.get(code);
      if (nonEmpty(candidate)) {
        return {
          ...candidate,
          requested_lang: lang,
          fallback: code !== lang,
        };
      }
    }
    return null;
  }

  search(matchers: readonly TextMatcher[], tokens: readonly string[], lang: Lang): SearchRow[] {
    const rows: SearchRow[] = [];
    for (const [ref, byLang] of this.searchable) {
      const type = this.refTypes.get(ref);
      if (!type) {
        continue;
      }
      let langCode: Lang | null = null;
      let text: SearchText | undefined = byLang.get(lang);
      if (text) {
        langCode = lang;
      } else {
        for (const code of FALLBACK_ORDER) {
          const candidate = byLang.get(code);
          if (candidate) {
            langCode = code;
            text = candidate;
            break;
          }
        }
      }
      if (!text || !langCode) {
        continue;
      }
      if (!matchers.every((matches) => matches(text.lower))) {
        continue;
      }
      rows.push({
        id: ref,
        ref,
        type,
        lang: langCode,
        fallback: langCode !== lang,
        snippet: matchSnippet(text.raw, tokens),
        title: "",
        entity: null,
      });
    }
    return rows;
  }
}

/* ------------------------------------------------------ projection store */
interface SubtitleDoc {
  readonly id: string;
  readonly character: string;
  readonly gameId: string;
  readonly langs: Map<Lang, string>;
}

class ProjectionStore {
  private readonly file: string;
  private signature = "\u0000";
  private loading: Promise<void> | null = null;
  private entities = new Map<string, Json>();
  private subtitles: SubtitleDoc[] = [];

  constructor(file: string) {
    this.file = file;
  }

  private async currentSignature(): Promise<string> {
    try {
      const stat = await fs.promises.stat(this.file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "missing";
    }
  }

  async ensure(): Promise<void> {
    const signature = await this.currentSignature();
    if (signature === this.signature) {
      return;
    }
    if (!this.loading) {
      this.loading = this.build()
        .then(() => {
          this.signature = signature;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  private async build(): Promise<void> {
    this.entities = new Map();
    this.subtitles = [];
    if (!fs.existsSync(this.file)) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.promises.readFile(this.file, "utf8"));
    } catch {
      return;
    }
    if (!isJson(parsed) || !isJson(parsed["entities"])) {
      return;
    }
    const entities = parsed["entities"] as Json;
    for (const records of Object.values(entities)) {
      if (!Array.isArray(records)) {
        continue;
      }
      for (const record of records) {
        if (!isJson(record)) {
          continue;
        }
        const id = record["id"];
        const type = record["type"];
        if (typeof id !== "string" || typeof type !== "string") {
          continue;
        }
        this.entities.set(id, record);
        if (type === "subtitle_line") {
          this.subtitles.push(this.subtitleDoc(record, id));
        }
      }
    }
  }

  private subtitleDoc(record: Json, id: string): SubtitleDoc {
    const langs = new Map<Lang, string>();
    const text = record["text"];
    if (isJson(text)) {
      for (const lang of LANGUAGES) {
        const value = text[lang];
        if (typeof value === "string" && value.trim()) {
          langs.set(lang, value);
        }
      }
    }
    return {
      id,
      character: stringValue(record["character"]),
      gameId: stringValue(record["game_id"]),
      langs,
    };
  }

  private localizedTitle(record: Json, field: string, lang: Lang): string {
    const map = record[field];
    if (!isJson(map)) {
      return "";
    }
    for (const code of [lang, ...FALLBACK_ORDER]) {
      const value = map[code];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    return "";
  }

  titleFor(ref: string, lang: Lang): string {
    const record = this.entities.get(ref);
    if (!record) {
      return ref.split("/").slice(1).join("/");
    }
    const type = stringValue(record["type"]);
    if (type === "im_post") {
      return (
        this.localizedTitle(record, "titles", lang) ||
        stringValue(record["game_id"]) ||
        ref
      );
    }
    if (type === "os_log") {
      return (
        this.localizedTitle(record, "names", lang) ||
        stringValue(record["game_id"]) ||
        ref
      );
    }
    if (type === "story_node") {
      return (
        this.localizedTitle(record, "names", lang) ||
        stringValue(record["game_id"]) ||
        ref
      );
    }
    if (type === "subtitle_line") {
      return `${stringValue(record["character"]) || "Voice"} · ${stringValue(
        record["game_id"],
      )}`;
    }
    const name = record["name"];
    if (typeof name === "string" && name) {
      return name;
    }
    const displayName = record["display_name"];
    if (typeof displayName === "string" && displayName) {
      return displayName;
    }
    const gameId = record["game_id"];
    if (typeof gameId === "string" && gameId) {
      return gameId;
    }
    return ref;
  }

  gameIdFor(ref: string): string {
    const record = this.entities.get(ref);
    if (!record) {
      return "";
    }
    const value = record["game_id"];
    return typeof value === "string" ? value : "";
  }

  subtitleSearch(
    matchers: readonly TextMatcher[],
    tokens: readonly string[],
    lang: Lang,
  ): SearchRow[] {
    const rows: SearchRow[] = [];
    for (const doc of this.subtitles) {
      let langCode: Lang | null = null;
      let body: string | undefined;
      for (const code of [lang, ...FALLBACK_ORDER]) {
        const value = doc.langs.get(code);
        if (value) {
          langCode = code;
          body = value;
          break;
        }
      }
      if (!body || !langCode) {
        continue;
      }
      const plain = stripMarkup(body);
      const lower = plain.toLowerCase();
      if (!matchers.every((matches) => matches(lower))) {
        continue;
      }
      rows.push({
        id: doc.id,
        ref: doc.id,
        type: "subtitle_line",
        lang: langCode,
        fallback: langCode !== lang,
        snippet: matchSnippet(plain, tokens),
        title: `${doc.character || "Voice"} · ${doc.gameId}`,
        entity: null,
      });
    }
    return rows;
  }

  titleSearch(
    matchers: readonly TextMatcher[],
    lang: Lang,
    covered: ReadonlySet<string>,
  ): SearchRow[] {
    const rows: SearchRow[] = [];
    for (const [id, record] of this.entities) {
      const type = stringValue(record["type"]);
      if ((type !== "im_post" && type !== "os_log") || covered.has(id)) {
        continue;
      }
      const title = this.titleFor(id, lang);
      if (!matchers.every((matches) => matches(title.toLowerCase()))) {
        continue;
      }
      rows.push({
        id,
        ref: id,
        type,
        lang,
        fallback: false,
        snippet: title,
        title,
        entity: record,
      });
    }
    return rows;
  }

}

/* ------------------------------------------------------------------ HTTP */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function sendFile(res: ServerResponse, file: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) {
      throw new Error("not a file");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(stat.size));
    fs.createReadStream(file).pipe(res);
  } catch {
    sendJson(res, 404, {
      error: `missing artifact: ${file}`,
      hint: "run `python -m cytus2db build --out build/` from the repository root",
    });
  }
}

function parseLang(value: string | null): Lang {
  return value && isLang(value) ? value : "zh-Hans";
}

function searchResponse(
  query: string,
  lang: Lang,
  store: TextStore,
  projection: ProjectionStore,
  limit: number,
): {
  query: string;
  lang: Lang;
  groups: { type: string; label: string; hits: SearchHit[] }[];
  total: number;
} {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return { query, lang, groups: [], total: 0 };
  }
  const matchers = tokens.map(matcherFor);
  const textRows = [
    ...store.search(matchers, tokens, lang),
    ...projection.subtitleSearch(matchers, tokens, lang),
  ];
  const covered = new Set(textRows.map((row) => row.ref));
  const rows = [
    ...textRows,
    ...projection.titleSearch(matchers, lang, covered),
  ];
  const byType = new Map<string, SearchRow[]>();
  for (const row of rows) {
    const title =
      row.type === "oa_document"
        ? store.nameFor(row.ref, row.lang) ||
          projection.gameIdFor(row.ref) ||
          row.ref
        : projection.titleFor(row.ref, row.lang);
    const list = byType.get(row.type);
    if (list) {
      list.push({ ...row, title });
    } else {
      byType.set(row.type, [{ ...row, title }]);
    }
  }
  const groups: { type: string; label: string; hits: SearchHit[] }[] = [];
  let total = 0;
  for (const group of SEARCH_GROUPS) {
    const hits = byType.get(group.type);
    if (!hits) {
      continue;
    }
    hits.sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.ref.localeCompare(right.ref),
    );
    const capped = hits.slice(0, limit).map((row) => ({
      id: row.id,
      ref: row.ref,
      type: row.type,
      title: row.title,
      snippet: row.snippet,
      lang: row.lang,
      fallback: row.fallback,
    }));
    total += hits.length;
    groups.push({ type: group.type, label: group.label, hits: capped });
  }
  return { query, lang, groups, total };
}

function attach(
  server: ViteDevServer | PreviewServer,
  buildDir: string,
  store: TextStore,
  projection: ProjectionStore,
): void {
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, "http://localhost");
    if (url.pathname === "/db/data.json") {
      void sendFile(res, path.join(buildDir, "spa", "data.json"));
      return;
    }
    if (url.pathname === "/db/text.json") {
      void store
        .ensure()
        .then(() => {
          sendJson(res, 200, {
            languages: LANGUAGES,
            refs: store.snippetIndex(),
            names: store.nameIndex(),
          });
        })
        .catch((error: unknown) => {
          sendJson(res, 500, { error: String(error) });
        });
      return;
    }
    if (url.pathname === "/db/text") {
      const ref = url.searchParams.get("ref") ?? "";
      const lang = parseLang(url.searchParams.get("lang"));
      if (!ref) {
        sendJson(res, 400, { error: "ref is required" });
        return;
      }
      void store
        .ensure()
        .then(() => {
          const record = store.record(ref, lang);
          if (!record) {
            sendJson(res, 404, {
              error: `no text record for ${ref}`,
              requested_lang: lang,
            });
            return;
          }
          sendJson(res, 200, record);
        })
        .catch((error: unknown) => {
          sendJson(res, 500, { error: String(error) });
        });
      return;
    }
    if (url.pathname === "/db/search") {
      const query = url.searchParams.get("q") ?? "";
      const lang = parseLang(url.searchParams.get("lang"));
      const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
        : 20;
      void Promise.all([store.ensure(), projection.ensure()])
        .then(() => {
          sendJson(
            res,
            200,
            searchResponse(query, lang, store, projection, limit),
          );
        })
        .catch((error: unknown) => {
          sendJson(res, 500, { error: String(error) });
        });
      return;
    }
    next();
  });
}

export interface CanonicalDataOptions {
  buildDir?: string;
}

export function canonicalData(options: CanonicalDataOptions = {}): Plugin {
  const defaultDir = fileURLToPath(new URL("../../build", import.meta.url));
  const buildDir = path.resolve(
    options.buildDir ?? process.env["CYTUS2_BUILD_DIR"] ?? defaultDir,
  );
  const store = new TextStore(path.join(buildDir, "text"));
  const projection = new ProjectionStore(
    path.join(buildDir, "spa", "data.json"),
  );
  return {
    name: "cytus2-canonical-data",
    configureServer(server) {
      attach(server, buildDir, store, projection);
    },
    configurePreviewServer(server) {
      attach(server, buildDir, store, projection);
    },
  };
}
