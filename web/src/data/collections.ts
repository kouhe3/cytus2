import {
  isBossStage,
  isCapsoShopItem,
  isCapsoShopPack,
  isCharacter,
  isGachaMachine,
  isGachaReward,
  isGalleryFolder,
  isGalleryItem,
  isOaCharacter,
  isOaDescription,
  isOaDocument,
  isOaObject,
  isShopBundle,
  isStoryNode,
  textSnippet,
} from "./database";
import { entityTitle } from "./selectors";
import type { I18n } from "./messages";
import type {
  BaseEntity,
  BossStageEntity,
  CapsoShopItemEntity,
  CapsoShopPackEntity,
  CharacterEntity,
  Database,
  GachaMachineEntity,
  GachaRewardEntity,
  GalleryFolderEntity,
  GalleryItemEntity,
  Lang,
  OaCharacterEntity,
  OaDescriptionEntity,
  OaDocumentEntity,
  OaObjectEntity,
  ReadingOrderRow,
  ShopBundleEntity,
  StoryNodeEntity,
} from "../types";

function typed<T extends BaseEntity>(db: Database, type: string): T[] {
  return (db.entitiesByType.get(type) ?? []) as T[];
}

/* --------------------------------------------------------------------- OA */
export interface OaGroup {
  readonly oa: OaCharacterEntity;
  readonly character: CharacterEntity | null;
  readonly objects: OaObjectEntity[];
  readonly documents: OaDocumentEntity[];
  readonly descriptions: OaDescriptionEntity[];
}

export function oaGroups(db: Database): OaGroup[] {
  const characters = typed<OaCharacterEntity>(db, "oa_character").filter(isOaCharacter);
  const objects = typed<OaObjectEntity>(db, "oa_object").filter(isOaObject);
  const documents = typed<OaDocumentEntity>(db, "oa_document").filter(isOaDocument);
  const descriptions = typed<OaDescriptionEntity>(db, "oa_description").filter(
    isOaDescription,
  );
  return characters
    .map((oa) => {
      const characterRecord = db.entityById.get(oa.character_id);
      return {
        oa,
        character:
          characterRecord && isCharacter(characterRecord) ? characterRecord : null,
        objects: objects
          .filter((object) => object.character_id === oa.character_id)
          .sort((left, right) => left.game_id.localeCompare(right.game_id)),
        documents: documents
          .filter((document) => document.character_id === oa.character_id)
          .sort((left, right) => left.game_id.localeCompare(right.game_id)),
        descriptions: descriptions
          .filter((description) => description.character_id === oa.character_id)
          .sort((left, right) => left.game_id.localeCompare(right.game_id)),
      };
    })
    .sort((left, right) => left.oa.name.localeCompare(right.oa.name));
}

export function findOaGroup(db: Database, gameId: string): OaGroup | null {
  return oaGroups(db).find((group) => group.oa.game_id === gameId) ?? null;
}

/* ---------------------------------------------------- Backup Database */
export interface GalleryGroup {
  readonly folder: GalleryFolderEntity;
  readonly items: GalleryItemEntity[];
  readonly bossStages: BossStageEntity[];
  readonly counts: Record<string, number>;
}

export function galleryGroups(db: Database): GalleryGroup[] {
  const folders = typed<GalleryFolderEntity>(db, "gallery_folder").filter(
    isGalleryFolder,
  );
  const items = typed<GalleryItemEntity>(db, "gallery_item").filter(isGalleryItem);
  const stages = typed<BossStageEntity>(db, "boss_stage").filter(isBossStage);
  return folders
    .map((folder) => {
      const folderItems = items
        .filter((item) => item.folder_id === folder.id)
        .sort((left, right) => left.game_id.localeCompare(right.game_id));
      const counts: Record<string, number> = {};
      for (const item of folderItems) {
        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      }
      return {
        folder,
        items: folderItems,
        bossStages: stages.filter((stage) => stage.folder_id === folder.id),
        counts,
      };
    })
    .sort((left, right) => left.folder.name.localeCompare(right.folder.name));
}

export function findGalleryGroup(db: Database, gameId: string): GalleryGroup | null {
  return galleryGroups(db).find((group) => group.folder.game_id === gameId) ?? null;
}

/* ------------------------------------------------------------------ story */
export type StorySort = "level" | "version" | "chapter";
export type StoryKindFilter = "all" | "event" | "branch";

export interface StoryEntry {
  readonly node: StoryNodeEntity;
  readonly row: ReadingOrderRow | null;
  readonly title: string;
  readonly snippet: string;
  readonly sortKey: string;
}

