import { isStoryNode } from "./database";
import type { Database, StoryNodeEntity } from "../types";

/**
 * Branching OS projection helpers.
 *
 * The game ships Tairitsu's OS archive as `text/branchingosdata/<source>`: the
 * nodes carry `position` (graph column), `state_id`/`state_value` (the branch
 * state the game writes back) and `next` (the `LinkedFileIds` edges). Nothing
 * here hard-codes the current file, track letters or state numbers: a future
 * branch file shows up as another group, and unknown values fall back to the
 * neutral styling instead of failing.
 */
export interface BranchGroup {
  readonly source: string;
  readonly nodes: StoryNodeEntity[];
  readonly positions: number[];
  /** Track suffixes present in this file (`a`, `b`, `c`, ...), ordered. */
  readonly tracks: string[];
  readonly chartRefs: string[];
}

const TRACK_SUFFIX = /([a-z])$/;

/** `taos001a` -> `a`; merge nodes such as `taos010` carry no track. */
export function branchTrack(node: StoryNodeEntity): string {
  const match = TRACK_SUFFIX.exec(node.game_id);
  return match?.[1] ?? "";
}

/**
 * Unlock gate stored for a node (the owner level lock wins over the node's own
 * `level`). Both are 0-based; callers add 1 to match the level the game shows.
 */
export function branchGate(node: StoryNodeEntity): number | null {
  const lock = node.level_locks?.[0];
  if (lock) {
    return lock.level;
  }
  return node.level ?? null;
}

function compareNodes(left: StoryNodeEntity, right: StoryNodeEntity): number {
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  const leftTrack = branchTrack(left);
  const rightTrack = branchTrack(right);
  if (leftTrack !== rightTrack) {
    if (!leftTrack) {
      return 1;
    }
    if (!rightTrack) {
      return -1;
    }
    return leftTrack.localeCompare(rightTrack);
  }
  return left.game_id.localeCompare(right.game_id);
}

/** Every `story_node(kind=branch)`, ordered by position, then track. */
export function branchNodes(db: Database): StoryNodeEntity[] {
  return (db.entitiesByType.get("story_node") ?? [])
    .filter(
      (entity): entity is StoryNodeEntity =>
        isStoryNode(entity) && entity.kind === "branch",
    )
    .sort(compareNodes);
}

/** Branch nodes grouped by their source file, for the presence of future files. */
export function branchGroups(db: Database): BranchGroup[] {
  const bySource = new Map<string, StoryNodeEntity[]>();
  for (const node of branchNodes(db)) {
    const source = node.source_file ?? "";
    const bucket = bySource.get(source);
    if (bucket) {
      bucket.push(node);
    } else {
      bySource.set(source, [node]);
    }
  }
  return [...bySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, nodes]) => ({
      source,
      nodes,
      positions: [
        ...new Set(
          nodes
            .map((node) => node.position)
            .filter((position): position is number => typeof position === "number"),
        ),
      ].sort((left, right) => left - right),
      tracks: [...new Set(nodes.map(branchTrack).filter(Boolean))].sort(),
      chartRefs: [...new Set(nodes.flatMap((node) => node.charts ?? []))],
    }));
}

export function findBranchNode(db: Database, gameId: string): StoryNodeEntity | null {
  const record = db.entityById.get(`story_node/${gameId}`);
  return record && isStoryNode(record) && record.kind === "branch" ? record : null;
}

/** Nodes whose `next` edge points at `node`; drives the reader's predecessors. */
export function branchPredecessors(
  db: Database,
  node: StoryNodeEntity,
): StoryNodeEntity[] {
  return branchNodes(db).filter((candidate) =>
    (candidate.next ?? []).includes(node.id),
  );
}
