import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useI18n } from "../data/i18n";
import {
  entityTypeLabel,
  searchGroupCount,
  searchGroupLabel,
} from "../data/labels";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { useFullTextSearch } from "../data/search";
import { entityHref } from "../data/selectors";
import type { Database, SearchHit } from "../types";

/** Preview cap for the palette, full cap once the user asks for everything. */
const PREVIEW_LIMIT = 20;
const EXPANDED_LIMIT = 500;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenPattern(token: string): string {
  const escaped = escapeRegExp(token);
  return /^[a-z0-9_-]+$/i.test(token)
    ? `(?<![a-z0-9])${escaped}`
    : escaped;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const rawTokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (rawTokens.length === 0) {
    return <>{text}</>;
  }
  const tokens = rawTokens.map(tokenPattern);
  const parts = text.split(new RegExp(`(${tokens.join("|")})`, "gi"));
  const lowered = new Set(rawTokens.map((token) => token.toLowerCase()));
  return (
    <>
      {parts.map((part, index) =>
        lowered.has(part.toLowerCase()) ? (
          <mark key={index}>{part}</mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useFullTextSearch(
    query,
    lang,
    true,
    expanded ? EXPANDED_LIMIT : PREVIEW_LIMIT,
  );

  useEffect(() => {
    setInput(query);
  }, [query]);

  const hits = useMemo<SearchHit[]>(
    () => search.response?.groups.flatMap((group) => group.hits) ?? [],
    [search.response],
  );

  useEffect(() => {
    setSelected(0);
  }, [search.response]);

  useEffect(() => {
    setExpanded(false);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const updateQuery = (value: string) => {
    setInput(value);
    const next = new URLSearchParams(params);
    if (value.trim()) {
      next.set("q", value);
    } else {
      next.delete("q");
    }
    setParams(next, { replace: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const hit = hits[selected];
      if (hit) {
        event.preventDefault();
        navigate(entityHref(db, hit.id));
      }
    }
  };

  let hitIndex = -1;

  return (
    <>
      <main className="content" data-testid="search-view">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("search.eyebrow")}</p>
          <h1>{i18n.t("search.title")}</h1>
          <p className="lede">{i18n.t("search.lede")}</p>
          <input
            ref={inputRef}
            className="search-input"
            data-testid="search-input"
            value={input}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={i18n.t("search.placeholder")}
            aria-label={i18n.t("search.aria")}
            aria-controls="search-results"
            aria-activedescendant={
              hits[selected] ? `search-hit-${selected}` : undefined
            }
          />
          <div className="search-summary" data-testid="search-summary">
            {search.status === "loading"
              ? i18n.t("search.searching")
              : search.response
                ? i18n.t("search.summary", {
                    matches: formatUnit(
                      i18n,
                      "matches",
                      search.response.total,
                    ),
                    lang,
                  })
                : i18n.t("search.langOnly", { lang })}
          </div>
        </header>

        {search.status === "error" ? (
          <p className="error-text">
            {i18n.t("search.error", {
              message: search.error?.message ?? i18n.t("common.unknownError"),
            })}
          </p>
        ) : null}

        <div
          id="search-results"
          className="search-results"
          role="listbox"
          aria-label={i18n.t("search.resultsAria")}
          onKeyDown={onKeyDown}
        >
          {(search.response?.groups ?? []).map((group) => (
            <section
              key={group.type}
              className="search-group"
              role="group"
              aria-label={searchGroupLabel(i18n, group.type, group.label)}
              data-testid="search-group"
              data-group-type={group.type}
            >
              <h2>
                {searchGroupLabel(i18n, group.type, group.label)}
                <span className="edge-count">
                  {searchGroupCount(group.hits.length, group.total)}
                </span>
              </h2>
              <ul className="link-list">
                {group.hits.map((hit) => {
                  hitIndex += 1;
                  const index = hitIndex;
                  return (
                    <li key={`${hit.type}:${hit.id}`} role="presentation">
                      <Link
                        id={`search-hit-${index}`}
                        to={entityHref(db, hit.id)}
                        role="option"
                        aria-selected={index === selected}
                        className={
                          index === selected
                            ? "entity-link search-hit active"
                            : "entity-link search-hit"
                        }
                        data-testid="search-result"
                        data-hit-id={hit.id}
                        data-hit-type={hit.type}
                        onMouseEnter={() => setSelected(index)}
                      >
                        <span className="entity-link-title">
                          <Highlighted text={hit.title} query={query} />
                        </span>
                        {hit.snippet === hit.title ? null : (
                          <span className="search-snippet">
                            <Highlighted text={hit.snippet} query={query} />
                          </span>
                        )}
                        <span className="entity-link-meta">
                          <span>{entityTypeLabel(i18n, hit.type)}</span>
                          <code>{hit.id}</code>
                          {hit.fallback ? (
                            <span className="fallback-inline">
                              {i18n.t("common.fallbackShowing", {
                                requested: lang,
                                actual: hit.lang,
                              })}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {!expanded && group.total > group.hits.length ? (
                <button
                  type="button"
                  className="text-button"
                  data-testid="search-show-all"
                  onClick={() => setExpanded(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                    }
                  }}
                >
                  {i18n.t("search.showAll")}
                </button>
              ) : null}
            </section>
          ))}
          {search.status === "ready" && hits.length === 0 ? (
            <div className="empty-state" data-testid="search-empty">
              {i18n.t("search.noMatches", { query: query.trim() })}
            </div>
          ) : null}
          {search.status === "idle" ? (
            <div className="empty-state" data-testid="search-empty">
              {i18n.t("search.emptyQuery")}
            </div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("search.optionsAria")}>
        <section className="panel">
          <h2>{i18n.t("search.language")}</h2>
          <LanguageSwitcher compact />
          <p className="hint">{i18n.t("search.languageHint")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("search.coverage")}</h2>
          <ul className="plain-list">
            <li>{i18n.t("search.coverage.im")}</li>
            <li>{i18n.t("search.coverage.replies")}</li>
            <li>{i18n.t("search.coverage.os")}</li>
            <li>{i18n.t("search.coverage.oa")}</li>
            <li>{i18n.t("search.coverage.subtitles")}</li>
            <li>{i18n.t("search.coverage.charts")}</li>
          </ul>
          <p className="hint">{i18n.t("search.coverageHint")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("search.keyboard")}</h2>
          <p>
            <kbd>↑</kbd> <kbd>↓</kbd> {i18n.t("search.keyboardMove")} ·{" "}
            <kbd>Enter</kbd> {i18n.t("search.keyboardOpen")}
          </p>
          <p className="hint">{i18n.t("search.keyboardHint")}</p>
        </section>
      </aside>
    </>
  );
}