function storySortKey(
  row: ReadingOrderRow | null,
  sort: StorySort,
  levelOrder: number,
): string {
  // The effective level gate is the spoiler-deferred position. It stays the
  // primary key in every mode so version/chapter sorting never promotes a
  // node ahead of its prerequisites.
  if (sort === "level") {
    return String(levelOrder).padStart(8, "0");
  }
  const gate = String(row?.level_gate ?? 9999).padStart(4, "0");
  const order = String(levelOrder).padStart(8, "0");
  if (sort === "version") {
    if (row?.version) {
      const version = row.version_order.length
        ? row.version_order.map((part) => String(part).padStart(4, "0")).join("-")
        : row.version
            .split(".")
            .map((part) => String(Number(part) || 0).padStart(4, "0"))
            .join(".");
      return `${gate}\u00000\u0000${version}`;
    }
    return `${gate}\u00001\u0000${order}`;
  }
  if (sort === "chapter") {
    if (row?.chapter_id) {
      const chapterOrder =
        row.chapter_order === null
          ? 9999
          : row.chapter_order;
      return `${gate}\u00000\u0000${String(chapterOrder).padStart(6, "0")}\u0000${row.chapter_id}`;
    }
    return `${gate}\u00001\u0000${order}`;
  }
  return order;
}

export function storyEntries(
  db: Database,
  lang: Lang,
  sort: StorySort,
  kind: StoryKindFilter,
  i18n?: I18n,
): StoryEntry[] {
  const nodes = typed<StoryNodeEntity>(db, "story_node").filter(isStoryNode);
  const entries: StoryEntry[] = [];
  for (const node of nodes) {
    if (kind !== "all" && node.kind !== kind) {
      continue;
    }
    const row = db.readingOrderByEntity.get(node.id) ?? null;
    if (sort === "level" && row?.chapter_staged) {
      continue;
    }
    const levelOrder = row?.order ?? 100000 + entries.length;
    const sortKey = storySortKey(row, sort, levelOrder);
    entries.push({
      node,
      row,
      title: entityTitle(db, node, lang, i18n),
      snippet: node.text_ref ? textSnippet(db, node.text_ref, lang) : "",
      sortKey,
    });
  }
  entries.sort(
    (left, right) =>
      left.sortKey.localeCompare(right.sortKey) ||
      left.node.game_id.localeCompare(right.node.game_id),
  );
  return entries;
}

export function storySortMetaCount(
  db: Database,
  sort: StorySort,
): number {
  let count = 0;
  for (const node of db.entitiesByType.get("story_node") ?? []) {
    const row = db.readingOrderByEntity.get(node.id);
    if (!row) {
      continue;
    }
    if (sort === "version" && row.version) {
      count += 1;
    } else if (sort === "chapter" && row.chapter_id) {
      count += 1;
    }
  }
  return count;
}

export function findStoryNode(db: Database, gameId: string): StoryNodeEntity | null {
  const record = db.entityById.get(`story_node/${gameId}`);
  return record && isStoryNode(record) ? record : null;
}

/* -------------------------------------------------------------------- shop */
export interface CapsoGroup {
  readonly pack: CapsoShopPackEntity;
  readonly items: CapsoShopItemEntity[];
}

export function capsoGroups(db: Database): CapsoGroup[] {
  const packs = typed<CapsoShopPackEntity>(db, "capso_shop_pack").filter(
    isCapsoShopPack,
  );
  const items = typed<CapsoShopItemEntity>(db, "capso_shop_item").filter(
    isCapsoShopItem,
  );
  return packs
    .map((pack) => ({
      pack,
      items: items
        .filter((item) => item.pack_id === pack.id)
        .sort((left, right) => left.position - right.position),
    }))
    .sort((left, right) => left.pack.create_order - right.pack.create_order);
}

export interface GachaGroup {
  readonly machine: GachaMachineEntity;
  readonly rewards: GachaRewardEntity[];
  readonly totalWeight: number;
}

export function gachaGroups(db: Database): GachaGroup[] {
  const machines = typed<GachaMachineEntity>(db, "gacha_machine").filter(
    isGachaMachine,
  );
  const rewards = typed<GachaRewardEntity>(db, "gacha_reward").filter(isGachaReward);
  return machines
    .map((machine) => {
      const machineRewards = rewards
        .filter((reward) => reward.machine_id === machine.id)
        .sort(
          (left, right) =>
            right.weight - left.weight || left.create_order - right.create_order,
        );
      return {
        machine,
        rewards: machineRewards,
        totalWeight: machineRewards.reduce((sum, reward) => sum + reward.weight, 0),
      };
    })
    .sort((left, right) => left.machine.create_order - right.machine.create_order);
}

export function shopBundles(db: Database): ShopBundleEntity[] {
  return typed<ShopBundleEntity>(db, "shop_bundle")
    .filter(isShopBundle)
    .sort((left, right) => left.game_id.localeCompare(right.game_id));
}
