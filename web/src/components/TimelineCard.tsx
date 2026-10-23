import { Link } from "react-router-dom";
import { entityHref } from "../data/selectors";
import type { TimelineEntry } from "../data/selectors";
import { Avatar, LevelBadge, SpoilerChip, TierChip, TypeBadge } from "./ui";

export function TimelineCard({ entry }: { entry: TimelineEntry }) {
  const { row, entity } = entry;
  return (
    <Link
      to={entityHref(entity.id)}
      className="card timeline-card"
      data-testid="timeline-card"
      data-order={row.order}
      data-level={row.level_gate}
      data-tier={row.tier}
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
        <span className="card-order" title="Reading order">
          #{row.order}
        </span>
      </header>
      <h3 className="card-title">{entry.title}</h3>
      {entry.snippet ? (
        <p className="card-snippet">{entry.snippet}</p>
      ) : (
        <p className="card-snippet muted">No text record for this language.</p>
      )}
      <footer className="card-foot">
        <TypeBadge type={entity.type} />
        <LevelBadge gate={row.level_gate} />
        <TierChip tier={row.tier} />
        {row.spoiler_alert ? (
          <SpoilerChip threshold={entry.spoilerThreshold} />
        ) : null}
        <span className="card-context">{entry.context}</span>
      </footer>
    </Link>
  );
}
