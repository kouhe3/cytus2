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
 *   GET /db/text?ref=…&ref=…     several full records in one response
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
  im_reply: true,
  os_log: true,
  oa_object: true,
  oa_document: true,
  oa_description: true,
  story_node: true,
};

const SEARCHABLE_TEXT_TYPES: Record<string, true> = {
  im_post: true,
  im_reply: true,
  os_log: true,
  oa_document: true,
  subtitle_line: true,
};

const SEARCH_GROUPS: readonly { type: string; label: string }[] = [
  { type: "im_post", label: "iM posts" },
  { type: "im_reply", label: "iM replies" },
  { type: "os_log", label: "OS logs" },
  { type: "oa_document", label: "OA documents" },
  { type: "subtitle_line", label: "Subtitle lines" },
  { type: "chart", label: "Charts" },
];

const TEXT_FILES = [
  "im_os.jsonl",
  "oa.jsonl",
  "story.jsonl",
  "extras.jsonl",
  "packs.jsonl",
  "subtitles.jsonl",
] as const;

const MEDIA_PREFIX = "/media/";

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

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

interface SearchGroupPayload {
  type: string;
  label: string;
  hits: SearchHit[];
  total: number;
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
    case "booklet": {
      const title = stringValue(block["title"]);
      const subtitle = stringValue(block["subtitle"]);
      const paragraphs = Array.isArray(block["paragraphs"])
        ? block["paragraphs"].filter((item): item is string => typeof item === "string")
        : [];
      return [title, subtitle, ...paragraphs].filter(Boolean).join(" ");
    }
    case "sound":
    case "bgm":
    case "image":
    case "movie":
    case "imageviewer":
    case "note":
      return "";
    default:
      return text;
  }
}

function recordBody(record: TextRecord): string {
  let raw = (record.text ?? "").replace(
    />>hyperlink\s*\{[\s\S]*?\}\s*<<hyperlink/g,
    (block) => {
      const start = block.indexOf("{");
      const end = block.lastIndexOf("}");
      if (start === -1 || end <= start) {
        return " ";
      }
      try {
        const parsed = JSON.parse(
          block.slice(start, end + 1).replace(/\u00a0/g, " "),
        ) as { Content?: unknown };
        return typeof parsed.Content === "string"
          ? ` ${parsed.Content} `
          : " ";
      } catch {
        return " ";
      }
    },
  );
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

  snippetFor(ref: string, lang: Lang): string {
    const byLang = this.snippets[ref];
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

  search(
    matchers: readonly TextMatcher[],
    tokens: readonly string[],
    lang: Lang,
  ): SearchRow[] {
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
      });
    }
    return rows;
  }
}

/* ------------------------------------------------------ projection store */
class ProjectionStore {
  private readonly file: string;
  private signature = "\u0000";
  private loading: Promise<void> | null = null;
  private entities = new Map<string, Json>();

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
      }
    }
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
      });
    }
    return rows;
  }

  private songName(songId: string): string {
    const song = this.entities.get(songId);
    if (!song) {
      return songId.split("/").slice(1).join("/");
    }
    return stringValue(song["name"]) || stringValue(song["game_id"]) || songId;
  }

  private chartTitle(record: Json): string {
    const songName = this.songName(stringValue(record["song_id"]));
    const difficulty = stringValue(record["difficulty"]);
    const level = stringValue(record["level"]);
    const difficultyPart = difficulty ? ` · ${difficulty}` : "";
    const levelPart = level ? ` · Lv ${level}` : "";
    return `${songName}${difficultyPart}${levelPart}`;
  }

  /**
   * Charts carry no text record; they are matched on their composed label plus
   * the song's aliases, so "Yasutaka Nakata" and "ai001" both reach a chart.
   */
  chartSearch(matchers: readonly TextMatcher[], lang: Lang): SearchRow[] {
    const rows: SearchRow[] = [];
    for (const [id, record] of this.entities) {
      if (stringValue(record["type"]) !== "chart") {
        continue;
      }
      const title = this.chartTitle(record);
      const haystack = [title, stringValue(record["game_id"])];
      const song = this.entities.get(stringValue(record["song_id"]));
      if (song) {
        haystack.push(stringValue(song["name"]), stringValue(song["artist"]));
        const terms = song["search_terms"];
        if (Array.isArray(terms)) {
          for (const term of terms) {
            if (typeof term === "string") {
              haystack.push(term);
            }
          }
        }
      }
      const text = haystack.filter(Boolean).join(" ").toLowerCase();
      if (!matchers.every((matches) => matches(text))) {
        continue;
      }
      rows.push({
        id,
        ref: id,
        type: "chart",
        lang,
        fallback: false,
        snippet: title,
        title,
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

async function sendMedia(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  relative: string,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    sendJson(res, 400, { error: "malformed media path" });
    return;
  }
  const target = path.resolve(root, decoded);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) {
    sendJson(res, 403, { error: "media path escapes the media directory" });
    return;
  }
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    sendJson(res, 404, {
      error: `missing media: ${decoded}`,
      hint: "export the media or point CYTUS2_MEDIA_DIR at an existing export",
    });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: `not a media file: ${decoded}` });
    return;
  }

  const contentType =
    MEDIA_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const suffix = match[1] === "" ? Number(match[2]) : null;
      let start =
        suffix === null
          ? Number(match[1] || 0)
          : Math.max(0, stat.size - suffix);
      let end =
        suffix === null && match[2] !== ""
          ? Math.min(Number(match[2]), stat.size - 1)
          : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(target, { start, end }).pipe(res);
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(target).pipe(res);
}

