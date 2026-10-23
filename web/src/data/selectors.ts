import {
  DISPLAY_LANG,
  isCharacter,
  isChart,
  isImPost,
  isOsLog,
  isSong,
  recordOf,
  textSnippet,
} from "./database";
import type {
  BaseEntity,
  ChartEntity,
  Database,
  Edge,
  ImPostEntity,
  Lang,
  LocalizedText,
  OsLogEntity,
  ReadingOrderRow,
  ReadingTier,
} from "../types";

const FALLBACK_LANGS: Lang[] = ["en", "zh-Hant", "ja", "ko"];

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

export function localizedValue(map: LocalizedText | null | undefined): string {
  if (!map) {
    return "";
  }
  const exact = map[DISPLAY_LANG];
  if (exact) {
    return exact;
  }
  for (const lang of FALLBACK_LANGS) {
    const value = map[lang];
    if (value) {
      return value;
    }
  }
  return "";
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

export function entityTitle(entity: BaseEntity): string {
  if (isImPost(entity)) {
    return localizedValue(entity.titles) || entity.game_id;
  }
  if (isOsLog(entity)) {
    return localizedValue(entity.names) || entity.game_id;
  }
  if (isSong(entity)) {
    return entity.name || entity.game_id;
  }
  if (isCharacter(entity)) {
    return entity.name || entity.game_id;
  }
  const data = recordOf(entity);
  const name = data["name"];
  if (typeof name === "string" && name) {
    return name;
  }
  const titles = localized(data["titles"]);
  if (titles) {
    return localizedValue(titles) || entity.id;
  }
  const names = localized(data["names"]);
  if (names) {
    return localizedValue(names) || entity.id;
  }
  const gameId = data["game_id"];
  if (typeof gameId === "string" && gameId) {
    return gameId;
  }
  return entity.id;
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
        title: localizedValue(entity.titles) || entity.game_id,
        author: entity.author,
        character: threadName,
        context: `iM · #${entity.order}`,
        snippet: textSnippet(db, entity.text_ref),
        spoilerThreshold,
      });
    } else if (isOsLog(entity)) {
      entries.push({
        row,
        entity,
        title: localizedValue(entity.names) || entity.game_id,
        author: threadName || "OS",
        character: `OS · ${entity.file}`,
        context: entity.date || `Index ${entity.index}`,
        snippet: textSnippet(db, entity.text_ref),
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

export function incomingEdges(db: Database, entityId: string): Edge[] {
  return db.edgesTo.get(entityId) ?? [];
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
