import type { IndexData, Lang } from "../types";
import { Chip } from "../components/ui";
import { findMovie, useManifest } from "../media";
import { sourceOf } from "../data";
import { Video } from "../components/Media";

/** 剧情事件详情：字段来自 dump.cs 的 Story 类 + 其 Action 类常量 */
export function GateReader({
  index,
  lang,
  gateId,
  onNavigate,
}: {
  index: IndexData;
  lang: Lang;
  gateId: string;
  onNavigate: (view: string, id?: string) => void;
}) {
  const gate = index.gates.find((g) => g.id === gateId);
  const event = index.storyEvents?.find((e) => e.id === gateId);
  if (!gate && !event) return <p className="state">未找到剧情事件 {gateId}。</p>;

  const byId = new Map(index.im.map((t) => [t.id, t]));
  const isEnding = gateId.startsWith("story_ending");
  const manifest = useManifest();

  // TRIGGER_TOPIC_ID 有时指向 OS 档案（如 hos027），按真实归属决定标签与跳转目标
  const topicId = event?.trigger_topic_id ?? event?.start_topic_id ?? "";
  const topicSrc = topicId ? sourceOf(index, topicId) : "";
  const topicLabel = topicSrc === "os" ? "触发 OS 档案" : topicSrc === "gallery" ? "触发 gallery" : "触发 iM 帖";
  const jumpFor = (id: string) => {
    switch (sourceOf(index, id)) {
      case "os":
        return () => onNavigate("os", id);
      case "im":
        return () => onNavigate("im", id);
      case "gallery": {
        const it = index.gallery.items.find((g) => g.location === id);
        return it ? () => onNavigate("backup", it.folder) : undefined;
      }
      default:
        return undefined;
    }
  };
  const linkFor = (id: string, label?: string) => {
    const jump = id ? jumpFor(id) : undefined;
    return jump ? (
      <button type="button" className="chip chip-btn mono" onClick={jump}>
        {label ?? id}
      </button>
    ) : (
      <span className="mono">{label ?? id ?? "—"}</span>
    );
  };

  const movie = event?.movie_file ?? event?.cutscene_movie_file;
  const clip = movie ? findMovie(manifest, movie.replace(/\.mp4$/, "")) : undefined;

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("gates")}>
          剧情事件
        </button>{" "}
        <Chip tone={isEnding ? "warn" : undefined}>{isEnding ? "结局" : "剧情节点"}</Chip>
      </div>
      <h2>{gateId}</h2>

      {event ? (
        <table className="grid" style={{ marginBottom: 14 }}>
          <tbody>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>类名</td>
              <td className="mono">{event.cls}</td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>Action 类</td>
              <td className="mono">{(event.actions ?? []).join("、") || "—"}</td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>{topicLabel}</td>
              <td>{topicId ? linkFor(topicId) : <span className="mono">—</span>}</td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>角色曲包</td>
              <td>
                {event.trigger_os_id ? (
                  <button
                    type="button"
                    className="chip chip-btn mono"
                    onClick={() => onNavigate("packs", event.trigger_os_id!)}
                  >
                    {event.trigger_os_id}
                  </button>
                ) : (
                  <span className="mono">—</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>触发 gallery</td>
              <td>
                {event.trigger_gallery_file_location
                  ? linkFor(event.trigger_gallery_file_location)
                  : <span className="mono">—</span>}
              </td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>BOSS 关卡</td>
              <td className="mono">{event.boss_stage_id ?? "—"}</td>
            </tr>
            <tr>
              <td className="mono" style={{ width: 130, color: "var(--muted)" }}>影片</td>
              <td className="mono">{movie ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {clip ? <Video entry={clip} id={movie!.replace(/\.mp4$/, "")} lang={lang} /> : null}

      {event?.steps?.length ? (
        <>
          <h3>步骤</h3>
          <p className="mono" style={{ lineHeight: 1.9 }}>
            {event.steps.join(" → ")}
          </p>
        </>
      ) : null}

      {event?.imTopics?.length ? (
        <>
          <h3>本剧情用到的 iM 帖</h3>
          <div className="lang" style={{ gap: 6 }}>
            {event.imTopics.map((id) => (
              <button key={id} type="button" className="chip chip-btn" onClick={() => onNavigate("im", id)}>
                {id}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <h3>以它为前置的 iM 帖</h3>
      {gate && gate.topics.length > 0 ? (
        <table className="grid">
          <tbody>
            {gate.topics.map((id) => {
              const t = byId.get(id);
              return (
                <tr key={id}>
                  <td style={{ width: 90 }}>
                    <button type="button" className="chip chip-btn" onClick={() => onNavigate("im", id)}>
                      {id}
                    </button>
                  </td>
                  <td>{t?.author ?? "—"}</td>
                  <td>{t?.titles[lang] ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mono">没有 iM 帖以它为前置条件（它是剧情触发点，不是闸）。</p>
      )}
    </div>
  );
}
