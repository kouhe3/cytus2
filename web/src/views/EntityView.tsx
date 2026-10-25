import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { ChartLinks } from "../components/ChartLinks";
import {
  BossStageDetails,
  CapsoItemDetails,
  CapsoPackDetails,
  ExpansionPackDetails,
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
import { EntityMedia } from "../components/EntityMedia";
import { Fact, Facts } from "../components/Facts";
import { MediaImage } from "../components/Media";
import { RelationsSection } from "../components/Relations";
import { TextBody } from "../components/TextBody";
import { TypeBadge } from "../components/ui";
import { useI18n } from "../data/i18n";
import {
  isBossStage,
  isCapsoShopItem,
  isCapsoShopPack,
  isExpansionPack,
  isGachaMachine,
  isGachaReward,
  isGalleryFolder,
  isGalleryItem,
  isIllustration,
  isImPost,
  isImReply,
  isOaCharacter,
  isOaDescription,
  isOaDocument,
  isOaObject,
  isOsLog,
  isShopBundle,
  isStoryNode,
  isSubtitleLine,
  recordOf,
  resolveEntityRef,
} from "../data/database";
import { pickLocalized, useLanguage } from "../data/language";
import {
  entityTypeLabel,
  fallbackNotice,
  tierLabel,
} from "../data/labels";
import { formatUnit } from "../data/messages";
import {
  characterName,
  entityHref,
  entityHome,
  entityTitle,
  formatFieldValue,
  formatLevelLocks,
  incomingEdges,
  outgoingEdges,
  unlockedCharts,
} from "../data/selectors";
import type { I18n } from "../data/messages";
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
  "expansion_pack_id",
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

const REF_FIELDS: ReadonlySet<string> = new Set([
  "machine_id",
  "pack_id",
  "expansion_pack_id",
  "character_id",
  "chapter_id",
  "folder_id",
  "story_gate",
  "topic_gate",
  "file_lock",
  "mission_id",
  "description_object_id",
  "item_id",
]);

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
  expansion_pack: true,
  capso_shop_item: true,
  gacha_machine: true,
  gacha_reward: true,
  shop_bundle: true,
  subtitle_line: true,
  illustration: true,
};

function FactValue({
  db,
  lang,
  field,
  raw,
  value,
}: {
  db: Database;
  lang: Lang;
  field: string;
  raw: unknown;
  value: string;
}): ReactNode {
  const i18n = useI18n();
  if (REF_FIELDS.has(field) && typeof raw === "string") {
    const entity = resolveEntityRef(db, raw);
    if (entity) {
      return (
        <Link to={entityHref(entity.id)} className="inline-link">
          {entityTitle(db, entity, lang, i18n)}
        </Link>
      );
    }
  }
  return value;
}

function textRefOf(entity: BaseEntity): string | null {
  const value = recordOf(entity)["text_ref"];
  return typeof value === "string" && value ? value : null;
}

