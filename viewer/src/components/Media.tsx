import { MEDIA_BASE, findSubtitles, useManifest, type MediaEntry } from "../media";

/**
 * 档案内联图：游戏内所有内联插图（iM 附件、OS 档案 ##image / ##json、OA 文档、分支剧情静帧）
 * 都由 240x160（3:2）的基准框乘以贴图宽高比得到，即
 *     displayAspect = 1.5 * (spriteW / spriteH)
 * 并拉伸填满（object-fit: fill，不裁切）。
 *
 * 依据 libil2cpp.so v5.3.0 —— ThumbnailButton.SetThumbnail (RVA 0x21A18F8)：
 *     var rt = thumbnail.rectTransform;   // prefab RectTransform = 240 x 160
 *     var b  = sprite.bounds;             // rect size / pixelsPerUnit
 *     transform.sizeDelta = new Vector2(rt.sizeDelta.x * (b.size.x / b.size.y), rt.sizeDelta.y);
 */
const INLINE_BASE_RATIO = 1.5;
/** 以高度预算换宽度上限：竖图不至于占满整屏，横图不溢出 */
const INLINE_MAX_HEIGHT = 560;

export function InlineImage({
  entry,
  id,
  label = "插图",
}: {
  entry: MediaEntry;
  id: string;
  label?: string;
}) {
  const src = MEDIA_BASE + encodeURI(entry.file);
  const aspect = entry.w && entry.h ? INLINE_BASE_RATIO * (entry.w / entry.h) : undefined;
  return (
    <figure className="attachment">
      <img
        src={src}
        alt={`${label} ${id}`}
        loading="lazy"
        style={
          aspect
            ? {
                aspectRatio: String(Number(aspect.toFixed(4))),
                width: `min(100%, ${Math.round(INLINE_MAX_HEIGHT * aspect)}px)`,
              }
            : undefined
        }
      />
      <figcaption className="mono">
        {label} {id}
        {entry.w && entry.h ? ` · 原图 ${entry.w}×${entry.h} · 宽高 ${aspect?.toFixed(2)}` : ""}
        {entry.placeholder ? " · 占位素材（游戏内为 DUMMY）" : ""}
        {entry.full ? (
          <>
            {" · "}
            <a href={MEDIA_BASE + encodeURI(entry.full)} target="_blank" rel="noreferrer">
              完整画布 {entry.fullW}×{entry.fullH}
            </a>
          </>
        ) : null}
        {" · "}
        <a href={src} target="_blank" rel="noreferrer">
          原图
        </a>
      </figcaption>
    </figure>
  );
}

export function Video({
  entry,
  id,
  lang,
  subtitleKey,
  startAt,
}: {
  entry: MediaEntry;
  id: string;
  lang?: string;
  subtitleKey?: string;
  /** 打开即跳到的秒数（字幕正文搜到的位置） */
  startAt?: number;
}) {
  const manifest = useManifest();
  const subs = findSubtitles(manifest, subtitleKey ?? id, lang);
  return (
    <figure className="media">
      <video
        src={MEDIA_BASE + encodeURI(entry.file)}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={(e) => {
          if (startAt !== undefined) e.currentTarget.currentTime = startAt;
        }}
      >
        {subs.map((sub, i) => (
          <track
            key={sub.key + sub.lang}
            kind="subtitles"
            src={MEDIA_BASE + encodeURI(sub.file)}
            srcLang={sub.lang}
            label={subs.length > 1 ? `${sub.key} · ${sub.lang}` : sub.lang}
            default={i === 0}
          />
        ))}
      </video>
      <figcaption className="mono">
        ▶ {id}
        {entry.w && entry.h ? ` · ${entry.w}×${entry.h}` : ""}
        {entry.frames ? ` · ${entry.frames}f` : ""}
        {entry.hasAudio === false ? " · 无音轨" : ""}
        {subs.length ? ` · 字幕 ${subs.map((s) => `${s.key}/${s.lang}（${s.cues} 条）`).join("、")}` : ""}
      </figcaption>
    </figure>
  );
}

export function Audio({ entry, name, label }: { entry: MediaEntry; name: string; label: string }) {
  return (
    <div className="audio">
      <span className="mono">♪ {name}</span>
      {label ? <span className="audio-label">{label}</span> : null}
      <audio src={MEDIA_BASE + encodeURI(entry.file)} controls preload="none" />
    </div>
  );
}
