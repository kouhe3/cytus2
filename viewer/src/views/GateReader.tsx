import type { IndexData, Lang } from "../types";
import { Chip } from "../components/ui";

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
  if (!gate) return <p className="state">未找到剧情闸 {gateId}。</p>;
  const byId = new Map(index.im.map((t) => [t.id, t]));
  const isEnding = gateId.startsWith("story_ending");

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("gates")}>
          结局与剧情闸
        </button>{" "}
        <Chip tone={isEnding ? "warn" : undefined}>{isEnding ? "结局" : "终章演出"}</Chip>
      </div>
      <h2>{gateId}</h2>
      <p className="lede">{gate.topics.length} 条 iM 帖以此为前置条件。</p>
      <h3>解锁的 iM 帖</h3>
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
    </div>
  );
}
