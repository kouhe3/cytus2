import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConditionList, LevelLockList } from "./Conditions";
import { EntityLink, EntityList } from "./EntityLink";
import { Fact, Facts } from "./Facts";
import { TextBody } from "./TextBody";
import { MediaKindBadge, StoryKindBadge } from "./ui";
import {
  isBossStage,
  isCapsoShopItem,
  isGachaReward,
  isGalleryItem,
  isOaDocument,
  isStoryNode,
} from "../data/database";
import { useI18n } from "../data/i18n";
import {
  bossStageForGalleryItem,
  bundleItemEntity,
  entityHref,
  entityTitle,
} from "../data/selectors";
import { oaGroups } from "../data/collections";
import type {
  BossStageEntity,
  CapsoShopItemEntity,
  CapsoShopPackEntity,
  Database,
  GachaMachineEntity,
  GachaRewardEntity,
  GalleryFolderEntity,
  GalleryItemEntity,
  IllustrationEntity,
  Lang,
  OaCharacterEntity,
  OaDescriptionEntity,
  OaDocumentEntity,
  OaObjectEntity,
  ShopBundleEntity,
  StoryNodeEntity,
  SubtitleLineEntity,
} from "../types";

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="detail-section" data-testid={testId}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EntityById({
  db,
  id,
  lang,
}: {
  db: Database;
  id: string | null | undefined;
  lang: Lang;
}) {
  const i18n = useI18n();
  if (!id) {
    return <span className="muted">{i18n.t("common.none")}</span>;
  }
  const entity = db.entityById.get(id);
  if (!entity) {
    return <code>{id}</code>;
  }
  return (
    <Link to={entityHref(id)} className="inline-link">
      {entityTitle(db, entity, lang, i18n)}
    </Link>
  );
}

function StringChips({ values }: { values: readonly string[] }) {
  const i18n = useI18n();
  if (values.length === 0) {
    return <span className="muted">{i18n.t("common.none")}</span>;
  }
  return (
    <span className="chip-row">
      {values.map((value, index) => (
        <code key={`${value}:${index}`} className="code-chip">
          {value}
        </code>
      ))}
    </span>
  );
}

/* --------------------------------------------------------------------- OA */
export function OaCharacterDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: OaCharacterEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const group = oaGroups(db).find((entry) => entry.oa.id === entity.id);
  if (!group) {
    return null;
  }
  return (
    <>
      <Section title={i18n.t("section.oaArchive")} testId="oa-character-summary">
        <Facts>
          <Fact label={i18n.t("fact.character")}>
            <EntityById db={db} id={entity.character_id} lang={lang} />
          </Fact>
          <Fact label={i18n.t("fact.galleryFolder")}>
            <EntityById db={db} id={entity.gallery_folder_id} lang={lang} />
          </Fact>
          <Fact label={i18n.t("fact.objects")}>{group.objects.length}</Fact>
          <Fact label={i18n.t("fact.documents")}>{group.documents.length}</Fact>
          <Fact label={i18n.t("fact.descriptions")}>
            {group.descriptions.length}
          </Fact>
        </Facts>
      </Section>
      <Section title={i18n.t("section.objects")} testId="oa-object-list">
        <EntityList
          db={db}
          entities={group.objects}
          lang={lang}
          testId="oa-object-link"
          empty={i18n.t("value.noClickableObjects")}
        />
      </Section>
      <Section title={i18n.t("section.documents")} testId="oa-document-list">
        <EntityList
          db={db}
          entities={group.documents}
          lang={lang}
          testId="oa-document-link"
          empty={i18n.t("value.noDocuments")}
        />
      </Section>
      <Section
        title={i18n.t("section.descriptions")}
        testId="oa-description-list"
      >
        <EntityList
          db={db}
          entities={group.descriptions}
          lang={lang}
          testId="oa-description-link"
          empty={i18n.t("value.noDescriptions")}
        />
      </Section>
    </>
  );
}

