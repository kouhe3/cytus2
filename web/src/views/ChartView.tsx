import { Link, useNavigate } from "react-router-dom";
import { EntityList } from "../components/EntityLink";
import { TypeBadge } from "../components/ui";
import { isSong, recordOf } from "../data/database";
import {
  chartReferrerEntities,
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
  if (entities.length === 0) {
    return <p className="muted">Nothing recorded.</p>;
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
              {entityTitle(db, entity, lang)}
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
  const song = db.entityById.get(chart.song_id);
  const songName =
    song && isSong(song) ? song.name || song.game_id : chart.song_id;
  const sources = unlockSourceEntities(db, chart.id);
  const referrers = chartReferrerEntities(db, chart.id);
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
            ← Timeline
          </Link>
          <button
            type="button"
            className="text-button"
            data-testid="back-button"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
        </div>

        <article
          className="detail chart-detail"
          data-testid="chart-view"
          data-chart-id={chart.id}
        >
          <header className="detail-head">
            <p className="eyebrow">
              Chart · <code>{chart.id}</code>
            </p>
            <h1>{songName}</h1>
            <p className="byline">
              {song && isSong(song) ? song.artist || "Unknown artist" : "Unknown artist"}
              {" · "}
              {chart.difficulty}
            </p>
            <div className="chart-badges">
              <span className={`difficulty difficulty-${chart.difficulty}`}>
                {chart.difficulty}
              </span>
              <span className="level-badge chart-level-badge">Lv {chart.level}</span>
              <span
                className={
                  chart.need_unlock ? "unlock-badge locked" : "unlock-badge free"
                }
              >
                {chart.need_unlock ? "Unlock required" : "Always available"}
              </span>
            </div>
          </header>

          <dl className="facts chart-facts">
            <div className="fact">
              <dt>Difficulty</dt>
              <dd data-testid="chart-difficulty">{chart.difficulty}</dd>
            </div>
            <div className="fact">
              <dt>Level</dt>
              <dd data-testid="chart-level">{chart.level}</dd>
            </div>
            <div className="fact">
              <dt>NeedUnlock</dt>
              <dd data-testid="chart-need-unlock">
                {chart.need_unlock ? "Yes" : "No"}
              </dd>
            </div>
            <div className="fact">
              <dt>Song</dt>
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
            <h2>Unlock sources</h2>
            <p className="hint">
              Derived <code>unlocks_chart</code> edges that point at this chart.
            </p>
            <SourceList
              entities={sources}
              testId="unlock-source"
              db={db}
              lang={lang}
            />
          </section>

          <section className="detail-section" data-testid="chart-backlinks">
            <h2>Inbound references</h2>
            <p className="hint">
              Entities that list this chart in their own chart references.
            </p>
            <SourceList
              entities={referrers}
              testId="chart-backlink"
              db={db}
              lang={lang}
            />
          </section>

          <section className="detail-section" data-testid="chart-outgoing">
            <h2>Outgoing edges</h2>
            <p className="hint">
              Typed edges from this chart to other entities. Unlock sources above
              are the inbound <code>unlocks_chart</code> edges.
            </p>
            <EntityList
              db={db}
              entities={outgoing}
              lang={lang}
              empty="No outgoing edges."
            />
          </section>

          <section className="detail-section">
            <h2>Other difficulties</h2>
            <nav className="chart-switcher" aria-label="Other difficulties">
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
                  <span className="chart-jump-level">Lv {sibling.level}</span>
                </Link>
              ))}
            </nav>
          </section>
        </article>
      </main>

      <aside className="context" aria-label="Chart details">
        <section className="panel">
          <h2>Chart</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Key</dt>
              <dd>
                <code>{chart.id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>Game ID</dt>
              <dd>
                <code>{chart.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>Music ID</dt>
              <dd>{chart.music_id || "—"}</dd>
            </div>
            <div className="fact">
              <dt>Unlock sources</dt>
              <dd>{sources.length}</dd>
            </div>
            <div className="fact">
              <dt>Backlinks</dt>
              <dd>{referrers.length}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Song</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Title</dt>
              <dd>{songName}</dd>
            </div>
            <div className="fact">
              <dt>Artist</dt>
              <dd>{song && isSong(song) ? song.artist || "—" : "—"}</dd>
            </div>
            <div className="fact">
              <dt>Pack</dt>
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
      </aside>
    </>
  );
}
