import { Link } from "react-router-dom";
import { chartLabel, entityHref } from "../data/selectors";
import type { ChartEntity, Database } from "../types";

export function ChartLinks({
  db,
  charts,
  testId = "chart-link",
  empty,
}: {
  db: Database;
  charts: ChartEntity[];
  testId?: string;
  empty?: string;
}) {
  if (charts.length === 0) {
    return empty ? <p className="muted">{empty}</p> : null;
  }
  const ordered = [...charts].sort((left, right) => {
    if (left.song_id !== right.song_id) {
      return left.song_id.localeCompare(right.song_id);
    }
    const leftIndex = db.projection.difficulties.indexOf(left.difficulty);
    const rightIndex = db.projection.difficulties.indexOf(right.difficulty);
    return leftIndex - rightIndex;
  });
  return (
    <ul className="link-list">
      {ordered.map((chart) => (
        <li key={chart.id}>
          <Link
            to={entityHref(chart.id)}
            className="entity-link chart-link"
            data-testid={testId}
            data-chart-id={chart.id}
          >
            <span className="entity-link-title">{chartLabel(db, chart)}</span>
            <span className="entity-link-meta">{chart.id}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
