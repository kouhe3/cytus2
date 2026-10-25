import { useMemo } from "react";
import { Link } from "react-router-dom";
import { MediaImage } from "../components/Media";
import { isCharacter } from "../data/database";
import { useI18n } from "../data/i18n";
import { formatUnit } from "../data/messages";
import { characterOsEntries, entityHref } from "../data/selectors";
import type { CharacterEntity, Database } from "../types";

/** Every character in the archive, sorted like the OS index's character mode. */
function orderedCharacters(db: Database): CharacterEntity[] {
  return (db.entitiesByType.get("character") ?? [])
    .filter(isCharacter)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function CharacterIndexView({ db }: { db: Database }) {
  const i18n = useI18n();
  const characters = useMemo(() => orderedCharacters(db), [db]);
  const osCounts = useMemo(
    () =>
      new Map(
        characters.map((character) => [
          character.id,
          characterOsEntries(db, character.id).length,
        ]),
      ),
    [db, characters],
  );
  const totalOs = [...osCounts.values()].reduce((sum, count) => sum + count, 0);

  return (
    <main className="content">
      <header className="page-head">
        <p className="eyebrow">{i18n.t("character.eyebrow")}</p>
        <h1>{i18n.t("characters.title")}</h1>
        <p className="lede">{i18n.t("characters.lede")}</p>
        <div className="page-stats" data-testid="characters-stats">
          {i18n.t("characters.stats", {
            characters: formatUnit(i18n, "characters", characters.length),
            logs: i18n.t("character.osCount", {
              count: i18n.formatNumber(totalOs),
            }),
          })}
        </div>
      </header>

      <div className="card-grid" data-testid="characters-index">
        {characters.map((character) => (
          <Link
            key={character.id}
            to={entityHref(character.id)}
            className="collection-card"
            data-testid="character-card"
            data-character-id={character.id}
          >
            <MediaImage
              id={character.game_id}
              kind="logo"
              alt={character.name}
              className="collection-logo"
            />
            <span className="collection-title">
              {character.name || character.game_id}
            </span>
            <span className="collection-meta">
              {i18n.t("character.osCount", {
                count: i18n.formatNumber(osCounts.get(character.id) ?? 0),
              })}
            </span>
            <span className="collection-id">
              <code>{character.game_id}</code>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
