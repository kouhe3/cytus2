import { Fragment } from "react";
import type { Block } from "../types";
import { findImage, findMovie, findSound, imageKey, useManifest } from "../media";
import { Audio, InlineImage, Video } from "./Media";

function Mail({ block }: { block: Extract<Block, { kind: "mail" }> }) {
  return (
    <div className="mail">
      <header>
        <strong>✉ {block.title || "（无标题）"}</strong>
        <span>发件人 {block.from || "—"}</span>
        <span>收件人 {block.to || "—"}</span>
      </header>
      {block.body ? <p>{block.body}</p> : null}
    </div>
  );
}

export function Script({
  blocks,
  videoForImage = false,
  lang,
}: {
  blocks: Block[];
  /** 分支剧情：同 id 存在录影时先播影片，再内联静帧 */
  videoForImage?: boolean;
  /** 字幕语言（缺省时按简中/英文回退） */
  lang?: string;
}) {
  const manifest = useManifest();

  return (
    <div className="script">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "dialogue":
            return (
              <div className="dlg" key={i}>
                <span className="spk">{block.speaker}</span>
                <p>{block.text}</p>
              </div>
            );
          case "booklet":
            return (
              <section className="booklet" key={i}>
                <header>
                  <b>{block.title || "—"}</b>
                  {block.subtitle ? <span>{block.subtitle}</span> : null}
                </header>
                <div className="booklet-body">
                  {block.paragraphs.map((para, j) => (
                    <p key={j}>{para}</p>
                  ))}
                </div>
              </section>
            );
          case "narration":
            return (
              <p className="nar" key={i}>
                {block.text}
              </p>
            );
          case "image": {
            // 分支剧情的 `##image=<id>` 同时有录影与静帧：游戏内首次打开播放 mp4，之后内联静帧
            if (videoForImage) {
              const clip = findMovie(manifest, block.id);
              if (clip) {
                const still = findImage(manifest, block.id, "os");
                return (
                  <Fragment key={i}>
                    <Video entry={clip} id={block.id} lang={lang} />
                    <p className="media-note mono">游戏内首次打开档案时播放这段录影，之后内联下面的静帧。</p>
                    {still ? <InlineImage entry={still} id={block.id} label="静帧" /> : null}
                  </Fragment>
                );
              }
            }
            const entry = findImage(manifest, block.id, "os");
            if (entry) return <InlineImage key={i} entry={entry} id={block.id} label="插图" />;
            return (
              <div className="chips" key={i}>
                <span className="chip chip--warn">插图 · {block.id}（未导出）</span>
              </div>
            );
          }
          case "imageviewer": {
            const entry = findImage(manifest, block.id, "os");
            const label = `图像 ${block.viewer ?? "viewer"} · ${imageKey(block.id)}`;
            if (entry) return <InlineImage key={i} entry={entry} id={block.id} label={label} />;
            return (
              <div className="chips" key={i}>
                <span className="chip chip--warn">{label}（未导出）</span>
              </div>
            );
          }
          case "movie": {
            const entry = findMovie(manifest, block.id);
            if (entry) return <Video key={i} entry={entry} id={block.id} lang={lang} />;
            return (
              <div className="chips" key={i}>
                <span className="chip chip--warn">▶ 影片 · {block.id}（未导出）</span>
              </div>
            );
          }
          case "sound": {
            const entry = findSound(manifest, "sound", block.name);
            if (entry) return <Audio key={i} entry={entry} name={block.name} label={block.label} />;
            return (
              <div className="chips" key={i}>
                <span className="chip">♪ {block.name}</span>
              </div>
            );
          }
          case "bgm": {
            const entry = findSound(manifest, "bgm", block.name);
            if (!entry) return null;
            return <Audio key={i} entry={entry} name={block.name} label="BGM" />;
          }
          case "mail":
            return <Mail block={block} key={i} />;
          case "note":
            return (
              <div className="chips" key={i}>
                <span className="chip">
                  {block.directive} · {block.value}
                </span>
              </div>
            );
        }
      })}
    </div>
  );
}
