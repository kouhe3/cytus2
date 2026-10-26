import { isBossStage, isStoryNode } from "./database";
import type { BossStageEntity, Database, StoryNodeEntity } from "../types";

/**
 * Branching OS projection helpers.
 *
 * The game ships Tairitsu's OS archive as `text/branchingosdata/<source>`: the
 * nodes carry `position` (graph column), `order` (the line the node sits on),
 * `state_id`/`state_value` (the unlock state the game checks) and `next` (the
 * `LinkedFileIds` edges). Nothing here hard-codes the current file or the
 * `a`/`b`/`c` suffixes: a future branch file shows up as another group, and
 * unknown values fall back to the neutral styling instead of failing.
 */
export interface BranchGroup {
  readonly source: string;
  readonly nodes: StoryNodeEntity[];
  readonly positions: number[];
  readonly chartRefs: string[];
}

/** One node placed on the graph: `column` is `position`, `row` is derived. */
export interface BranchPlacement {
  readonly node: StoryNodeEntity;
  readonly column: number;
  readonly row: number;
}

const DEFAULT_ORDER = 1;

function orderOf(node: StoryNodeEntity): number {
  return Math.max((node.order ?? DEFAULT_ORDER) - 1, 0);
}

function compareNodes(left: StoryNodeEntity, right: StoryNodeEntity): number {
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  return (
    (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER) ||
    left.game_id.localeCompare(right.game_id)
  );
}

/**
 * Unlock gate stored for a node (the owner level lock wins over the node's own
 * `level`).
 *
 * The value is the level the game shows, not a 0-based index: the game's
 * `BranchingOS.UnlockStateResolver` compares it against `Progress + 1`, the
 * level this loop displays, so `7` means Lv 7.
 */
export function branchGate(node: StoryNodeEntity): number | null {
  const lock = node.level_locks?.[0];
  if (lock) {
    return lock.level;
  }
  return node.level ?? null;
}

/** Every `story_node(kind=branch)`, ordered by position, then order. */
export function branchNodes(db: Database): StoryNodeEntity[] {
  return (db.entitiesByType.get("story_node") ?? [])
    .filter(
      (entity): entity is StoryNodeEntity =>
        isStoryNode(entity) && entity.kind === "branch",
    )
    .sort(compareNodes);
}

/**
 * Rows come from the data, not from the id suffix: a column that holds several
 * nodes puts them on the lines their `order` names (ties keep the id order and
 * step down one line each), and a column that holds a single node sits on the
 * average of its predecessors — so a merge point lands between its inputs and
 * the final stubs stay aligned with the tracks they end (20 with 18a, 21 with
 * 18b, 11 on the third line).
 */
