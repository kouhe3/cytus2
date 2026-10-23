import { entityTypeLabel } from "../data/selectors";
import type { ReadingTier } from "../types";

const TIER_LABELS: Record<ReadingTier, string> = {
  free: "Free",
  paid: "Paid",
  side: "Side",
};

export function TypeBadge({ type }: { type: string }) {
  return <span className={`type-badge type-${type}`}>{entityTypeLabel(type)}</span>;
}

export function TierChip({ tier }: { tier: ReadingTier }) {
  return <span className={`tier-chip tier-${tier}`}>{TIER_LABELS[tier]}</span>;
}

export function LevelBadge({ gate }: { gate: number }) {
  return <span className="level-badge">Lv {gate + 1}</span>;
}

export function SpoilerChip({ threshold }: { threshold: number | null }) {
  return (
    <span className="spoiler-chip" title={threshold === null ? "Spoiler deferred" : `Spoiler deferred until Lv ${threshold + 1}`}>
      Spoiler{threshold === null ? "" : ` · Lv ${threshold + 1}`}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="avatar" aria-hidden="true">
      {initial}
    </span>
  );
}
