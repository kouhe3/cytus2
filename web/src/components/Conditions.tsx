import { Link } from "react-router-dom";
import { conditionLink, formatLevelLocks } from "../data/selectors";
import type { ConditionEntry, Database, LevelLock } from "../types";

export function ConditionList({
  db,
  conditions,
  empty = "None",
}: {
  db: Database;
  conditions: readonly ConditionEntry[];
  empty?: string;
}) {
  if (conditions.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <ul className="condition-list" data-testid="conditions">
      {conditions.map((condition) => {
        const target = conditionLink(db, condition);
        return (
          <li key={`${condition.kind}:${condition.value}`}>
            {target.href ? (
              <Link
                to={target.href}
                className="inline-link"
                data-testid="condition-link"
              >
                {target.label}
              </Link>
            ) : (
              <span>{target.label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LevelLockList({
  db,
  locks,
  empty = "None",
}: {
  db: Database;
  locks: readonly LevelLock[] | undefined;
  empty?: string;
}) {
  const labels = formatLevelLocks(db, locks);
  if (labels.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return <p className="lock-list">{labels.join(" · ")}</p>;
}
