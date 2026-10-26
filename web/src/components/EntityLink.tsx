import { Link } from "react-router-dom";
import { useI18n } from "../data/i18n";
import { TypeBadge } from "./ui";
import { MediaImage } from "./Media";
import { isImReply, isSong } from "../data/database";
import { entityHref, entityTitle } from "../data/selectors";
import type { BaseEntity, Database, Lang } from "../types";

export function EntityLink({
  db,
  entity,
  lang,
  testId,
  meta,
  level,
  cover = false,
}: {
  db: Database;
  entity: BaseEntity;
  lang: Lang;
  testId?: string;
  meta?: string;
  level?: string;
  /** Flag the song jacket next to the title, for relation rows that index songs. */
  cover?: boolean;
}) {
  const i18n = useI18n();
  const reply = isImReply(entity);
  const jacket = cover && isSong(entity);
  return (
    <Link
      to={entityHref(db, entity.id)}
      className={`entity-link${reply ? " entity-link--reply" : ""}${
        jacket ? " entity-link--row" : ""
      }`}
      data-testid={testId}
      data-entity-id={entity.id}
      data-entity-type={entity.type}
    >
      {reply ? (
        <MediaImage
          id={entity.avatar}
          kind="avatar"
          alt={entity.author}
          className="entity-link-avatar"
        />
      ) : null}
      {jacket ? (
        <MediaImage
          id={entity.game_id}
          kind="cover"
          alt={entity.name ?? entity.game_id}
          className="entity-link-cover"
        />
      ) : null}
      <span className="entity-link-body">
        <span className="entity-link-title">
          {entityTitle(db, entity, lang, i18n)}
        </span>
        {reply ? (
          <span className="entity-link-author">{entity.author}</span>
        ) : null}
        <span className="entity-link-meta">
          <TypeBadge type={entity.type} />
          <code>{entity.id}</code>
          {meta ? <span>{meta}</span> : null}
          {level ? (
            <span className="entity-link-level" data-testid="os-unlock-level">
              {level}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export function EntityList({
  db,
  entities,
  lang,
  testId,
  empty,
  meta,
}: {
  db: Database;
  entities: readonly BaseEntity[];
  lang: Lang;
  testId?: string;
  empty?: string;
  meta?: string;
}) {
  const i18n = useI18n();
  if (entities.length === 0) {
    return <p className="muted">{empty ?? i18n.t("common.notRecorded")}</p>;
  }
  return (
    <ul className="link-list">
      {entities.map((entity) => (
        <li key={entity.id}>
          <EntityLink
            db={db}
            entity={entity}
            lang={lang}
            testId={testId}
            meta={meta}
          />
        </li>
      ))}
    </ul>
  );
}
