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
export interface StoryEntry {
  readonly node: StoryNodeEntity;
  readonly row: ReadingOrderRow | null;
  readonly title: string;
  readonly snippet: string;
}

export function storyEntries(
  db: Database,
  lang: Lang,
  i18n: I18n,
): StoryEntry[] {
  const nodes = typed<StoryNodeEntity>(db, "story_node").filter(isStoryNode);
  const entries: StoryEntry[] = [];
  for (const node of nodes) {
    // Branching OS nodes have their own graph reader (`/branch`); this index
    // only lists story events.
    if (node.kind !== "event") {
      continue;
    }
    const row = db.readingOrderByEntity.get(node.id) ?? null;
    // test01/test02 staging rows stay out of the canonical reading order.
    if (row?.chapter_staged) {
      continue;
    }
    entries.push({
      node,
      row,
      title: entityTitle(db, node, lang, i18n),
      snippet: node.text_ref ? textSnippet(db, node.text_ref, lang) : "",
    });
  }
  // Canonical projection order; rows without a projection keep their place
  // after it, matching the reading-order card sequence elsewhere.
  entries.sort(
    (left, right) =>
      (left.row?.order ?? Number.MAX_SAFE_INTEGER) -
        (right.row?.order ?? Number.MAX_SAFE_INTEGER) ||
      left.node.game_id.localeCompare(right.node.game_id),
  );
  return entries;
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
