import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { ChartLinks } from "../components/ChartLinks";
import {
  BossStageDetails,
  CapsoItemDetails,
  CapsoPackDetails,
  GachaMachineDetails,
  GachaRewardDetails,
  GalleryFolderDetails,
  GalleryItemDetails,
  IllustrationDetails,
  OaCharacterDetails,
  OaDescriptionDetails,
  OaDocumentDetails,
  OaObjectDetails,
  ShopBundleDetails,
  StoryNodeDetails,
  SubtitleLineDetails,
} from "../components/EntitySections";
import { Fact, Facts } from "../components/Facts";
import { RelationsSection } from "../components/Relations";
import { TextBody } from "../components/TextBody";
import { TypeBadge } from "../components/ui";
import {
  isBossStage,
  isCapsoShopItem,
  isCapsoShopPack,
  isGachaMachine,
  isGachaReward,
  isGalleryFolder,
  isGalleryItem,
  isIllustration,
  isImPost,
  isOaCharacter,
  isOaDescription,
  isOaDocument,
  isOaObject,
  isOsLog,
  isShopBundle,
  isStoryNode,
  isSubtitleLine,
  recordOf,
} from "../data/database";
import { pickLocalized, useLanguage } from "../data/language";
import {
  characterName,
  entityHome,
  entityTitle,
  entityTypeLabel,
  formatFieldValue,
  formatLevelLocks,
  incomingEdges,
  outgoingEdges,
  unlockedCharts,
} from "../data/selectors";
import type {
  BaseEntity,
  ChartEntity,
  Database,
  Lang,
  LocalizedText,
} from "../types";

const GENERIC_FIELDS = [
  "game_id",
  "kind",
  "item_id",
  "machine_id",
  "pack_id",
  "character_id",
  "analyze_type",
  "analyze_type_id",
  "reward_type",
  "item_type",
  "weight",
  "secret",
  "position",
  "order",
  "need_unlock",
  "music_id",
  "artist",
  "category",
  "date",
  "file",
  "index",
  "chapter_id",
  "folder_id",
  "location",
  "format",
  "obtainable",
  "story_gate",
  "topic_gate",
  "threshold",
  "file_lock",
  "source_file",
  "state_id",
  "state_value",
  "mission_id",
  "digit_lock",
  "description_object_id",
  "available_for_capso",
  "available_for_iap",
  "capso_price",
  "default_price_string",
  "default_price",
  "icon_path",
  "icon",
  "black_market",
  "milestone_key",
  "trigger_free_character_level",
] as const;

const DETAILED_TYPES: Record<string, true> = {
  oa_character: true,
  oa_object: true,
  oa_document: true,
  oa_description: true,
  gallery_folder: true,
  gallery_item: true,
  boss_stage: true,
  story_node: true,
  capso_shop_pack: true,
  capso_shop_item: true,
  gacha_machine: true,
  gacha_reward: true,
  shop_bundle: true,
  subtitle_line: true,
  illustration: true,
};

function textRefOf(entity: BaseEntity): string | null {
  const value = recordOf(entity)["text_ref"];
  return typeof value === "string" && value ? value : null;
}

function titlePick(
  db: Database,
  entity: BaseEntity,
  lang: Lang,
): { title: string; fallback: boolean; actual: Lang | null } {
  const data = recordOf(entity);
  const map = (data["titles"] ?? data["names"]) as LocalizedText | undefined;
  if (map && typeof map === "object") {
    const picked = pickLocalized(map, lang);
    if (picked.value) {
      return {
        title: picked.value,
        fallback: picked.fallback,
        actual: picked.lang,
      };
    }
  }
  if (
    isImPost(entity) ||
    isOsLog(entity) ||
    isOaDocument(entity) ||
    isOaObject(entity) ||
    isOaDescription(entity) ||
    isStoryNode(entity)
  ) {
    const names = db.textNames[textRefOf(entity) ?? ""];
    if (names) {
      const picked = pickLocalized(names as LocalizedText, lang);
      if (picked.value) {
        return {
          title: picked.value,
          fallback: picked.fallback,
          actual: picked.lang,
        };
      }
    }
  }
  return {
    title: entityTitle(db, entity, lang),
    fallback: false,
    actual: null,
  };
}

