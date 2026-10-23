import { Link } from "react-router-dom";
import { TypeBadge } from "./ui";
import { entityHref, entityTitle } from "../data/selectors";
import type { BaseEntity, Database, Lang } from "../types";

export function EntityLink({
  db,
  entity,
  lang,
  testId,
  meta,
}: {
  db: Database;
  entity: BaseEntity;
  lang: Lang;
  testId?: string;
  meta?: string;
}) {
  return (
    <Link
      to={entityHref(entity.id)}
      className="entity-link"
      data-testid={testId}
      data-entity-id={entity.id}
      data-entity-type={entity.type}
    >
      <span className="entity-link-title">{entityTitle(db, entity, lang)}</span>
      <span className="entity-link-meta">
        <TypeBadge type={entity.type} />
        <code>{entity.id}</code>
        {meta ? <span>{meta}</span> : null}
      </span>
    </Link>
  );
}

export function EntityList({
  db,
  entities,
  lang,
  testId,
  empty = "None recorded.",
  meta,
}: {
  db: Database;
  entities: readonly BaseEntity[];
  lang: Lang;
  testId?: string;
  empty?: string;
  meta?: string;
}) {
  if (entities.length === 0) {
    return <p className="muted">{empty}</p>;
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
