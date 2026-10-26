import { useEffect, useState } from "react";
import { useI18n } from "../data/i18n";
import { fallbackNotice } from "../data/labels";
import { formatFieldValue } from "../data/selectors";
import { loadTextRecord } from "../data/text";
import { RichText } from "./InlineText";
import { MediaAudio, MediaImage } from "./Media";
import { VideoPlayer } from "./VideoPlayer";
import type { Lang, TextBlock, TextRecord } from "../types";

type TextState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly record: TextRecord | null }
  | { readonly status: "error"; readonly error: Error };

function readString(block: TextBlock, key: string): string {
  const value = block[key];
  return typeof value === "string"
    ? value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    : "";
}

function readStringsMarkup(block: TextBlock, key: string): string[] {
  const value = block[key];
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/&nbsp;/g, " "))
    : [];
}

/** Text fields keep their game markup; only `&nbsp;` needs normalising. */
function readMarkup(block: TextBlock, key: string): string {
  const value = block[key];
  return typeof value === "string" ? value.replace(/&nbsp;/g, " ") : "";
}

interface MsgsMessage {
  readonly side: "system" | "incoming" | "outgoing";
  readonly text: string;
  readonly image: string;
  readonly avatar: string;
  readonly name: string;
  readonly time: string;
}

/** ``msgs`` blocks carry the game's phone transcript as structured bubbles. */
function readMessages(block: TextBlock): MsgsMessage[] {
  const raw = block["messages"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const messages: MsgsMessage[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const text = typeof record["text"] === "string" ? record["text"] : "";
    const image = typeof record["image"] === "string" ? record["image"] : "";
    if (!text && !image) {
      continue;
    }
    messages.push({
      side:
        record["side"] === "system" || record["side"] === "outgoing"
          ? record["side"]
          : "incoming",
      text,
      image,
      avatar: typeof record["avatar"] === "string" ? record["avatar"] : "",
      name: typeof record["name"] === "string" ? record["name"] : "",
      time: typeof record["time"] === "string" ? record["time"] : "",
    });
  }
  return messages;
}

function Block({ block }: { block: TextBlock }) {
  const i18n = useI18n();
  switch (block.kind) {
    case "dialogue": {
      const speaker = readString(block, "speaker");
      return (
        <p className="block dialogue">
          {speaker ? <span className="speaker">{speaker}</span> : null}
          <RichText text={readMarkup(block, "text")} />
        </p>
      );
    }
    case "narration":
      return (
        <p className="block narration">
          <RichText text={readMarkup(block, "text")} />
        </p>
      );
    case "page": {
      const page = typeof block["page"] === "number" ? block["page"] : null;
      return (
        <div className="block assistant-page" data-testid="assistant-page">
          {page === null ? null : (
            <span className="page-index">
              {i18n.t("text.page", { page })}
            </span>
          )}
          <p>
            <RichText text={readMarkup(block, "text")} />
          </p>
        </div>
      );
    }
    case "mail":
      return (
        <div className="block mail">
          <p className="mail-route">
            {readString(block, "from")} → {readString(block, "to")}
          </p>
          <h4>{readString(block, "title")}</h4>
          <p>
            <RichText text={readMarkup(block, "body")} />
          </p>
        </div>
      );
    case "image":
      return (
        <div className="block media">
          <MediaImage id={readString(block, "id")} kind="image" />
        </div>
      );
    case "imageviewer":
      return (
        <div className="block media">
          <MediaImage id={readString(block, "id")} kind="viewer" />
        </div>
      );
    case "movie":
      return (
        <div className="block media">
          <VideoPlayer
            clip={readString(block, "id")}
            subtitleKey={null}
            missing="hide"
          />
        </div>
      );
    case "sound": {
      const name = readString(block, "name");
      const label = readString(block, "label");
      return (
        <div className="block media">
          <MediaAudio id={name} kind="sound" label={label || name} />
        </div>
      );
    }
    case "bgm": {
      const name = readString(block, "name");
      return (
        <div className="block media">
          <MediaAudio id={name} kind="bgm" label={name} />
        </div>
      );
    }
    case "booklet": {
      const title = readString(block, "title");
      const subtitle = readString(block, "subtitle");
      return (
        <section className="block booklet">
          <header>
            <b>{title || "—"}</b>
            {subtitle ? <span>{subtitle}</span> : null}
          </header>
          <div className="booklet-body">
            {readStringsMarkup(block, "paragraphs").map((paragraph, index) => (
              <p key={index}>
                <RichText text={paragraph} />
              </p>
            ))}
          </div>
        </section>
      );
    }
    case "msgs": {
      const messages = readMessages(block);
      if (messages.length === 0) {
        return null;
      }
      return (
        <div className="block msgs" data-testid="os-msgs">
          {messages.map((message, index) => {
            if (message.side === "system") {
              return (
                <p key={index} className="msgs-system">
                  {message.text}
                </p>
              );
            }
            const meta = [message.name, message.time]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={index} className={`msgs-row ${message.side}`}>
                <MediaImage
                  id={message.avatar}
                  kind="osAvatar"
                  alt={message.name || message.avatar}
                  className="msgs-avatar"
                />
                <div className="msgs-bubble">
                  {message.image ? (
                    <MediaImage
                      id={message.image}
                      kind="sticker"
                      alt={message.image}
                      className="msgs-sticker"
                      fallback={
                        <code className="msgs-attachment">
                          {message.image}
                        </code>
                      }
                    />
                  ) : (
                    <p className="msgs-text">
                      <RichText text={message.text} />
                    </p>
                  )}
                  {meta ? <span className="msgs-meta">{meta}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    case "note":
      return (
        <div className="block note">
          <span className="block-kind">{block.kind}</span>
          {formatFieldValue(block["value"], i18n)}
        </div>
      );
    default:
      return (
        <div className="block note">
          <span className="block-kind">{block.kind}</span>
          {readString(block, "text") || readString(block, "id")}
        </div>
      );
  }
}

type BodyNode =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "image"; readonly id: string }
  | { readonly kind: "movie"; readonly id: string }
  | {
      readonly kind: "hyperlink";
      readonly content: string;
      readonly url: string;
    }
  | { readonly kind: "quote"; readonly paragraphs: readonly string[] };

/** The game's rich-text quote markers, on their own lines around the quote. */
const QUOTE_OPEN = ">>";
const QUOTE_CLOSE = "<<";

function cleanLinkContent(value: string): string {
  return value.replace(/&nbsp;/g, " ").trim();
}

function parseHyperlink(body: string): BodyNode | null {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const raw = JSON.parse(body.slice(start, end + 1).replace(/\u00a0/g, " ")) as {
      Content?: unknown;
      Urls?: Record<string, unknown>;
    };
    const content = cleanLinkContent(
      typeof raw.Content === "string" ? raw.Content : "",
    );
    const urls = Object.values(raw.Urls ?? {}).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const editor =
      typeof raw.Urls?.Editor === "string" ? raw.Urls.Editor : null;
    const url = editor ?? urls[0];
    if (!url) {
      return null;
    }
    return { kind: "hyperlink", content: content || url, url };
  } catch {
    return null;
  }
}

function cleanBodyText(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\s*p\s*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function textBodyNodes(text: string): BodyNode[] {
  const nodes: BodyNode[] = [];
  const paragraph: string[] = [];
  const flush = () => {
    const joined = cleanBodyText(paragraph.join("\n"));
    if (joined) {
      nodes.push({ kind: "paragraph", text: joined });
    }
    paragraph.length = 0;
  };
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === ">>hyperlink") {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== "<<hyperlink") {
        body.push(lines[index] ?? "");
        index += 1;
      }
      const hyperlink = parseHyperlink(body.join("\n"));
      if (hyperlink) {
        nodes.push(hyperlink);
      }
      continue;
    }
    if (line === QUOTE_OPEN) {
      flush();
      const quoted: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== QUOTE_CLOSE) {
        quoted.push(lines[index] ?? "");
        index += 1;
      }
      const paragraphs = cleanBodyText(quoted.join("\n"))
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (paragraphs.length > 0) {
        nodes.push({ kind: "quote", paragraphs });
      }
      continue;
    }
    if (line === QUOTE_CLOSE) {
      // A close marker without an opener: drop the marker, keep the text.
      flush();
      continue;
    }
    if (line.startsWith("##")) {
      flush();
      const [key, value = ""] = line.slice(2).split("=", 2);
      const id = value.trim();
      if (key === "image" && id) {
        nodes.push({ kind: "image", id });
      } else if (key === "movie" && id) {
        nodes.push({ kind: "movie", id });
      }
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return nodes;
}

export function TextBody({
  textRef,
  lang,
}: {
  textRef: string | null;
  lang: Lang;
}) {
  const i18n = useI18n();
  const [state, setState] = useState<TextState>({ status: "idle" });

  useEffect(() => {
    if (!textRef) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    loadTextRecord(textRef, lang)
      .then((record) => {
        if (active) {
          setState({ status: "ready", record });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [textRef, lang]);

  if (!textRef) {
    return <p className="muted">{i18n.t("text.noText")}</p>;
  }
  if (state.status === "loading" || state.status === "idle") {
    return <p className="muted">{i18n.t("text.loading")}</p>;
  }
  if (state.status === "error") {
    return (
      <p className="error-text">
        {i18n.t("text.error", { message: state.error.message })}
      </p>
    );
  }
  return <TextRecordBody record={state.record} lang={lang} />;
}

/**
 * Render one already-loaded text record. Extracted from `TextBody` so the
 * relations list can render batch-loaded reply bodies with the same block,
 * rich-text and media handling.
 */
export function TextRecordBody({
  record,
  lang,
  testId = "entity-body",
}: {
  record: TextRecord | null;
  lang: Lang;
  testId?: string;
}) {
  const i18n = useI18n();
  if (!record) {
    return (
      <div className="fallback-note" data-testid="language-fallback" data-lang="none">
        {fallbackNotice(i18n, lang, null)}.
      </div>
    );
  }
  const fallbackNote = record.fallback ? (
    <div className="fallback-note" data-testid="language-fallback">
      {fallbackNotice(i18n, record.requested_lang ?? lang, record.lang)}
    </div>
  ) : null;
  const blocks = record.blocks ?? [];
  if (blocks.length > 0) {
    return (
      <>
        {fallbackNote}
        <div className="prose blocks" data-testid={testId} data-lang={record.lang}>
          {blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      </>
    );
  }
  if (record.text) {
    const nodes = textBodyNodes(record.text);
    return (
      <>
        {fallbackNote}
        <div className="prose" data-testid={testId} data-lang={record.lang}>
          {nodes.map((node, index) => {
            if (node.kind === "image") {
              return <MediaImage key={index} id={node.id} kind="image" />;
            }
            if (node.kind === "movie") {
              return (
                <VideoPlayer
                  key={index}
                  clip={node.id}
                  subtitleKey={null}
                  missing="hide"
                />
              );
            }
            if (node.kind === "hyperlink") {
              return (
                <a
                  key={index}
                  className="im-hyperlink"
                  href={node.url}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="im-hyperlink"
                >
                  <span>
                    <RichText text={node.content} />
                  </span>
                </a>
              );
            }
            if (node.kind === "quote") {
              return (
                <blockquote key={index} className="text-quote">
                  {node.paragraphs.map((paragraph, offset) => (
                    <p key={offset}>
                      <RichText text={paragraph} />
                    </p>
                  ))}
                </blockquote>
              );
            }
            return (
              <p key={index}>
                <RichText text={node.text} />
              </p>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <>
      {fallbackNote}
      <p className="muted">{i18n.t("text.noBody")}</p>
    </>
  );
}
