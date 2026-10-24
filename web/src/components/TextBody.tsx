import { useEffect, useState } from "react";
import { useI18n } from "../data/i18n";
import { fallbackNotice } from "../data/labels";
import { formatFieldValue } from "../data/selectors";
import { loadTextRecord } from "../data/text";
import { MediaAudio, MediaImage, MediaVideo } from "./Media";
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

function Block({ block }: { block: TextBlock }) {
  const i18n = useI18n();
  switch (block.kind) {
    case "dialogue": {
      const speaker = readString(block, "speaker");
      return (
        <p className="block dialogue">
          {speaker ? <span className="speaker">{speaker}</span> : null}
          {readString(block, "text")}
        </p>
      );
    }
    case "narration":
      return <p className="block narration">{readString(block, "text")}</p>;
    case "page": {
      const page = typeof block["page"] === "number" ? block["page"] : null;
      return (
        <div className="block assistant-page" data-testid="assistant-page">
          {page === null ? null : (
            <span className="page-index">
              {i18n.t("text.page", { page })}
            </span>
          )}
          <p>{readString(block, "text")}</p>
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
          <p>{readString(block, "body")}</p>
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
          <MediaVideo id={readString(block, "id")} />
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
    case "booklet":
      return (
        <div className="block media-note">
          {i18n.t("text.booklet", { id: readString(block, "id") })}
        </div>
      );
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
  | { readonly kind: "movie"; readonly id: string };

function textBodyNodes(text: string): BodyNode[] {
  const nodes: BodyNode[] = [];
  const paragraph: string[] = [];
  const flush = () => {
    const joined = paragraph
      .join("\n")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (joined) {
      nodes.push({ kind: "paragraph", text: joined });
    }
    paragraph.length = 0;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
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
  const record = state.record;
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
  if (record.text) {
    const nodes = textBodyNodes(record.text);
    return (
      <>
        {fallbackNote}
        <div className="prose" data-testid="entity-body" data-lang={record.lang}>
          {nodes.map((node, index) => {
            if (node.kind === "image") {
              return <MediaImage key={index} id={node.id} kind="image" />;
            }
            if (node.kind === "movie") {
              return <MediaVideo key={index} id={node.id} />;
            }
            return <p key={index}>{node.text}</p>;
          })}
        </div>
      </>
    );
  }
  if (record.blocks && record.blocks.length > 0) {
    return (
      <>
        {fallbackNote}
        <div className="prose blocks" data-testid="entity-body" data-lang={record.lang}>
          {record.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
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
