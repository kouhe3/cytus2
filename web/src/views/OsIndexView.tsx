import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EntityLink } from "../components/EntityLink";
import { MediaImage } from "../components/Media";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import type { I18n } from "../data/messages";
import {
  chapterOsGroups,
  characterOsEntries,
  compareOsVersions,
  entityHref,
  osOwnerLevelLabel,
} from "../data/selectors";
import type { CharacterOsEntry } from "../data/selectors";
import { isCharacter } from "../data/database";
import type { CharacterEntity, Database } from "../types";

type Mode = "chapter" | "character" | "version";
type CharacterGroup = {
  readonly character: CharacterEntity;
  readonly entries: CharacterOsEntry[];
};
function categoryGroups(entries: CharacterOsEntry[]): [string, CharacterOsEntry[]][] {
  const grouped = new Map<string, CharacterOsEntry[]>();
  for (const entry of entries) {
    const category = entry.entity.category;
    const bucket = grouped.get(category);
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped.set(category, [entry]);
    }
  }
  return [...grouped.entries()];
}

/** Date shown beside every OS file; locks are not displayed in this archive. */
function osFileMeta(i18n: I18n, entry: CharacterOsEntry): string {
  return entry.entity.date
    ? i18n.formatDate(entry.entity.date)
    : i18n.t("entity.noDate");
}

const OPEN_STORAGE = "os-index-open";
const MODE_STORAGE = "os-index-mode";

/** Groups stay collapsed until the reader opens them: sort order carries no
 * reading order, so no group deserves a default expansion. */
function readOpenGroups(): Set<string> {
  try {
    const raw = sessionStorage.getItem(OPEN_STORAGE);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((item): item is string => typeof item === "string"),
        );
      }
    }
  } catch {
    // ignore malformed storage
  }
  return new Set();
}

function writeOpenGroups(keys: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(OPEN_STORAGE, JSON.stringify([...keys]));
  } catch {
    // A blocked storage API only costs persistence, not the view.
  }
}

function initialMode(): Mode {
  const stored = sessionStorage.getItem(MODE_STORAGE);
  return stored === "character" || stored === "version" ? stored : "chapter";
}

