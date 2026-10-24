import { useI18n } from "../data/i18n";
import { MediaImage } from "./Media";
import {
  entityTypeLabel,
  mediaKindLabel,
  storyKindLabel,
  tierLabel,
} from "../data/labels";
import type { ReadingTier } from "../types";

export function TypeBadge({ type }: { type: string }) {
  const i18n = useI18n();
  return (
    <span className={`type-badge type-${type}`}>
      {entityTypeLabel(i18n, type)}
    </span>
  );
}

export function MediaKindBadge({ kind }: { kind: string }) {
  const i18n = useI18n();
  return (
    <span className={`media-kind media-${kind}`}>
      {mediaKindLabel(i18n, kind)}
    </span>
  );
}

export function StoryKindBadge({ kind }: { kind: string }) {
  const i18n = useI18n();
  return (
    <span className={`story-kind story-${kind}`}>
      {storyKindLabel(i18n, kind)}
    </span>
  );
}

export function TierChip({ tier }: { tier: ReadingTier }) {
  const i18n = useI18n();
  return <span className={`tier-chip tier-${tier}`}>{tierLabel(i18n, tier)}</span>;
}

export function LevelBadge({ gate }: { gate: number }) {
  const i18n = useI18n();
  return (
    <span className="level-badge">
      {i18n.t("common.level", { level: gate + 1 })}
    </span>
  );
}

export function SpoilerChip({ threshold }: { threshold: number | null }) {
  const i18n = useI18n();
  return (
    <span
      className="spoiler-chip"
      title={
        threshold === null
          ? i18n.t("card.spoilerTitle")
          : i18n.t("card.spoilerTitleLevel", { level: threshold + 1 })
      }
    >
      {threshold === null
        ? i18n.t("card.spoiler")
        : i18n.t("card.spoilerLevel", { level: threshold + 1 })}
    </span>
  );
}

export function Avatar({ name, mediaId }: { name: string; mediaId?: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="avatar" aria-hidden="true">
      {mediaId ? <MediaImage id={mediaId} kind="avatar" alt={name} /> : initial}
    </span>
  );
}