function TypeDetails({
  db,
  entity,
  lang,
}: {
  db: Database;
  entity: BaseEntity;
  lang: Lang;
}): ReactNode {
  if (isOaCharacter(entity)) {
    return <OaCharacterDetails db={db} entity={entity} lang={lang} />;
  }
  if (isOaObject(entity)) {
    return <OaObjectDetails db={db} entity={entity} lang={lang} />;
  }
  if (isOaDocument(entity)) {
    return <OaDocumentDetails db={db} entity={entity} lang={lang} />;
  }
  if (isOaDescription(entity)) {
    return <OaDescriptionDetails db={db} entity={entity} lang={lang} />;
  }
  if (isGalleryFolder(entity)) {
    return <GalleryFolderDetails db={db} entity={entity} lang={lang} />;
  }
  if (isGalleryItem(entity)) {
    return <GalleryItemDetails db={db} entity={entity} lang={lang} />;
  }
  if (isBossStage(entity)) {
    return <BossStageDetails db={db} entity={entity} lang={lang} />;
  }
  if (isStoryNode(entity)) {
    return <StoryNodeDetails db={db} entity={entity} lang={lang} />;
  }
  if (isCapsoShopPack(entity)) {
    return <CapsoPackDetails db={db} entity={entity} lang={lang} />;
  }
  if (isCapsoShopItem(entity)) {
    return <CapsoItemDetails db={db} entity={entity} lang={lang} />;
  }
  if (isGachaMachine(entity)) {
    return <GachaMachineDetails db={db} entity={entity} lang={lang} />;
  }
  if (isGachaReward(entity)) {
    return <GachaRewardDetails db={db} entity={entity} lang={lang} />;
  }
  if (isShopBundle(entity)) {
    return <ShopBundleDetails db={db} entity={entity} lang={lang} />;
  }
  if (isSubtitleLine(entity)) {
    return <SubtitleLineDetails db={db} entity={entity} lang={lang} />;
  }
  if (isIllustration(entity)) {
    return <IllustrationDetails db={db} entity={entity} lang={lang} />;
  }
  return null;
}

