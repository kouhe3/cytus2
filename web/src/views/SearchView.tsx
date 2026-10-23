import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useLanguage } from "../data/language";
import { useFullTextSearch } from "../data/search";
import { entityTypeLabel } from "../data/selectors";
import type { SearchHit } from "../types";

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

export function SearchView() {
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useFullTextSearch(query, lang);

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
        navigate(`/${encodeURI(hit.id)}`);
      }
    }
  };

  let hitIndex = -1;

  return (
    <>
      <main className="content" data-testid="search-view">
        <header className="page-head">
          <p className="eyebrow">Full-text search</p>
          <h1>Search</h1>
          <p className="lede">
            Searches iM post bodies, OS logs, OA documents and subtitle lines in
            the selected language. Matches come from the canonical text store.
          </p>
          <input
            ref={inputRef}
            className="search-input"
            data-testid="search-input"
            value={input}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search story text…"
            aria-label="Full-text search"
            aria-controls="search-results"
            aria-activedescendant={
              hits[selected] ? `search-hit-${selected}` : undefined
            }
          />
          <div className="search-summary" data-testid="search-summary">
            {search.status === "loading"
              ? "Searching…"
              : search.response
                ? `${search.response.total.toLocaleString()} matches · ${lang}`
                : `Language ${lang}`}
          </div>
        </header>

        {search.status === "error" ? (
          <p className="error-text">
            Search failed: {search.error?.message ?? "unknown error"}
          </p>
        ) : null}

        <div
          id="search-results"
          className="search-results"
          role="listbox"
          aria-label="Search results"
          onKeyDown={onKeyDown}
        >
          {(search.response?.groups ?? []).map((group) => (
            <section
              key={group.type}
              className="search-group"
              role="group"
              aria-label={group.label}
              data-testid="search-group"
              data-group-type={group.type}
            >
              <h2>
                {group.label}
                <span className="edge-count">{group.hits.length}</span>
              </h2>
              <ul className="link-list">
                {group.hits.map((hit) => {
                  hitIndex += 1;
                  const index = hitIndex;
                  return (
                    <li key={`${hit.type}:${hit.id}`} role="presentation">
                      <Link
                        id={`search-hit-${index}`}
                        to={`/${encodeURI(hit.id)}`}
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
                        <span className="search-snippet">
                          <Highlighted text={hit.snippet} query={query} />
                        </span>
                        <span className="entity-link-meta">
                          <span>{entityTypeLabel(hit.type)}</span>
                          <code>{hit.id}</code>
                          {hit.fallback ? (
                            <span className="fallback-inline">
                              {lang} missing · showing {hit.lang}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {search.status === "ready" && hits.length === 0 ? (
            <div className="empty-state" data-testid="search-empty">
              No post, log, OA document or subtitle line matches “{query.trim()}”.
            </div>
          ) : null}
          {search.status === "idle" ? (
            <div className="empty-state" data-testid="search-empty">
              Type at least one character. Use ↑/↓ to move and Enter to open a
              result.
            </div>
          ) : null}
        </div>
      </main>

      <aside className="context" aria-label="Search options">
        <section className="panel">
          <h2>Language</h2>
          <LanguageSwitcher compact />
          <p className="hint">
            Results use the selected language first and fall back explicitly when
            it has no text.
          </p>
        </section>
        <section className="panel">
          <h2>Coverage</h2>
          <ul className="plain-list">
            <li>iM post bodies</li>
            <li>OS log blocks</li>
            <li>OA document text</li>
            <li>Subtitle lines</li>
          </ul>
          <p className="hint">
            Replies and story events are browsable from their own views but are
            not part of full-text search.
          </p>
        </section>
        <section className="panel">
          <h2>Keyboard</h2>
          <p>
            <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open
          </p>
          <p className="hint">
            <kbd>Ctrl K</kbd> opens the same search from anywhere.
          </p>
        </section>
      </aside>
    </>
  );
}
