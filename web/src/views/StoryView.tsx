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
import { useLanguage } from "../data/language";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

const SORT_OPTIONS: { value: StorySort; label: string }[] = [
  { value: "level", label: "By level" },
  { value: "version", label: "By version" },
  { value: "chapter", label: "By chapter" },
];

const KIND_OPTIONS: { value: StoryKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "event", label: "Events" },
  { value: "branch", label: "Branching OS" },
];

export function StoryIndexView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const [sort, setSort] = useState<StorySort>("level");
  const [kind, setKind] = useState<StoryKindFilter>("all");
  const entries = useMemo(
    () => storyEntries(db, lang, sort, kind),
    [db, lang, sort, kind],
  );
  const metaCount = storySortMetaCount(db, sort);
  const nodeCount = db.entitiesByType.get("story_node")?.length ?? 0;
  const eventCount =
    db.entitiesByType.get("story_node")?.filter(
      (node) => isStoryNode(node) && node.kind === "event",
    ).length ?? 0;

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Narrative units</p>
          <h1>Story</h1>
          <p className="lede">
            Story events and Branching OS nodes. Reading order follows the
            canonical projection: free characters run in parallel, levels ascend,
            and spoiler-gated nodes are deferred instead of being pulled forward.
          </p>
          <div className="page-stats" data-testid="story-stats">
            <strong>{entries.length}</strong> nodes · {eventCount} events ·{" "}
            {nodeCount - eventCount} Branching OS
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
                {option.label}
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
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {sort !== "level" ? (
          <p className="hint" data-testid="story-sort-note">
            Entries stay grouped by effective level gate, so a deferred node is
            never promoted ahead of its prerequisites. Within a gate,{" "}
            {metaCount} of {nodeCount} nodes carry {sort} metadata; the rest keep
            their reading order.
          </p>
        ) : (
          <p className="hint" data-testid="story-sort-note">
            Default order: reading-order position, spoiler gates already deferred.
            test01 staging nodes are omitted from this sequence; switch to
            version or chapter to inspect them.
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
                <span className="card-order" title="Reading order">
                  {entry.row ? `#${entry.row.order}` : "—"}
                </span>
              </header>
              <h3 className="card-title">{entry.title}</h3>
              {entry.snippet ? (
                <p className="card-snippet">{entry.snippet}</p>
              ) : (
                <p className="card-snippet muted">
                  {entry.node.class_name
                    ? `Event class ${entry.node.class_name}`
                    : "No text record for this language."}
                </p>
              )}
              <footer className="card-foot">
                <span className="card-context">
                  <code>{entry.node.game_id}</code>
                </span>
                {entry.node.level !== undefined ? (
                  <span className="level-badge">Lv {entry.node.level + 1}</span>
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
            <div className="empty-state">No story nodes match this filter.</div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label="Story details">
        <section className="panel">
          <h2>Sort modes</h2>
          <p>
            <strong>By level</strong> is the canonical reading order.
          </p>
          <p>
            <strong>By version</strong> and <strong>by chapter</strong> keep the
            entries the projection annotates first inside each effective level
            gate; other nodes keep their reading position so nothing is promoted
            ahead of its prerequisites.
          </p>
        </section>
        <section className="panel">
          <h2>Two systems</h2>
          <p>
            Branching OS nodes use <code>story_node(kind=branch)</code>. Backup
            Database entries are <code>gallery_item</code> and never appear here.
          </p>
        </section>
        <section className="panel">
          <h2>Counts</h2>
          <dl className="facts">
            <div className="fact">
              <dt>All nodes</dt>
              <dd>{nodeCount}</dd>
            </div>
            <div className="fact">
              <dt>Events</dt>
              <dd>{eventCount}</dd>
            </div>
            <div className="fact">
              <dt>Branching OS</dt>
              <dd>{nodeCount - eventCount}</dd>
            </div>
            <div className="fact">
              <dt>Shown</dt>
              <dd>{entries.length}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}
