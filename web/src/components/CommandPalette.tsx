import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import {
  entityTypeLabel,
  searchGroupCount,
  searchGroupLabel,
} from "../data/labels";
import type { MessageKey } from "../data/messages";
import { useFullTextSearch } from "../data/search";
import { entityHref } from "../data/selectors";
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

/**
 * Pages are jumps, not results: `/db/search` owns every entity match, so the
 * palette never scores a title locally. Keeping the two kinds apart is what
 * stops this panel from growing a second search engine.
 */
const PAGE_ENTRIES: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/timeline", labelKey: "nav.timeline" },
  { href: "/characters", labelKey: "type.character" },
  { href: "/os", labelKey: "nav.os" },
  { href: "/oa", labelKey: "nav.oa" },
  { href: "/backup", labelKey: "nav.backup" },
  { href: "/story", labelKey: "nav.story" },
  { href: "/shop", labelKey: "nav.shop" },
  { href: "/extras", labelKey: "nav.extras" },
];

const PAGE_MATCH_LIMIT = 4;

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
  const i18n = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const pageItems = useMemo<PaletteItem[]>(
    () =>
      PAGE_ENTRIES.map((entry) => ({
        key: `page:${entry.href}`,
        label: i18n.t(entry.labelKey),
        hint: entry.href,
        href: entry.href,
      })),
    [i18n],
  );

  const needle = query.trim().toLowerCase();
  const search = useFullTextSearch(query, lang, open);

  const pageMatches = useMemo(() => {
    if (!needle) {
      return pageItems;
    }
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const item of pageItems) {
      const label = item.label.toLowerCase();
      let score = -1;
      if (label.startsWith(needle)) {
        score = 0;
      } else if (label.includes(needle)) {
        score = 1;
      } else if (item.href.includes(needle)) {
        score = 2;
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
    return scored.slice(0, PAGE_MATCH_LIMIT).map((entry) => entry.item);
  }, [pageItems, needle]);

  const rows = useMemo<PaletteRow[]>(() => {
    const next: PaletteRow[] = [];
    if (!needle) {
      next.push({
        kind: "group",
        key: "group:jump",
        label: i18n.t("palette.navigation"),
      });
      for (const item of pageMatches) {
        next.push({ kind: "item", key: item.key, item });
      }
      return next;
    }
    next.push({
      kind: "item",
      key: "action:search",
      item: {
        key: "action:search",
        label: i18n.t("palette.fullSearch", { query: query.trim() }),
        hint: i18n.t("palette.fullSearchHint"),
        href: `/search?q=${encodeURIComponent(query.trim())}`,
      },
    });
    if (search.status === "loading") {
      next.push({
        kind: "note",
        key: "note:loading",
        text: i18n.t("search.searching"),
      });
    }
    if (search.status === "error") {
      next.push({
        kind: "note",
        key: "note:error",
        text: i18n.t("search.error", {
          message: search.error?.message ?? i18n.t("common.unknownError"),
        }),
      });
    }
    for (const group of search.response?.groups ?? []) {
      if (group.hits.length === 0) {
        continue;
      }
      next.push({
        kind: "group",
        key: `group:${group.type}`,
        label: i18n.t("palette.group", {
          label: searchGroupLabel(i18n, group.type, group.label),
          count: searchGroupCount(group.hits.length, group.total),
        }),
      });
      for (const hit of group.hits) {
        next.push({
          kind: "item",
          key: `hit:${hit.type}:${hit.id}`,
          item: {
            key: `hit:${hit.type}:${hit.id}`,
            label: hit.title,
            hint: `${entityTypeLabel(i18n, hit.type)}${
              hit.snippet === hit.title ? "" : ` · ${hit.snippet}`
            }${
              hit.fallback ? ` · ${i18n.t("common.fallbackText")}` : ""
            }`,
            href: entityHref(db, hit.id),
          },
        });
      }
    }
    if (pageMatches.length > 0) {
      next.push({
        kind: "group",
        key: "group:jump",
        label: i18n.t("palette.navigation"),
      });
      for (const item of pageMatches) {
        next.push({ kind: "item", key: item.key, item });
      }
    }
    return next;
  }, [needle, pageMatches, query, search, i18n]);

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
        aria-label={i18n.t("palette.dialogAria")}
        data-testid="command-palette"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          data-testid="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={i18n.t("palette.placeholder")}
          aria-label={i18n.t("palette.inputAria")}
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
            <li className="palette-empty">{i18n.t("palette.empty")}</li>
          ) : null}
        </ul>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {i18n.t("common.select")}
          </span>
          <span>
            <kbd>Enter</kbd> {i18n.t("common.open")}
          </span>
          <span>
            <kbd>Esc</kbd> {i18n.t("common.close")}
          </span>
        </footer>
      </div>
    </div>
  );
}
