import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  chartLabel,
  entityHref,
  entityTitle,
  entityTypeLabel,
} from "../data/selectors";
import type { Database } from "../types";

interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}

export function CommandPalette({
  db,
  open,
  onClose,
}: {
  db: Database;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const items = useMemo(() => {
    const next: PaletteItem[] = [
      {
        id: "command:timeline",
        label: "Timeline",
        hint: "iM + OS reading feed",
        href: "/timeline",
      },
    ];
    for (const row of db.timelineOrders) {
      const entity = db.entityById.get(row.entity_id);
      if (!entity) {
        continue;
      }
      next.push({
        id: `entity:${entity.id}`,
        label: entityTitle(entity),
        hint: `${entityTypeLabel(entity.type)} · Lv ${row.level_gate + 1} · #${row.order}`,
        href: entityHref(entity.id),
      });
    }
    for (const charts of db.chartsBySong.values()) {
      for (const chart of charts) {
        next.push({
          id: `chart:${chart.id}`,
          label: chartLabel(db, chart),
          hint: `Chart · NeedUnlock ${chart.need_unlock ? "yes" : "no"}`,
          href: entityHref(chart.id),
        });
      }
    }
    return next;
  }, [db]);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) {
      return items.slice(0, 12);
    }
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const item of items) {
      const label = item.label.toLowerCase();
      const hint = item.hint.toLowerCase();
      const id = item.id.toLowerCase();
      let score = -1;
      if (label.startsWith(needle)) {
        score = 0;
      } else if (label.includes(needle)) {
        score = 1;
      } else if (id.includes(needle)) {
        score = 2;
      } else if (hint.includes(needle)) {
        score = 3;
      }
      if (score >= 0) {
        scored.push({ item, score });
      }
    }
    scored.sort(
      (left, right) =>
        left.score - right.score ||
        left.item.label.localeCompare(right.item.label),
    );
    return scored.slice(0, 20).map((entry) => entry.item);
  }, [items, needle]);

  useEffect(() => {
    setSelected(0);
  }, [needle]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  const choose = (item: PaletteItem | undefined) => {
    if (!item) {
      return;
    }
    navigate(item.href);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          data-testid="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to an iM post, OS log, or chart…"
          aria-label="Search entities"
          aria-controls="palette-results"
          aria-activedescendant={
            results[selected] ? `palette-option-${selected}` : undefined
          }
        />
        <ul className="palette-results" id="palette-results" role="listbox">
          {results.map((item, index) => (
            <li
              key={item.id}
              id={`palette-option-${index}`}
              role="option"
              aria-selected={index === selected}
            >
              <button
                type="button"
                className={index === selected ? "palette-item active" : "palette-item"}
                data-testid="palette-item"
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <span className="palette-label">{item.label}</span>
                <span className="palette-hint">{item.hint}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="palette-empty">No navigation target matches.</li>
          ) : null}
        </ul>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> select
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
