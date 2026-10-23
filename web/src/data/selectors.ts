import {
  isCharacter,
  isChart,
  isImPost,
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
import type {
  BaseEntity,
  BossStageEntity,
  ChartEntity,
  ConditionEntry,
  Database,
  Edge,
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
}

export interface TimelineEntry {
  readonly row: ReadingOrderRow;
  readonly entity: ImPostEntity | OsLogEntity;
  readonly title: string;
  readonly author: string;
  readonly character: string;
  readonly context: string;
  readonly snippet: string;
  readonly spoilerThreshold: number | null;
}

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
    return `${entity.character || "Voice"} · ${entity.game_id}`;
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

export function entityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    im_post: "iM post",
    im_reply: "iM reply",
    os_log: "OS log",
    chart: "Chart",
    song: "Song",
    character: "Character",
    pack: "Song pack",
    folder: "Folder",
    chapter: "Chapter",
    story_node: "Story node",
    oa_character: "OA character",
    oa_object: "OA object",
    oa_document: "OA document",
    oa_description: "OA description",
    gallery_item: "Backup item",
    gallery_folder: "Backup folder",
    illustration: "Illustration",
    capso_shop_pack: "CAPSO pack",
    capso_shop_item: "CAPSO item",
    gacha_machine: "Gacha machine",
    gacha_reward: "Gacha reward",
    shop_bundle: "Shop bundle",
    boss_stage: "Boss stage",
    spoiler_alert: "Spoiler alert",
    subtitle_line: "Subtitle line",
    assistant_dialogue: "iM assistant dialogue",
    title_screen: "Title screen",
    reading_order: "Reading order",
  };
  return labels[type] ?? type;
}

export function entityHref(id: string): string {
  return `/${encodeURI(id)}`;
}

export function decodeEntityPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  try {
    return decodeURI(trimmed);
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

export function selectTimeline(
  db: Database,
  filters: TimelineFilters,
  lang: Lang,
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
    const threadName = characterName(db, row.thread);
    const spoilerThreshold = row.spoiler_alert
      ? (db.spoilerById.get(row.spoiler_alert)?.threshold ?? null)
      : null;
    if (isImPost(entity)) {
      entries.push({
        row,
        entity,
        title: localizedValue(entity.titles, lang) || entity.game_id,
        author: entity.author,
        character: threadName,
        context: `iM · #${entity.order}`,
        snippet: textSnippet(db, entity.text_ref, lang),
        spoilerThreshold,
      });
    } else if (isOsLog(entity)) {
      entries.push({
        row,
        entity,
        title: localizedValue(entity.names, lang) || entity.game_id,
        author: threadName || "OS",
        character: `OS · ${entity.file}`,
        context: entity.date || `Index ${entity.index}`,
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

export function chartReferrerEntities(db: Database, chartId: string): BaseEntity[] {
  const ids = db.chartReferrers.get(chartId) ?? [];
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
    if (chart && isChart(chart)) {
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

const RELATION_LABELS: Record<string, string> = {
  unlocks_chart: "Unlocks charts",
  requires_story: "Requires story",
  same_level: "Same level",
  same_stage: "Same stage",
  appears_in_gallery: "Appears in gallery",
  belongs_to_pack: "Belongs to pack",
  has_reply: "Has reply",
};

export function relationLabel(relation: string): string {
  return (
    RELATION_LABELS[relation] ??
    relation.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

export function groupEdges(edges: readonly Edge[], relation?: string): EdgeGroup[] {
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
      label: relationLabel(name),
      edges: list,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function formatLevelLocks(db: Database, locks: unknown): string[] {
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
    values.push(`${characterName(db, character)} · Lv ${level + 1}`);
  }
  return values;
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value.slice(0, 8)) {
      const formatted = formatFieldValue(item);
      if (formatted) {
        parts.push(formatted);
      }
    }
    if (value.length > 8) {
      parts.push(`… ${value.length - 8} more`);
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

export function chartLabel(db: Database, chart: ChartEntity): string {
  const song = db.entityById.get(chart.song_id);
  const songName = song && isSong(song) ? song.name || song.game_id : chart.song_id;
  return `${songName} · ${chart.difficulty} · Lv ${chart.level}`;
}

export interface ConditionLink {
  readonly label: string;
  readonly href: string | null;
  readonly id: string | null;
}

export function conditionLink(db: Database, condition: ConditionEntry): ConditionLink {
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
        label: `${condition.kind}: ${condition.value}`,
        href: entityHref(id),
        id,
      };
    }
  }
  return {
    label: `${condition.kind}: ${condition.value}`,
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

export function entityHome(entity: BaseEntity): { href: string; label: string } | null {
  switch (entity.type) {
    case "im_post":
    case "os_log":
    case "chart":
    case "song":
    case "spoiler_alert":
    case "reading_order":
      return { href: "/timeline", label: "Timeline" };
    case "oa_character":
    case "oa_object":
    case "oa_document":
    case "oa_description":
      return { href: "/oa", label: "OA" };
    case "gallery_item":
    case "gallery_folder":
    case "boss_stage":
      return { href: "/backup", label: "Backup Database" };
    case "story_node":
      return { href: "/story", label: "Story" };
    case "capso_shop_pack":
    case "capso_shop_item":
    case "gacha_machine":
    case "gacha_reward":
    case "shop_bundle":
      return { href: "/shop", label: "Shop" };
    case "assistant_dialogue":
      return { href: "/extras/assistants", label: "Extras" };
    case "title_screen":
      return { href: "/extras/titles", label: "Extras" };
    default:
      return null;
  }
}
