import { Fragment } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { conditionKindLabel } from "../data/labels";
import { conditionLink, formatLevelLocks } from "../data/selectors";
import type { I18n } from "../data/messages";
import type {
  ConditionEntry,
  Database,
  LevelLock,
  OaDescriptionEntity,
} from "../types";

/**
 * OA hotspots keep one `DescriptionObjectId` across story stages; each stage
 * is a separate row whose EnableCondition/DisableCondition decide whether the
 * game offers it.  Stage labels follow the conditions, in the same priority as
 * the archived viewer: ending swap, OS read, level unlock, other story.
 */
export type OaDescriptionStage = "level" | "os" | "ending" | "story" | "other";

const STAGE_RANK: Record<OaDescriptionStage, number> = {
  other: 0,
  level: 1,
  os: 2,
  story: 2,
  ending: 3,
};

export function oaDescriptionStage(
  description: OaDescriptionEntity,
): OaDescriptionStage {
  const story = description.enable_conditions.find(
    (condition) => condition.kind === "story",
  );
  if (story?.value === "story_ending04_main") {
    return "ending";
  }
  if (
    description.enable_conditions.some(
      (condition) => condition.kind === "os",
    )
  ) {
    return "os";
  }
  if (description.enable_level_locks.length > 0) {
    return "level";
  }
  if (story) {
    return "story";
  }
  return "other";
}

export function oaDescriptionStageRank(
  description: OaDescriptionEntity,
): number {
  return STAGE_RANK[oaDescriptionStage(description)];
}

export function oaDescriptionStageLabel(
  description: OaDescriptionEntity,
  i18n: I18n,
): string {
  const stage = oaDescriptionStage(description);
  if (stage === "ending") {
    return i18n.t("oa.conditionStoryEnding04");
  }
  if (stage === "os") {
    const condition = description.enable_conditions.find(
      (entry) => entry.kind === "os",
    );
    return condition
      ? i18n.t("oa.conditionOsRead", { os: condition.value })
      : i18n.t("oa.variantStageOther");
  }
  if (stage === "level") {
    return i18n.t("oa.variantStageLevel");
  }
  if (stage === "story") {
    const condition = description.enable_conditions.find(
      (entry) => entry.kind === "story",
    );
    if (condition?.value === "story_tairitsu_unlock_oas") {
      return i18n.t("oa.conditionStoryTairitsu");
    }
    return i18n.t("oa.conditionStory", {
      story: condition?.value ?? "",
    });
  }
  return i18n.t("oa.variantStageOther");
}

function conditionLabel(condition: ConditionEntry, i18n: I18n): string {
  if (condition.kind === "story") {
    if (condition.value === "story_ending04_main") {
      return i18n.t("oa.conditionStoryEnding04");
    }
    if (condition.value === "story_tairitsu_unlock_oas") {
      return i18n.t("oa.conditionStoryTairitsu");
    }
    return i18n.t("oa.conditionStory", { story: condition.value });
  }
  if (condition.kind === "os") {
    return i18n.t("oa.conditionOsRead", { os: condition.value });
  }
  return i18n.t("condition.label", {
    kind: conditionKindLabel(i18n, condition.kind),
    value: condition.value,
  });
}

function ConditionValues({
  db,
  locks,
  conditions,
  i18n,
}: {
  db: Database;
  locks: readonly LevelLock[];
  conditions: readonly ConditionEntry[];
  i18n: I18n;
}) {
  const parts: ReactNode[] = [];
  for (const label of formatLevelLocks(db, locks, i18n)) {
    parts.push(<span key={`level:${label}`}>{label}</span>);
  }
  for (const condition of conditions) {
    const target = conditionLink(db, condition, i18n);
    const label = conditionLabel(condition, i18n);
    parts.push(
      target.href ? (
        <Link
          key={`${condition.kind}:${condition.value}`}
          to={target.href}
          className="inline-link"
        >
          {label}
        </Link>
      ) : (
        <span key={`${condition.kind}:${condition.value}`}>{label}</span>
      ),
    );
  }
  if (parts.length === 0) {
    return <span className="muted">{i18n.t("common.none")}</span>;
  }
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? " · " : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function OaDescriptionWhen({
  db,
  description,
  i18n,
}: {
  db: Database;
  description: OaDescriptionEntity;
  i18n: I18n;
}) {
  const hidden =
    description.disable_level_locks.length > 0 ||
    description.disable_conditions.length > 0;
  return (
    <>
      <p className="oa-variant-when" data-testid="oa-description-appears">
        <span className="chip">{i18n.t("oa.variantAppears")}</span>
        <span className="oa-variant-values">
          <ConditionValues
            db={db}
            locks={description.enable_level_locks}
            conditions={description.enable_conditions}
            i18n={i18n}
          />
        </span>
      </p>
      {hidden ? (
        <p className="oa-variant-when" data-testid="oa-description-hidden">
          <span className="chip">{i18n.t("oa.variantHidden")}</span>
          <span className="oa-variant-values">
            <ConditionValues
              db={db}
              locks={description.disable_level_locks}
              conditions={description.disable_conditions}
              i18n={i18n}
            />
          </span>
        </p>
      ) : null}
    </>
  );
}