function titlePick(
  db: Database,
  entity: BaseEntity,
  lang: Lang,
  i18n: I18n,
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
    title: entityTitle(db, entity, lang, i18n),
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
  if (isExpansionPack(entity)) {
    return <ExpansionPackDetails db={db} entity={entity} lang={lang} />;
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
  const i18n = useI18n();
  const order = db.readingOrderByEntity.get(entity.id);
  const textRef = textRefOf(entity);
  const picked = titlePick(db, entity, lang, i18n);
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
    value: formatFieldValue(data[field], i18n),
  })).filter((fact) => fact.value !== "");
  const levelLocks = formatLevelLocks(db, data["level_locks"], i18n);
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
              ← {i18n.t(home.labelKey)}
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
          <header
            className={isImPost(entity) || isImReply(entity)
              ? "detail-head detail-head--post"
              : "detail-head"}
          >
            {isImPost(entity) || isImReply(entity) ? (
              <MediaImage
                id={entity.avatar}
                kind="avatar"
                alt={entity.author}
                className="post-avatar"
              />
            ) : null}
            <div className="detail-head-body">
              <p className="eyebrow">
                {entityTypeLabel(i18n, entity.type)} · <code>{entity.id}</code>
              </p>
              <h1>{picked.title}</h1>
              {picked.fallback ? (
                <div className="fallback-note" data-testid="language-fallback">
                  {fallbackNotice(i18n, lang, picked.actual)}
                </div>
              ) : null}
              {isImReply(entity) ? (
                <p className="byline">
                  {entity.author} ·{" "}
                  <Link to={entityHref(entity.post_id)} className="inline-link">
                    {(() => {
                      const parent = db.entityById.get(entity.post_id);
                      return parent
                        ? entityTitle(db, parent, lang, i18n)
                        : entity.post_id;
                    })()}
                  </Link>
                </p>
              ) : null}
              {isImPost(entity) ? (
                <p className="byline">
                  {entity.author}
                  {order?.thread ? (
                    <>
                      {" · "}
                      <Link to={entityHref(order.thread)} className="inline-link">
                        {characterName(db, order.thread)}
                      </Link>
                    </>
                  ) : null}{" "}
                  ·{" "}
                  {formatUnit(i18n, "likes", entity.likes)} ·{" "}
                  {formatUnit(i18n, "replies", entity.reply_count)}
                </p>
              ) : null}
              {isImPost(entity) && entity.title_only ? (
                <p className="hint" data-testid="im-title-only-note">
                  {i18n.t("entity.titleOnlyPost")}
                </p>
              ) : null}
              {isImPost(entity) && entity.removed_after_read ? (
                <p className="hint" data-testid="im-removed-after-read-note">
                  {i18n.t("entity.removedAfterReadPost")}
                </p>
              ) : null}
              {isOsLog(entity) ? (
                <p className="byline">
                  {entity.date
                    ? i18n.formatDate(entity.date)
                    : i18n.t("entity.noDate")}{" "}
                  · {i18n.t("entity.fileMeta", { file: entity.file })} ·{" "}
                  {i18n.t("entity.indexMeta", { index: entity.index })}
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
            </div>
          </header>

          <EntityMedia entity={entity} />

          {textRef ? <TextBody textRef={textRef} lang={lang} /> : null}

          {!textRef && !DETAILED_TYPES[entity.type] ? (
            <dl className="facts entity-facts">
              {genericFacts.map((fact) => (
                <Fact key={fact.field} label={fact.field}>
                  <FactValue
                    db={db}
                    lang={lang}
                    field={fact.field}
                    raw={data[fact.field]}
                    value={fact.value}
                  />
                </Fact>
              ))}
              {levelLocks.length > 0 ? (
                <Fact label={i18n.t("fact.levelLocks")}>
                  {levelLocks.join(" · ")}
                </Fact>
              ) : null}
            </dl>
          ) : null}

          {isImPost(entity) && levelLocks.length > 0 ? (
            <p className="hint">
              {i18n.t("entity.levelLocks", {
                locks: levelLocks.join(" · "),
              })}
            </p>
          ) : null}

          <TypeDetails db={db} entity={entity} lang={lang} />

          {charts.length > 0 ? (
            <section className="detail-section" data-testid="charts-section">
              <h2>
                {isImPost(entity) || isOsLog(entity)
                  ? i18n.t("entity.chartsUnlocked")
                  : i18n.t("entity.charts")}
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

      <aside className="context" aria-label={i18n.t("entity.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("entity.panel.entity")}</h2>
          <Facts>
            <Fact label={i18n.t("entity.fact.type")}>
              {entityTypeLabel(i18n, entity.type)}
            </Fact>
            <Fact label={i18n.t("entity.fact.id")}>
              <code>{entity.id}</code>
            </Fact>
            {typeof data["game_id"] === "string" ? (
              <Fact label={i18n.t("entity.fact.gameId")}>
                <code>{data["game_id"]}</code>
              </Fact>
            ) : null}
            {order ? (
              <>
                <Fact
                  label={i18n.t("entity.fact.readingOrder")}
                  testId="entity-order"
                >
                  #{order.order}
                </Fact>
                {isOsLog(entity) ? null : (
                  <Fact
                    label={i18n.t("entity.fact.levelGate")}
                    testId="entity-level"
                  >
                    {i18n.t("common.level", { level: order.level_gate + 1 })}
                  </Fact>
                )}
                <Fact label={i18n.t("entity.fact.tier")} testId="entity-tier">
                  {tierLabel(i18n, order.tier)}
                </Fact>
                <Fact label={i18n.t("entity.fact.stage")}>{order.stage}</Fact>
                {order.thread ? (
                  <Fact label={i18n.t("entity.fact.thread")}>
                    <Link to={entityHref(order.thread)} className="inline-link">
                      {characterName(db, order.thread)}
                    </Link>
                  </Fact>
                ) : null}
                {order.chapter ? (
                  <Fact label={i18n.t("entity.fact.chapter")}>
                    {order.chapter}
                  </Fact>
                ) : null}
                <Fact
                  label={i18n.t("entity.fact.spoiler")}
                  testId="entity-spoiler"
                >
                  {spoiler
                    ? i18n.t("common.level", {
                        level: spoiler.threshold + 1,
                      })
                    : order.spoiler_alert
                      ? order.spoiler_alert
                      : i18n.t("common.none")}
                </Fact>
              </>
            ) : null}
          </Facts>
        </section>

        {isImPost(entity) ? (
          <section className="panel">
            <h2>{i18n.t("entity.panel.imPost")}</h2>
            <Facts>
              <Fact label={i18n.t("entity.fact.author")}>{entity.author}</Fact>
              <Fact label={i18n.t("entity.fact.imOrder")}>{entity.order}</Fact>
              <Fact label={i18n.t("entity.fact.likes")}>{entity.likes}</Fact>
              <Fact label={i18n.t("entity.fact.replies")}>
                {entity.reply_count}
              </Fact>
              <Fact label={i18n.t("entity.fact.storyGate")}>
                <FactValue
                  db={db}
                  lang={lang}
                  field="story_gate"
                  raw={entity.story_gate}
                  value={entity.story_gate ?? i18n.t("common.none")}
                />
              </Fact>
              <Fact label={i18n.t("entity.fact.topicGate")}>
                <FactValue
                  db={db}
                  lang={lang}
                  field="topic_gate"
                  raw={entity.topic_gate}
                  value={entity.topic_gate ?? i18n.t("common.none")}
                />
              </Fact>
              <Fact label={i18n.t("entity.fact.attachments")}>
                {entity.attachments.length > 0
                  ? entity.attachments.join(", ")
                  : i18n.t("common.none")}
              </Fact>
            </Facts>
          </section>
        ) : null}

        {isOsLog(entity) ? (
          <section className="panel">
            <h2>{i18n.t("entity.panel.osLog")}</h2>
            <Facts>
              <Fact label={i18n.t("entity.fact.file")}>{entity.file}</Fact>
              <Fact label={i18n.t("entity.fact.index")}>{entity.index}</Fact>
              <Fact label={i18n.t("entity.fact.date")}>
                {entity.date ? i18n.formatDate(entity.date) : "—"}
              </Fact>
              <Fact label={i18n.t("entity.fact.category")}>
                {entity.category || "—"}
              </Fact>
              <Fact label={i18n.t("fact.levelLocks")}>
                {levelLocks.length > 0
                  ? levelLocks.join(" · ")
                  : i18n.t("common.none")}
              </Fact>
              <Fact label={i18n.t("entity.fact.levelLockDisplay")}>
                {entity.level_lock_display
                  ? i18n.t("common.yes")
                  : i18n.t("common.no")}
              </Fact>
              <Fact label={i18n.t("entity.fact.chapter")}>
                <FactValue
                  db={db}
                  lang={lang}
                  field="chapter_id"
                  raw={entity.chapter_id}
                  value={entity.chapter_id}
                />
              </Fact>
              <Fact label={i18n.t("entity.fact.fileLock")}>
                <FactValue
                  db={db}
                  lang={lang}
                  field="file_lock"
                  raw={entity.file_lock}
                  value={entity.file_lock ?? i18n.t("common.none")}
                />
              </Fact>
              <Fact label={i18n.t("entity.fact.movies")}>
                {entity.movies.length > 0
                  ? entity.movies.join(", ")
                  : i18n.t("common.none")}
              </Fact>
            </Facts>
          </section>
        ) : null}

        {Array.isArray(provenance) && provenance.length > 0 ? (
          <section className="panel">
            <h2>{i18n.t("entity.panel.provenance")}</h2>
            <ul className="prov">
              {provenance.map((entry, index) => {
                if (typeof entry !== "object" || entry === null) {
                  return null;
                }
                const record = entry as Record<string, unknown>;
                return (
                  <li key={index}>
                    <code>
                      {formatFieldValue(record["locator"], i18n)}
                    </code>
                    <span>{formatFieldValue(record["kind"], i18n)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="panel">
          <h2>{i18n.t("entity.panel.edges")}</h2>
          <Facts>
            <Fact label={i18n.t("entity.fact.outgoing")}>
              {i18n.formatNumber(outgoingCount)}
            </Fact>
            <Fact label={i18n.t("entity.fact.incoming")}>
              {i18n.formatNumber(incomingCount)}
            </Fact>
            <Fact label={i18n.t("entity.fact.charts")}>
              {i18n.formatNumber(charts.length)}
            </Fact>
            <Fact label={i18n.t("entity.fact.language")}>{lang}</Fact>
          </Facts>
        </section>
      </aside>
    </>
  );
}
