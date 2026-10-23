import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConditionList, LevelLockList } from "./Conditions";
import { EntityLink, EntityList } from "./EntityLink";
import { Fact, Facts } from "./Facts";
import { MediaKindBadge, StoryKindBadge } from "./ui";
import {
  isBossStage,
  isCapsoShopItem,
  isGachaReward,
  isGalleryItem,
  isOaDocument,
  isStoryNode,
} from "../data/database";
import {
  bossStageForGalleryItem,
  bundleItemEntity,
  entityHref,
  entityTitle,
} from "../data/selectors";
import { oaGroups } from "../data/collections";
import { pickLocalized } from "../data/language";
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
  if (!id) {
    return <span className="muted">None</span>;
  }
  const entity = db.entityById.get(id);
  if (!entity) {
    return <code>{id}</code>;
  }
  return (
    <Link to={entityHref(id)} className="inline-link">
      {entityTitle(db, entity, lang)}
    </Link>
  );
}

function StringChips({ values }: { values: readonly string[] }) {
  if (values.length === 0) {
    return <span className="muted">None</span>;
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
  const group = oaGroups(db).find((entry) => entry.oa.id === entity.id);
  if (!group) {
    return null;
  }
  return (
    <>
      <Section title="OA archive" testId="oa-character-summary">
        <Facts>
          <Fact label="Character">
            <EntityById db={db} id={entity.character_id} lang={lang} />
          </Fact>
          <Fact label="Gallery folder">
            <EntityById db={db} id={entity.gallery_folder_id} lang={lang} />
          </Fact>
          <Fact label="Objects">{group.objects.length}</Fact>
          <Fact label="Documents">{group.documents.length}</Fact>
          <Fact label="Descriptions">{group.descriptions.length}</Fact>
        </Facts>
      </Section>
      <Section title="Objects" testId="oa-object-list">
        <EntityList
          db={db}
          entities={group.objects}
          lang={lang}
          testId="oa-object-link"
          empty="No clickable objects."
        />
      </Section>
      <Section title="Documents" testId="oa-document-list">
        <EntityList
          db={db}
          entities={group.documents}
          lang={lang}
          testId="oa-document-link"
          empty="No documents."
        />
      </Section>
      <Section title="Descriptions" testId="oa-description-list">
        <EntityList
          db={db}
          entities={group.descriptions}
          lang={lang}
          testId="oa-description-link"
          empty="No descriptions."
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
  const documents = (db.entitiesByType.get("oa_document") ?? []).filter(
    (record): record is OaDocumentEntity =>
      isOaDocument(record) && record.object_id === entity.id,
  );
  return (
    <>
      <Section title="OA object" testId="oa-object-detail">
        <Facts>
          <Fact label="Character">
            <EntityById db={db} id={entity.character_id} lang={lang} />
          </Fact>
          <Fact label="Analyze type">{entity.analyze_type}</Fact>
          <Fact label="Analyze type ID">
            <code>{entity.analyze_type_id ?? "—"}</code>
          </Fact>
          <Fact label="Level locks">
            <LevelLockList db={db} locks={entity.level_locks} />
          </Fact>
          <Fact label="Conditions">
            <ConditionList db={db} conditions={entity.conditions} />
          </Fact>
        </Facts>
      </Section>
      <Section title="Documents attached" testId="oa-object-documents">
        <EntityList
          db={db}
          entities={documents}
          lang={lang}
          empty="No document is attached to this object."
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
  return (
    <Section title="OA document" testId="oa-document-detail">
      <Facts>
        <Fact label="Character">
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label="Object">
          <EntityById db={db} id={entity.object_id} lang={lang} />
        </Fact>
        <Fact label="Mission">
          <code>{entity.mission_id ?? "—"}</code>
        </Fact>
        <Fact label="Digit lock">{entity.digit_lock ?? "none"}</Fact>
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
  return (
    <Section title="OA description" testId="oa-description-detail">
      <Facts>
        <Fact label="Character">
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label="Description object">
          <code>{entity.description_object_id}</code>
        </Fact>
        <Fact label="Weight">{entity.weight}</Fact>
        <Fact label="Event">{entity.event}</Fact>
        <Fact label="Enable locks">
          <LevelLockList db={db} locks={entity.enable_level_locks} />
        </Fact>
        <Fact label="Enable conditions">
          <ConditionList db={db} conditions={entity.enable_conditions} />
        </Fact>
        <Fact label="Disable locks">
          <LevelLockList db={db} locks={entity.disable_level_locks} />
        </Fact>
        <Fact label="Disable conditions">
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
      <Section title="Backup folder" testId="gallery-folder-detail">
        <Facts>
          <Fact label="Avatar">
            <code>{entity.avatar_id ?? "—"}</code>
          </Fact>
          <Fact label="Items">{items.length}</Fact>
          <Fact label="Videos">{counts.get("video") ?? 0}</Fact>
          <Fact label="Images">{counts.get("image") ?? 0}</Fact>
          <Fact label="Boss stages">{counts.get("boss_stage") ?? 0}</Fact>
        </Facts>
      </Section>
      <Section title="Media retrospective" testId="gallery-folder-items">
        <EntityList db={db} entities={items} lang={lang} testId="gallery-item-link" />
      </Section>
      {stages.length > 0 ? (
        <Section title="Boss stages">
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
  const stage = bossStageForGalleryItem(db, entity.id);
  return (
    <Section title="Backup item" testId="gallery-item-detail">
      <Facts>
        <Fact label="Kind">
          <MediaKindBadge kind={entity.kind} />
        </Fact>
        <Fact label="Folder">
          <EntityById db={db} id={entity.folder_id} lang={lang} />
        </Fact>
        <Fact label="Location">
          <code>{entity.location}</code>
        </Fact>
        <Fact label="Format">{entity.format}</Fact>
        <Fact label="Size">
          {entity.size ? `${entity.size[0]} × ${entity.size[1]}` : "—"}
        </Fact>
        <Fact label="Obtainable">{entity.obtainable ? "Yes" : "No"}</Fact>
        <Fact label="Conditions">
          <ConditionList db={db} conditions={entity.conditions} />
        </Fact>
        {stage ? (
          <Fact label="Boss stage">
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
  return (
    <Section title="Boss stage" testId="boss-stage-detail">
      <Facts>
        <Fact label="Display name">{entity.display_name}</Fact>
        <Fact label="Aliases">
          <StringChips values={entity.aliases} />
        </Fact>
        <Fact label="Conditions">
          <ConditionList db={db} conditions={entity.conditions} />
        </Fact>
        <Fact label="Folder">
          <EntityById db={db} id={entity.folder_id} lang={lang} />
        </Fact>
        <Fact label="Gallery item">
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
  if (entity.kind === "branch") {
    const next = (entity.next ?? [])
      .map((id) => db.entityById.get(id))
      .filter(
        (record): record is StoryNodeEntity =>
          record !== undefined && isStoryNode(record),
      );
    return (
      <>
        <Section title="Branching OS node" testId="story-branch-detail">
          <Facts>
            <Fact label="Kind">
              <StoryKindBadge kind={entity.kind} />
            </Fact>
            <Fact label="Order">{entity.order ?? "—"}</Fact>
            <Fact label="Position">{entity.position ?? "—"}</Fact>
            <Fact label="Level">{entity.level ?? "—"}</Fact>
            <Fact label="Source file">
              <code>{entity.source_file ?? "—"}</code>
            </Fact>
            <Fact label="State">
              <code>
                {entity.state_id ?? "—"} / {entity.state_value ?? "—"}
              </code>
            </Fact>
            <Fact label="Level locks">
              <LevelLockList db={db} locks={entity.level_locks} />
            </Fact>
          </Facts>
        </Section>
        <Section title="Next nodes" testId="story-next">
          <EntityList db={db} entities={next} lang={lang} empty="No next node." />
        </Section>
      </>
    );
  }
  const bossStages = entity.boss_stages ?? [];
  const movies = entity.movie_files ?? [];
  return (
    <Section title="Story event" testId="story-event-detail">
      <Facts>
        <Fact label="Kind">
          <StoryKindBadge kind={entity.kind} />
        </Fact>
        <Fact label="Class">
          <code>{entity.class_name ?? "—"}</code>
        </Fact>
        <Fact label="Topic ids">
          <StringChips values={entity.topic_ids ?? []} />
        </Fact>
        <Fact label="Start topic">
          <code>{entity.start_topic_id ?? "—"}</code>
        </Fact>
        <Fact label="End topic">
          <code>{entity.end_topic_id ?? "—"}</code>
        </Fact>
        <Fact label="Trigger topics">
          <StringChips values={entity.trigger_topics ?? []} />
        </Fact>
        <Fact label="Trigger OS">
          <code>{entity.trigger_os_id ?? "—"}</code>
        </Fact>
        <Fact label="Actions">
          <StringChips values={entity.actions ?? []} />
        </Fact>
        <Fact label="Steps">
          <StringChips values={entity.steps ?? []} />
        </Fact>
        <Fact label="Movies">
          <StringChips values={movies} />
        </Fact>
        <Fact label="Gallery">
          <EntityById db={db} id={entity.gallery_ref} lang={lang} />
        </Fact>
        <Fact label="Boss stages">
          {bossStages.length === 0 ? (
            <span className="muted">None</span>
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
  const items = (db.entitiesByType.get("capso_shop_item") ?? []).filter(
    (record): record is CapsoShopItemEntity =>
      isCapsoShopItem(record) && record.pack_id === entity.id,
  );
  return (
    <>
      <Section title="CAPSO shop pack" testId="capso-pack-detail">
        <Facts>
          <Fact label="Price">{entity.default_price_string || "—"}</Fact>
          <Fact label="CAPSO price">{entity.capso_price}</Fact>
          <Fact label="CAPSO available">
            {entity.available_for_capso ? "Yes" : "No"}
          </Fact>
          <Fact label="IAP available">
            {entity.available_for_iap ? "Yes" : "No"}
          </Fact>
          <Fact label="Icon">
            <code>{entity.icon_path || "—"}</code>
          </Fact>
        </Facts>
      </Section>
      <Section title={`Items (${items.length})`} testId="capso-pack-items">
        <EntityList
          db={db}
          entities={items}
          lang={lang}
          testId="capso-item-link"
          empty="No items in this pack."
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
  return (
    <Section title="CAPSO item" testId="capso-item-detail">
      <Facts>
        <Fact label="Pack">
          <EntityById db={db} id={entity.pack_id} lang={lang} />
        </Fact>
        <Fact label="Kind">{entity.kind}</Fact>
        <Fact label="Item ID">
          <code>{entity.item_id}</code>
        </Fact>
        <Fact label="Position">{entity.position}</Fact>
        <Fact label="Illustration">
          <EntityById db={db} id={entity.illustration_id} lang={lang} />
        </Fact>
        <Fact label="Song">
          <EntityById db={db} id={entity.song_id} lang={lang} />
        </Fact>
        <Fact label="Tap FX">
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
  const rewards = (db.entitiesByType.get("gacha_reward") ?? []).filter(
    (record): record is GachaRewardEntity =>
      isGachaReward(record) && record.machine_id === entity.id,
  );
  const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  return (
    <>
      <Section title="Gacha machine" testId="gacha-machine-detail">
        <Facts>
          <Fact label="Price">{entity.default_price || "—"}</Fact>
          <Fact label="Icon">
            <code>{entity.icon_path || "—"}</code>
          </Fact>
          <Fact label="Rewards">{rewards.length}</Fact>
          <Fact label="Total weight">{totalWeight}</Fact>
        </Facts>
      </Section>
      <Section title="Rewards" testId="gacha-rewards">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reward</th>
              <th>Kind</th>
              <th>Weight</th>
              <th>Secret</th>
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
                <td>{reward.secret ? "Yes" : "No"}</td>
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
  return (
    <Section title="Gacha reward" testId="gacha-reward-detail">
      <Facts>
        <Fact label="Machine">
          <EntityById db={db} id={entity.machine_id} lang={lang} />
        </Fact>
        <Fact label="Kind">{entity.kind}</Fact>
        <Fact label="Weight">{entity.weight}</Fact>
        <Fact label="Secret">{entity.secret ? "Yes" : "No"}</Fact>
        <Fact label="Illustration">
          <EntityById db={db} id={entity.illustration_id} lang={lang} />
        </Fact>
        <Fact label="Song">
          <EntityById db={db} id={entity.song_id} lang={lang} />
        </Fact>
        <Fact label="Tap FX">
          <code>{entity.tap_fx_id ?? "—"}</code>
        </Fact>
        <Fact label="IM lock">
          <code>{entity.reward_locks.im_topic_id || "—"}</code>
        </Fact>
        <Fact label="OS lock">
          <code>{entity.reward_locks.os_file_id || "—"}</code>
        </Fact>
        <Fact label="Story lock">
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
  return (
    <>
      <Section title="Shop bundle" testId="shop-bundle-detail">
        <Facts>
          <Fact label="Sale">
            {entity.black_market ? (
              <span className="black-market" data-testid="black-market-badge">
                Black Market
              </span>
            ) : (
              "Standard"
            )}
          </Fact>
          <Fact label="Milestone">
            <code>{entity.milestone_key || "—"}</code>
          </Fact>
          <Fact label="Free character level">
            Lv {entity.trigger_free_character_level + 1}
          </Fact>
          <Fact label="Items">{entity.items.length}</Fact>
        </Facts>
      </Section>
      <Section title="Bundle items" testId="shop-bundle-items">
        <ul className="link-list">
          {entity.items.map((item) => {
            const target = bundleItemEntity(db, item);
            return (
              <li key={`${item.item_type}:${item.product_id}`}>
                {target ? (
                  <EntityLink
                    db={db}
                    entity={target}
                    lang={lang}
                    meta={`${item.item_type} · weight ${item.weight}`}
                  />
                ) : (
                  <span className="entity-link">
                    <span className="entity-link-title">{item.product_id}</span>
                    <span className="entity-link-meta">
                      {item.item_type} · weight {item.weight}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="IAP tiers" testId="shop-bundle-tiers">
        <table className="data-table">
          <thead>
            <tr>
              <th>IAP id</th>
              <th>Remaining weight</th>
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
  const picked = pickLocalized(entity.text, lang);
  const voice = db.entityById.get(entity.voice_asset_id);
  return (
    <>
      <Section title="Subtitle line" testId="subtitle-detail">
        {picked.fallback || !picked.value ? (
          <div className="fallback-note" data-testid="language-fallback">
            {picked.value
              ? `${lang} missing · showing ${picked.lang}`
              : `No text in ${lang} or any fallback language`}
          </div>
        ) : null}
        <blockquote className="subtitle-quote" data-lang={picked.lang ?? "none"}>
          {picked.value || "—"}
        </blockquote>
        <Facts>
          <Fact label="Character">{entity.character || "—"}</Fact>
          <Fact label="Game ID">
            <code>{entity.game_id}</code>
          </Fact>
          <Fact label="Voice asset">
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
  return (
    <Section title="Illustration" testId="illustration-detail">
      <Facts>
        <Fact label="Character">
          <EntityById db={db} id={entity.character_id} lang={lang} />
        </Fact>
        <Fact label="Costume">{entity.costume}</Fact>
        <Fact label="Available">{entity.available ? "Yes" : "No"}</Fact>
        <Fact label="Asset">
          <EntityById db={db} id={entity.asset_id} lang={lang} />
        </Fact>
        <Fact label="Description">{entity.description || "—"}</Fact>
      </Facts>
    </Section>
  );
}

