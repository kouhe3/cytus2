import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChartLinks } from "../components/ChartLinks";
import { TextBody } from "../components/TextBody";
import { TypeBadge } from "../components/ui";
import { isImPost, isOsLog, recordOf } from "../data/database";
import {
  characterName,
  entityHref,
  entityTitle,
  entityTypeLabel,
  formatFieldValue,
  formatLevelLocks,
  incomingEdges,
  unlockedCharts,
} from "../data/selectors";
import type { BaseEntity, ChartEntity, Database } from "../types";

const GENERIC_FIELDS = [
  "game_id",
  "kind",
  "item_id",
  "machine_id",
  "pack_id",
  "character_id",
  "analyze_type",
  "reward_type",
  "weight",
  "secret",
  "need_unlock",
  "music_id",
  "artist",
  "category",
  "date",
  "file",
  "index",
  "chapter_id",
  "folder_id",
  "story_gate",
  "topic_gate",
  "threshold",
  "file_lock",
] as const;

function Fact({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

export function EntityView({
  db,
  entity,
}: {
  db: Database;
  entity: BaseEntity;
}) {
  const order = db.readingOrderByEntity.get(entity.id);
  const textRef = isImPost(entity) || isOsLog(entity) ? entity.text_ref : null;

  const charts = useMemo(() => {
    const collected = new Map<string, ChartEntity>();
    for (const chart of db.chartsBySong.get(entity.id) ?? []) {
      collected.set(chart.id, chart);
    }
    for (const chart of unlockedCharts(db, entity)) {
      collected.set(chart.id, chart);
    }
    return [...collected.values()];
  }, [db, entity]);

  const backlinks = useMemo(() => {
    const collected = new Map<string, { source: BaseEntity; relation: string }>();
    for (const edge of incomingEdges(db, entity.id)) {
      if (edge.relation === "unlocks_chart") {
        continue;
      }
      const source = db.entityById.get(edge.source);
      if (!source) {
        continue;
      }
      const key = `${source.id}:${edge.relation}`;
      if (!collected.has(key)) {
        collected.set(key, { source, relation: edge.relation });
      }
    }
    return [...collected.values()];
  }, [db, entity.id]);

  const data = recordOf(entity);
  const genericFacts = GENERIC_FIELDS.map((field) => ({
    field,
    value: formatFieldValue(data[field]),
  })).filter((fact) => fact.value !== "");
  const levelLocks = formatLevelLocks(db, data["level_locks"]);
  const provenance = data["provenance"];
  const spoiler = order?.spoiler_alert
    ? db.spoilerById.get(order.spoiler_alert)
    : undefined;

  return (
    <>
      <main className="content">
        <Link to="/timeline" className="backlink" data-testid="back-to-timeline">
          ← Timeline
        </Link>

        <article
          className="detail"
          data-testid="entity-view"
          data-entity-id={entity.id}
          data-entity-type={entity.type}
        >
          <header className="detail-head">
            <p className="eyebrow">
              {entityTypeLabel(entity.type)} · {entity.id}
            </p>
            <h1>{entityTitle(entity)}</h1>
            {isImPost(entity) ? (
              <p className="byline">
                {entity.author}
                {order?.thread ? ` · ${characterName(db, order.thread)}` : ""} ·{" "}
                {entity.likes} likes · {entity.reply_count} replies
              </p>
            ) : null}
            {isOsLog(entity) ? (
              <p className="byline">
                {entity.date || "No date"} · file {entity.file} · index{" "}
                {entity.index}
              </p>
            ) : null}
            {!isImPost(entity) && !isOsLog(entity) ? (
              <p className="byline">
                <TypeBadge type={entity.type} />
              </p>
            ) : null}
          </header>

          {textRef ? <TextBody textRef={textRef} /> : null}

          {!textRef ? (
            <dl className="facts entity-facts">
              {genericFacts.map((fact) => (
                <Fact key={fact.field} label={fact.field}>
                  {fact.value}
                </Fact>
              ))}
              {levelLocks.length > 0 ? (
                <Fact label="Level locks">{levelLocks.join(" · ")}</Fact>
              ) : null}
            </dl>
          ) : null}

          {isImPost(entity) && levelLocks.length > 0 ? (
            <p className="hint">Level locks: {levelLocks.join(" · ")}</p>
          ) : null}

          {charts.length > 0 ? (
            <section className="detail-section">
              <h2>{isImPost(entity) || isOsLog(entity) ? "Unlocks charts" : "Charts"}</h2>
              <ChartLinks db={db} charts={charts} />
            </section>
          ) : null}

          {backlinks.length > 0 ? (
            <section className="detail-section">
              <h2>Backlinks</h2>
              <ul className="link-list">
                {backlinks.map(({ source, relation }) => (
                  <li key={`${source.id}:${relation}`}>
                    <Link
                      to={entityHref(source.id)}
                      className="entity-link"
                      data-testid="entity-backlink"
                    >
                      <span className="entity-link-title">
                        {entityTitle(source)}
                      </span>
                      <span className="entity-link-meta">
                        {relation} · {entityTypeLabel(source.type)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </main>

      <aside className="context" aria-label="Entity details">
        <section className="panel">
          <h2>Entity</h2>
          <dl className="facts">
            <Fact label="Type">{entityTypeLabel(entity.type)}</Fact>
            <Fact label="ID">
              <code>{entity.id}</code>
            </Fact>
            {typeof data["game_id"] === "string" ? (
              <Fact label="Game ID">
                <code>{data["game_id"]}</code>
              </Fact>
            ) : null}
            {order ? (
              <>
                <Fact label="Reading order" testId="entity-order">
                  #{order.order}
                </Fact>
                <Fact label="Level gate" testId="entity-level">
                  Lv {order.level_gate + 1}
                </Fact>
                <Fact label="Tier" testId="entity-tier">
                  {order.tier}
                </Fact>
                <Fact label="Stage">{order.stage}</Fact>
                {order.thread ? (
                  <Fact label="Thread">{characterName(db, order.thread)}</Fact>
                ) : null}
                {order.chapter ? (
                  <Fact label="Chapter">{order.chapter}</Fact>
                ) : null}
                <Fact label="Spoiler" testId="entity-spoiler">
                  {spoiler
                    ? `Lv ${spoiler.threshold + 1}`
                    : order.spoiler_alert
                      ? order.spoiler_alert
                      : "none"}
                </Fact>
              </>
            ) : null}
          </dl>
        </section>

        {isImPost(entity) ? (
          <section className="panel">
            <h2>iM post</h2>
            <dl className="facts">
              <Fact label="Author">{entity.author}</Fact>
              <Fact label="iM order">{entity.order}</Fact>
              <Fact label="Likes">{entity.likes}</Fact>
              <Fact label="Replies">{entity.reply_count}</Fact>
              <Fact label="Story gate">{entity.story_gate ?? "none"}</Fact>
              <Fact label="Topic gate">{entity.topic_gate ?? "none"}</Fact>
              <Fact label="Attachments">
                {entity.attachments.length > 0
                  ? entity.attachments.join(", ")
                  : "none"}
              </Fact>
            </dl>
          </section>
        ) : null}

        {isOsLog(entity) ? (
          <section className="panel">
            <h2>OS log</h2>
            <dl className="facts">
              <Fact label="File">{entity.file}</Fact>
              <Fact label="Index">{entity.index}</Fact>
              <Fact label="Date">{entity.date || "—"}</Fact>
              <Fact label="Category">{entity.category || "—"}</Fact>
              <Fact label="Chapter">{entity.chapter_id}</Fact>
              <Fact label="File lock">{entity.file_lock ?? "none"}</Fact>
              <Fact label="Movies">
                {entity.movies.length > 0 ? entity.movies.join(", ") : "none"}
              </Fact>
            </dl>
          </section>
        ) : null}

        {Array.isArray(provenance) && provenance.length > 0 ? (
          <section className="panel">
            <h2>Provenance</h2>
            <ul className="prov">
              {provenance.map((entry, index) => {
                if (typeof entry !== "object" || entry === null) {
                  return null;
                }
                const record = entry as Record<string, unknown>;
                return (
                  <li key={index}>
                    <code>{formatFieldValue(record["locator"])}</code>
                    <span>{formatFieldValue(record["kind"])}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="panel">
          <h2>Order context</h2>
          <dl className="facts">
            <Fact label="Charts">
              {charts.length > 0 ? `${charts.length} linked` : "none"}
            </Fact>
            <Fact label="Backlinks">
              {backlinks.length > 0 ? `${backlinks.length} incoming` : "none"}
            </Fact>
          </dl>
        </section>
      </aside>
    </>
  );
}
