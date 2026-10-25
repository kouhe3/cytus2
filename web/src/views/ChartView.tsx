import { Link, useNavigate } from "react-router-dom";
import { EntityList } from "../components/EntityLink";
import { TypeBadge } from "../components/ui";
import { isSong, recordOf } from "../data/database";
import { useI18n } from "../data/i18n";
import {
  entityHref,
  entityTitle,
  formatFieldValue,
  outgoingEdges,
  unlockSourceEntities,
} from "../data/selectors";
import { useLanguage } from "../data/language";
import type { BaseEntity, ChartEntity, Database, Lang } from "../types";

function SourceList({
  entities,
  testId,
  db,
  lang,
}: {
  entities: BaseEntity[];
  testId: string;
  db: Database;
  lang: Lang;
}) {
  const i18n = useI18n();
  if (entities.length === 0) {
    return <p className="muted">{i18n.t("value.nothingRecorded")}</p>;
  }
  return (
    <ul className="source-list">
      {entities.map((entity) => (
        <li key={entity.id}>
          <Link
            to={entityHref(entity.id)}
            className="source-link"
            data-testid={testId}
            data-source-id={entity.id}
          >
            <span className="source-title">
              {entityTitle(db, entity, lang, i18n)}
            </span>
            <span className="source-meta">
              <TypeBadge type={entity.type} />
              <code>{entity.id}</code>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ChartView({ db, chart }: { db: Database; chart: ChartEntity }) {
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const i18n = useI18n();
  const song = db.entityById.get(chart.song_id);
  const songName =
    song && isSong(song) ? song.name || song.game_id : chart.song_id;
  const sources = unlockSourceEntities(db, chart.id);
  const outgoing = outgoingEdges(db, chart.id)
    .map((edge) => db.entityById.get(edge.target))
    .filter((entity): entity is BaseEntity => Boolean(entity));
  const siblings = db.chartsBySong.get(chart.song_id) ?? [];
  const data = recordOf(chart);
  const provenance = Array.isArray(data["provenance"]) ? data["provenance"] : [];

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/timeline" className="backlink" data-testid="back-to-timeline">
            ← {i18n.t("nav.timeline")}
          </Link>
          <button
            type="button"
            className="text-button"
            data-testid="back-button"
            onClick={() => navigate(-1)}
          >
            ← {i18n.t("common.back")}
          </button>
        </div>

        <article
          className="detail chart-detail"
          data-testid="chart-view"
          data-chart-id={chart.id}
        >
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("entity.chartEyebrow")} · <code>{chart.id}</code>
            </p>
            <h1>{songName}</h1>
            <p className="byline">
              {song && isSong(song)
                ? song.artist || i18n.t("value.unknownArtist")
                : i18n.t("value.unknownArtist")}
              {" · "}
              {chart.difficulty}
            </p>
            <div className="chart-badges">
              <span className={`difficulty difficulty-${chart.difficulty}`}>
                {chart.difficulty}
              </span>
              <span className="level-badge chart-level-badge">
                {i18n.t("common.level", { level: chart.level })}
              </span>
              <span
                className={
                  chart.need_unlock ? "unlock-badge locked" : "unlock-badge free"
                }
              >
                {chart.need_unlock
                  ? i18n.t("value.unlockRequired")
                  : i18n.t("value.alwaysAvailable")}
              </span>
            </div>
          </header>

          <dl className="facts chart-facts">
            <div className="fact">
              <dt>{i18n.t("value.difficulty")}</dt>
              <dd data-testid="chart-difficulty">{chart.difficulty}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.level")}</dt>
              <dd data-testid="chart-level">{chart.level}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("value.needUnlock")}</dt>
              <dd data-testid="chart-need-unlock">
                {chart.need_unlock ? i18n.t("common.yes") : i18n.t("common.no")}
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.song")}</dt>
              <dd>
                {song ? (
                  <Link to={entityHref(song.id)} className="inline-link">
                    {songName}
                  </Link>
                ) : (
                  songName
                )}
              </dd>
            </div>
          </dl>

          <section className="detail-section" data-testid="unlock-sources">
            <h2>{i18n.t("fact.unlockSources")}</h2>
            <p className="hint">
              {i18n.t("value.conditionEdges", { relation: "unlocks_chart" })}
            </p>
            <SourceList
              entities={sources}
              testId="unlock-source"
              db={db}
              lang={lang}
            />
          </section>

          <section className="detail-section" data-testid="chart-outgoing">
            <h2>{i18n.t("entity.fact.outgoing")}</h2>
            <p className="hint">
              {i18n.t("value.outgoingHint", { relation: "unlocks_chart" })}
            </p>
            <EntityList
              db={db}
              entities={outgoing}
              lang={lang}
              empty={i18n.t("value.noOutgoingEdges")}
            />
          </section>

          <section className="detail-section">
            <h2>{i18n.t("value.otherDifficulties")}</h2>
            <nav
              className="chart-switcher"
              aria-label={i18n.t("value.otherDifficulties")}
            >
              {siblings.map((sibling) => (
                <Link
                  key={sibling.id}
                  to={entityHref(sibling.id)}
                  className={
                    sibling.id === chart.id
                      ? "chart-jump active"
                      : "chart-jump"
                  }
                  aria-current={sibling.id === chart.id ? "page" : undefined}
                  data-testid="chart-sibling"
                >
                  <span>{sibling.difficulty}</span>
                  <span className="chart-jump-level">
                    {i18n.t("common.level", { level: sibling.level })}
                  </span>
                </Link>
              ))}
            </nav>
          </section>
        </article>
      </main>

      <aside className="context" aria-label={i18n.t("entity.chartDetailsAria")}>
        <section className="panel">
          <h2>{i18n.t("entity.charts")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.key")}</dt>
              <dd>
                <code>{chart.id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("entity.fact.gameId")}</dt>
              <dd>
                <code>{chart.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.musicId")}</dt>
              <dd>{chart.music_id || "—"}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.unlockSources")}</dt>
              <dd>{i18n.formatNumber(sources.length)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>{i18n.t("fact.song")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.title")}</dt>
              <dd>{songName}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.artist")}</dt>
              <dd>{song && isSong(song) ? song.artist || "—" : "—"}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.pack")}</dt>
              <dd>
                {song && isSong(song) ? (
                  <Link to={entityHref(song.pack_id)} className="inline-link">
                    {song.pack_id}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </section>

        {provenance.length > 0 ? (
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
                    <code>{formatFieldValue(record["locator"], i18n)}</code>
                    <span>{formatFieldValue(record["kind"], i18n)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </aside>
    </>
  );
}
