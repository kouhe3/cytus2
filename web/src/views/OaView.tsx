import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { MediaImage } from "../components/Media";
import {
  OaDescriptionWhen,
  oaDescriptionStage,
  oaDescriptionStageLabel,
  oaDescriptionStageRank,
} from "../components/OaDescriptionWhen";
import { Avatar } from "../components/ui";
import { VideoPlayer } from "../components/VideoPlayer";
import { oaGroups, findOaGroup } from "../data/collections";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { entityHref, entityTitle } from "../data/selectors";
import { useMediaManifest } from "../data/useMedia";
import type { I18n } from "../data/messages";
import type { MediaManifest } from "../data/media";
import type { OaGroup } from "../data/collections";
import type { Database, OaDescriptionEntity } from "../types";

function oaStats(
  i18n: I18n,
  group: {
    objects: readonly unknown[];
    documents: readonly unknown[];
    descriptions: readonly unknown[];
  },
): string {
  return i18n.t("oa.meta", {
    objects: formatUnit(i18n, "objects", group.objects.length),
    documents: formatUnit(i18n, "documents", group.documents.length),
    descriptions: formatUnit(i18n, "descriptions", group.descriptions.length),
  });
}

/**
 * OA scene clips come from `video_oasystem_*` bundles. Their manifest keys are
 * `<character>_oa_system` plus `<character>_sNNN_oa_system` costume variants.
 * The scene LOGOs (`<character>_l`) are separate textures.
 */
