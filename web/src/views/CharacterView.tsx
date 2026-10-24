import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { MediaImage } from "../components/Media";
import { TypeBadge } from "../components/ui";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import {
  characterImAccount,
  characterOsEntries,
  entityHref,
  entityTitle,
} from "../data/selectors";
import type { CharacterOsEntry } from "../data/selectors";
import type { I18n } from "../data/messages";
import type { CharacterEntity, Database, Lang } from "../types";

/**
 * The game's character page exposes an iM entry only for the three
 * protagonists. This is navigation structure, not a data derivation: the feed's
 * account filter (`imFilters`) also contains Xenon, ConneR, Cherry and JOE, and
 * those characters still have no character-page iM tab.
 */
const IM_TAB_CHARACTERS: Readonly<Record<string, true>> = {
  paff001: true,
  neko001: true,
  robo001: true,
};

function PackFact({
  db,
  character,
  lang,
  i18n,
  children,
}: {
  db: Database;
  character: CharacterEntity;
  lang: Lang;
  i18n: I18n;
  children: ReactNode;
}) {
  if (!character.pack_id) {
    return null;
  }
  const pack = db.entityById.get(character.pack_id);
  return (
    <div className="fact">
      <dt>{children}</dt>
      <dd>
        {pack ? (
          <Link to={entityHref(pack.id)} className="inline-link">
            {entityTitle(db, pack, lang, i18n)}
          </Link>
        ) : (
          <code>{character.pack_id}</code>
        )}
      </dd>
    </div>
  );
}

export function CharacterView({
  db,
  character,
}: {
  db: Database;
  character: CharacterEntity;
}) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const entries = useMemo(
    () => characterOsEntries(db, character.id),
    [db, character.id],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, CharacterOsEntry[]>();
    for (const entry of entries) {
      const version = entry.row.version ?? "";
      const bucket = grouped.get(version);
      if (bucket) {
        bucket.push(entry);
      } else {
        grouped.set(version, [entry]);
      }
    }
    return [...grouped.entries()];
  }, [entries]);

  const imAccount = IM_TAB_CHARACTERS[character.game_id]
    ? characterImAccount(db, character)
    : null;
  const timelineOs = entries.filter(
    (entry) => entry.row.timeline_scope === "timeline",
  ).length;

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/timeline" className="backlink" data-testid="back-to-timeline">
            ← {i18n.t("nav.timeline")}
          </Link>
          <BackButton />
        </div>

        <article
          className="detail"
          data-testid="character-view"
          data-character-id={character.id}
        >
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("character.eyebrow")} · <code>{character.id}</code>
            </p>
            <h1>{character.name || character.game_id}</h1>
            <p className="byline">
              <TypeBadge type={character.type} /> ·{" "}
              <code>{character.game_id}</code>
            </p>
          </header>

          <div className="entity-media character-media">
            <MediaImage
              id={character.game_id}
              kind="illustration"
              alt={character.name}
              className="character-illustration"
            />
          </div>

          <nav
            className="tab-strip"
            aria-label={i18n.t("character.tabsAria")}
            data-testid="character-tabs"
          >
            <span className="tab active" data-testid="character-tab-os">
              {i18n.t("character.osTab")}
            </span>
            {imAccount ? (
              <Link
                className="tab"
                data-testid="character-tab-im"
                to={`/timeline?account=${encodeURIComponent(character.game_id)}`}
              >
                {i18n.t("character.imTab")}
              </Link>
            ) : null}
          </nav>

          {character.game_id === "paff003" ? (
            <p className="hint" data-testid="character-paff-note">
              {i18n.t("character.paffNote")}
            </p>
          ) : null}

          <section
            className="detail-section"
            data-testid="character-os-list"
            data-character-id={character.id}
          >
            <h2>
              {i18n.t("character.osHeading")}{" "}
              <span className="muted">
                {i18n.t("character.osCount", {
                  count: i18n.formatNumber(entries.length),
                })}
              </span>
            </h2>
            <p className="hint">{i18n.t("character.osLede")}</p>
            {groups.length === 0 ? (
              <p className="muted">{i18n.t("character.osEmpty")}</p>
            ) : (
              groups.map(([version, group]) => (
                <section
                  key={version || "unknown"}
                  className="os-version-group"
                  data-testid="character-os-version"
                  data-version={version}
                >
                  <h3>{version || "—"}</h3>
                  <ul className="link-list">
                    {group.map((entry) => (
                      <li
                        key={entry.entity.id}
                        data-testid="character-os-entry"
                        data-version={version}
                        data-version-order={entry.row.version_order.join(".")}
                        data-entity-id={entry.entity.id}
                      >
                        <EntityLink
                          db={db}
                          entity={entry.entity}
                          lang={lang}
                          meta={
                            entry.entity.date
                              ? i18n.formatDate(entry.entity.date)
                              : i18n.t("entity.noDate")
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </section>
        </article>
      </main>

      <aside className="context" aria-label={i18n.t("entity.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("entity.panel.entity")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("entity.fact.type")}</dt>
              <dd>{i18n.t("type.character")}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("entity.fact.gameId")}</dt>
              <dd>
                <code>{character.game_id}</code>
              </dd>
            </div>
            <PackFact db={db} character={character} lang={lang} i18n={i18n}>
              {i18n.t("type.pack")}
            </PackFact>
            <div className="fact">
              <dt>{i18n.t("character.osTab")}</dt>
              <dd>{i18n.formatNumber(entries.length)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("nav.timeline")}</dt>
              <dd>{i18n.formatNumber(timelineOs)}</dd>
            </div>
          </dl>
        </section>
        {imAccount ? (
          <section className="panel">
            <h2>{i18n.t("character.imTab")}</h2>
            <p className="hint">{i18n.t("character.imHint")}</p>
            <Link
              to={`/timeline?account=${encodeURIComponent(character.game_id)}`}
              className="inline-link"
            >
              {i18n.t("character.imLink", { name: character.name })}
            </Link>
          </section>
        ) : null}
      </aside>
    </>
  );
}
