import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../data/language";
import { useFullTextSearch } from "../data/search";
import {
  chartLabel,
  entityHref,
  entityTitle,
  entityTypeLabel,
} from "../data/selectors";
import type { Database } from "../types";

interface PaletteItem {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}

type PaletteRow =
  | { readonly kind: "group"; readonly key: string; readonly label: string }
  | { readonly kind: "item"; readonly key: string; readonly item: PaletteItem }
  | { readonly kind: "note"; readonly key: string; readonly text: string };

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
  const { lang } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const navigationItems = useMemo(() => {
    const next: PaletteItem[] = [
      {
        key: "command:timeline",
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
        key: `entity:${entity.id}`,
        label: entityTitle(db, entity, lang),
        hint: `${entityTypeLabel(entity.type)} · Lv ${row.level_gate + 1} · #${row.order}`,
        href: entityHref(entity.id),
      });
    }
    for (const charts of db.chartsBySong.values()) {
      for (const chart of charts) {
        next.push({
          key: `chart:${chart.id}`,
          label: chartLabel(db, chart),
          hint: `Chart · NeedUnlock ${chart.need_unlock ? "yes" : "no"}`,
          href: entityHref(chart.id),
        });
      }
    }
    return next;
  }, [db, lang]);

  const needle = query.trim().toLowerCase();
  const search = useFullTextSearch(query, lang, open);
  const searchHits = useMemo(
    () => search.response?.groups.flatMap((group) => group.hits) ?? [],
    [search.response],
  );

  const navMatches = useMemo(() => {
    if (!needle) {
      return navigationItems.slice(0, 12);
    }
    const hitHrefs = new Set(searchHits.map((hit) => `/${encodeURI(hit.id)}`));
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const item of navigationItems) {
      if (hitHrefs.has(item.href)) {
        continue;
      }
      const label = item.label.toLowerCase();
      const hint = item.hint.toLowerCase();
      const id = item.key.toLowerCase();
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
    return scored.slice(0, 8).map((entry) => entry.item);
  }, [navigationItems, needle, searchHits]);

  const rows = useMemo<PaletteRow[]>(() => {
    const next: PaletteRow[] = [];
    if (needle) {
      next.push({
        kind: "item",
        key: "action:search",
        item: {
          key: "action:search",
          label: `Open full search for “${query.trim()}”`,
          hint: "Grouped results with keyboard navigation",
          href: `/search?q=${encodeURIComponent(query.trim())}`,
        },
      });
      if (search.status === "loading") {
        next.push({ kind: "note", key: "note:loading", text: "Searching…" });
      }
      if (search.status === "error") {
        next.push({
          kind: "note",
          key: "note:error",
          text: `Search failed: ${search.error?.message ?? "unknown error"}`,
        });
      }
      for (const group of search.response?.groups ?? []) {
        if (group.hits.length === 0) {
          continue;
        }
        next.push({
          kind: "group",
          key: `group:${group.type}`,
          label: `${group.label} (${group.hits.length})`,
        });
        for (const hit of group.hits) {
          next.push({
            kind: "item",
            key: `hit:${hit.type}:${hit.id}`,
            item: {
              key: `hit:${hit.type}:${hit.id}`,
              label: hit.title,
              hint: `${entityTypeLabel(hit.type)} · ${hit.snippet}${
                hit.fallback ? " · fallback text" : ""
              }`,
              href: `/${encodeURI(hit.id)}`,
            },
          });
        }
      }
      if (navMatches.length > 0) {
        next.push({
          kind: "group",
          key: "group:navigation",
          label: "Navigation",
        });
        for (const item of navMatches) {
          next.push({ kind: "item", key: item.key, item });
        }
      }
    } else {
      for (const item of navMatches) {
        next.push({ kind: "item", key: item.key, item });
      }
    }
    return next;
  }, [needle, navMatches, query, search]);

  const results = useMemo(
    () =>
      rows
        .filter(
          (row): row is Extract<PaletteRow, { kind: "item" }> =>
            row.kind === "item",
        )
        .map((row) => row.item),
    [rows],
  );

  useEffect(() => {
    setSelected(0);
  }, [needle, search.response]);

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

  let itemIndex = -1;

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
          placeholder="Search posts, logs, OA files, subtitles, charts…"
          aria-label="Search the canonical DB"
          aria-controls="palette-results"
          aria-activedescendant={
            results[selected] ? `palette-option-${selected}` : undefined
          }
        />
        <ul className="palette-results" id="palette-results" role="listbox">
          {rows.map((row) => {
            if (row.kind === "group") {
              return (
                <li
                  key={row.key}
                  className="palette-group"
                  role="presentation"
                  data-testid="palette-group"
                >
                  {row.label}
                </li>
              );
            }
            if (row.kind === "note") {
              return (
                <li key={row.key} className="palette-empty" role="presentation">
                  {row.text}
                </li>
              );
            }
            itemIndex += 1;
            const index = itemIndex;
            return (
              <li
                key={row.key}
                id={`palette-option-${index}`}
                role="option"
                aria-selected={index === selected}
              >
                <button
                  type="button"
                  className={
                    index === selected ? "palette-item active" : "palette-item"
                  }
                  data-testid="palette-item"
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(row.item)}
                >
                  <span className="palette-label">{row.item.label}</span>
                  <span className="palette-hint">{row.item.hint}</span>
                </button>
              </li>
            );
          })}
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
