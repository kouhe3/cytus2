import type { BackupNode, Lang } from "../types";

/**
 * Tairitsu 的 Branching OS 分支图。
 *
 * 布局取自数据（`ViewSetting.Position` + 节点 id 的分支后缀）：
 *   x = position（1..21）
 *   y = 分支行：a / b / c 三行；无后缀的收束节点放在中间行，同一列多个时上下错开
 * 连线来自 `ViewSetting.LinkedFileIds`（`next`）。
 */
const COL_W = 168;
const ROW_H = 62;
const NODE_W = 150;
const NODE_H = 26;
const PAD_X = 34;
const PAD_Y = 26;

const ROW_OF: Record<string, number> = { a: 0, b: 1, c: 2 };
const SHARED_ROW = 1;

export function BranchMap({
  nodes,
  activeId,
  lang,
  onNavigate,
}: {
  nodes: BackupNode[];
  activeId?: string;
  lang: Lang;
  onNavigate: (id: string) => void;
}) {
  const positions = [...new Set(nodes.map((n) => n.position ?? 0))].sort((a, b) => a - b);
  const colOf = new Map(positions.map((p, i) => [p, i]));

  // 同一列同一行的节点需要错开：先按分支分行，收束节点叠在中间行
  const rows = new Map<string, number>(); // id -> y 行号（可为小数）
  const used = new Map<string, number>();
  for (const n of nodes) {
    const branchRow = n.branch && n.branch in ROW_OF ? ROW_OF[n.branch] : SHARED_ROW;
    const key = `${n.position ?? 0}:${branchRow}`;
    const k = used.get(key) ?? 0;
    used.set(key, k + 1);
    rows.set(n.id, branchRow + (k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * (0.42 * Math.ceil(k / 2))));
  }

  const width = PAD_X * 2 + (positions.length - 1) * COL_W + NODE_W;
  const height = PAD_Y * 2 + 2 * ROW_H + NODE_H + ROW_H;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 每个节点的落点只算一次，连线与方块共用同一套坐标
  const at = new Map(
    nodes.map((n) => [
      n.id,
      {
        x: PAD_X + (colOf.get(n.position ?? 0) ?? 0) * COL_W,
        y: PAD_Y + (rows.get(n.id) ?? SHARED_ROW) * ROW_H,
      },
    ]),
  );

  return (
    <div className="branch-map">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="分支图">
        {(["a", "b", "c"] as const).map((lane, i) => (
          <text key={lane} x={10} y={PAD_Y + i * ROW_H + NODE_H / 2 + 4} className="branch-node-label" opacity={0.55}>
            {lane}
          </text>
        ))}
        {nodes.flatMap((n) =>
          n.next
            .filter((id) => byId.has(id))
            .map((id) => {
              const t = byId.get(id)!;
              const from = at.get(n.id)!;
              const to = at.get(t.id)!;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              // 跨越多列的「跳线」（如 taos010 → taos011，位置 10 → 19）用虚线拱到节点上方，避免被方块盖住
              const jump = Math.abs((t.position ?? 0) - (n.position ?? 0)) > 2;
              const lift = jump ? Math.max(y1, y2) + ROW_H * 0.9 : null;
              return (
                <path
                  key={`${n.id}->${id}`}
                  d={
                    jump
                      ? `M ${x1} ${y1} C ${x1 + 24} ${lift}, ${x2 - 24} ${lift}, ${x2} ${y2}`
                      : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
                  }
                  fill="none"
                  stroke={jump ? "var(--accent)" : "var(--border)"}
                  strokeWidth={1}
                  strokeDasharray={jump ? "4 3" : undefined}
                  opacity={jump ? 0.75 : 1}
                />
              );
            }),
        )}
        {nodes.map((n) => {
          const { x, y } = at.get(n.id)!;
          const active = n.id === activeId;
          const name = n.names?.[lang] || n.id;
          const label = name.length > 20 ? `${name.slice(0, 19)}…` : name;
          return (
            <g
              key={n.id}
              className="branch-node"
              transform={`translate(${x},${y})`}
              onClick={() => onNavigate(n.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onNavigate(n.id);
              }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={active ? "var(--surface)" : "transparent"}
                stroke={active ? "var(--accent)" : "var(--border)"}
              />
              <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" className="branch-node-label">
                {label}
              </text>
              <title>{`${n.names?.[lang] || n.id} · ${n.id} · Lv${n.level ?? "?"} · 分支 ${n.branch || "收束"}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
