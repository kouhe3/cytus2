import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TimelineCard } from "../components/TimelineCard";
import { useI18n } from "../data/i18n";
import { tierLabel } from "../data/labels";
import { useLanguage } from "../data/language";
import {
  maxTimelineLevel,
  resolveTimelineAccount,
  selectTimeline,
  timelineAccounts,
  OTHER_ACCOUNT,
  type TimelineTypeFilter,
} from "../data/selectors";
import type { Database, ReadingTier } from "../types";
import type { MessageKey } from "../data/messages";

const TYPE_OPTIONS: { value: TimelineTypeFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "im_post", labelKey: "type.im_post" },
  { value: "os_log", labelKey: "type.os_log" },
];

const TIER_OPTIONS: { value: ReadingTier }[] = [
  { value: "free" },
  { value: "paid" },
  { value: "side" },
];

export function TimelineView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const maxLevel = useMemo(() => maxTimelineLevel(db), [db]);
  const accounts = useMemo(() => timelineAccounts(db, i18n), [db, i18n]);
  const [searchParams, setSearchParams] = useSearchParams();
  const account = resolveTimelineAccount(db, searchParams.get("account"));
  const [level, setLevel] = useState(maxLevel);
  const [type, setType] = useState<TimelineTypeFilter>("all");
  const [tiers, setTiers] = useState<Set<ReadingTier>>(
    () => new Set<ReadingTier>(["free", "paid", "side"]),
  );

  const entries = useMemo(
    () =>
      selectTimeline(
        db,
        { maxLevel: level, type, tiers, account },
        lang,
        i18n,
      ),
    [db, level, type, tiers, account, lang, i18n],
  );

  const setAccount = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") {
      next.delete("account");
    } else {
      next.set("account", value);
    }
    setSearchParams(next, { replace: true });
  };

  const toggleTier = (tier: ReadingTier) => {
    setTiers((previous) => {
      const next = new Set(previous);
      if (next.has(tier)) {
        next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  };

  const tierSummary =
    tiers.size === TIER_OPTIONS.length
      ? i18n.t("timeline.tierAll")
      : [...tiers].map((tier) => tierLabel(i18n, tier)).join(", ") ||
        i18n.t("timeline.tierNone");
  const accountSummary =
    account === null
      ? i18n.t("timeline.tierAll")
      : (accounts.find((item) => item.key === account)?.label ??
        (account === OTHER_ACCOUNT ? i18n.t("timeline.accountOther") : account));
  const typeSummary =
    type === "all"
      ? "timeline.types.all"
      : type === "im_post"
        ? "timeline.types.im"
        : "timeline.types.os";

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("timeline.eyebrow")}</p>
          <h1>{i18n.t("timeline.title")}</h1>
          <p className="lede">{i18n.t("timeline.lede")}</p>
          <div className="page-stats" data-testid="timeline-stats">
            {i18n.t("timeline.stats", {
              shown: i18n.formatNumber(entries.length),
              total: i18n.formatNumber(db.timelineOrders.length),
              level: level + 1,
              tier: tierSummary,
              account: accountSummary,
              types: i18n.t(typeSummary),
            })}
          </div>
        </header>

        <div className="feed" data-testid="timeline-feed">
          {entries.map((entry) => (
            <TimelineCard db={db} key={entry.entity.id} entry={entry} />
          ))}
          {entries.length === 0 ? (
            <div className="empty-state">{i18n.t("timeline.empty")}</div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("timeline.filtersAria")}>
        <section className="panel">
          <h2>{i18n.t("timeline.levelGate")}</h2>
          <input
            id="level-slider"
            className="level-slider"
            type="range"
            min={0}
            max={maxLevel}
            step={1}
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
            aria-label={i18n.t("timeline.maxLevelAria")}
            data-testid="level-slider"
          />
          <div className="range-labels">
            <span>{i18n.t("common.level", { level: 1 })}</span>
            <output htmlFor="level-slider">
              {i18n.t("timeline.levelRange", {
                level: level + 1,
                max: maxLevel + 1,
              })}
            </output>
          </div>
          <p className="hint">
            {i18n.t("timeline.levelHint", { gate: level, level: level + 1 })}
          </p>
        </section>

        <section className="panel">
          <h2>{i18n.t("timeline.type")}</h2>
          <div className="segmented" data-testid="type-filter">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={type === option.value ? "segment active" : "segment"}
                aria-pressed={type === option.value}
                data-testid={`type-${option.value}`}
                onClick={() => setType(option.value)}
              >
                {i18n.t(option.labelKey)}
              </button>
            ))}
          </div>
          <p className="hint">{i18n.t("timeline.typeHint")}</p>
        </section>

        <section className="panel">
          <h2>{i18n.t("timeline.tier")}</h2>
          <div className="chips" data-testid="tier-filter">
            {TIER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  tiers.has(option.value) ? "chip active" : "chip"
                }
                aria-pressed={tiers.has(option.value)}
                data-testid={`tier-${option.value}`}
                onClick={() => toggleTier(option.value)}
              >
                {tierLabel(i18n, option.value)}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2 data-testid="account-heading">{i18n.t("timeline.account")}</h2>
          <select
            className="lane-select"
            value={account ?? "all"}
            onChange={(event) => setAccount(event.target.value)}
            aria-label={i18n.t("timeline.account")}
            data-testid="account-filter"
          >
            <option value="all">
              {i18n.t("timeline.accountAll", {
                count: i18n.formatNumber(db.timelineOrders.length),
              })}
            </option>
            {accounts.map((item) => (
              <option key={item.key} value={item.key}>
                {i18n.t("common.labelCount", {
                  label: item.label,
                  count: item.count,
                })}
              </option>
            ))}
          </select>
          <p className="hint">
            {i18n.t("timeline.accountHint", {
              other: i18n.t("timeline.accountOther"),
            })}
          </p>
        </section>

        <section className="panel legend">
          <h2>{i18n.t("timeline.legend")}</h2>
          <p>
            <span className="level-badge">
              {i18n.t("timeline.legendLevelBadge")}
            </span>{" "}
            {i18n.t("timeline.legendLevelText")}
          </p>
          <p>
            <span className="spoiler-chip">
              {i18n.t("timeline.legendSpoilerBadge")}
            </span>{" "}
            {i18n.t("timeline.legendSpoilerText")}
          </p>
          <p>
            <span className="meta-chip">{i18n.t("timeline.legendCostBadge")}</span>{" "}
            {i18n.t("timeline.legendCostText")}
          </p>
          <p>
            <span className="meta-chip">
              {i18n.t("timeline.legendBranchBadge")}
            </span>{" "}
            {i18n.t("timeline.legendBranchText")}{" "}
            <span className="meta-chip">
              {i18n.t("timeline.legendExternalBadge")}
            </span>{" "}
            {i18n.t("timeline.legendExternalText")}
          </p>
          <p className="hint">{i18n.t("timeline.legendOrder")}</p>
        </section>
      </aside>
    </>
  );
}
