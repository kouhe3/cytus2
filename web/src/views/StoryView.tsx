import { useMemo } from "react";
import { Link } from "react-router-dom";
import { isStoryNode } from "../data/database";
import { storyEntries } from "../data/collections";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

export function StoryIndexView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const entries = useMemo(
    () => storyEntries(db, lang, i18n),
    [db, lang, i18n],
  );
  const eventCount =
    db.entitiesByType.get("story_node")?.filter(
      (node) => isStoryNode(node) && node.kind === "event",
    ).length ?? 0;

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("story.eyebrow")}</p>
          <h1>{i18n.t("story.title")}</h1>
          <p className="lede">{i18n.t("story.lede")}</p>
          <div className="page-stats" data-testid="story-stats">
            {i18n.t("story.stats", {
              events: formatUnit(i18n, "events", eventCount),
            })}
          </div>
        </header>

        <p className="hint" data-testid="story-order-note">
          {i18n.t("story.orderNote")}
        </p>

        <div className="feed" data-testid="story-feed">
          {entries.map((entry) => (
            <Link
              key={entry.node.id}
              to={entityHref(db, entry.node.id)}
              className="card story-card"
              data-testid="story-node-card"
              data-node-id={entry.node.id}
              data-order={entry.row?.order ?? ""}
            >
              <header className="card-head">
                <span
                  className="card-order"
                  title={i18n.t("story.readingOrderTitle")}
                >
                  {entry.row ? `#${entry.row.order}` : "—"}
                </span>
              </header>
              <h3 className="card-title">{entry.title}</h3>
              {entry.snippet ? (
                <p className="card-snippet">{entry.snippet}</p>
              ) : (
                <p className="card-snippet muted">
                  {entry.node.class_name
                    ? i18n.t("story.eventClass", { class: entry.node.class_name })
                    : i18n.t("story.noText")}
                </p>
              )}
              <footer className="card-foot">
                <span className="card-context">
                  <code>{entry.node.game_id}</code>
                </span>
                {entry.node.level !== undefined ? (
                  <span className="level-badge">
                    {i18n.t("common.level", { level: entry.node.level + 1 })}
                  </span>
                ) : null}
                {entry.row?.version ? (
                  <span className="sort-meta">v{entry.row.version}</span>
                ) : null}
                {entry.row?.chapter ? (
                  <span className="sort-meta">{entry.row.chapter}</span>
                ) : null}
              </footer>
            </Link>
          ))}
          {entries.length === 0 ? (
            <div className="empty-state">{i18n.t("story.empty")}</div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("story.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("story.branchingTitle")}</h2>
          <p>{i18n.t("story.branchingText")}</p>
          <Link to="/branch" className="inline-link">
            {i18n.t("nav.branch")} →
          </Link>
        </section>
        <section className="panel">
          <h2>{i18n.t("story.counts")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("story.events")}</dt>
              <dd>{i18n.formatNumber(eventCount)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("story.shown")}</dt>
              <dd>{i18n.formatNumber(entries.length)}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}