export function branchPlacements(nodes: StoryNodeEntity[]): BranchPlacement[] {
  const columns = new Map<number, StoryNodeEntity[]>();
  for (const node of nodes) {
    const position = node.position ?? 0;
    const bucket = columns.get(position);
    if (bucket) {
      bucket.push(node);
    } else {
      columns.set(position, [node]);
    }
  }

  const predecessors = new Map<string, StoryNodeEntity[]>();
  for (const node of nodes) {
    for (const nextId of node.next ?? []) {
      const bucket = predecessors.get(nextId);
      if (bucket) {
        bucket.push(node);
      } else {
        predecessors.set(nextId, [node]);
      }
    }
  }

  const rowOf = new Map<string, number>();
  for (const position of [...columns.keys()].sort((left, right) => left - right)) {
    const column = columns.get(position) ?? [];
    if (column.length === 1) {
      const [node] = column;
      if (!node) {
        continue;
      }
      const rows = (predecessors.get(node.id) ?? [])
        .map((predecessor) => rowOf.get(predecessor.id))
        .filter((row): row is number => typeof row === "number");
      rowOf.set(
        node.id,
        rows.length > 0
          ? rows.reduce((sum, row) => sum + row, 0) / rows.length
          : orderOf(node),
      );
      continue;
    }
    let previous: number | null = null;
    for (const node of [...column].sort(compareNodes)) {
      const row = Math.max(
        orderOf(node),
        previous === null ? 0 : previous + 1,
      );
      rowOf.set(node.id, row);
      previous = row;
    }
  }

  const columnOf = new Map(
    [...columns.keys()].sort((left, right) => left - right).map((position, index) => [position, index]),
  );
  return nodes.map((node) => ({
    node,
    column: columnOf.get(node.position ?? 0) ?? 0,
    row: rowOf.get(node.id) ?? orderOf(node),
  }));
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

/**
 * `UnlockCondition.StateId` semantics (the game's `BranchingOS.StateId` enum).
 *
 * `-1` means the node unlocks on level alone; `0`/`1` read the two loop group
 * states, `2`/`3` the tap result of the matching branch point
 * (`BranchingSelect`: 0 = Leave, 1 = Hit), and `4` lists file ids that must be
 * read first. The SPA keeps the raw values and only names the field.
 */
export type BranchStateKind =
  | "level"
  | "group1"
  | "group2"
  | "select1"
  | "select2"
  | "afterFiles";

export interface BranchState {
  readonly kind: BranchStateKind;
  /** Required values; empty for `level`. `afterFiles` values are file ids. */
  readonly values: string[];
}

const STATE_KINDS: Record<number, BranchStateKind> = {
  [-1]: "level",
  0: "group1",
  1: "group2",
  2: "select1",
  3: "select2",
  4: "afterFiles",
};

export function branchState(node: StoryNodeEntity): BranchState {
  const kind = STATE_KINDS[node.state_id ?? -1] ?? "level";
  const values = (node.state_value ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return { kind, values };
}

/**
 * Stories the game starts when this node is picked: their `trigger_branch_id`
 * comes from the `TOUCH_BOS_<file id>` step in the story class.
 */
export function branchStories(
  db: Database,
  node: StoryNodeEntity,
): StoryNodeEntity[] {
  return (db.entitiesByType.get("story_node") ?? [])
    .filter(
      (entity): entity is StoryNodeEntity =>
        isStoryNode(entity) &&
        entity.kind === "event" &&
        triggerNamesNode(entity.trigger_branch_id, node.game_id),
    )
    .sort((left, right) => left.game_id.localeCompare(right.game_id));
}

/**
 * Whether a story's `trigger_branch_id` selects this node.
 *
 * Most triggers are the exact file id (`taos010`). The node-12 cutscene is the
 * exception the branch table itself creates: the story class carries
 * `TOUCH_BOS_TAOS012` while the node is split into the route variants
 * `taos012a` / `taos012b`, so a trigger that matches no file of its own still
 * claims the single-letter variants it prefixes.
 */
function triggerNamesNode(
  trigger: string | null | undefined,
  nodeId: string,
): boolean {
  if (!trigger) {
    return false;
  }
  if (trigger === nodeId) {
    return true;
  }
  return (
    nodeId.length === trigger.length + 1 &&
    nodeId.startsWith(trigger) &&
    /[a-z]/.test(nodeId.slice(-1))
  );
}

/** Boss stages the triggered stories play, in story order and deduped. */
export function branchBossStages(
  db: Database,
  node: StoryNodeEntity,
): BossStageEntity[] {
  const stages: BossStageEntity[] = [];
  const seen = new Set<string>();
  for (const story of branchStories(db, node)) {
    for (const reference of story.boss_stages ?? []) {
      const id = reference.entity_id;
      if (!id || seen.has(id)) {
        continue;
      }
      const record = db.entityById.get(id);
      if (!record || !isBossStage(record)) {
        continue;
      }
      seen.add(id);
      stages.push(record);
    }
  }
  return stages;
}

/**
 * Whether selecting the node opens the OS file reader.
 *
 * The game's `BranchingOSPresenter._ShouldSkipByStory` is
 * `(file.Type & ~1) == 8`, i.e. `BranchingPoint` (8) and `Ending` (9) nodes
 * never show their body: selecting them starts the node's story, which plays
 * the cutscene / boss stage and settles the reward. `TrueEnding` (10) still
 * opens the reader.
 */
export function branchOpensReader(node: StoryNodeEntity): boolean {
  return ((node.node_type ?? 0) & ~1) !== 8;
}

/** Cutscene clips the node's stories play, deduped. */
export function branchStoryMovies(
  db: Database,
  node: StoryNodeEntity,
): string[] {
  const movies: string[] = [];
  for (const story of branchStories(db, node)) {
    for (const movie of story.movie_files ?? []) {
      if (!movies.includes(movie)) {
        movies.push(movie);
      }
    }
  }
  return movies;
}
