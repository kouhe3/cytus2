import { Link } from "react-router-dom";
import { useI18n } from "../data/i18n";
import { entityHref } from "../data/selectors";
import type { TimelineEntry } from "../data/selectors";
import { Avatar, LevelBadge, SpoilerChip, TierChip, TypeBadge } from "./ui";

export function TimelineCard({ entry }: { entry: TimelineEntry }) {
  const i18n = useI18n();
  const { row, entity } = entry;
  const detail = [
    i18n.t("card.tooltipOrder", { order: row.order }),
    row.read_index === null
      ? null
      : i18n.t("card.tooltipReadIndex", { index: row.read_index }),
    i18n.t("card.tooltipCost", { cost: row.cost }),
    i18n.t("card.tooltipLane", { name: entry.laneName, lane: row.lane }),
    row.lock_level
      ? i18n.t("card.tooltipStage", { level: row.lock_level + 1 })
      : null,
    row.branch ? i18n.t("card.tooltipBranch", { branch: row.branch }) : null,
    row.external
      ? i18n.t("card.tooltipExternal", { detail: row.external })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <Link
      to={entityHref(entity.id)}
      className="card timeline-card"
      title={detail}
      data-testid="timeline-card"
      data-order={row.order}
      data-level={row.level_gate}
      data-tier={row.tier}
      data-lane={row.lane}
      data-cost={row.cost}
      data-read-index={row.read_index ?? ""}
      data-branch={row.branch ?? ""}
      data-external={row.external ?? ""}
      data-type={entity.type}
      data-spoiler={row.spoiler_alert ? "true" : "false"}
      data-entity-id={entity.id}
    >
      <header className="card-head">
        <Avatar name={entry.author} />
        <div className="card-who">
          <span className="card-author">{entry.author}</span>
          {entry.character ? (
            <span className="card-character">{entry.character}</span>
          ) : null}
        </div>
        <span className="card-order" title={detail}>
          #{row.order}
        </span>
      </header>
      <h3 className="card-title">{entry.title}</h3>
      {entry.snippet ? (
        <p className="card-snippet">{entry.snippet}</p>
      ) : (
        <p className="card-snippet muted">{i18n.t("card.noText")}</p>
      )}
      <footer className="card-foot">
        <TypeBadge type={entity.type} />
        <LevelBadge gate={row.level_gate} />
        <TierChip tier={row.tier} />
        <span className="meta-chip cost-chip" title={i18n.t("card.costTitle")}>
          {i18n.t("card.cost", { cost: i18n.formatNumber(row.cost) })}
        </span>
        <span
          className="meta-chip lane-chip"
          title={i18n.t("card.laneTitle", { lane: row.lane })}
        >
          {entry.laneName}
        </span>
        {row.branch ? (
          <span className="meta-chip branch-chip" title={i18n.t("card.branchTitle")}>
            {row.branch}
          </span>
        ) : null}
        {row.external ? (
          <span
            className="meta-chip external-chip"
            title={i18n.t("card.externalTitle", { detail: row.external })}
          >
            {i18n.t("card.external")}
          </span>
        ) : null}
        {row.spoiler_alert ? (
          <SpoilerChip threshold={entry.spoilerThreshold} />
        ) : null}
        <span className="card-context">{entry.context}</span>
      </footer>
    </Link>
  );
}
