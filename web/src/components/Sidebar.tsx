import { Link, NavLink } from "react-router-dom";
import { useI18n } from "../data/i18n";
import { formatUnit } from "../data/messages";
import type { MessageKey } from "../data/messages";
import { LanguageSwitcher } from "./LanguageSwitcher";
import type { Database } from "../types";

const NAV_ITEMS: readonly {
  to: string;
  labelKey: MessageKey;
  testId: string;
}[] = [
  { to: "/timeline", labelKey: "nav.timeline", testId: "nav-timeline" },
  { to: "/characters", labelKey: "type.character", testId: "nav-characters" },
  { to: "/os", labelKey: "nav.os", testId: "nav-os" },
  { to: "/oa", labelKey: "nav.oa", testId: "nav-oa" },
  { to: "/backup", labelKey: "nav.backup", testId: "nav-backup" },
  { to: "/story", labelKey: "nav.story", testId: "nav-story" },
  { to: "/branch", labelKey: "nav.branch", testId: "nav-branch" },
  { to: "/shop", labelKey: "nav.shop", testId: "nav-shop" },
  { to: "/extras", labelKey: "nav.extras", testId: "nav-extras" },
];

export function Sidebar({
  db,
  onOpenSearch,
}: {
  db: Database;
  onOpenSearch: () => void;
}) {
  const i18n = useI18n();
  const counts = db.projection.counts;
  const total =
    (counts["im_post"] ?? 0) +
    (counts["os_log"] ?? 0) +
    (counts["oa_document"] ?? 0) +
    (counts["story_node"] ?? 0);
  const stats: readonly { labelKey: MessageKey; value: number }[] = [
    { labelKey: "sidebar.stats.timeline", value: db.timelineOrders.length },
    { labelKey: "sidebar.stats.imPosts", value: counts["im_post"] ?? 0 },
    { labelKey: "sidebar.stats.osLogs", value: counts["os_log"] ?? 0 },
    { labelKey: "sidebar.stats.oaDocuments", value: counts["oa_document"] ?? 0 },
    { labelKey: "sidebar.stats.backupItems", value: counts["gallery_item"] ?? 0 },
    { labelKey: "sidebar.stats.charts", value: counts["chart"] ?? 0 },
  ];
  return (
    <aside className="rail rail-left" aria-label={i18n.t("sidebar.primaryAria")}>
      <Link to="/timeline" className="brand">
        <span className="brand-name">Cytus II</span>
        <span className="brand-sub">{i18n.t("brand.sub")}</span>
      </Link>

      <nav className="nav" aria-label={i18n.t("sidebar.viewsAria")}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            data-testid={item.testId}
          >
            <span className="nav-dot" aria-hidden="true" />
            {i18n.t(item.labelKey)}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        className="search-trigger"
        onClick={onOpenSearch}
        data-testid="open-search"
      >
        <span>{i18n.t("nav.search")}</span>
        <kbd>Ctrl K</kbd>
      </button>

      <LanguageSwitcher compact />

      <dl className="stats">
        {stats.map((stat) => (
          <div key={stat.labelKey}>
            <dt>{i18n.t(stat.labelKey)}</dt>
            <dd>{i18n.formatNumber(stat.value)}</dd>
          </div>
        ))}
      </dl>

      <p className="rail-note">
        {i18n.t("sidebar.note", { total: i18n.formatNumber(total) })}
      </p>
      <footer className="rail-foot">
        <span>
          {i18n.t("sidebar.schema", { version: db.projection.schemaVersion })}
        </span>
        <span>
          {formatUnit(i18n, "difficulties", db.projection.difficulties.length)}
        </span>
      </footer>
    </aside>
  );
}
