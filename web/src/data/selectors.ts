import {
  isCharacter,
  isChart,
  isGalleryItem,
  isImPost,
  isOaCharacter,
  isOaDescription,
  isOaDocument,
  isOaObject,
  isOsLog,
  isSong,
  isSubtitleLine,
  recordOf,
  textSnippet,
} from "./database";
import { localizedValue, pickLocalized } from "./language";
import { conditionKindLabel, relationLabel } from "./labels";
import type { I18n, MessageKey } from "./messages";
import type {
  BaseEntity,
  BossStageEntity,
  ChartEntity,
  ConditionEntry,
  Database,
  Edge,
  GalleryItemEntity,
  ImPostEntity,
  Lang,
  LocalizedText,
  OsLogEntity,
  ReadingOrderRow,
  ReadingTier,
  ShopBundleItem,
} from "../types";

export type TimelineTypeFilter = "all" | "im_post" | "os_log";

export interface TimelineFilters {
  readonly maxLevel: number;
  readonly type: TimelineTypeFilter;
  readonly tiers: ReadonlySet<ReadingTier>;
  /** iM account filter key, "other", or null for every account. */
  readonly account: string | null;
}

export interface TimelineEntry {
  readonly row: ReadingOrderRow;
  readonly entity: ImPostEntity | OsLogEntity;
  readonly account: string;
  readonly title: string;
  readonly author: string;
  readonly character: string;
  readonly laneName: string;
  readonly context: string;
  readonly snippet: string;
  readonly spoilerThreshold: number | null;
}

export interface TimelineAccount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export const OTHER_ACCOUNT = "other";

function localized(map: unknown): LocalizedText | null {
  if (typeof map !== "object" || map === null) {
    return null;
  }
  return map as LocalizedText;
}

