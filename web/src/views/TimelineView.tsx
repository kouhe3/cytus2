import { useMemo, useState } from "react";
import { TimelineCard } from "../components/TimelineCard";
import { useLanguage } from "../data/language";
import {
  maxTimelineLevel,
  selectTimeline,
  timelineLanes,
  type TimelineTypeFilter,
} from "../data/selectors";
import type { Database, ReadingTier } from "../types";

const TYPE_OPTIONS: { value: TimelineTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "im_post", label: "iM" },
  { value: "os_log", label: "OS" },
];

const TIER_OPTIONS: { value: ReadingTier; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "side", label: "Side" },
];

export function TimelineView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const maxLevel = useMemo(() => maxTimelineLevel(db), [db]);
  const lanes = useMemo(() => timelineLanes(db), [db]);
  const [level, setLevel] = useState(maxLevel);
  const [type, setType] = useState<TimelineTypeFilter>("all");
  const [lane, setLane] = useState<number | null>(null);
  const [tiers, setTiers] = useState<Set<ReadingTier>>(
    () => new Set<ReadingTier>(["free", "paid", "side"]),
  );

  const entries = useMemo(
    () => selectTimeline(db, { maxLevel: level, type, tiers, lane }, lang),
    [db, level, type, tiers, lane, lang],
  );

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

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Canonical reading order</p>
          <h1>Timeline</h1>
          <p className="lede">
            iM posts and OS logs ordered by the derived reading position. OA
            documents and backup entries stay out of this feed.
          </p>
          <div className="page-stats" data-testid="timeline-stats">
            <strong>{entries.length.toLocaleString()}</strong> of{" "}
            {db.timelineOrders.length.toLocaleString()} entries · level gate ≤{" "}
            {level + 1} · tier{" "}
            {tiers.size === 3 ? "all" : [...tiers].join(", ") || "none"} ·{" "}
            lane {lane === null ? "all" : lanes.find((item) => item.lane === lane)?.label ?? lane} ·{" "}
            {type === "all" ? "iM + OS" : type === "im_post" ? "iM only" : "OS only"}
          </div>
        </header>

        <div className="feed" data-testid="timeline-feed">
          {entries.map((entry) => (
            <TimelineCard key={entry.entity.id} entry={entry} />
          ))}
          {entries.length === 0 ? (
            <div className="empty-state">
              No entries match these filters. Widen the level gate or re-enable a
              tier.
            </div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label="Timeline filters">
        <section className="panel">
          <h2>Level gate</h2>
          <input
            id="level-slider"
            className="level-slider"
            type="range"
            min={0}
            max={maxLevel}
            step={1}
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
            aria-label="Maximum level gate"
            data-testid="level-slider"
          />
          <div className="range-labels">
            <span>Lv 1</span>
            <output htmlFor="level-slider">
              Lv {level + 1} / {maxLevel + 1}
            </output>
          </div>
          <p className="hint">
            Keeps entries with <code>level_gate ≤ {level}</code>, shown in game
            levels as Lv {level + 1}.
          </p>
        </section>

        <section className="panel">
          <h2>Type</h2>
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
                {option.label}
              </button>
            ))}
          </div>
          <p className="hint">Only iM posts and OS logs are part of the timeline.</p>
        </section>

        <section className="panel">
          <h2>Tier</h2>
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
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Lane</h2>
          <select
            className="lane-select"
            value={lane === null ? "all" : String(lane)}
            onChange={(event) =>
              setLane(
                event.target.value === "all" ? null : Number(event.target.value),
              )
            }
            aria-label="Account lane"
            data-testid="lane-filter"
          >
            <option value="all">All lanes ({db.timelineOrders.length})</option>
            {lanes.map((item) => (
              <option key={item.lane} value={item.lane}>
                {item.label} ({item.count})
              </option>
            ))}
          </select>
          <p className="hint">
            Lanes follow the account thread: free characters, then paid, then
            side characters; <code>Other / plot</code> collects posts that do
            not belong to a character account.
          </p>
        </section>

        <section className="panel legend">
          <h2>Legend</h2>
          <p>
            <span className="level-badge">Lv N</span> effective level gate after
            spoiler deferral.
          </p>
          <p>
            <span className="spoiler-chip">Spoiler</span> the reading position
            defers this entry until a later level.
          </p>
          <p>
            <span className="meta-chip">Cost</span> the sum of every level lock;
            multi-character gates cost the sum, so they sort later.
          </p>
          <p>
            <span className="meta-chip">Branch</span> an ending branch mapped
            from the story lock; <span className="meta-chip">External</span>{" "}
            marks a post the model cannot unlock on its own.
          </p>
          <p className="hint">
            Cards are ordered by <code>reading_order.order</code>, ascending.
          </p>
        </section>
      </aside>
    </>
  );
}
