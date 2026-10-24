import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StoryKindBadge } from "../components/ui";
import { isStoryNode } from "../data/database";
import {
  storyEntries,
  storySortMetaCount,
  type StoryKindFilter,
  type StorySort,
} from "../data/collections";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import type { MessageKey } from "../data/messages";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

const SORT_OPTIONS: { value: StorySort; labelKey: MessageKey }[] = [
  { value: "level", labelKey: "story.sort.level" },
  { value: "version", labelKey: "story.sort.version" },
  { value: "chapter", labelKey: "story.sort.chapter" },
];

const KIND_OPTIONS: { value: StoryKindFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "story.kind.all" },
  { value: "event", labelKey: "story.kind.event" },
  { value: "branch", labelKey: "story.kind.branch" },
];

export function StoryIndexView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const [sort, setSort] = useState<StorySort>("level");
  const [kind, setKind] = useState<StoryKindFilter>("all");
  const entries = useMemo(
    () => storyEntries(db, lang, sort, kind, i18n),
    [db, lang, sort, kind],
  );
  const metaCount = storySortMetaCount(db, sort);
  const nodeCount = db.entitiesByType.get("story_node")?.length ?? 0;
  const shownEvents = entries.filter((entry) => entry.node.kind === "event").length;
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
              nodes: formatUnit(i18n, "nodes", entries.length),
              events: formatUnit(i18n, "events", shownEvents),
              branches: formatUnit(
                i18n,
                "branches",
                entries.length - shownEvents,
              ),
            })}
          </div>
        </header>

        <div className="filter-bar">
          <div className="segmented" data-testid="story-sort">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={sort === option.value ? "segment active" : "segment"}
                aria-pressed={sort === option.value}
                data-testid={`story-sort-${option.value}`}
                onClick={() => setSort(option.value)}
              >
                {i18n.t(option.labelKey)}
              </button>
            ))}
          </div>
          <div className="segmented" data-testid="story-kind-filter">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={kind === option.value ? "segment active" : "segment"}
                aria-pressed={kind === option.value}
                data-testid={`story-kind-${option.value}`}
                onClick={() => setKind(option.value)}
              >
                {i18n.t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {sort !== "level" ? (
          <p className="hint" data-testid="story-sort-note">
            {i18n.t("story.sortMeta", {
              meta: i18n.formatNumber(metaCount),
              total: i18n.formatNumber(nodeCount),
              sort: i18n.t(
                sort === "version" ? "story.sort.version" : "story.sort.chapter",
              ),
            })}
          </p>
        ) : (
          <p className="hint" data-testid="story-sort-note">
            {i18n.t("story.defaultNote")}
          </p>
        )}

        <div className="feed" data-testid="story-feed">
          {entries.map((entry) => (
            <Link
              key={entry.node.id}
              to={entityHref(entry.node.id)}
              className="card story-card"
              data-testid="story-node-card"
              data-kind={entry.node.kind}
              data-node-id={entry.node.id}
              data-order={entry.row?.order ?? ""}
            >
              <header className="card-head">
                <StoryKindBadge kind={entry.node.kind} />
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
          <h2>{i18n.t("story.sortModes")}</h2>
          <p>
            <strong>{i18n.t("story.sortLevelStrong")}</strong>{" "}
            {i18n.t("story.sortLevelText")}
          </p>
          <p>
            <strong>{i18n.t("story.sortOtherStrong")}</strong>{" "}
            {i18n.t("story.sortOtherText")}
          </p>
        </section>
        <section className="panel">
          <h2>{i18n.t("story.twoSystems")}</h2>
          <p>
            {i18n.t("story.twoSystemsBefore")}
            <code>story_node(kind=branch)</code>
            {i18n.t("story.twoSystemsMiddle")}
            <code>gallery_item</code>
            {i18n.t("story.twoSystemsAfter")}
          </p>
        </section>
        <section className="panel">
          <h2>{i18n.t("story.counts")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("story.allNodes")}</dt>
              <dd>{i18n.formatNumber(nodeCount)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("story.events")}</dt>
              <dd>{i18n.formatNumber(eventCount)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("story.branchingOs")}</dt>
              <dd>{i18n.formatNumber(nodeCount - eventCount)}</dd>
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
