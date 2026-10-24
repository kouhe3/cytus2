import { Link } from "react-router-dom";
import { useI18n } from "../data/i18n";
import { conditionLink, formatLevelLocks } from "../data/selectors";
import type { ConditionEntry, Database, LevelLock } from "../types";

export function ConditionList({
  db,
  conditions,
  empty,
}: {
  db: Database;
  conditions: readonly ConditionEntry[];
  empty?: string;
}) {
  const i18n = useI18n();
  if (conditions.length === 0) {
    return <p className="muted">{empty ?? i18n.t("common.none")}</p>;
  }
  return (
    <ul className="condition-list" data-testid="conditions">
      {conditions.map((condition) => {
        const target = conditionLink(db, condition, i18n);
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
  empty,
}: {
  db: Database;
  locks: readonly LevelLock[] | undefined;
  empty?: string;
}) {
  const i18n = useI18n();
  const labels = formatLevelLocks(db, locks, i18n);
  if (labels.length === 0) {
    return <p className="muted">{empty ?? i18n.t("common.none")}</p>;
  }
  return <p className="lock-list">{labels.join(" · ")}</p>;
}