function OaScenes({
  db,
  manifest,
  characterId,
  i18n,
}: {
  db: Database;
  manifest: MediaManifest | null;
  characterId: string;
  i18n: I18n;
}) {
  const scenes = useMemo(() => {
    if (!manifest) {
      return [];
    }
    return Object.keys(manifest.videos)
      .filter((key) => key.endsWith("_oa_system"))
      .filter((key) => {
        const stem = key.slice(0, -"_oa_system".length);
        return stem === characterId || stem.startsWith(`${characterId}_s`);
      })
      .sort();
  }, [manifest, characterId]);
  const logos = useMemo(() => {
    if (!manifest) {
      return [];
    }
    const base = characterId.slice(0, -3);
    return [characterId, `${base}002`, `${base}003`].flatMap((id) => {
      const asset = manifest.oaAssets[`${id}_l`];
      return asset ? [{ id, asset }] : [];
    });
  }, [manifest, characterId]);
  if (scenes.length === 0 && logos.length === 0) {
    return null;
  }
  return (
    <section className="detail-section" data-testid="oa-scenes">
      <h2>
        {i18n.t("oa.scenesHeading", {
          count: i18n.formatNumber(scenes.length),
        })}
      </h2>
      <p className="hint">{i18n.t("oa.scenesHint")}</p>
      {logos.length > 0 ? (
        <div className="oa-art" data-testid="oa-scene-logos">
          {logos.map(({ id, asset }) => (
            <figure key={id} className="oa-art-item">
              <MediaImage id={id} kind="image" natural alt={`${id} logo`} />
              <figcaption>
                {asset.file.split("/").pop()?.replace(/\.png$/, "")} · {asset.w}×
                {asset.h}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <div className="oa-scene-list">
        {scenes.map((key) => {
          const stem = key.slice(0, -"_oa_system".length);
          const illustration = db.entityById.get(`illustration/${stem}`);
          const costume =
            illustration && "costume" in illustration
              ? String(illustration.costume)
              : "";
          const label = costume ? `${stem} · ${costume}` : stem;
          return (
            <figure
              key={key}
              className="oa-scene-item"
              data-testid="oa-scene-video"
              data-scene-id={key}
            >
              <VideoPlayer
                clip={key}
                subtitleKey={null}
                missing="hide"
                label={label}
              />
              <figcaption>{label}</figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export function OaIndexView({ db }: { db: Database }) {
  const i18n = useI18n();
  const groups = oaGroups(db);
  const objects = groups.reduce((sum, group) => sum + group.objects.length, 0);
  const documents = groups.reduce(
    (sum, group) => sum + group.documents.length,
    0,
  );
  const descriptions = groups.reduce(
    (sum, group) => sum + group.descriptions.length,
    0,
  );
  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("oa.eyebrow")}</p>
          <h1>{i18n.t("oa.title")}</h1>
          <p className="lede">{i18n.t("oa.lede")}</p>
          <div className="page-stats" data-testid="oa-stats">
            {i18n.t("oa.stats", {
              characters: formatUnit(i18n, "characters", groups.length),
              objects: formatUnit(i18n, "objects", objects),
              documents: formatUnit(i18n, "documents", documents),
              descriptions: formatUnit(i18n, "descriptions", descriptions),
            })}
          </div>
        </header>

        <div className="card-grid" data-testid="oa-index">
          {groups.map((group) => (
            <Link
              key={group.oa.id}
              to={`/oa/${encodeURIComponent(group.oa.game_id)}`}
              className="collection-card"
              data-testid="oa-character-card"
              data-oa-id={group.oa.id}
            >
              <Avatar name={group.oa.name} />
              <span className="collection-title">{group.oa.name}</span>
              <span className="collection-meta">
                {formatUnit(i18n, "objects", group.objects.length)} ·{" "}
                {formatUnit(i18n, "documents", group.documents.length)} ·{" "}
                {formatUnit(i18n, "descriptions", group.descriptions.length)}
              </span>
              <span className="collection-id">
                <code>{group.oa.game_id}</code>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("oa.sideAria")}>
        <section className="panel">
          <h2>{i18n.t("oa.archive")}</h2>
          <p>{i18n.t("oa.archiveText")}</p>
          <p className="hint">{i18n.t("oa.archiveHint")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("oa.counts")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.character")}</dt>
              <dd>{i18n.formatNumber(groups.length)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.objects")}</dt>
              <dd>{i18n.formatNumber(objects)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.documents")}</dt>
              <dd>{i18n.formatNumber(documents)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.descriptions")}</dt>
              <dd>{i18n.formatNumber(descriptions)}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}

export function OaCharacterView({
  db,
  gameId,
}: {
  db: Database;
  gameId: string;
}) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const group: OaGroup | null = findOaGroup(db, gameId);
  const { manifest } = useMediaManifest();

  if (!group) {
    return (
      <main className="content">
        <div className="empty-state">
          <h1>{i18n.t("oa.notFoundTitle")}</h1>
          <p>
            {i18n.t("oa.notFoundText", { gameId })}
          </p>
          <Link to="/oa" className="inline-link">
            ← {i18n.t("oa.all")}
          </Link>
        </div>
      </main>
    );
  }

  // Documents live on their object's entity page; the archive only counts them.
  const documentCounts = new Map<string, number>();
  for (const document of group.documents) {
    if (!document.object_id) continue;
    documentCounts.set(
      document.object_id,
      (documentCounts.get(document.object_id) ?? 0) + 1,
    );
  }
  // One hotspot (`DescriptionObjectId`) can have several conditional rows.
  const descriptionGroups = new Map<string, OaDescriptionEntity[]>();
  for (const description of group.descriptions) {
    const groupId = description.description_object_id;
    const variants = descriptionGroups.get(groupId);
    if (variants) {
      variants.push(description);
    } else {
      descriptionGroups.set(groupId, [description]);
    }
  }
  const orderedDescriptionGroups = [...descriptionGroups.entries()]
    .map(
      ([groupId, variants]) =>
        [
          groupId,
          [...variants].sort(
            (left, right) =>
              oaDescriptionStageRank(left) - oaDescriptionStageRank(right) ||
              left.game_id.localeCompare(right.game_id),
          ),
        ] as const,
    )
    .sort((left, right) => left[0].localeCompare(right[0]));
  const galleryFolder = group.oa.gallery_folder_id
    ? db.entityById.get(group.oa.gallery_folder_id)
    : undefined;

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/oa" className="backlink" data-testid="back-to-oa">
            ← {i18n.t("nav.oa")}
          </Link>
          <BackButton />
        </div>

        <article className="detail" data-testid="oa-workspace" data-oa-id={group.oa.id}>
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("oa.archive")} · <code>{group.oa.game_id}</code>
            </p>
            <h1>{group.oa.name}</h1>
            <p className="byline">{oaStats(i18n, group)}</p>
          </header>

          <OaScenes
            db={db}
            manifest={manifest}
            characterId={group.oa.game_id}
            i18n={i18n}
          />

          <section className="detail-section" data-testid="oa-object-list">
            <h2>
              {i18n.t("oa.objectsHeading", {
                count: i18n.formatNumber(group.objects.length),
              })}
            </h2>
            {group.objects.length === 0 ? (
              <p className="muted">{i18n.t("value.noClickableObjects")}</p>
            ) : (
              <ul
                className="link-list"
                aria-label={i18n.t("oa.objectsAria")}
              >
                {group.objects.map((object) => (
                  <li key={object.id}>
                    <EntityLink
                      db={db}
                      entity={object}
                      lang={lang}
                      testId="oa-object-link"
                      meta={formatUnit(
                        i18n,
                        "documents",
                        documentCounts.get(object.id) ?? 0,
                      )}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail-section" data-testid="oa-descriptions">
            <h2>
              {i18n.t("oa.descriptionGroupsHeading", {
                groups: i18n.formatNumber(orderedDescriptionGroups.length),
                variants: i18n.formatNumber(group.descriptions.length),
              })}
            </h2>
            <p className="hint">{i18n.t("oa.descriptionVariantsHint")}</p>
            {orderedDescriptionGroups.map(([groupId, variants]) => (
              <section
                key={groupId}
                className="oa-desc-group"
                data-testid="oa-description-group"
                data-description-object-id={groupId}
              >
                <h3>
                  {entityTitle(db, variants[0]!, lang, i18n)}
                  <span className="mono">{groupId}</span>
                </h3>
                <ul className="oa-desc-variants">
                  {variants.map((description) => (
                    <li
                      key={description.id}
                      className="oa-desc-variant"
                      data-testid="oa-description-variant"
                      data-stage={oaDescriptionStage(description)}
                    >
                      <div className="oa-desc-variant-head">
                        <Link
                          to={entityHref(description.id)}
                          className="inline-link"
                          data-testid="oa-description-link"
                        >
                          {oaDescriptionStageLabel(description, i18n)}
                        </Link>
                        <code>{description.game_id}</code>
                      </div>
                      <OaDescriptionWhen
                        db={db}
                        description={description}
                        i18n={i18n}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
        </article>
      </main>

      <aside className="context" aria-label={i18n.t("oa.workspaceAria")}>
        <section className="panel">
          <h2>{i18n.t("oa.panelCharacter")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.name")}</dt>
              <dd>{group.oa.name}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("entity.fact.gameId")}</dt>
              <dd>
                <code>{group.oa.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.objects")}</dt>
              <dd>{i18n.formatNumber(group.objects.length)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.documents")}</dt>
              <dd>{i18n.formatNumber(group.documents.length)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.descriptions")}</dt>
              <dd>{i18n.formatNumber(group.descriptions.length)}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2>{i18n.t("oa.panelLinks")}</h2>
          <ul className="link-list">
            {galleryFolder ? (
              <li>
                <EntityLink db={db} entity={galleryFolder} lang={lang} />
              </li>
            ) : null}
            <li>
              <EntityLink db={db} entity={group.oa} lang={lang} />
            </li>
          </ul>
        </section>
      </aside>
    </>
  );
}