function parseLang(value: string | null): Lang {
  return value && isLang(value) ? value : "zh-Hans";
}

/**
 * Title matches outrank body-only hits, and the tighter the title match the
 * higher it sits. Ties fall through to title, then ref, so the order is stable.
 */
function relevance(
  title: string,
  tokens: readonly string[],
  needle: string,
): number {
  if (!title) {
    return 3;
  }
  const lowered = title.toLowerCase();
  if (lowered === needle) {
    return 0;
  }
  if (lowered.startsWith(needle)) {
    return 1;
  }
  if (lowered.includes(needle)) {
    return 2;
  }
  // A multi-token query matches rows token-wise, so a title carrying every
  // token is still a title hit even without the contiguous phrase.
  return tokens.length > 1 && tokens.every((token) => lowered.includes(token))
    ? 2
    : 3;
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
  groups: SearchGroupPayload[];
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
  const textRows = store.search(matchers, tokens, lang);
  const covered = new Set(textRows.map((row) => row.ref));
  const rows = [
    ...textRows,
    ...projection.titleSearch(matchers, lang, covered),
    ...projection.chartSearch(matchers, lang),
  ];
  const needle = query.trim().toLowerCase();
  const byType = new Map<string, SearchRow[]>();
  for (const row of rows) {
    const title =
      row.title ||
      (row.type === "oa_document"
        ? store.nameFor(row.ref, row.lang) ||
          projection.gameIdFor(row.ref) ||
          row.ref
        : row.type === "im_reply"
          ? store.nameFor(row.ref, row.lang) ||
            store.snippetFor(row.ref, row.lang) ||
            row.ref
          : projection.titleFor(row.ref, row.lang));
    const list = byType.get(row.type);
    if (list) {
      list.push({ ...row, title });
    } else {
      byType.set(row.type, [{ ...row, title }]);
    }
  }
  const groups: SearchGroupPayload[] = [];
  let total = 0;
  for (const group of SEARCH_GROUPS) {
    const hits = byType.get(group.type);
    if (!hits) {
      continue;
    }
    hits.sort(
      (left, right) =>
        relevance(left.title, tokens, needle) -
          relevance(right.title, tokens, needle) ||
        left.title.localeCompare(right.title) ||
        left.ref.localeCompare(right.ref),
    );
    total += hits.length;
    const capped = hits.slice(0, limit).map((row) => ({
      id: row.id,
      ref: row.ref,
      type: row.type,
      title: row.title,
      snippet: row.snippet,
      lang: row.lang,
      fallback: row.fallback,
    }));
    groups.push({
      type: group.type,
      label: group.label,
      hits: capped,
      total: hits.length,
    });
  }
  return { query, lang, groups, total };
}

function attach(
  server: ViteDevServer | PreviewServer,
  buildDir: string,
  store: TextStore,
  projection: ProjectionStore,
  mediaDir: string,
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
      const refs = [
        ...new Set(
          url.searchParams
            .getAll("ref")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      const lang = parseLang(url.searchParams.get("lang"));
      if (refs.length === 0) {
        sendJson(res, 400, { error: "ref is required" });
        return;
      }
      if (refs.length > 500) {
        sendJson(res, 400, { error: "too many refs" });
        return;
      }
      void store
        .ensure()
        .then(() => {
          if (refs.length === 1) {
            const ref = refs[0] as string;
            const record = store.record(ref, lang);
            if (!record) {
              sendJson(res, 404, {
                error: `no text record for ${ref}`,
                requested_lang: lang,
              });
              return;
            }
            sendJson(res, 200, record);
            return;
          }
          const records: Record<string, TextRecord | null> = {};
          for (const ref of refs) {
            records[ref] = store.record(ref, lang);
          }
          sendJson(res, 200, { lang, records });
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
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500)
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
    if (url.pathname.startsWith(MEDIA_PREFIX)) {
      void sendMedia(
        req,
        res,
        mediaDir,
        url.pathname.slice(MEDIA_PREFIX.length),
      );
      return;
    }
    next();
  });
}

export interface CanonicalDataOptions {
  buildDir?: string;
  mediaDir?: string;
}

export function canonicalData(options: CanonicalDataOptions = {}): Plugin {
  const defaultDir = fileURLToPath(new URL("../../build", import.meta.url));
  const buildDir = path.resolve(
    options.buildDir ?? process.env["CYTUS2_BUILD_DIR"] ?? defaultDir,
  );
  const defaultMediaDir = fileURLToPath(
    new URL("../../viewer/public/media", import.meta.url),
  );
  const mediaDir = path.resolve(
    options.mediaDir ?? process.env["CYTUS2_MEDIA_DIR"] ?? defaultMediaDir,
  );
  const store = new TextStore(path.join(buildDir, "text"));
  const projection = new ProjectionStore(
    path.join(buildDir, "spa", "data.json"),
  );
  return {
    name: "cytus2-canonical-data",
    configureServer(server) {
      attach(server, buildDir, store, projection, mediaDir);
    },
    configurePreviewServer(server) {
      attach(server, buildDir, store, projection, mediaDir);
    },
  };
}
