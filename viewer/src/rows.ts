import type { IndexData, Lang } from "./types";
import { characterName, formatDate, tierLabel } from "./data";

export interface Row {
  key: string;
  view: string;
  id: string;
  title: string;
  sub?: string;
  badge?: string;
  group?: string;
  subgroup?: string;
  kind?: "group" | "entry";
  avatar?: string;
}

export interface ArchiveFilters {
  chapter: string;
  version: string;
  /** TIMELINE CHAPTER 的文件夹 */
  folder: string;
  /** TIMELINE BY VERSION 的角色（与文件夹互不复用） */
  character: string;
}

export const EMPTY_FILTERS: ArchiveFilters = { chapter: "", version: "", folder: "", character: "" };

export const hasFilters = (f: ArchiveFilters) =>
  Boolean(f.chapter || f.version || f.folder || f.character);

/**
 * TIMELINE BY CHAPTER 的显示顺序由作者手动维护（Chapter 数据只有 Id/Name/Category，
 * 侧章 Index 从 1 重新计数、曲包等级也都从 0 起，代码里没有排序表）。
 * 这里按 Wiki 记载的当前顺序维护：As of 4.6，Extra Chapter「Amiya」位于 chapter 2 与 3 之间。
 */
const CHAPTER_ORDER = [
  "Architects",
  "Decommission",
  "Amiya",
  "cyTus",
  "The Silence",
  "Vanessa",
  "The Lost",
  "Loom",
  "Another Me",
  "Buried",
  "The New World",
  "Miku",
  "Kizuna AI",
  "Alice",
  "Hans",
  "Graff.J",
  "Kaf",
];

const chapterOrderIndex = (name: string) => {
  const i = CHAPTER_ORDER.indexOf(name);
  return i < 0 ? CHAPTER_ORDER.length : i;
};

/** test01 / test02 是数据里的暂存章，游戏 TIMELINE BY CHAPTER 不显示它们 */
const isUnassignedChapter = (chapter: string) => /^test\d+$/i.test(chapter);

const semverKey = (v: string) => v.split(".").map((n) => Number(n) || 0);