export function OaObjectDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: OaObjectEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const documents = (db.entitiesByType.get("oa_document") ?? []).filter(
    (record): record is OaDocumentEntity =>
      isOaDocument(record) && record.object_id === entity.id,
  );
  return (
    <>
      <Section title={i18n.t("section.oaObject")} testId="oa-object-detail">
        <Facts>
          <Fact label={i18n.t("fact.character")}>
            <EntityById db={db} id={entity.character_id} lang={lang} />
          </Fact>
          <Fact label={i18n.t("fact.analyzeType")}>{entity.analyze_type}</Fact>
          <Fact label={i18n.t("fact.analyzeTypeId")}>
            <code>{entity.analyze_type_id ?? "—"}</code>
          </Fact>
          <Fact label={i18n.t("fact.levelLocks")}>
            <LevelLockList db={db} locks={entity.level_locks} />
          </Fact>
          <Fact label={i18n.t("fact.conditions")}>
            <ConditionList db={db} conditions={entity.conditions} />
          </Fact>
        </Facts>
      </Section>
      <Section
        title={i18n.t("section.documentsAttached")}
        testId="oa-object-documents"
      >
        <EntityList
          db={db}
          entities={documents}
          lang={lang}
          empty={i18n.t("value.noAttachedDocument")}
        />
      </Section>
    </>
  );
}

export function OaDocumentDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: OaDocumentEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section title={i18n.t("section.oaDocument")} testId="oa-document-detail">
      <Facts>
        <Fact label={i18n.t("fact.character")}>
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.object")}>
          <EntityById db={db} id={entity.object_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.mission")}>
          <code>{entity.mission_id ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.digitLock")}>
          {entity.digit_lock ?? i18n.t("common.none")}
        </Fact>
      </Facts>
    </Section>
  );
}

export function OaDescriptionDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: OaDescriptionEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section
      title={i18n.t("section.oaDescription")}
      testId="oa-description-detail"
    >
      <Facts>
        <Fact label={i18n.t("fact.character")}>
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.descriptionObject")}>
          <code>{entity.description_object_id}</code>
        </Fact>
        <Fact label={i18n.t("fact.weight")}>{entity.weight}</Fact>
        <Fact label={i18n.t("fact.event")}>{entity.event}</Fact>
        <Fact label={i18n.t("fact.enableLocks")}>
          <LevelLockList db={db} locks={entity.enable_level_locks} />
        </Fact>
        <Fact label={i18n.t("fact.enableConditions")}>
          <ConditionList db={db} conditions={entity.enable_conditions} />
        </Fact>
        <Fact label={i18n.t("fact.disableLocks")}>
          <LevelLockList db={db} locks={entity.disable_level_locks} />
        </Fact>
        <Fact label={i18n.t("fact.disableConditions")}>
          <ConditionList db={db} conditions={entity.disable_conditions} />
        </Fact>
      </Facts>
    </Section>
  );
}

/* --------------------------------------------------------- Backup Database */
export function GalleryFolderDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: GalleryFolderEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const items = (db.entitiesByType.get("gallery_item") ?? []).filter(
    (record): record is GalleryItemEntity =>
      isGalleryItem(record) && record.folder_id === entity.id,
  );
  const stages = (db.entitiesByType.get("boss_stage") ?? []).filter(
    (record): record is BossStageEntity =>
      isBossStage(record) && record.folder_id === entity.id,
  );
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return (
    <>
      <Section title={i18n.t("section.backupFolder")} testId="gallery-folder-detail">
        <Facts>
          <Fact label={i18n.t("fact.avatar")}>
            <code>{entity.avatar_id ?? "—"}</code>
          </Fact>
          <Fact label={i18n.t("fact.items")}>{items.length}</Fact>
          <Fact label={i18n.t("fact.videos")}>{counts.get("video") ?? 0}</Fact>
          <Fact label={i18n.t("fact.images")}>{counts.get("image") ?? 0}</Fact>
          <Fact label={i18n.t("fact.bossStages")}>
            {counts.get("boss_stage") ?? 0}
          </Fact>
        </Facts>
      </Section>
      <Section
        title={i18n.t("section.mediaRetrospective")}
        testId="gallery-folder-items"
      >
        <EntityList db={db} entities={items} lang={lang} testId="gallery-item-link" />
      </Section>
      {stages.length > 0 ? (
        <Section title={i18n.t("section.bossStages")}>
          <EntityList db={db} entities={stages} lang={lang} />
        </Section>
      ) : null}
    </>
  );
}

