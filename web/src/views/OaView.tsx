import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { TextBody } from "../components/TextBody";
import { Avatar } from "../components/ui";
import { oaGroups, findOaGroup } from "../data/collections";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { entityHref } from "../data/selectors";
import type { I18n } from "../data/messages";
import type { OaGroup } from "../data/collections";
import type { Database } from "../types";

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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedObjectId(null);
  }, [gameId]);

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

  const activeObject =
    group.objects.find((object) => object.id === selectedObjectId) ??
    group.objects[0] ??
    null;
  const attachedDocuments = activeObject
    ? group.documents.filter((document) => document.object_id === activeObject.id)
    : group.documents.filter((document) => document.object_id === null);
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

          <nav
            className="tab-strip"
            aria-label={i18n.t("oa.objectsAria")}
            data-testid="oa-object-tabs"
          >
            {group.objects.map((object) => (
              <button
                key={object.id}
                type="button"
                className={
                  activeObject?.id === object.id ? "tab active" : "tab"
                }
                aria-pressed={activeObject?.id === object.id}
                data-testid="oa-object-tab"
                data-object-id={object.id}
                onClick={() => setSelectedObjectId(object.id)}
              >
                {object.game_id}
              </button>
            ))}
            {group.objects.length === 0 ? (
              <span className="muted">{i18n.t("value.noClickableObjects")}</span>
            ) : null}
          </nav>

          {activeObject ? (
            <section className="oa-object-panel" data-testid="oa-object-panel">
              <header className="oa-object-head">
                <h2>{activeObject.game_id}</h2>
                <Link
                  to={entityHref(activeObject.id)}
                  className="inline-link"
                  data-testid="oa-object-entity-link"
                >
                  {i18n.t("oa.objectDetail")}
                </Link>
              </header>
              <TextBody textRef={activeObject.text_ref} lang={lang} />
              <h3>
                {i18n.t("oa.documentsHeading", {
                  count: i18n.formatNumber(attachedDocuments.length),
                })}
              </h3>
              {attachedDocuments.length === 0 ? (
                <p className="muted">{i18n.t("value.noAttachedDocument")}</p>
              ) : (
                <ul className="link-list">
                  {attachedDocuments.map((document) => (
                    <li key={document.id}>
                      <EntityLink
                        db={db}
                        entity={document}
                        lang={lang}
                        testId="oa-document-link"
                        meta={document.mission_id ?? undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="detail-section" data-testid="oa-descriptions">
            <h2>
              {i18n.t("oa.descriptionsHeading", {
                count: i18n.formatNumber(group.descriptions.length),
              })}
            </h2>
            <ul className="link-list">
              {group.descriptions.map((description) => (
                <li key={description.id}>
                  <EntityLink
                    db={db}
                    entity={description}
                    lang={lang}
                    testId="oa-description-link"
                    meta={i18n.t("value.weightMeta", {
                      weight: description.weight,
                    })}
                  />
                </li>
              ))}
            </ul>
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