export function OsIndexView({ db }: { readonly db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const [mode, setMode] = useState(initialMode);
  const [openGroups, setOpenGroups] = useState<Set<string>>(readOpenGroups);

  const characters = useMemo(
    () =>
      (db.entitiesByType.get("character") ?? [])
        .filter(isCharacter)
        .map((character) => ({
          character,
          entries: characterOsEntries(db, character.id),
        }))
        .filter((item) => item.entries.length > 0)
        .sort((a, b) => a.character.name.localeCompare(b.character.name)),
    [db],
  );

  const versions = useMemo(() => {
    const byVersion = new Map<string, CharacterOsEntry[]>();
    for (const { entries } of characters) {
      for (const entry of entries) {
        const version = entry.row.version ?? "";
        const bucket = byVersion.get(version);
        if (bucket) {
          bucket.push(entry);
        } else {
          byVersion.set(version, [entry]);
        }
      }
    }
    return [...byVersion.entries()]
      .map(([version, entries]) => {
        const grouped = new Map<string, CharacterGroup>();
        for (const entry of [...entries].sort(compareOsVersions)) {
          const character = db.characterById.get(entry.row.thread ?? "");
          if (!character) {
            continue;
          }
          const existing = grouped.get(character.id);
          if (existing) {
            existing.entries.push(entry);
          } else {
            grouped.set(character.id, { character, entries: [entry] });
          }
        }
        return {
          version,
          entries,
          characters: [...grouped.values()],
          first: [...entries].sort(compareOsVersions)[0]!,
        };
      })
      .sort((a, b) => compareOsVersions(a.first, b.first));
  }, [characters, db]);

  const chapters = useMemo(() => chapterOsGroups(db), [db]);

  useEffect(() => {
    writeOpenGroups(openGroups);
  }, [openGroups]);

  const toggle = (key: string, open: boolean) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    sessionStorage.setItem(MODE_STORAGE, next);
  };

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/timeline" className="backlink">
            ← {i18n.t("nav.timeline")}
          </Link>
        </div>
        <article className="detail" data-testid="os-index">
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("nav.os")} · <code>os_log</code>
            </p>
            <h1>{i18n.t("nav.os")}</h1>
            <p className="byline">{i18n.t("osIndex.lede")}</p>
          </header>

          <div
            className="os-mode-switch"
            role="group"
            aria-label={i18n.t("osIndex.modeAria")}
            data-testid="os-mode-switch"
          >
            <button
              type="button"
              className={mode === "chapter" ? "active" : ""}
              aria-pressed={mode === "chapter"}
              onClick={() => chooseMode("chapter")}
              data-testid="os-mode-chapter"
            >
              {i18n.t("osIndex.byChapter")}
            </button>
            <button
              type="button"
              className={mode === "character" ? "active" : ""}
              aria-pressed={mode === "character"}
              onClick={() => chooseMode("character")}
              data-testid="os-mode-character"
            >
              {i18n.t("osIndex.byCharacter")}
            </button>
            <button
              type="button"
              className={mode === "version" ? "active" : ""}
              aria-pressed={mode === "version"}
              onClick={() => chooseMode("version")}
              data-testid="os-mode-version"
            >
              {i18n.t("osIndex.byVersion")}
            </button>
          </div>

          {mode === "chapter"
            ? chapters.map((chapter) => {
                const key = `ch:${chapter.chapterId}`;
                const open = openGroups.has(key);
                return (
                  <details
                    key={chapter.chapterId}
                    className="os-character-group"
                    open={open}
                    onToggle={(event) => toggle(key, event.currentTarget.open)}
                    data-testid="os-chapter-group"
                    data-chapter-id={chapter.chapterId}
                  >
                    <summary>
                      <span className="os-summary-name">
                        <span>{chapter.name}</span>
                        {chapter.category === null ? null : (
                          <span className="meta-chip">
                            {i18n.t(
                              chapter.category === 0
                                ? "osIndex.chapterMain"
                                : "osIndex.chapterCollab",
                            )}
                          </span>
                        )}
                      </span>
                      <span className="muted">
                        {i18n.t("osIndex.chapterMeta", {
                          logs: i18n.formatNumber(chapter.entries.length),
                          folders: i18n.formatNumber(chapter.folders.length),
                        })}
                      </span>
                    </summary>
                    {chapter.folders.map((folder) => (
                      <section
                        key={folder.folderId ?? folder.name}
                        className="os-version-group"
                        data-testid="os-folder-group"
                        data-folder-id={folder.folderId ?? ""}
                      >
                        <h3 className="os-folder-heading">
                          <span>{folder.name}</span>
                          <span className="muted">
                            {i18n.t("character.osCount", {
                              count: i18n.formatNumber(folder.entries.length),
                            })}
                          </span>
                        </h3>
                        <ul className="link-list">
                          {folder.entries.map((entry) => (
                            <li key={entry.entity.id}>
                              <EntityLink
                                db={db}
                                entity={entry.entity}
                                lang={lang}
                                meta={osFileMeta(i18n, entry)}
                                level={osOwnerLevelLabel(i18n, entry) ?? undefined}
                              />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </details>
                );
              })
            : null}

          {mode === "character"
            ? characters.map(({ character, entries }) => {
                const key = `c:${character.id}`;
                const open = openGroups.has(key);
                return (
                  <details
                    key={character.id}
                    className="os-character-group"
                    open={open}
                    onToggle={(event) =>
                      toggle(key, event.currentTarget.open)
                    }
                    data-testid="os-character-group"
                    data-character-id={character.id}
                  >
                    <summary>
                      <span className="os-summary-name">
                        <MediaImage
                          id={character.game_id}
                          kind="logo"
                          alt={character.name}
                          className="os-character-logo"
                        />
                        <Link to={entityHref(character.id)} className="inline-link">
                          {character.name || character.game_id}
                        </Link>
                      </span>
                      <span className="muted">
                        {i18n.t("character.osCount", {
                          count: i18n.formatNumber(entries.length),
                        })}
                      </span>
                    </summary>
                    {categoryGroups(entries).map(([category, group]) => (
                      <section
                        key={category || "unknown"}
                        className="os-version-group"
                        data-testid="os-category-group"
                        data-category={category}
                      >
                        <h3>{category || "—"}</h3>
                        <ul className="link-list">
                          {group.map((entry) => (
                            <li key={entry.entity.id}>
                              <EntityLink
                                db={db}
                                entity={entry.entity}
                                lang={lang}
                                meta={osFileMeta(i18n, entry)}
                                level={osOwnerLevelLabel(i18n, entry) ?? undefined}
                              />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </details>
                );
              })
            : null}

          {mode === "version"
            ? versions.map(({ version, entries, characters: groups }) => {
                const key = `v:${version}`;
                const open = openGroups.has(key);
                return (
                  <details
                    key={version || "unknown"}
                    className="os-character-group"
                    open={open}
                    onToggle={(event) => toggle(key, event.currentTarget.open)}
                    data-testid="os-version-root"
                    data-version={version}
                  >
                    <summary>
                      <span className="os-summary-name">
                        <span className="os-version-label">{version || "—"}</span>
                      </span>
                      <span className="muted">
                        {i18n.t("character.osCount", {
                          count: i18n.formatNumber(entries.length),
                        })}
                      </span>
                    </summary>
                    {groups.map(({ character, entries: characterEntries }) => (
                      <section
                        key={character.id}
                        className="os-version-group"
                        data-testid="os-version-character"
                        data-character-id={character.id}
                      >
                        <h3 className="os-character-heading">
                          <MediaImage
                            id={character.game_id}
                            kind="logo"
                            alt={character.name}
                            className="os-character-logo"
                          />
                          <Link
                            to={entityHref(character.id)}
                            className="inline-link"
                          >
                            {character.name || character.game_id}
                          </Link>
                        </h3>
                        <ul className="link-list">
                          {characterEntries.map((entry) => (
                            <li key={entry.entity.id}>
                              <EntityLink
                                db={db}
                                entity={entry.entity}
                                lang={lang}
                                meta={osFileMeta(i18n, entry)}
                                level={osOwnerLevelLabel(i18n, entry) ?? undefined}
                              />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </details>
                );
              })
            : null}
        </article>
      </main>
    </>
  );
}