export function characterName(db: Database, characterId: string | null): string {
  if (!characterId) {
    return "";
  }
  const character = db.characterById.get(characterId);
  if (character && isCharacter(character)) {
    return character.name || character.game_id;
  }
  return characterId.replace(/^character\//, "");
}

export function entityGameId(entity: BaseEntity): string {
  const value = recordOf(entity)["game_id"];
  return typeof value === "string" ? value : entity.id.split("/").slice(1).join("/");
}

export function entityTitle(
  db: Database,
  entity: BaseEntity,
  lang: Lang,
  i18n: I18n,
): string {
  if (isImPost(entity)) {
    return pickLocalized(entity.titles, lang).value || entity.game_id;
  }
  if (isOsLog(entity)) {
    return pickLocalized(entity.names, lang).value || entity.game_id;
  }
  if (isSong(entity)) {
    return entity.name || entity.game_id;
  }
  if (isCharacter(entity)) {
    return entity.name || entity.game_id;
  }
  if (isSubtitleLine(entity)) {
    return `${entity.character || i18n.t("entity.voice")} · ${entity.game_id}`;
  }
  if (entity.type === "im_reply") {
    const data = recordOf(entity);
    const textRef = data["text_ref"];
    if (typeof textRef === "string") {
      const reply = textSnippet(db, textRef, lang);
      if (reply) {
        return reply;
      }
    }
  }
  if (entity.type === "oa_document" && isOaDocument(entity)) {
    return textName(db, entity.text_ref, lang) || entity.game_id;
  }
  if (entity.type === "oa_object" && isOaObject(entity)) {
    return textName(db, entity.text_ref, lang) || entity.game_id;
  }
  if (entity.type === "oa_description" && isOaDescription(entity)) {
    return textName(db, entity.text_ref, lang) || entity.game_id;
  }
  const data = recordOf(entity);
  const name = data["name"];
  if (typeof name === "string" && name) {
    return name;
  }
  const displayName = data["display_name"];
  if (typeof displayName === "string" && displayName) {
    return displayName;
  }
  const names = localized(data["names"]);
  if (names) {
    const picked = pickLocalized(names, lang);
    if (picked.value) {
      return picked.value;
    }
  }
  const titles = localized(data["titles"]);
  if (titles) {
    const picked = pickLocalized(titles, lang);
    if (picked.value) {
      return picked.value;
    }
  }
  const gameId = data["game_id"];
  if (typeof gameId === "string" && gameId) {
    return gameId;
  }
  return entity.id;
}

function textName(db: Database, textRef: string, lang: Lang): string {
  const names = db.textNames[textRef];
  if (!names) {
    return "";
  }
  return pickLocalized(names as LocalizedText, lang).value;
}

export function entityHref(id: string): string {
  // Entity ids use "#" for reply floors.  A raw "#" starts the URL fragment,
  // so encode it into the path; otherwise /im_reply/P0101#1 resolves to the
  // non-existent /im_reply/P0101.
  return `/${encodeURI(id).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

export function decodeEntityPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  try {
    // decodeURI leaves reserved characters such as %23 (#) encoded, but
    // reply ids use "#" in the path: /im_reply/P0101%231.
    return trimmed
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return trimmed;
  }
}

export function maxTimelineLevel(db: Database): number {
  let max = 0;
  for (const row of db.timelineOrders) {
    if (row.level_gate > max) {
      max = row.level_gate;
    }
  }
  return max;
}

/** ``paff001`` -> ``paff_01``: the avatar-naming convention of the account filter. */
export function characterAvatarId(characterId: string): string | null {
  const gameId = characterId.replace(/^character\//, "");
  const match = /^(.+?)(\d+)$/.exec(gameId);
  if (!match) {
    return null;
  }
  return `${match[1]}_${String(Number(match[2])).padStart(2, "0")}`;
}

/** The account icon that owns a post avatar or a character's OS thread. */
export function timelineAccountKey(
  db: Database,
  row: ReadingOrderRow,
  entity: BaseEntity,
): string {
  let avatar: string | null = null;
  if (isImPost(entity)) {
    avatar = entity.avatar;
  } else if (isOsLog(entity)) {
    const characterId = row.lane_character ?? row.thread;
    avatar = characterId ? characterAvatarId(characterId) : null;
  }
  if (avatar) {
    const item = db.imFilters.items.find((entry) =>
      entry.avatars.includes(avatar),
    );
    if (item) {
      return item.avatar;
    }
  }
  return OTHER_ACCOUNT;
}

/**
 * Normalize an ``?account=`` value.  Accepts the filter icon avatar id, a
 * character id (``paff001``) or a character entity id.  Unknown values fall
 * back to "all accounts" so a stale link never hides the whole feed.
 */
export function resolveTimelineAccount(
  db: Database,
  raw: string | null,
): string | null {
  if (!raw || raw === OTHER_ACCOUNT) {
    return raw;
  }
  if (db.imFilters.items.some((item) => item.avatar === raw)) {
    return raw;
  }
  const avatar = raw.includes("_")
    ? raw.replace(/^character\//, "")
    : characterAvatarId(raw);
  if (!avatar) {
    return null;
  }
  const item = db.imFilters.items.find((entry) =>
    entry.avatars.includes(avatar),
  );
  return item ? item.avatar : null;
}

/** The IM tab account of a character page, when the game has one. */
export function characterImAccount(
  db: Database,
  character: BaseEntity,
): string | null {
  const avatar = characterAvatarId(character.id);
  if (!avatar) {
    return null;
  }
  const item = db.imFilters.items.find((entry) =>
    entry.avatars.includes(avatar),
  );
  return item ? item.avatar : null;
}

export function timelineAccounts(
  db: Database,
  i18n: I18n,
): TimelineAccount[] {
  const counts = new Map<string, number>();
  for (const row of db.timelineOrders) {
    const entity = db.entityById.get(row.entity_id);
    if (!entity) {
      continue;
    }
    const key = timelineAccountKey(db, row, entity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const accounts = db.imFilters.items.map((item) => ({
    key: item.avatar,
    label: item.name,
    count: counts.get(item.avatar) ?? 0,
  }));
  accounts.push({
    key: OTHER_ACCOUNT,
    label: i18n.t("timeline.accountOther"),
    count: counts.get(OTHER_ACCOUNT) ?? 0,
  });
  return accounts;
}

export interface CharacterOsEntry {
  readonly row: ReadingOrderRow;
  readonly entity: OsLogEntity;
}

/** A folder inside one OS chapter, in the game's TIMELINE CHAPTER view. */
export interface OsFolderGroup {
  readonly folderId: string | null;
  readonly name: string;
  readonly entries: CharacterOsEntry[];
}

export interface OsChapterGroup {
  readonly chapterId: string;
  readonly name: string;
  readonly category: number | null;
  readonly entries: CharacterOsEntry[];
  readonly folders: OsFolderGroup[];
}

/**
 * The 1-based level of the OS log's own character (the reading-order thread).
 * A file can require several characters, but the lists only mark the owner's
 * level; `null` means the file has no level condition for that character.
 */
export function osOwnerUnlockLevel(entry: CharacterOsEntry): number | null {
  const owner = entry.row.thread;
  if (!owner) {
    return null;
  }
  const lock = entry.entity.level_locks.find((item) => item.character === owner);
  return lock ? lock.level + 1 : null;
}

export function osOwnerLevelLabel(
  i18n: I18n,
  entry: CharacterOsEntry,
): string | null {
  const level = osOwnerUnlockLevel(entry);
  return level === null
    ? null
    : i18n.t("common.level", { level: i18n.formatNumber(level) });
}

/**
 * The game's TIMELINE CHAPTER order. `osdata/chapters` carries only
 * Id/Name/Category and no sort table (side-chapter `Index` restarts at 1), so
 * the order is maintained by the wiki: as of 4.6 the extra chapter "Amiya"
 * sits between chapters 2 and 3.
 */
const OS_CHAPTER_ORDER = [
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

function osChapterRank(name: string): number {
  const index = OS_CHAPTER_ORDER.indexOf(name);
  return index === -1 ? OS_CHAPTER_ORDER.length : index;
}

export function compareOsVersions(
  left: CharacterOsEntry,
  right: CharacterOsEntry,
): number {
  const a = left.row.version_order;
  const b = right.row.version_order;
  if (a.length === 0 || b.length === 0) {
    return a.length === 0 ? (b.length === 0 ? 0 : 1) : -1;
  }
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1);
    if (difference !== 0) {
      return difference;
    }
  }
  return (
    left.row.in_game_order - right.row.in_game_order ||
    left.entity.id.localeCompare(right.entity.id)
  );
}

/**
 * Compare `Category` labels ("1.1", "2.9", "1.9.1") numerically, segment by
 * segment. A shorter label precedes its own subdivisions, so "1.9" < "1.9.1".
 */
export function compareOsCategories(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = Number.parseInt(a[index] ?? "", 10);
    const y = Number.parseInt(b[index] ?? "", 10);
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) {
      return x - y;
    }
    if (Number.isFinite(x) !== Number.isFinite(y)) {
      return Number.isFinite(x) ? 1 : -1;
    }
  }
  return left.localeCompare(right);
}

/**
 * Every OS log that carries a reading-order row, regardless of thread or
 * timeline scope.
 */
export function allOsEntries(db: Database): CharacterOsEntry[] {
  const entries: CharacterOsEntry[] = [];
  for (const entity of db.entitiesByType.get("os_log") ?? []) {
    if (!isOsLog(entity)) {
      continue;
    }
    const row = db.readingOrderByEntity.get(entity.id);
    if (!row) {
      continue;
    }
    entries.push({ row, entity });
  }
  return entries;
}

/**
 * The game's TIMELINE CHAPTER view: chapters in the wiki-maintained game order
 * (not the table's Id), each split by `TimelineChapter.Folder`. Staged
 * chapters (test01/test02) are not part of that view and stay in the
 * version/character groupings only.
 */
export function chapterOsGroups(db: Database): OsChapterGroup[] {
  type Pending = {
    chapterId: string;
    name: string;
    category: number | null;
    rank: number;
    entries: CharacterOsEntry[];
  };
  const chapters = new Map<string, Pending>();
  for (const entry of allOsEntries(db)) {
    if (entry.row.chapter_staged) {
      continue;
    }
    const chapterId = entry.row.chapter_id ?? entry.entity.chapter_id;
    if (!chapterId) {
      continue;
    }
    let group = chapters.get(chapterId);
    if (!group) {
      const chapter = db.entityById.get(chapterId);
      const name =
        entry.row.chapter ??
        (chapter && "name" in chapter ? String(chapter.name) : chapterId);
      const category =
        chapter && "category" in chapter && typeof chapter.category === "number"
          ? chapter.category
          : null;
      const gameId =
        chapter && "game_id" in chapter ? Number(chapter.game_id) : Number.NaN;
      group = {
        chapterId,
        name,
        category,
        rank: entry.row.chapter_order ?? (Number.isFinite(gameId) ? gameId : 0),
        entries: [],
      };
      chapters.set(chapterId, group);
    }
    group.entries.push(entry);
  }
  return [...chapters.values()]
    .sort(
      (left, right) =>
        osChapterRank(left.name) - osChapterRank(right.name) ||
        left.rank - right.rank ||
        left.name.localeCompare(right.name),
    )
    .map((group) => {
      const byFolder = new Map<string, OsFolderGroup>();
      for (const entry of group.entries) {
        const folderId = entry.entity.folder_id;
        const folder = folderId ? db.entityById.get(folderId) : undefined;
        const name = folder && "name" in folder ? String(folder.name) : "—";
        const bucket = byFolder.get(name);
        if (bucket) {
          bucket.entries.push(entry);
        } else {
          byFolder.set(name, { folderId, name, entries: [entry] });
        }
      }
      const folders = [...byFolder.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((folder) => ({
          ...folder,
          entries: [...folder.entries].sort(
            (left, right) =>
              left.entity.index - right.entity.index ||
              left.entity.id.localeCompare(right.entity.id),
          ),
        }));
      return {
        chapterId: group.chapterId,
        name: group.name,
        category: group.category,
        entries: group.entries,
        folders,
      };
    });
}

/**
 * Every OS log owned by a character, in the game's list order: grouped by
 * `Category`, then in osdata array order (`position`). `position` is the
 * index of the file inside the character's `osdata` table, which is exactly
 * the order `OSView.AddFile` appends them.
 */
export function characterOsEntries(
  db: Database,
  characterId: string,
): CharacterOsEntry[] {
  return allOsEntries(db)
    .filter((entry) => entry.row.thread === characterId)
    .sort(
      (left, right) =>
        compareOsCategories(left.entity.category, right.entity.category) ||
        left.entity.position - right.entity.position ||
        left.entity.index - right.entity.index ||
        left.entity.id.localeCompare(right.entity.id),
    );
}

export function selectTimeline(
  db: Database,
  filters: TimelineFilters,
  lang: Lang,
  i18n: I18n,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const row of db.timelineOrders) {
    if (row.level_gate > filters.maxLevel) {
      continue;
    }
    if (filters.type !== "all" && row.entity_type !== filters.type) {
      continue;
    }
    if (!filters.tiers.has(row.tier)) {
      continue;
    }
    const entity = db.entityById.get(row.entity_id);
    if (!entity) {
      continue;
    }
    const account = timelineAccountKey(db, row, entity);
    if (filters.account !== null && account !== filters.account) {
      continue;
    }
    const threadName = characterName(db, row.thread);
    const laneName =
      row.lane === 300
        ? i18n.t("timeline.laneOther")
        : characterName(db, row.lane_character) ||
          i18n.t("timeline.laneFallback", { lane: row.lane });
    const spoilerThreshold = row.spoiler_alert
      ? (db.spoilerById.get(row.spoiler_alert)?.threshold ?? null)
      : null;
    if (isImPost(entity)) {
      entries.push({
        row,
        entity,
        account,
        title: localizedValue(entity.titles, lang) || entity.game_id,
        author: entity.author,
        character: threadName,
        laneName,
        context: i18n.t("timeline.contextIm", { order: entity.order }),
        snippet: textSnippet(db, entity.text_ref, lang),
        spoilerThreshold,
      });
    } else if (isOsLog(entity)) {
      entries.push({
        row,
        entity,
        account,
        title: localizedValue(entity.names, lang) || entity.game_id,
        author: threadName || i18n.t("timeline.osAuthor"),
        character: `${i18n.t("timeline.osAuthor")} · ${entity.file}`,
        laneName,
        context: entity.date
          ? i18n.formatDate(entity.date)
          : i18n.t("timeline.contextOsIndex", { index: entity.index }),
        snippet: textSnippet(db, entity.text_ref, lang),
        spoilerThreshold,
      });
    }
  }
  return entries;
}

export function unlockSourceEntities(db: Database, chartId: string): BaseEntity[] {
  const ids = db.unlockSourceIds.get(chartId) ?? [];
  const entities: BaseEntity[] = [];
  for (const id of ids) {
    const entity = db.entityById.get(id);
    if (entity) {
      entities.push(entity);
    }
  }
  return entities;
}

export function unlockedCharts(db: Database, entity: BaseEntity): ChartEntity[] {
  const chartIds = new Set<string>();
  for (const edge of db.edgesFrom.get(entity.id) ?? []) {
    if (edge.relation === "unlocks_chart") {
      chartIds.add(edge.target);
    }
  }
  const data = recordOf(entity);
  for (const field of ["charts", "chart_ids"]) {
    const value = data[field];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === "string") {
        chartIds.add(item);
      }
    }
  }
  const charts: ChartEntity[] = [];
  for (const id of chartIds) {
    const chart = db.entityById.get(id);
    if (chart && isChart(chart) && chart.need_unlock) {
      charts.push(chart);
    }
  }
  return charts;
}

export function chartsFromIds(db: Database, ids: readonly string[]): ChartEntity[] {
  const charts: ChartEntity[] = [];
  for (const id of ids) {
    const entity = db.entityById.get(id);
    if (entity && isChart(entity)) {
      charts.push(entity);
    }
  }
  return charts;
}

export function incomingEdges(db: Database, entityId: string): Edge[] {
  return db.edgesTo.get(entityId) ?? [];
}

export function outgoingEdges(db: Database, entityId: string): Edge[] {
  return db.edgesFrom.get(entityId) ?? [];
}

export interface EdgeGroup {
  readonly relation: string;
  readonly label: string;
  readonly edges: Edge[];
}

export function groupEdges(
  edges: readonly Edge[],
  i18n: I18n,
  relation?: string,
): EdgeGroup[] {
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (relation && edge.relation !== relation) {
      continue;
    }
    const list = groups.get(edge.relation);
    if (list) {
      list.push(edge);
    } else {
      groups.set(edge.relation, [edge]);
    }
  }
  return [...groups.entries()]
    .map(([name, list]) => ({
      relation: name,
      label: relationLabel(i18n, name),
      edges: list,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function formatLevelLocks(
  db: Database,
  locks: unknown,
  i18n: I18n,
  levelOffset = 1,
): string[] {
  if (!Array.isArray(locks)) {
    return [];
  }
  const values: string[] = [];
  for (const lock of locks) {
    if (typeof lock !== "object" || lock === null) {
      continue;
    }
    const data = lock as Record<string, unknown>;
    const character = typeof data["character"] === "string" ? data["character"] : "";
    const level = typeof data["level"] === "number" ? data["level"] : null;
    if (!character || level === null) {
      continue;
    }
    values.push(
      `${characterName(db, character)} · ${i18n.t("common.level", {
        level: level + levelOffset,
      })}`,
    );
  }
  return values;
}

export function formatFieldValue(value: unknown, i18n: I18n): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? i18n.t("common.yes") : i18n.t("common.no");
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value.slice(0, 8)) {
      const formatted = formatFieldValue(item, i18n);
      if (formatted) {
        parts.push(formatted);
      }
    }
    if (value.length > 8) {
      parts.push(i18n.t("format.more", { count: value.length - 8 }));
    }
    return parts.join(", ");
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      return text.length > 160 ? `${text.slice(0, 159)}…` : text;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function chartLabel(
  db: Database,
  chart: ChartEntity,
  i18n: I18n,
): string {
  const song = db.entityById.get(chart.song_id);
  const songName = song && isSong(song) ? song.name || song.game_id : chart.song_id;
  return `${songName} · ${chart.difficulty} · ${i18n.t("common.level", {
    level: chart.level,
  })}`;
}

/** AudioClip length as the browser/console player shows it: minutes:seconds. */
export function formatChartDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export interface ConditionLink {
  readonly label: string;
  readonly href: string | null;
  readonly id: string | null;
}

export function conditionLink(
  db: Database,
  condition: ConditionEntry,
  i18n: I18n,
): ConditionLink {
  const candidates: Record<string, string[]> = {
    os: [`os/${condition.value}`],
    im: [`im/${condition.value}`],
    story: [`story_node/${condition.value}`],
    branch: [`story_node/${condition.value}`],
    gallery: [`gallery_item/${condition.value}`],
    boss_stage: [`boss_stage/${condition.value}`],
  };
  for (const id of candidates[condition.kind] ?? []) {
    if (db.entityById.has(id)) {
      return {
        label: i18n.t("condition.label", {
          kind: conditionKindLabel(i18n, condition.kind),
          value: condition.value,
        }),
        href: entityHref(id),
        id,
      };
    }
  }
  return {
    label: i18n.t("condition.label", {
      kind: conditionKindLabel(i18n, condition.kind),
      value: condition.value,
    }),
    href: null,
    id: null,
  };
}

export function bundleItemEntity(
  db: Database,
  item: ShopBundleItem,
): BaseEntity | null {
  const candidates = [
    `character/${item.product_id}`,
    `pack/${item.product_id}`,
    `illustration/${item.product_id}`,
  ];
  for (const id of candidates) {
    const entity = db.entityById.get(id);
    if (entity) {
      return entity;
    }
  }
  return null;
}

export function bossStageForGalleryItem(
  db: Database,
  galleryItemId: string,
): BossStageEntity | null {
  for (const record of db.entitiesByType.get("boss_stage") ?? []) {
    if (record.type !== "boss_stage") {
      continue;
    }
    const stage = record as BossStageEntity;
    if (stage.gallery_item_id === galleryItemId) {
      return stage;
    }
  }
  return null;
}

/**
 * Backup Database videos that unlock from an OS log. There is no canonical edge
 * for this direction: the reference lives in the gallery item's condition.
 */
export function relatedGalleryVideos(
  db: Database,
  osLogId: string,
): GalleryItemEntity[] {
  return (db.entitiesByType.get("gallery_item") ?? []).filter(
    (record): record is GalleryItemEntity =>
      isGalleryItem(record) &&
      record.kind === "video" &&
      record.conditions.some(
        (condition) => condition.kind === "os" && condition.value === osLogId,
      ),
  );
}

export function entityHome(
  entity: BaseEntity,
): { href: string; labelKey: MessageKey } | null {
  // OA objects, documents and hotspots are read in the context of their
  // character's archive, not the flat OA index.
  if (
    isOaCharacter(entity) ||
    isOaObject(entity) ||
    isOaDocument(entity) ||
    isOaDescription(entity)
  ) {
    return {
      href: `/oa/${encodeURIComponent(
        entity.character_id.replace(/^character\//, ""),
      )}`,
      labelKey: "oa.archive",
    };
  }
  switch (entity.type) {
    case "im_post":
    case "os_log":
    case "chart":
    case "song":
    case "spoiler_alert":
    case "reading_order":
      return { href: "/timeline", labelKey: "nav.timeline" };
    case "gallery_item":
    case "gallery_folder":
    case "boss_stage":
      return { href: "/backup", labelKey: "nav.backup" };
    case "story_node":
      return { href: "/story", labelKey: "nav.story" };
    case "capso_shop_pack":
    case "capso_shop_item":
    case "gacha_machine":
    case "gacha_reward":
    case "shop_bundle":
    case "expansion_pack":
      return { href: "/shop", labelKey: "nav.shop" };
    case "assistant_dialogue":
      return { href: "/extras/assistants", labelKey: "nav.extras" };
    case "title_screen":
      return { href: "/extras/titles", labelKey: "nav.extras" };
    default:
      return null;
  }
}