export function EntityView({
  db,
  entity,
}: {
  db: Database;
  entity: BaseEntity;
}) {
  const { lang } = useLanguage();
  const order = db.readingOrderByEntity.get(entity.id);
  const textRef = textRefOf(entity);
  const picked = titlePick(db, entity, lang);
  const home = entityHome(entity);

  const charts = useMemo(() => {
    const collected = new Map<string, ChartEntity>();
    for (const chart of db.chartsBySong.get(entity.id) ?? []) {
      collected.set(chart.id, chart);
    }
    for (const chart of unlockedCharts(db, entity)) {
      collected.set(chart.id, chart);
    }
    return [...collected.values()];
  }, [db, entity]);

  const outgoingCount = outgoingEdges(db, entity.id).length;
  const incomingCount = incomingEdges(db, entity.id).length;

  const data = recordOf(entity);
  const genericFacts = GENERIC_FIELDS.map((field) => ({
    field,
    value: formatFieldValue(data[field]),
  })).filter((fact) => fact.value !== "");
  const levelLocks = formatLevelLocks(db, data["level_locks"]);
  const provenance = data["provenance"];
  const spoiler = order?.spoiler_alert
    ? db.spoilerById.get(order.spoiler_alert)
    : undefined;

  return (
    <>
      <main className="content">
        <div className="back-row">
          {home ? (
            <Link
              to={home.href}
              className="backlink"
              data-testid={
                home.href === "/timeline" ? "back-to-timeline" : "back-to-collection"
              }
            >
              ← {home.label}
            </Link>
          ) : null}
          <BackButton />
        </div>

        <article
          className="detail"
          data-testid="entity-view"
          data-entity-id={entity.id}
          data-entity-type={entity.type}
        >
          <header className="detail-head">
            <p className="eyebrow">
              {entityTypeLabel(entity.type)} · <code>{entity.id}</code>
            </p>
            <h1>{picked.title}</h1>
            {picked.fallback ? (
              <div className="fallback-note" data-testid="language-fallback">
                {lang} missing · showing {picked.actual}
              </div>
            ) : null}
            {isImPost(entity) ? (
              <p className="byline">
                {entity.author}
                {order?.thread ? ` · ${characterName(db, order.thread)}` : ""} ·{" "}
                {entity.likes} likes · {entity.reply_count} replies
              </p>
            ) : null}
            {isOsLog(entity) ? (
              <p className="byline">
                {entity.date || "No date"} · file {entity.file} · index{" "}
                {entity.index}
              </p>
            ) : null}
            {!isImPost(entity) && !isOsLog(entity) ? (
              <p className="byline">
                <TypeBadge type={entity.type} />
                {typeof data["game_id"] === "string" ? (
                  <>
                    {" · "}
                    <code>{data["game_id"]}</code>
                  </>
                ) : null}
              </p>
            ) : null}
          </header>

          {textRef ? <TextBody textRef={textRef} lang={lang} /> : null}

          {!textRef && !DETAILED_TYPES[entity.type] ? (
            <dl className="facts entity-facts">
              {genericFacts.map((fact) => (
                <Fact key={fact.field} label={fact.field}>
                  {fact.value}
                </Fact>
              ))}
              {levelLocks.length > 0 ? (
                <Fact label="Level locks">{levelLocks.join(" · ")}</Fact>
              ) : null}
            </dl>
          ) : null}

          {isImPost(entity) && levelLocks.length > 0 ? (
            <p className="hint">Level locks: {levelLocks.join(" · ")}</p>
          ) : null}

          <TypeDetails db={db} entity={entity} lang={lang} />

          {charts.length > 0 ? (
            <section className="detail-section" data-testid="charts-section">
              <h2>
                {isImPost(entity) || isOsLog(entity) ? "Unlocks charts" : "Charts"}
              </h2>
              <ChartLinks db={db} charts={charts} />
            </section>
          ) : null}

          <RelationsSection
            db={db}
            entityId={entity.id}
            lang={lang}
            exclude={["unlocks_chart"]}
          />
        </article>
      </main>

      <aside className="context" aria-label="Entity details">
        <section className="panel">
          <h2>Entity</h2>
          <Facts>
            <Fact label="Type">{entityTypeLabel(entity.type)}</Fact>
            <Fact label="ID">
              <code>{entity.id}</code>
            </Fact>
            {typeof data["game_id"] === "string" ? (
              <Fact label="Game ID">
                <code>{data["game_id"]}</code>
              </Fact>
            ) : null}
            {order ? (
              <>
                <Fact label="Reading order" testId="entity-order">
                  #{order.order}
                </Fact>
                <Fact label="Level gate" testId="entity-level">
                  Lv {order.level_gate + 1}
                </Fact>
                <Fact label="Tier" testId="entity-tier">
                  {order.tier}
                </Fact>
                <Fact label="Stage">{order.stage}</Fact>
                {order.thread ? (
                  <Fact label="Thread">{characterName(db, order.thread)}</Fact>
                ) : null}
                {order.chapter ? (
                  <Fact label="Chapter">{order.chapter}</Fact>
                ) : null}
                <Fact label="Spoiler" testId="entity-spoiler">
                  {spoiler
                    ? `Lv ${spoiler.threshold + 1}`
                    : order.spoiler_alert
                      ? order.spoiler_alert
                      : "none"}
                </Fact>
              </>
            ) : null}
          </Facts>
        </section>

        {isImPost(entity) ? (
          <section className="panel">
            <h2>iM post</h2>
            <Facts>
              <Fact label="Author">{entity.author}</Fact>
              <Fact label="iM order">{entity.order}</Fact>
              <Fact label="Likes">{entity.likes}</Fact>
              <Fact label="Replies">{entity.reply_count}</Fact>
              <Fact label="Story gate">{entity.story_gate ?? "none"}</Fact>
              <Fact label="Topic gate">{entity.topic_gate ?? "none"}</Fact>
              <Fact label="Attachments">
                {entity.attachments.length > 0
                  ? entity.attachments.join(", ")
                  : "none"}
              </Fact>
            </Facts>
          </section>
        ) : null}

        {isOsLog(entity) ? (
          <section className="panel">
            <h2>OS log</h2>
            <Facts>
              <Fact label="File">{entity.file}</Fact>
              <Fact label="Index">{entity.index}</Fact>
              <Fact label="Date">{entity.date || "—"}</Fact>
              <Fact label="Category">{entity.category || "—"}</Fact>
              <Fact label="Chapter">{entity.chapter_id}</Fact>
              <Fact label="File lock">{entity.file_lock ?? "none"}</Fact>
              <Fact label="Movies">
                {entity.movies.length > 0 ? entity.movies.join(", ") : "none"}
              </Fact>
            </Facts>
          </section>
        ) : null}

        {Array.isArray(provenance) && provenance.length > 0 ? (
          <section className="panel">
            <h2>Provenance</h2>
            <ul className="prov">
              {provenance.map((entry, index) => {
                if (typeof entry !== "object" || entry === null) {
                  return null;
                }
                const record = entry as Record<string, unknown>;
                return (
                  <li key={index}>
                    <code>{formatFieldValue(record["locator"])}</code>
                    <span>{formatFieldValue(record["kind"])}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="panel">
          <h2>Edges</h2>
          <Facts>
            <Fact label="Outgoing">{outgoingCount}</Fact>
            <Fact label="Incoming">{incomingCount}</Fact>
            <Fact label="Charts">{charts.length}</Fact>
            <Fact label="Language">{lang}</Fact>
          </Facts>
        </section>
      </aside>
    </>
  );
}