const cmpVersionDesc = (a: string, b: string) => {
  const ka = semverKey(a);
  const kb = semverKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (kb[i] ?? -1) - (ka[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

export interface FilterOptions {
  chapters: string[];
  versions: string[];
  folders: string[];
  characters: string[];
}

/** 每个筛选器只考虑其它两个筛选器后的候选值（空结果的条件不出现在下拉里） */
export function filterOptions(index: IndexData, f: ArchiveFilters): FilterOptions {
  const osById = new Map(index.os.map((e) => [e.id, e]));
  const chapters = new Set<string>();
  const versions = new Set<string>();
  const folders = new Set<string>();
  const characters = new Set<string>();
  for (const id of index.timeline) {
    const e = osById.get(id);
    if (!e) continue;
    const byVersion = !f.version || e.category === f.version;
    const byChapter = !f.chapter || e.chapter === f.chapter;
    const byFolder = !f.folder || e.folder === f.folder;
    const byCharacter = !f.character || e.character === f.character;
    if (byVersion && byFolder && byCharacter) chapters.add(e.chapter);
    if (byChapter && byFolder && byCharacter && e.category) versions.add(e.category);
    if (byChapter && byVersion && byCharacter) folders.add(e.folder);
    if (byChapter && byVersion && byFolder) characters.add(e.character);
  }
  return {
    chapters: index.chapters
      .filter((c) => chapters.has(c.name))
      .sort((a, b) => chapterOrderIndex(a.name) - chapterOrderIndex(b.name))
      .map((c) => c.name),
    versions: [...versions].sort(cmpVersionDesc),
    folders: index.folders.filter((x) => folders.has(x.name)).map((x) => x.name),
    characters: [...characters].sort((a, b) => a.localeCompare(b)),
  };
}

/** 丢弃在当前其它筛选器下已无结果的选择 */
export function sanitizeFilters(
  filters: ArchiveFilters,
  options: FilterOptions,
): ArchiveFilters {
  return {
    chapter: filters.chapter && !options.chapters.includes(filters.chapter) ? "" : filters.chapter,
    version: filters.version && !options.versions.includes(filters.version) ? "" : filters.version,
    folder: filters.folder && !options.folders.includes(filters.folder) ? "" : filters.folder,
    character:
      filters.character && !options.characters.includes(filters.character) ? "" : filters.character,
  };
}

export type TimelineMode = "chapter" | "version";

export const TIMELINE_MODES: { id: TimelineMode; label: string }[] = [
  { id: "chapter", label: "按章节" },
  { id: "version", label: "按版本" },
];

export const VIEWS = [
  { id: "timeline", label: "时间线", countKey: "osEntries" },
  { id: "packs", label: "曲包阶梯", countKey: "packs" },
  { id: "im", label: "iM 社群", countKey: "imTopics" },
  { id: "backup", label: "备份数据库", countKey: "galleryItems" },
  { id: "gates", label: "结局闸", countKey: "gates" },
  { id: "oa", label: "OA 系统", countKey: "oaObjects" },
  { id: "branching", label: "分支剧情", countKey: "backupNodes" },
  { id: "extras", label: "附录", countKey: "" },
] as const;

const chapterOrder = (index: IndexData) =>
  new Map(index.chapters.map((c, i) => [c.name, { i, chapter: c }]));

export function isOsId(index: IndexData, id: string): boolean {
  return index.os.some((e) => e.id === id);
}

export function rowsFor(
  index: IndexData,
  view: string,
  lang: Lang,
  filters: ArchiveFilters = EMPTY_FILTERS,
  mode: TimelineMode = "chapter",
  imFilter: string = "",
): Row[] {
  switch (view) {
    case "timeline": {
      const osById = new Map(index.os.map((e) => [e.id, e]));
      const chapterRank = new Map(index.chapters.map((c) => [c.name, chapterOrderIndex(c.name)]));

      // 第一层：TIMELINE BY CHAPTER —— 章节列表（游戏里点进去才看到档案）
      if (mode === "chapter" && !filters.chapter) {
        return index.chapters
          .filter((c) => !isUnassignedChapter(c.name))
          .sort((a, b) => chapterOrderIndex(a.name) - chapterOrderIndex(b.name))
          .map((c) => {
            const es = index.os.filter((e) => e.chapter === c.name);
            const folders = new Set(es.map((e) => e.folder));
            const dates = es.map((e) => e.date).filter(Boolean).sort();
            return {
              key: `chapter:${c.name}`,
              view: "timeline",
              id: `chapter:${c.name}`,
              kind: "group" as const,
              title: c.name,
              sub: `${es.length} 条 · 角色 ${folders.size}${
                dates.length ? ` · ${formatDate(dates[0])}` : ""
              }`,
              badge: c.category === 0 ? "主线" : "联动",
            };
          });
      }

      const pool = index.timeline.filter((id) => {
        const e = osById.get(id);
        if (!e) return false;
        // 未进 CHAPTER 的档案（test01/test02，如 5.3 的 paos001-018）只在版本视图出现
        if (isUnassignedChapter(e.chapter) && mode === "chapter") return false;
        if (filters.chapter && e.chapter !== filters.chapter) return false;
        if (filters.version && e.category !== filters.version) return false;
        if (filters.folder && e.folder !== filters.folder) return false;
        if (filters.character && e.character !== filters.character) return false;
        return true;
      });

      // 第二层：CHAPTER 视图按 FOLDER、VERSION 视图按角色分组，两者不混用
      // 版本视图里若已锁定单个角色（= 游戏里「点角色 → 按版本分组」那个视图），按版本号分组
      const byVersion = mode === "version" && Boolean(filters.character);
      const keyOf = (e?: { folder: string; character: string; category: string | null }) => {
        if (mode === "chapter") return e?.folder && e.folder !== "N/A" ? e.folder : "未分类";
        if (byVersion) return e?.category || "未知版本";
        return e?.character || "未知角色";
      };
      const ordered = [...pool].sort((a, b) => {
        const ea = osById.get(a);
        const eb = osById.get(b);
        return (
          keyOf(ea).localeCompare(keyOf(eb)) ||
          (ea?.folder ?? "").localeCompare(eb?.folder ?? "") ||
          (chapterRank.get(ea?.chapter ?? "") ?? 99) - (chapterRank.get(eb?.chapter ?? "") ?? 99) ||
          (ea?.index ?? 0) - (eb?.index ?? 0)
        );
      });
      return ordered.map((id) => {
        const e = osById.get(id);
        return {
          key: id,
          view: "timeline",
          id,
          kind: "entry" as const,
          title: e ? e.names[lang] : id,
          sub: `${
            mode === "version" && e && !isUnassignedChapter(e.chapter) ? `${e.chapter} · ` : ""
          }${formatDate(e?.date ?? "")}`,
          badge: id,
          group: keyOf(e),
        };
      });
    }
    case "packs":
      return index.packs.map((p) => ({
        key: p.id,
        view: "packs",
        id: p.id,
        title: characterName(index, p.id),
        sub: `${tierLabel(index, p.id) ? `${tierLabel(index, p.id)} · ` : ""}iM ${p.imCount} · OS ${p.osCount} · 同步 ${p.syncCount}`,
        badge: p.id,
      }));
    case "im": {
      // 账户过滤器：filter item 的 avatar id 作为 key；"other" 表示不属于任何主角账号
      const flt = index.imFilters;
      const covered = new Set((flt?.items ?? []).flatMap((it) => it.avatars));
      const match = (avatar: string) => {
        if (!imFilter) return true;
        if (imFilter === "other") return !covered.has(avatar);
        const item = flt?.items.find((it) => it.avatar === imFilter);
        return item ? item.avatars.includes(avatar) : true;
      };
      // 按阅读阶段排序（阶段由脚本推导：角色等级硬上限 + 剧情触发 + 帖子依赖）
      return [...index.im]
        .filter((t) => match(t.avatar))
        .sort((a, b) => (a.readIndex ?? 10_000) - (b.readIndex ?? 10_000))
        .map((t) => ({
          key: t.id,
          view: "im",
          id: t.id,
          title: t.titles[lang] || t.id,
          sub: `${t.storyTrigger ? "⚑ " : ""}#${t.readIndex ?? "?"}${t.cost ? ` · 解锁成本 ${t.cost}` : ""}${
            t.external ? ` · 外部：${t.external}` : ""
          }${t.branch ? ` · 分支：${t.branch}` : ""} · ${t.author} · ${t.replies} 回复`,
          group: `阶段 ${t.stage ?? "?"}${t.lockLevel ? `（≤Lv${t.lockLevel}）` : ""}`,
          badge: t.id,
          avatar: t.avatar,
        }));
    }
    case "gates": {
      // 全部剧情事件（dump.cs 的 Story 类），并附上「锁定多少 iM 帖」这个剧情闸信息
      const gated = new Map(index.gates.map((g) => [g.id, g.topics]));
      const events = index.storyEvents ?? index.gates.map((g) => ({ id: g.id, cls: "" }));
      const category = (id: string) =>
        id.startsWith("story_ending")
          ? "结局"
          : id.includes("tairitsu")
            ? "Tairitsu 分支"
            : /^story0[1-9]|^story1|^story01_new/.test(id)
              ? "主线节点"
              : "角色线";
      return events.map((e) => {
        const topics = gated.get(e.id) ?? [];
        const bits = [
          "trigger_topic_id" in e && e.trigger_topic_id ? `帖 ${e.trigger_topic_id}` : "",
          "trigger_os_id" in e && e.trigger_os_id ? `OS ${e.trigger_os_id}` : "",
          "boss_stage_id" in e && e.boss_stage_id ? `BOSS ${e.boss_stage_id}` : "",
          topics.length ? `锁 ${topics.length} 帖` : "",
        ].filter(Boolean);
        return {
          key: e.id,
          view: "gates",
          id: e.id,
          title: e.id,
          sub: bits.join(" · ") || "—",
          badge: "cls" in e ? e.cls : undefined,
          group: category(e.id),
        };
      });
    }
    case "oa":
      return index.oa.map((c) => ({
        key: c.character,
        view: "oa",
        id: c.character,
        title: characterName(index, c.character),
        sub: `物件 ${c.objects.length} · 描述 ${c.descriptions.length} · 文件 ${c.documents.length}`,
        badge: c.character,
      }));
    case "backup": {
      const counts = new Map<string, number>();
      for (const it of index.gallery.items) counts.set(it.folder, (counts.get(it.folder) ?? 0) + 1);
      return index.gallery.folders.map((f) => ({
        key: f.id,
        view: "backup",
        id: f.id,
        title: f.name,
        sub: `${tierLabel(index, f.id) ? `${tierLabel(index, f.id)} · ` : ""}${counts.get(f.id) ?? 0} 个文件`,
        avatar: f.avatar && f.avatar !== "gallery" ? f.avatar : undefined,
      }));
    }
    case "branching": {
      const sorted = [...index.branching].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
      );
      return sorted.map((n) => ({
        key: n.id,
        view: "branching",
        id: n.id,
        title: n.id,
        sub: `位置 ${n.position ?? "—"} · 后继 ${n.next.join("、") || "—"}`,
        group: n.branch ? `分支 ${n.branch.toUpperCase()}` : "收束段",
      }));
    }
    case "extras":
      return [
        { key: "audio", view: "extras", id: "audio", title: "语音字幕", sub: "57 条角色语音" },
        { key: "assistants", view: "extras", id: "assistants", title: "iM 助手对话", sub: "19 组" },
        { key: "cutscenes", view: "extras", id: "cutscenes", title: "过场影片与字幕", sub: "55 组字幕 ↔ 影片" },
        { key: "titles", view: "extras", id: "titles", title: "标题画面演进", sub: "title_info" },
        { key: "illustrations", view: "extras", id: "illustrations", title: "角色立绘", sub: "69 张造型 + 14 张全灭结局" },
        { key: "logos", view: "extras", id: "logos", title: "图标与 LOGO", sub: "52 个曲包 / 品牌标志" },
      ];
    default:
      return [];
  }
}

export function chapterOf(index: IndexData, name: string) {
  return chapterOrder(index).get(name)?.chapter;
}
