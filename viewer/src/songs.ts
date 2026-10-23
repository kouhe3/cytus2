import type { SongCatalog, SongInfo } from "./types";

/** Difficulties 枚举（dump.cs）：0 Easy / 1 Hard / 2 Chaos / 3 Glitch / 4 Crash / 5 Dream / 6 Drop */
export const DIFF_LABEL: Record<number, string> = {
  0: "简单",
  1: "困难",
  2: "混沌",
  3: "Glitch",
  4: "Crash",
  5: "Dream",
  6: "Drop",
};

export type ChartRef = { song: string; d: number };

/** 歌曲与获取方式的路由 id：extras/songs|<songId>（| 由 navigate 负责编码） */
export function songsRoute(focus: string) {
  return `songs|${focus}`;
}

/** 曲目 id → 曲目信息（曲包 + 其它 + DLC，先到先得） */
export function songIndex(catalog: SongCatalog | undefined): Map<string, SongInfo> {
  const map = new Map<string, SongInfo>();
  if (!catalog) return map;
  for (const pack of catalog.packs) for (const s of pack.songs) map.set(s.id, s);
  for (const s of catalog.other) if (!map.has(s.id)) map.set(s.id, s);
  for (const pack of catalog.expansion) for (const s of pack.songs) if (!map.has(s.id)) map.set(s.id, s);
  return map;
}

/** 把 {song,d} 列表按曲目聚合并按难度序号排序 */
export function groupBySong(items: ChartRef[]): { song: string; diffs: number[] }[] {
  const bySong = new Map<string, Set<number>>();
  for (const it of items) {
    let set = bySong.get(it.song);
    if (!set) bySong.set(it.song, (set = new Set()));
    set.add(it.d);
  }
  return [...bySong.entries()].map(([song, diffs]) => ({
    song,
    diffs: [...diffs].sort((a, b) => a - b),
  }));
}

function uniq(items: ChartRef[]): ChartRef[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.song}#${it.d}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** iM 帖 / 分支节点解锁的谱面（unlocks 的 ref 就是帖 id 或节点 id） */
export function chartsForRef(catalog: SongCatalog | undefined, ref: string): ChartRef[] {
  if (!catalog) return [];
  const out: ChartRef[] = [];
  for (const [song, list] of Object.entries(catalog.unlocks)) {
    for (const u of list) if (u.ref === ref) out.push({ song, d: u.d });
  }
  return uniq(out);
}

/** OS 档案的 UnlockCharts */
export function chartsForOs(catalog: SongCatalog | undefined, ref: string): ChartRef[] {
  if (!catalog) return [];
  const out: ChartRef[] = [];
  for (const [song, list] of Object.entries(catalog.osCharts)) {
    for (const u of list) if (u.ref === ref) out.push({ song, d: u.d });
  }
  return uniq(out);
}

/** storychartunlock：通关某段剧情解锁的谱面 */
export function chartsForStory(catalog: SongCatalog | undefined, storyId: string): ChartRef[] {
  if (!catalog) return [];
  const out: ChartRef[] = [];
  for (const [song, list] of Object.entries(catalog.storyCharts)) {
    for (const it of list) if (it.story === storyId) out.push({ song, d: it.d });
  }
  return uniq(out);
}

/** OA 分析记录奖励：按物件 id（如 paff001_obj001） */
export function chartsForOaObject(catalog: SongCatalog | undefined, objectId: string): ChartRef[] {
  if (!catalog) return [];
  const out: ChartRef[] = [];
  for (const [song, list] of Object.entries(catalog.oaCharts)) {
    for (const u of list) if (u.ref === objectId) out.push({ song, d: u.d });
  }
  return uniq(out);
}

/** OA 角色的全部奖励谱面（按 ref 前缀归属）；补上同角色 iM/OS 之外的 OA 来源 */
export function chartsForOaCharacter(catalog: SongCatalog | undefined, character: string): ChartRef[] {
  if (!catalog) return [];
  const out: ChartRef[] = [];
  for (const [song, list] of Object.entries(catalog.oaCharts)) {
    for (const u of list) if (u.character === character || u.ref.startsWith(`${character}_obj`)) out.push({ song, d: u.d });
  }
  return uniq(out);
}
