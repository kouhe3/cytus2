import { useLayoutEffect, useRef, useState } from "react";
import { branchPlacements } from "../data/branch";
import { useI18n } from "../data/i18n";
import type { StoryNodeEntity } from "../types";

/**
 * Branching OS graph. Both axes come from the projection: columns are
 * `position`, and `branchPlacements` derives the row from `order` plus the
 * `next` edges (see that helper), so the graph never parses the id suffix.
 * Edges are right-angle elbows like the in-game graph, not curves.
 */
const MAX_COL_W = 58;
/** Below this a short id such as `12a` stops fitting inside the node. */
const MIN_COL_W = 30;
const ROW_H = 54;
const MAX_NODE_W = 46;
const NODE_H = 20;
const PAD_X = 16;
const PAD_Y = 18;

/** `taos001a` -> `1a`, `taos010` -> `10`. */
function shortLabel(gameId: string): string {
  const trimmed = gameId.replace(/^[a-z]+0*/, "");
  return trimmed || gameId;
}

function classNames(node: StoryNodeEntity, activeId: string | undefined): string {
  const classes = ["branch-node"];
  if (node.state_id === -1) {
    classes.push("is-merge");
  }
  if ((node.next ?? []).length === 0) {
    classes.push("is-end");
  }
  if (node.id === activeId) {
    classes.push("is-active");
  }
  return classes.join(" ");
}

export function BranchMap({
  nodes,
  activeId,
  onOpen,
}: {
  nodes: StoryNodeEntity[];
  activeId?: string;
  onOpen: (gameId: string) => void;
}) {
  const i18n = useI18n();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);

  // The graph is as wide as its data; size the columns to the reader's column
  // so a wide window shows every position without a horizontal scroll.
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) {
      return;
    }
    // Measure before the first paint so the graph never flashes at the
    // maximum column width and pushes its own scrollbar in.
    setAvailable(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setAvailable(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placements = branchPlacements(nodes);
  const lastColumn = placements.reduce(
    (max, placement) => Math.max(max, placement.column),
    0,
  );
  const lastRow = placements.reduce(
    (max, placement) => Math.max(max, placement.row),
    0,
  );
  // Budget the widest node so the computed graph always fits its column.
  const usable = Math.max(available - PAD_X * 2 - MAX_NODE_W, 0);
  const colW = Math.min(
    MAX_COL_W,
    Math.max(MIN_COL_W, usable > 0 ? usable / Math.max(lastColumn, 1) : MAX_COL_W),
  );
  const nodeW = Math.min(MAX_NODE_W, colW - 6);

  const left = (column: number) => PAD_X + column * colW;
  const top = (row: number) => PAD_Y + row * ROW_H;
  const width = PAD_X * 2 + lastColumn * colW + nodeW;
  const height = PAD_Y * 2 + lastRow * ROW_H + NODE_H;
  const byId = new Map(placements.map((placement) => [placement.node.id, placement]));
  const gapX = Math.max((colW - nodeW) / 2, 3);
  /** Rows already used by a node strictly between two columns. */
  const rowTaken = (
    from: { column: number },
    to: { column: number },
    row: number,
  ) =>
    placements.some(
      (placement) =>
        placement.column > Math.min(from.column, to.column) &&
        placement.column < Math.max(from.column, to.column) &&
        Math.abs(placement.row - row) < 0.01,
    );

  const edges: string[] = [];
  for (const placement of placements) {
    const x1 = left(placement.column) + nodeW;
    const y1 = top(placement.row) + NODE_H / 2;
    // A short elbow bends in the gap between two columns; an edge that skips
    // more than one column would run through the boxes of the row it starts
    // in, so it takes a lane in the row gutter on the target's side instead.
    const gutter = Math.max(ROW_H - NODE_H - 14, 8);
    for (const nextId of placement.node.next ?? []) {
      const to = byId.get(nextId);
      if (!to) {
        continue;
      }
      const x2 = left(to.column);
      const y2 = top(to.row) + NODE_H / 2;
      if (Math.abs(to.column - placement.column) > 1) {
        // Two bends are enough when one of the two rows is empty between the
        // columns: drop on the target's row and run in, otherwise run out on
        // the source's row and drop at the end.
        if (!rowTaken(placement, to, to.row)) {
          const dropX = Math.round(x1 + gapX);
          edges.push(`M ${x1} ${y1} L ${dropX} ${y1} L ${dropX} ${y2} L ${x2} ${y2}`);
          continue;
        }
        if (!rowTaken(placement, to, placement.row)) {
          const dropX = Math.round(x2 - gapX);
          edges.push(`M ${x1} ${y1} L ${dropX} ${y1} L ${dropX} ${y2} L ${x2} ${y2}`);
          continue;
        }
        // Both rows are occupied in between: take a lane in the row gutter on
        // the target's side so the detour never crosses the rows.
        const exitX = Math.round(x1 + gapX);
        const entryX = Math.round(x2 - gapX);
        const above = top(placement.row) - gutter;
        const laneY =
          y2 > y1 || above < NODE_H / 2
            ? top(placement.row) + NODE_H + gutter
            : above;
        edges.push(
          `M ${x1} ${y1} L ${exitX} ${y1} L ${exitX} ${laneY} L ${entryX} ${laneY} L ${entryX} ${y2} L ${x2} ${y2}`,
        );
        continue;
      }
      const midX = Math.round((x1 + x2) / 2);
      edges.push(`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
    }
  }

  return (
    <div className="branch-map-wrap" ref={wrapRef}>
      <svg
        className="branch-map"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={i18n.t("branch.mapAria")}
        data-testid="branch-map"
      >
        <g className="branch-edges" aria-hidden="true">
          {edges.map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
        {placements.map((placement) => {
          const node = placement.node;
          const x = left(placement.column);
          const y = top(placement.row);
          return (
            <g
              key={node.id}
              className={classNames(node, activeId)}
              data-testid="branch-map-node"
              data-node-id={node.id}
              data-state={node.state_id ?? ""}
              data-row={placement.row}
              role="link"
              tabIndex={0}
              aria-label={node.game_id}
              onClick={() => onOpen(node.game_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(node.game_id);
                }
              }}
            >
              <title>{node.game_id}</title>
              <rect x={x} y={y} width={nodeW} height={NODE_H} rx="4" />
              <text
                x={x + nodeW / 2}
                y={y + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {shortLabel(node.game_id)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