export function GalleryItemDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: GalleryItemEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const stage = bossStageForGalleryItem(db, entity.id);
  return (
    <Section title={i18n.t("section.backupItem")} testId="gallery-item-detail">
      <Facts>
        <Fact label={i18n.t("fact.kind")}>
          <MediaKindBadge kind={entity.kind} />
        </Fact>
        <Fact label={i18n.t("fact.folder")}>
          <EntityById db={db} id={entity.folder_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.location")}>
          <code>{entity.location}</code>
        </Fact>
        <Fact label={i18n.t("fact.format")}>{entity.format}</Fact>
        <Fact label={i18n.t("fact.size")}>
          {entity.size
            ? `${i18n.formatNumber(entity.size[0])} × ${i18n.formatNumber(entity.size[1])}`
            : "—"}
        </Fact>
        <Fact label={i18n.t("fact.obtainable")}>
          {entity.obtainable ? i18n.t("common.yes") : i18n.t("common.no")}
        </Fact>
        <Fact label={i18n.t("fact.conditions")}>
          <ConditionList db={db} conditions={entity.conditions} />
        </Fact>
        {stage ? (
          <Fact label={i18n.t("fact.bossStage")}>
            <EntityLink db={db} entity={stage} lang={lang} />
          </Fact>
        ) : null}
      </Facts>
    </Section>
  );
}

export function BossStageDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: BossStageEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section title={i18n.t("section.bossStage")} testId="boss-stage-detail">
      <Facts>
        <Fact label={i18n.t("fact.displayName")}>{entity.display_name}</Fact>
        <Fact label={i18n.t("fact.aliases")}>
          <StringChips values={entity.aliases} />
        </Fact>
        <Fact label={i18n.t("fact.conditions")}>
          <ConditionList db={db} conditions={entity.conditions} />
        </Fact>
        <Fact label={i18n.t("fact.folder")}>
          <EntityById db={db} id={entity.folder_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.galleryItem")}>
          <EntityById db={db} id={entity.gallery_item_id} lang={lang} />
        </Fact>
      </Facts>
    </Section>
  );
}

