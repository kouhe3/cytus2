import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Serves the canonical DB artifacts next to the Vite app.
 *
 *   GET /db/data.json   the SPA projection written by `python -m cytus2db build`
 *   GET /db/text.json   snippet index derived from build/text/im_os.jsonl
 *   GET /db/text?ref=…  full text record for one iM post / OS log
 *
 * The text store is the canonical one written by the Python pipeline; this
 * plugin only indexes and slices it, it does not introduce a second model.
 */

const LANGUAGES = ["en", "ja", "zh-Hant", "ko", "zh-Hans"] as const;
const FALLBACK_ORDER = ["zh-Hans", "en", "ja", "zh-Hant", "ko"] as const;

interface TextBlock {
  kind: string;
  [key: string]: unknown;
}

interface TextRecord {
  entity: string;
  lang: string;
  ref: string;
  text?: string | null;
  blocks?: TextBlock[] | null;
  missing?: boolean;
}

interface TextIndex {
  detail: Map<string, Map<string, TextRecord>>;
  snippets: Record<string, Record<string, string>>;
}

function emptyIndex(): TextIndex {
  return { detail: new Map(), snippets: {} };
}

function blockText(block: TextBlock): string {
  const text = typeof block["text"] === "string" ? block["text"] : "";
  const speaker = typeof block["speaker"] === "string" ? block["speaker"] : "";
  switch (block.kind) {
    case "dialogue":
      return speaker ? `${speaker}：${text}` : text;
    case "narration":
      return text;
    case "mail": {
      const title = typeof block["title"] === "string" ? block["title"] : "";
      const body = typeof block["body"] === "string" ? block["body"] : "";
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

function snippet(record: TextRecord, limit = 180): string {
  let raw = record.text ?? "";
  if (!raw && record.blocks) {
    raw = record.blocks.map(blockText).filter(Boolean).join(" ");
  }
  const clean = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function nonEmpty(record: TextRecord | undefined): record is TextRecord {
  return Boolean(
    record &&
      !record.missing &&
      ((record.text && record.text.trim()) ||
        (record.blocks && record.blocks.length > 0)),
  );
}

class TextStore {
  private readonly file: string;
  private signature = "\u0000";
  private index: TextIndex = emptyIndex();
  private loading: Promise<void> | null = null;

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
    if (signature !== "missing" && signature === this.signature) {
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
    const index = emptyIndex();
    if (!fs.existsSync(this.file)) {
      this.index = index;
      return;
    }
    const input = fs.createReadStream(this.file, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let record: TextRecord;
      try {
        record = JSON.parse(line) as TextRecord;
      } catch {
        continue;
      }
      if (record.entity !== "im_post" && record.entity !== "os_log") {
        continue;
      }
      if (typeof record.ref !== "string" || typeof record.lang !== "string") {
        continue;
      }
      let byLang = index.detail.get(record.ref);
      if (!byLang) {
        byLang = new Map();
        index.detail.set(record.ref, byLang);
      }
      byLang.set(record.lang, record);
      let snippets = index.snippets[record.ref];
      if (!snippets) {
        snippets = {};
        index.snippets[record.ref] = snippets;
      }
      snippets[record.lang] = snippet(record);
    }
    this.index = index;
  }

  snippets(): Record<string, Record<string, string>> {
    return this.index.snippets;
  }

  record(ref: string, lang: string): TextRecord | null {
    const byLang = this.index.detail.get(ref);
    if (!byLang) {
      return null;
    }
    for (const code of [lang, ...FALLBACK_ORDER]) {
      const candidate = byLang.get(code);
      if (nonEmpty(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}

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

function attach(
  server: ViteDevServer | PreviewServer,
  buildDir: string,
  store: TextStore,
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
            refs: store.snippets(),
          });
        })
        .catch((error: unknown) => {
          sendJson(res, 500, { error: String(error) });
        });
      return;
    }
    if (url.pathname === "/db/text") {
      const ref = url.searchParams.get("ref") ?? "";
      const lang = url.searchParams.get("lang") ?? "zh-Hans";
      if (!ref) {
        sendJson(res, 400, { error: "ref is required" });
        return;
      }
      void store
        .ensure()
        .then(() => {
          const record = store.record(ref, lang);
          if (!record) {
            sendJson(res, 404, { error: `no text record for ${ref}` });
            return;
          }
          sendJson(res, 200, record);
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
  const store = new TextStore(path.join(buildDir, "text", "im_os.jsonl"));
  return {
    name: "cytus2-canonical-data",
    configureServer(server) {
      attach(server, buildDir, store);
    },
    configurePreviewServer(server) {
      attach(server, buildDir, store);
    },
  };
}
