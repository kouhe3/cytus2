import { Link, NavLink } from "react-router-dom";
import type { Database } from "../types";

export function Sidebar({
  db,
  onOpenSearch,
}: {
  db: Database;
  onOpenSearch: () => void;
}) {
  const counts = db.projection.counts;
  const total =
    (counts["im_post"] ?? 0) +
    (counts["os_log"] ?? 0) +
    (counts["oa_document"] ?? 0) +
    (counts["story_node"] ?? 0);
  return (
    <aside className="rail rail-left" aria-label="Primary">
      <Link to="/timeline" className="brand">
        <span className="brand-name">Cytus II</span>
        <span className="brand-sub">Story DB</span>
      </Link>

      <nav className="nav" aria-label="Views">
        <NavLink
          to="/timeline"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          <span className="nav-dot" aria-hidden="true" />
          Timeline
        </NavLink>
      </nav>

      <button
        type="button"
        className="search-trigger"
        onClick={onOpenSearch}
        data-testid="open-search"
      >
        <span>Search entities</span>
        <kbd>Ctrl K</kbd>
      </button>

      <dl className="stats">
        <div>
          <dt>Timeline</dt>
          <dd>{db.timelineOrders.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>iM posts</dt>
          <dd>{(counts["im_post"] ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>OS logs</dt>
          <dd>{(counts["os_log"] ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Charts</dt>
          <dd>{(counts["chart"] ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Songs</dt>
          <dd>{(counts["song"] ?? 0).toLocaleString()}</dd>
        </div>
      </dl>

      <p className="rail-note">
        {total.toLocaleString()} addressable story entities read from the canonical
        DB projection.
      </p>
      <footer className="rail-foot">
        <span>schema v{db.projection.schemaVersion}</span>
        <span>{db.projection.difficulties.length} difficulties</span>
      </footer>
    </aside>
  );
}
