import { useMemo } from "react";
import { Link } from "react-router-dom";
import { EntityLink } from "../components/EntityLink";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { characterOsEntries, entityHref } from "../data/selectors";
import type { CharacterOsEntry } from "../data/selectors";
import { isCharacter } from "../data/database";
import type { Database } from "../types";

function versionGroups(entries: CharacterOsEntry[]): [string, CharacterOsEntry[]][] {
  const grouped = new Map<string, CharacterOsEntry[]>();
  for (const entry of entries) {
    const version = entry.row.version ?? "";
    const bucket = grouped.get(version);
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped.set(version, [entry]);
    }
  }
  return [...grouped.entries()];
}

export function OsIndexView({ db }: { readonly db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
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
            <p className="byline">{i18n.t("character.osLede")}</p>
          </header>

          {characters.map(({ character, entries }, index) => (
            <details
              key={character.id}
              className="os-character-group"
              open={index === 0}
              data-testid="os-character-group"
              data-character-id={character.id}
            >
              <summary>
                <Link to={entityHref(character.id)} className="inline-link">
                  {character.name || character.game_id}
                </Link>
                <span className="muted">
                  {i18n.t("character.osCount", {
                    count: i18n.formatNumber(entries.length),
                  })}
                </span>
              </summary>
              {versionGroups(entries).map(([version, group]) => (
                <section
                  key={version || "unknown"}
                  className="os-version-group"
                  data-testid="os-version-group"
                  data-version={version}
                >
                  <h3>{version || "—"}</h3>
                  <ul className="link-list">
                    {group.map((entry) => (
                      <li key={entry.entity.id}>
                        <EntityLink
                          db={db}
                          entity={entry.entity}
                          lang={lang}
                          meta={
                            entry.entity.date
                              ? i18n.formatDate(entry.entity.date)
                              : i18n.t("entity.noDate")
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </details>
          ))}
        </article>
      </main>
    </>
  );
}
