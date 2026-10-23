import { localizedValue } from "./language";
import type {
  BaseEntity,
  BossStageEntity,
  CapsoShopItemEntity,
  CapsoShopPackEntity,
  ChartEntity,
  CharacterEntity,
  Database,
  Difficulty,
  Edge,
  GachaMachineEntity,
  GachaRewardEntity,
  GalleryFolderEntity,
  GalleryItemEntity,
  ImPostEntity,
  IllustrationEntity,
  Lang,
  OaCharacterEntity,
  OaDescriptionEntity,
  OaDocumentEntity,
  OaObjectEntity,
  OsLogEntity,
  Projection,
  ReadingOrderRow,
  ShopBundleEntity,
  SongEntity,
  SpoilerAlertEntity,
  StoryNodeEntity,
  SubtitleLineEntity,
  TextSummary,
} from "../types";

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function recordOf(entity: BaseEntity): Json {
  return entity as unknown as Json;
}

export function isImPost(entity: BaseEntity): entity is ImPostEntity {
  return entity.type === "im_post";
}

export function isOsLog(entity: BaseEntity): entity is OsLogEntity {
  return entity.type === "os_log";
}

export function isChart(entity: BaseEntity): entity is ChartEntity {
  return entity.type === "chart";
}

export function isSong(entity: BaseEntity): entity is SongEntity {
  return entity.type === "song";
}

export function isCharacter(entity: BaseEntity): entity is CharacterEntity {
  return entity.type === "character";
}

export function isSpoilerAlert(entity: BaseEntity): entity is SpoilerAlertEntity {
  return entity.type === "spoiler_alert";
}

export function isOaCharacter(entity: BaseEntity): entity is OaCharacterEntity {
  return entity.type === "oa_character";
}

export function isOaObject(entity: BaseEntity): entity is OaObjectEntity {
  return entity.type === "oa_object";
}

export function isOaDocument(entity: BaseEntity): entity is OaDocumentEntity {
  return entity.type === "oa_document";
}

export function isOaDescription(entity: BaseEntity): entity is OaDescriptionEntity {
  return entity.type === "oa_description";
}

export function isGalleryFolder(entity: BaseEntity): entity is GalleryFolderEntity {
  return entity.type === "gallery_folder";
}

export function isGalleryItem(entity: BaseEntity): entity is GalleryItemEntity {
  return entity.type === "gallery_item";
}

export function isIllustration(entity: BaseEntity): entity is IllustrationEntity {
  return entity.type === "illustration";
}

export function isStoryNode(entity: BaseEntity): entity is StoryNodeEntity {
  return entity.type === "story_node";
}

export function isBossStage(entity: BaseEntity): entity is BossStageEntity {
  return entity.type === "boss_stage";
}

export function isCapsoShopPack(entity: BaseEntity): entity is CapsoShopPackEntity {
  return entity.type === "capso_shop_pack";
}

export function isCapsoShopItem(entity: BaseEntity): entity is CapsoShopItemEntity {
  return entity.type === "capso_shop_item";
}

export function isGachaMachine(entity: BaseEntity): entity is GachaMachineEntity {
  return entity.type === "gacha_machine";
}

export function isGachaReward(entity: BaseEntity): entity is GachaRewardEntity {
  return entity.type === "gacha_reward";
}

export function isShopBundle(entity: BaseEntity): entity is ShopBundleEntity {
  return entity.type === "shop_bundle";
}

export function isSubtitleLine(entity: BaseEntity): entity is SubtitleLineEntity {
  return entity.type === "subtitle_line";
}

export function isReadingOrder(entity: BaseEntity): entity is ReadingOrderRow {
  const row = recordOf(entity);
  return (
    entity.type === "reading_order" &&
    typeof row["entity_id"] === "string" &&
    typeof row["order"] === "number"
  );
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (!list) {
    map.set(key, [value]);
    return;
  }
  if (!list.includes(value)) {
    list.push(value);
  }
}

function pushEdge(map: Map<string, Edge[]>, key: string, edge: Edge): void {
  const list = map.get(key);
  if (list) {
    list.push(edge);
  } else {
    map.set(key, [edge]);
  }
}

function difficultyIndex(difficulties: Difficulty[], difficulty: Difficulty): number {
  const index = difficulties.indexOf(difficulty);
  return index === -1 ? difficulties.length : index;
}

