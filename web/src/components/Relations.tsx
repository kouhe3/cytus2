import { EntityLink } from "./EntityLink";
import { useI18n } from "../data/i18n";
import {
  groupEdges,
  incomingEdges,
  outgoingEdges,
} from "../data/selectors";
import type { EdgeGroup } from "../data/selectors";
import type { I18n } from "../data/messages";
import type { Database, Edge, Lang } from "../types";

/**
 * Relation lists follow the game: replies are labelled by floor and listed in
 * that order, which the build stores as the entity's `order`. Edge order out
 * of the JSONL is lexicographic (`#1`, `#10`, `#11`, `#2`), so sort here.
 */
function sortEdgesForDisplay(
  db: Database,
  direction: "outgoing" | "incoming",
  edges: readonly Edge[],
): Edge[] {
  const key = (edge: Edge): { readonly order: number; readonly id: string } => {
    const id = direction === "outgoing" ? edge.target : edge.source;
    const entity = db.entityById.get(id);
    const order = entity && "order" in entity
      ? entity.order
      : undefined;
    return {
      order: typeof order === "number" ? order : Number.MAX_SAFE_INTEGER,
      id,
    };
  };
  return [...edges].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

function EdgeGroupList({
  db,
  lang,
  i18n,
  groups,
  testId,
  direction,
}: {
  db: Database;
  lang: Lang;
  i18n: I18n;
  groups: EdgeGroup[];
  testId: string;
  direction: "outgoing" | "incoming";
}) {
  return (
    <div className="edge-groups" data-testid={testId}>
      {groups.length === 0 ? (
        <p className="muted">{i18n.t("common.notRecorded")}</p>
      ) : null}
      {groups.map((group) => (
        <div className="edge-group" key={group.relation}>
          <h3>
            {group.label} <span className="edge-count">{group.edges.length}</span>
          </h3>
          <ul className="link-list">
            {sortEdgesForDisplay(db, direction, group.edges).map((edge) => {
              const otherId =
                direction === "outgoing" ? edge.target : edge.source;
              const entity = db.entityById.get(otherId);
              if (!entity) {
                return (
                  <li className="muted" key={`${edge.relation}:${otherId}`}>
                    <code>{otherId}</code>
                  </li>
                );
              }
              return (
                <li key={`${edge.relation}:${otherId}`}>
                  <EntityLink
                    db={db}
                    entity={entity}
                    lang={lang}
                    testId="relation-link"
                    meta={group.relation}
                    cover={group.relation === "belongs_to_pack"}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function RelationsSection({
  db,
  entityId,
  lang,
  exclude = [],
}: {
  db: Database;
  entityId: string;
  lang: Lang;
  exclude?: readonly string[];
}) {
  const i18n = useI18n();
  const excluded = new Set(exclude);
  const outgoing = groupEdges(
    outgoingEdges(db, entityId).filter((edge) => !excluded.has(edge.relation)),
    i18n,
  );
  const incoming = groupEdges(
    incomingEdges(db, entityId).filter((edge) => !excluded.has(edge.relation)),
    i18n,
  );
  return (
    <section className="detail-section" data-testid="relations">
      <h2>{i18n.t("section.relations")}</h2>
      <div className="relations-grid">
        <div className="relations-column">
          <h3 className="relations-heading">
            {i18n.t("entity.fact.outgoing")}
          </h3>
          <EdgeGroupList
            db={db}
            lang={lang}
            i18n={i18n}
            groups={outgoing}
            testId="relations-outgoing"
            direction="outgoing"
          />
        </div>
        <div className="relations-column">
          <h3 className="relations-heading">
            {i18n.t("entity.fact.incoming")}
          </h3>
          <EdgeGroupList
            db={db}
            lang={lang}
            i18n={i18n}
            groups={incoming}
            testId="relations-incoming"
            direction="incoming"
          />
        </div>
      </div>
    </section>
  );
}
