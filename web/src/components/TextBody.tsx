import { useEffect, useState } from "react";
import { fallbackLabel } from "../data/language";
import { formatFieldValue } from "../data/selectors";
import { loadTextRecord } from "../data/text";
import type { Lang, TextBlock, TextRecord } from "../types";

type TextState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly record: TextRecord | null }
  | { readonly status: "error"; readonly error: Error };

function readString(block: TextBlock, key: string): string {
  const value = block[key];
  return typeof value === "string" ? value : "";
}

function Block({ block }: { block: TextBlock }) {
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
      return <div className="block media-note">Image · {readString(block, "id")}</div>;
    case "imageviewer":
      return (
        <div className="block media-note">Image viewer · {readString(block, "id")}</div>
      );
    case "movie":
      return <div className="block media-note">Movie · {readString(block, "id")}</div>;
    case "sound":
      return <div className="block media-note">Sound · {readString(block, "name")}</div>;
    case "bgm":
      return <div className="block media-note">BGM · {readString(block, "name")}</div>;
    case "booklet":
      return <div className="block media-note">Booklet · {readString(block, "id")}</div>;
    case "note":
      return (
        <div className="block note">
          <span className="block-kind">{block.kind}</span>
          {formatFieldValue(block["value"])}
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

function bodyParagraphs(text: string): string[] {
  const cleaned = text.replace(/^\s*##\w+.*$/gm, "").trim();
  return cleaned.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== "");
}

export function TextBody({
  textRef,
  lang,
}: {
  textRef: string | null;
  lang: Lang;
}) {
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
    return <p className="muted">No text record for this entity.</p>;
  }
  if (state.status === "loading" || state.status === "idle") {
    return <p className="muted">Loading text…</p>;
  }
  if (state.status === "error") {
    return <p className="error-text">Could not load text: {state.error.message}</p>;
  }
  const record = state.record;
  if (!record) {
    return (
      <div className="fallback-note" data-testid="language-fallback" data-lang="none">
        {fallbackLabel(lang, null)}.
      </div>
    );
  }
  const fallbackNotice = record.fallback ? (
    <div className="fallback-note" data-testid="language-fallback">
      {fallbackLabel(record.requested_lang ?? lang, record.lang)}
    </div>
  ) : null;
  if (record.text) {
    const paragraphs = bodyParagraphs(record.text);
    return (
      <>
        {fallbackNotice}
        <div className="prose" data-testid="entity-body" data-lang={record.lang}>
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </>
    );
  }
  if (record.blocks && record.blocks.length > 0) {
    return (
      <>
        {fallbackNotice}
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
      {fallbackNotice}
      <p className="muted">
        This language has no body text.
      </p>
    </>
  );
}
