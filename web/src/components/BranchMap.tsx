import { useLayoutEffect, useRef, useState } from "react";
import { branchTrack } from "../data/branch";
import { useI18n } from "../data/i18n";
import type { StoryNodeEntity } from "../types";

/**
 * Branching OS graph: columns are `position`, rows are track suffixes resolved
 * from the ids, and the edges come from `next` (the game's `LinkedFileIds`).
 * Edges are right-angle elbows like the in-game graph, not curves.
 * Nodes without a track suffix (merge and terminal nodes) share the middle row
 * and stack vertically when one column holds several of them.
 */
const MAX_COL_W = 58;
/** Below this a short id such as `12a` stops fitting inside the node. */
const MIN_COL_W = 30;
const ROW_H = 54;
const MAX_NODE_W = 46;
const NODE_H = 20;
const PAD_X = 16;
const PAD_Y = 18;
const STACK_STEP = 22;

interface Placement {
  readonly column: number;
  readonly row: number;
  readonly offset: number;
}

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

  const positions = [
    ...new Set(nodes.map((node) => node.position ?? 0)),
  ].sort((left, right) => left - right);
  const tracks = [...new Set(nodes.map(branchTrack).filter(Boolean))].sort();
  const rows = Math.max(tracks.length, 1);
  const sharedRow = Math.floor(rows / 2);
  const columnOf = new Map(positions.map((position, index) => [position, index]));
  // Budget the widest node so the computed graph always fits its column.
  const usable = Math.max(available - PAD_X * 2 - MAX_NODE_W, 0);
  const columns = Math.max(positions.length - 1, 1);
  const colW = Math.min(
    MAX_COL_W,
    Math.max(MIN_COL_W, usable > 0 ? usable / columns : MAX_COL_W),
  );
  const nodeW = Math.min(MAX_NODE_W, colW - 6);

  const cells = new Map<string, StoryNodeEntity[]>();
  for (const node of nodes) {
    const column = columnOf.get(node.position ?? 0) ?? 0;
    const track = branchTrack(node);
    const row = track ? Math.max(tracks.indexOf(track), 0) : sharedRow;
    const key = `${column}:${row}`;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      cells.set(key, [node]);
    }
  }

  const placed = new Map<string, Placement>();
  for (const [key, bucket] of cells) {
    const [columnText, rowText] = key.split(":");
    const step = bucket.length > 1 ? STACK_STEP : 0;
    bucket.forEach((node, index) => {
      placed.set(node.id, {
        column: Number(columnText),
        row: Number(rowText),
        offset: (index - (bucket.length - 1) / 2) * step,
      });
    });
  }

  const left = (placement: Placement) => PAD_X + placement.column * colW;
  const top = (placement: Placement) => PAD_Y + placement.row * ROW_H + placement.offset;
  const width = PAD_X * 2 + Math.max(positions.length - 1, 0) * colW + nodeW;
  const height = PAD_Y * 2 + Math.max(rows - 1, 0) * ROW_H + NODE_H;

  const edges: string[] = [];
  for (const node of nodes) {
    const from = placed.get(node.id);
    if (!from) {
      continue;
    }
    const x1 = left(from) + nodeW;
    const y1 = top(from) + NODE_H / 2;
    for (const nextId of node.next ?? []) {
      const to = placed.get(nextId);
      if (!to) {
        continue;
      }
      const x2 = left(to);
      const y2 = top(to) + NODE_H / 2;
      // Mid-column elbow: the game draws Branching OS edges as square lines.
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
        {nodes.map((node) => {
          const placement = placed.get(node.id);
          if (!placement) {
            return null;
          }
          const x = left(placement);
          const y = top(placement);
          return (
            <g
              key={node.id}
              className={classNames(node, activeId)}
              data-testid="branch-map-node"
              data-node-id={node.id}
              data-state={node.state_id ?? ""}
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