/* ------------------------------------------------------------------ story */
export function StoryNodeDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: StoryNodeEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  if (entity.kind === "branch") {
    const next = (entity.next ?? [])
      .map((id) => db.entityById.get(id))
      .filter(
        (record): record is StoryNodeEntity =>
          record !== undefined && isStoryNode(record),
      );
    return (
      <>
        <Section
          title={i18n.t("section.storyBranch")}
          testId="story-branch-detail"
        >
          <Facts>
            <Fact label={i18n.t("fact.kind")}>
              <StoryKindBadge kind={entity.kind} />
            </Fact>
            <Fact label={i18n.t("fact.order")}>{entity.order ?? "—"}</Fact>
            <Fact label={i18n.t("fact.position")}>{entity.position ?? "—"}</Fact>
            <Fact label={i18n.t("fact.level")}>{entity.level ?? "—"}</Fact>
            <Fact label={i18n.t("fact.sourceFile")}>
              <code>{entity.source_file ?? "—"}</code>
            </Fact>
            <Fact label={i18n.t("fact.state")}>
              <code>
                {entity.state_id ?? "—"} / {entity.state_value ?? "—"}
              </code>
            </Fact>
            <Fact label={i18n.t("fact.levelLocks")}>
              <LevelLockList db={db} locks={entity.level_locks} />
            </Fact>
          </Facts>
        </Section>
        <Section title={i18n.t("section.nextNodes")} testId="story-next">
          <EntityList
            db={db}
            entities={next}
            lang={lang}
            empty={i18n.t("value.noNextNode")}
          />
        </Section>
      </>
    );
  }
  const bossStages = entity.boss_stages ?? [];
  const movies = entity.movie_files ?? [];
  return (
    <Section title={i18n.t("section.storyEvent")} testId="story-event-detail">
      <Facts>
        <Fact label={i18n.t("fact.kind")}>
          <StoryKindBadge kind={entity.kind} />
        </Fact>
        <Fact label={i18n.t("fact.className")}>
          <code>{entity.class_name ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.topicIds")}>
          <StringChips values={entity.topic_ids ?? []} />
        </Fact>
        <Fact label={i18n.t("fact.startTopic")}>
          <code>{entity.start_topic_id ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.endTopic")}>
          <code>{entity.end_topic_id ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.triggerTopics")}>
          <StringChips values={entity.trigger_topics ?? []} />
        </Fact>
        <Fact label={i18n.t("fact.triggerOs")}>
          <code>{entity.trigger_os_id ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.actions")}>
          <StringChips values={entity.actions ?? []} />
        </Fact>
        <Fact label={i18n.t("fact.steps")}>
          <StringChips values={entity.steps ?? []} />
        </Fact>
        <Fact label={i18n.t("fact.movies")}>
          <StringChips values={movies} />
        </Fact>
        <Fact label={i18n.t("fact.gallery")}>
          <EntityById db={db} id={entity.gallery_ref} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.bossStages")}>
          {bossStages.length === 0 ? (
            <span className="muted">{i18n.t("common.none")}</span>
          ) : (
            <span className="chip-row">
              {bossStages.map((stage) => {
                const target = stage.entity_id
                  ? db.entityById.get(stage.entity_id)
                  : undefined;
                return target ? (
                  <Link
                    key={stage.raw}
                    to={entityHref(target.id)}
                    className="inline-link"
                  >
                    {stage.raw}
                  </Link>
                ) : (
                  <span key={stage.raw} className="muted">
                    {stage.raw} ({stage.status})
                  </span>
                );
              })}
            </span>
          )}
        </Fact>
      </Facts>
    </Section>
  );
}

/* ------------------------------------------------------------------- shop */
export function CapsoPackDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: CapsoShopPackEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const items = (db.entitiesByType.get("capso_shop_item") ?? []).filter(
    (record): record is CapsoShopItemEntity =>
      isCapsoShopItem(record) && record.pack_id === entity.id,
  );
  return (
    <>
      <Section title={i18n.t("section.capsoPack")} testId="capso-pack-detail">
        <Facts>
          <Fact label={i18n.t("fact.price")}>
            {entity.default_price_string || "—"}
          </Fact>
          <Fact label={i18n.t("fact.capsoPrice")}>{entity.capso_price}</Fact>
          <Fact label={i18n.t("fact.capsoAvailable")}>
            {entity.available_for_capso
              ? i18n.t("common.yes")
              : i18n.t("common.no")}
          </Fact>
          <Fact label={i18n.t("fact.iapAvailable")}>
            {entity.available_for_iap
              ? i18n.t("common.yes")
              : i18n.t("common.no")}
          </Fact>
          <Fact label={i18n.t("fact.icon")}>
            <code>{entity.icon_path || "—"}</code>
          </Fact>
        </Facts>
      </Section>
      <Section
        title={i18n.t("section.capsoItems", { count: items.length })}
        testId="capso-pack-items"
      >
        <EntityList
          db={db}
          entities={items}
          lang={lang}
          testId="capso-item-link"
          empty={i18n.t("value.noItemsInPack")}
        />
      </Section>
    </>
  );
}

export function CapsoItemDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: CapsoShopItemEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section title={i18n.t("section.capsoItem")} testId="capso-item-detail">
      <Facts>
        <Fact label={i18n.t("fact.pack")}>
          <EntityById db={db} id={entity.pack_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.kind")}>{entity.kind}</Fact>
        <Fact label={i18n.t("fact.itemId")}>
          <code>{entity.item_id}</code>
        </Fact>
        <Fact label={i18n.t("fact.position")}>{entity.position}</Fact>
        <Fact label={i18n.t("fact.illustration")}>
          <EntityById db={db} id={entity.illustration_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.song")}>
          <EntityById db={db} id={entity.song_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.tapFx")}>
          <code>{entity.tap_fx_id ?? "—"}</code>
        </Fact>
      </Facts>
    </Section>
  );
}

export function GachaMachineDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: GachaMachineEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const rewards = (db.entitiesByType.get("gacha_reward") ?? []).filter(
    (record): record is GachaRewardEntity =>
      isGachaReward(record) && record.machine_id === entity.id,
  );
  const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  return (
    <>
      <Section title={i18n.t("section.gachaMachine")} testId="gacha-machine-detail">
        <Facts>
          <Fact label={i18n.t("fact.price")}>
            {entity.default_price || "—"}
          </Fact>
          <Fact label={i18n.t("fact.icon")}>
            <code>{entity.icon_path || "—"}</code>
          </Fact>
          <Fact label={i18n.t("fact.rewards")}>{rewards.length}</Fact>
          <Fact label={i18n.t("fact.totalWeight")}>{totalWeight}</Fact>
        </Facts>
      </Section>
      <Section title={i18n.t("section.rewards")} testId="gacha-rewards">
        <table className="data-table">
          <thead>
            <tr>
              <th>{i18n.t("table.reward")}</th>
              <th>{i18n.t("table.kind")}</th>
              <th>{i18n.t("table.weight")}</th>
              <th>{i18n.t("table.secret")}</th>
            </tr>
          </thead>
          <tbody>
            {rewards.map((reward) => (
              <tr key={reward.id}>
                <td>
                  <EntityLink db={db} entity={reward} lang={lang} />
                </td>
                <td>{reward.kind}</td>
                <td>{reward.weight}</td>
                <td>
                  {reward.secret ? i18n.t("common.yes") : i18n.t("common.no")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

export function GachaRewardDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: GachaRewardEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section title={i18n.t("section.gachaReward")} testId="gacha-reward-detail">
      <Facts>
        <Fact label={i18n.t("fact.machine")}>
          <EntityById db={db} id={entity.machine_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.kind")}>{entity.kind}</Fact>
        <Fact label={i18n.t("fact.weight")}>{entity.weight}</Fact>
        <Fact label={i18n.t("fact.secret")}>
          {entity.secret ? i18n.t("common.yes") : i18n.t("common.no")}
        </Fact>
        <Fact label={i18n.t("fact.illustration")}>
          <EntityById db={db} id={entity.illustration_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.song")}>
          <EntityById db={db} id={entity.song_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.tapFx")}>
          <code>{entity.tap_fx_id ?? "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.imLock")}>
          <code>{entity.reward_locks.im_topic_id || "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.osLock")}>
          <code>{entity.reward_locks.os_file_id || "—"}</code>
        </Fact>
        <Fact label={i18n.t("fact.storyLock")}>
          <code>{entity.reward_locks.story_lock_id || "—"}</code>
        </Fact>
      </Facts>
    </Section>
  );
}

export function ShopBundleDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: ShopBundleEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <>
      <Section title={i18n.t("section.shopBundle")} testId="shop-bundle-detail">
        <Facts>
          <Fact label={i18n.t("fact.sale")}>
            {entity.black_market ? (
              <span className="black-market" data-testid="black-market-badge">
                {i18n.t("value.blackMarket")}
              </span>
            ) : (
              i18n.t("value.standard")
            )}
          </Fact>
          <Fact label={i18n.t("fact.milestone")}>
            <code>{entity.milestone_key || "—"}</code>
          </Fact>
          <Fact label={i18n.t("fact.freeCharacterLevel")}>
            {i18n.t("common.level", {
              level: entity.trigger_free_character_level + 1,
            })}
          </Fact>
          <Fact label={i18n.t("fact.items")}>{entity.items.length}</Fact>
        </Facts>
      </Section>
      <Section title={i18n.t("section.bundleItems")} testId="shop-bundle-items">
        <ul className="link-list">
          {entity.items.map((item) => {
            const target = bundleItemEntity(db, item);
            const meta = `${item.item_type} · ${i18n.t("value.weightMeta", {
              weight: item.weight,
            })}`;
            return (
              <li key={`${item.item_type}:${item.product_id}`}>
                {target ? (
                  <EntityLink
                    db={db}
                    entity={target}
                    lang={lang}
                    meta={meta}
                  />
                ) : (
                  <span className="entity-link">
                    <span className="entity-link-title">{item.product_id}</span>
                    <span className="entity-link-meta">{meta}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={i18n.t("section.iapTiers")} testId="shop-bundle-tiers">
        <table className="data-table">
          <thead>
            <tr>
              <th>{i18n.t("table.iapId")}</th>
              <th>{i18n.t("table.remainingWeight")}</th>
            </tr>
          </thead>
          <tbody>
            {entity.tiers.map((tier) => (
              <tr key={tier.iap_id}>
                <td>
                  <code>{tier.iap_id}</code>
                </td>
                <td>{tier.remain_weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------- misc */
export function SubtitleLineDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: SubtitleLineEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const voice = db.entityById.get(entity.voice_asset_id);
  return (
    <>
      <Section title={i18n.t("section.subtitleLine")} testId="subtitle-detail">
        <TextBody textRef={entity.text_ref} lang={lang} />
        <Facts>
          <Fact label={i18n.t("fact.character")}>{entity.character || "—"}</Fact>
          <Fact label={i18n.t("fact.gameId")}>
            <code>{entity.game_id}</code>
          </Fact>
          <Fact label={i18n.t("fact.voiceAsset")}>
            {voice ? (
              <EntityLink db={db} entity={voice} lang={lang} />
            ) : (
              <code>{entity.voice_asset_id}</code>
            )}
          </Fact>
        </Facts>
      </Section>
    </>
  );
}

export function IllustrationDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: IllustrationEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  return (
    <Section title={i18n.t("section.illustration")} testId="illustration-detail">
      <Facts>
        <Fact label={i18n.t("fact.character")}>
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.costume")}>{entity.costume}</Fact>
        <Fact label={i18n.t("fact.available")}>
          {entity.available ? i18n.t("common.yes") : i18n.t("common.no")}
        </Fact>
        <Fact label={i18n.t("fact.asset")}>
          <EntityById db={db} id={entity.asset_id} lang={lang} />
        </Fact>
        <Fact label={i18n.t("fact.description")}>
          {entity.description || "—"}
        </Fact>
      </Facts>
    </Section>
  );
}
