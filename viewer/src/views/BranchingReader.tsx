import type { ExtraContent, IndexData, Lang } from "../types";
import { Script } from "../components/Script";
import { Chip, Facts, Skeleton } from "../components/ui";

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
      <p className="lede">分支图节点（ViewSetting.Position / LinkedFileIds），不是线性档案。</p>
      <Facts
        items={[
          ["位置", node.position ?? "—"],
          ["顺序", node.order ?? "—"],
          ["类型", node.type],
          ["前驱", incoming.map((n) => n.id).join("、") || "—"],
        ]}
      />
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
