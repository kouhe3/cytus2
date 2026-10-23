import type { ExtraContent, IndexData, Lang } from "../types";
import { Script } from "../components/Script";
import { Chip, Facts, Skeleton } from "../components/ui";
import { BranchMap } from "../components/BranchMap";

export function BranchingReader({
  index,
  lang,
  nodeId,
  extra,
  loading,
  onNavigate,
}: {
  index: IndexData;
  lang: Lang;
  nodeId: string;
  extra?: ExtraContent;
  loading: boolean;
  onNavigate: (view: string, id?: string) => void;
}) {
  const node = index.branching.find((n) => n.id === nodeId);
  if (!node) return <p className="state">未找到备份数据库节点 {nodeId}。</p>;
  const content = extra?.backup[nodeId];
  const byId = new Map(index.branching.map((n) => [n.id, n]));
  const incoming = index.branching.filter((n) => n.next.includes(nodeId));

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("branching")}>
          分支剧情
        </button>{" "}
        <Chip>{node.branch ? `分支 ${node.branch.toUpperCase()}` : "收束段"}</Chip>
      </div>
      <h2>{node.id}</h2>
      <p className="lede">
        Tairitsu 的 <b>Branching OS（分支 OS）</b>节点：按「曲包等级 + 分支状态」解锁，不是线性档案。
      </p>
      <h3>分支图（{index.branching.length} 节点，点方块跳转）</h3>
      <BranchMap nodes={index.branching} activeId={node.id} onNavigate={(id) => onNavigate("branching", id)} />

      <Facts
        items={[
          ["解锁等级", node.level ? `Lv${node.level}` : "—"],
          ["分支状态", node.stateId !== undefined ? `StateId ${node.stateId} = ${node.stateValue}` : "—"],
          ["关联谱面", (node.charts ?? []).join("、") || "—"],
          ["位置 / 顺序", `${node.position ?? "—"} / ${node.order ?? "—"}`],
          ["前驱", incoming.map((n) => n.id).join("、") || "—"],
        ]}
      />
      <div className="chips">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("packs", "tairitsu001")}>
          等级解锁 · tairitsu001 →
        </button>
      </div>
      <div className="chips">
        {node.next.map((id) => (
          <button
            type="button"
            key={id}
            className="chip chip-btn"
            onClick={() => byId.has(id) && onNavigate("branching", id)}
          >
            → {id}
          </button>
        ))}
      </div>
      {loading ? <Skeleton rows={5} /> : content ? <Script blocks={content.blocks} videoForImage lang={lang} /> : null}
    </div>
  );
}