export function buildDatabase(
  projection: Projection,
  text: TextSummary,
): Database {
  const entityById = new Map<string, BaseEntity>();
  const entitiesByType = new Map<string, BaseEntity[]>();
  for (const [type, records] of Object.entries(projection.entities)) {
    entitiesByType.set(type, records);
    for (const record of records) {
      entityById.set(record.id, record);
    }
  }

  const readingOrders: ReadingOrderRow[] = [];
  for (const record of projection.entities["reading_order"] ?? []) {
    if (isReadingOrder(record)) {
      readingOrders.push(record);
    }
  }
  readingOrders.sort((left, right) => left.order - right.order);

  const readingOrderByEntity = new Map<string, ReadingOrderRow>();
  for (const row of readingOrders) {
    if (!readingOrderByEntity.has(row.entity_id)) {
      readingOrderByEntity.set(row.entity_id, row);
    }
  }
  const timelineOrders = [...readingOrderByEntity.values()]
    .filter(
      (row) => row.entity_type === "im_post" || row.entity_type === "os_log",
    )
    .sort((left, right) => left.order - right.order);

  const characterById = new Map<string, CharacterEntity>();
  for (const record of projection.entities["character"] ?? []) {
    if (isCharacter(record)) {
      characterById.set(record.id, record);
    }
  }

  const spoilerById = new Map<string, SpoilerAlertEntity>();
  for (const record of projection.entities["spoiler_alert"] ?? []) {
    if (isSpoilerAlert(record)) {
      spoilerById.set(record.id, record);
    }
  }

  const charts: ChartEntity[] = [];
  for (const record of projection.entities["chart"] ?? []) {
    if (isChart(record)) {
      charts.push(record);
    }
  }
  const chartIds = new Set(charts.map((chart) => chart.id));
  const chartsBySong = new Map<string, ChartEntity[]>();
  for (const chart of charts) {
    const list = chartsBySong.get(chart.song_id);
    if (list) {
      list.push(chart);
    } else {
      chartsBySong.set(chart.song_id, [chart]);
    }
  }
  for (const list of chartsBySong.values()) {
    list.sort(
      (left, right) =>
        difficultyIndex(projection.difficulties, left.difficulty) -
        difficultyIndex(projection.difficulties, right.difficulty),
    );
  }

  const edgesFrom = new Map<string, Edge[]>();
  const edgesTo = new Map<string, Edge[]>();
  const unlockSourceIds = new Map<string, string[]>();
  for (const edge of projection.edges) {
    pushEdge(edgesFrom, edge.source, edge);
    pushEdge(edgesTo, edge.target, edge);
    if (edge.relation === "unlocks_chart") {
      pushUnique(unlockSourceIds, edge.target, edge.source);
    }
  }

  const chartReferrers = new Map<string, string[]>();
  for (const records of Object.values(projection.entities)) {
    for (const record of records) {
      const data = recordOf(record);
      for (const field of ["charts", "chart_ids"]) {
        const ids = stringArray(data[field]);
        if (!ids) {
          continue;
        }
        for (const id of ids) {
          if (chartIds.has(id)) {
            pushUnique(chartReferrers, id, record.id);
          }
        }
      }
    }
  }

  return {
    projection,
    entityById,
    entitiesByType,
    timelineOrders,
    readingOrderByEntity,
    textRefs: text.refs,
    textNames: text.names ?? {},
    characterById,
    spoilerById,
    chartsBySong,
    edgesFrom,
    edgesTo,
    unlockSourceIds,
    chartReferrers,
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function parseProjection(value: unknown): Projection {
  if (!isJson(value)) {
    throw new Error("projection is not an object");
  }
  const entities = value["entities"];
  const edges = value["edges"];
  if (!isJson(entities) || !Array.isArray(edges)) {
    throw new Error("projection is missing entities/edges");
  }
  return value as unknown as Projection;
}

function parseTextSummary(value: unknown): TextSummary {
  if (!isJson(value) || !isJson(value["refs"])) {
    throw new Error("text summary is malformed");
  }
  return value as unknown as TextSummary;
}

export async function loadDatabase(signal?: AbortSignal): Promise<Database> {
  const [projection, text] = await Promise.all([
    fetchJson<unknown>("/db/data.json", signal).then(parseProjection),
    fetchJson<unknown>("/db/text.json", signal).then(parseTextSummary),
  ]);
  return buildDatabase(projection, text);
}

export function textSnippet(
  db: Database,
  textRef: string | null | undefined,
  lang: Lang,
): string {
  if (!textRef) {
    return "";
  }
  const byLang = db.textRefs[textRef];
  if (!byLang) {
    return "";
  }
  return localizedValue(byLang as Record<Lang, string | null>, lang);
}
