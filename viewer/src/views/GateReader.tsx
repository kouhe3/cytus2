import type { IndexData, Lang } from "../types";
import { Chip } from "../components/ui";
import { findMovie, useManifest } from "../media";
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
  const movie = event?.movie_file ?? event?.cutscene_movie_file;
  const clip = movie ? findMovie(manifest, movie.replace(/\.mp4$/, "")) : undefined;

  const rows: [string, string][] = event
    ? ([
        ["类名", event.cls],
        ["Action 类", (event.actions ?? []).join("、") || "—"],
        ["触发 iM 帖", event.trigger_topic_id ?? event.start_topic_id ?? "—"],
        ["触发 OS", event.trigger_os_id ?? "—"],
        ["触发 gallery", event.trigger_gallery_file_location ?? "—"],
        ["BOSS 关卡", event.boss_stage_id ?? "—"],
        ["影片", movie ?? "—"],
      ] as [string, string][])
    : [];

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
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="mono" style={{ width: 130, color: "var(--muted)" }}>
                  {k}
                </td>
                <td className="mono">{v}</td>
              </tr>
            ))}
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
