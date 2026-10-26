import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { BranchMap } from "../components/BranchMap";
import { BranchConsequences, BranchStateText } from "../components/BranchStory";
import { ChartLinks } from "../components/ChartLinks";
import { LevelLockList } from "../components/Conditions";
import { TextBody } from "../components/TextBody";
import { VideoPlayer } from "../components/VideoPlayer";
import {
  branchHref,
  branchGate,
  branchGroups,
  branchOpensReader,
  branchPlacements,
  branchPredecessors,
  findBranchNode,
} from "../data/branch";
import { isChart, isStoryNode, textSnippet } from "../data/database";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { entityTitle } from "../data/selectors";
import type { ChartEntity, Database, StoryNodeEntity } from "../types";

/** `story_node(kind=branch)` state ids are game values; show them verbatim. */
function stateText(node: StoryNodeEntity): string {
  return `${node.state_id ?? "-"} / ${node.state_value || "-"}`;
}

function BranchAside({
  nodes,
  positions,
  rows,
  charts,
}: {
  nodes: number;
  positions: number;
  rows: number;
  charts: number;
}) {
  const i18n = useI18n();
  return (
    <aside className="context" aria-label={i18n.t("branch.detailsAria")}>
      <section className="panel">
        <h2>{i18n.t("branch.legendTitle")}</h2>
        <p>
          <span className="branch-swatch" aria-hidden="true" />{" "}
          {i18n.t("branch.legendTrack")}
        </p>
        <p>
          <span className="branch-swatch is-merge" aria-hidden="true" />{" "}
          {i18n.t("branch.legendMerge")}
        </p>
        <p>
          <span className="branch-swatch is-end" aria-hidden="true" />{" "}
          {i18n.t("branch.legendEnd")}
        </p>
      </section>
      <section className="panel">
        <h2>{i18n.t("story.counts")}</h2>
        <dl className="facts">
          <div className="fact">
            <dt>{i18n.t("story.branchingOs")}</dt>
            <dd>{i18n.formatNumber(nodes)}</dd>
          </div>
          <div className="fact">
            <dt>{i18n.t("fact.position")}</dt>
            <dd>{i18n.formatNumber(positions)}</dd>
          </div>
          <div className="fact">
            <dt>{i18n.t("branch.legendTrack")}</dt>
            <dd>{i18n.formatNumber(rows)}</dd>
          </div>
          <div className="fact">
            <dt>{i18n.t("sidebar.stats.charts")}</dt>
            <dd>{i18n.formatNumber(charts)}</dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>{i18n.t("branch.mapAria")}</h2>
        <p>{i18n.t("branch.mapHint")}</p>
      </section>
    </aside>
  );
}

export function BranchIndexView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const navigate = useNavigate();
  const groups = useMemo(() => branchGroups(db), [db]);
  const nodes = groups.reduce((sum, group) => sum + group.nodes.length, 0);
  const positions = new Set(groups.flatMap((group) => group.positions)).size;
  const rows = new Set(
    groups.flatMap((group) =>
      branchPlacements(group.nodes).map((placement) => placement.row),
    ),
  ).size;
  const charts = groups.reduce((sum, group) => sum + group.chartRefs.length, 0);
  const openNode = (gameId: string) => navigate(branchHref(gameId));

  return (
    <>
      <main className="content" data-testid="branch-index">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("branch.eyebrow")}</p>
          <h1>{i18n.t("branch.title")}</h1>
          <p className="lede">{i18n.t("branch.lede")}</p>
          <p className="hint" data-testid="branch-level-hint">
            {i18n.t("branch.levelHint")}
          </p>
          <div className="page-stats" data-testid="branch-stats">
            {i18n.t("branch.stats", {
              nodes: formatUnit(i18n, "nodes", nodes),
              positions: formatUnit(i18n, "positions", positions),
              tracks: formatUnit(i18n, "tracks", rows),
              charts: formatUnit(i18n, "charts", charts),
            })}
          </div>
        </header>

        {groups.length === 0 ? (
          <div className="empty-state" data-testid="branch-empty">
            {i18n.t("branch.empty")}
          </div>
        ) : null}

        {groups.map((group) => (
          <section
            className="detail-section"
            key={group.source}
            data-testid="branch-group"
            data-source={group.source}
          >
            <h2>
              {group.source
                ? i18n.t("branch.groupTitle", { source: group.source })
                : i18n.t("branch.title")}
            </h2>
            <p className="hint">{i18n.t("branch.mapHint")}</p>
            <BranchMap nodes={group.nodes} onOpen={openNode} />
            <h3>{i18n.t("branch.listTitle")}</h3>
            <ol className="branch-list" data-testid="branch-list">
              {group.nodes.map((node) => {
                const gate = branchGate(node);
                const snippet =
                  node.text_ref && branchOpensReader(node)
                  ? textSnippet(db, node.text_ref, lang)
                  : "";
                return (
                  <li key={node.id}>
                    <Link
                      to={branchHref(node.game_id)}
                      className="branch-row"
                      data-testid="branch-row"
                      data-node-id={node.id}
                      data-position={node.position ?? ""}
                    >
                      <span className="branch-row-pos">#{node.position ?? "-"}</span>
                      <code className="branch-row-id">{node.game_id}</code>
                      {gate === null ? null : (
                        <span className="level-badge">
                          {i18n.t("common.level", { level: gate })}
                        </span>
                      )}
                      <span className="branch-row-state">{stateText(node)}</span>
                      <span className="branch-row-snippet">
                        {snippet ||
                          (branchOpensReader(node)
                            ? i18n.t("story.noText")
                            : i18n.t("branch.rowStoryOnly"))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </main>

      <BranchAside
        nodes={nodes}
        positions={positions}
        rows={rows}
        charts={charts}
      />
    </>
  );
}

export function BranchNodeView({ db, gameId }: { db: Database; gameId: string }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const navigate = useNavigate();
  const node = findBranchNode(db, gameId);
  const group = useMemo(() => {
    if (!node) {
      return null;
    }
    return (
      branchGroups(db).find((candidate) =>
        candidate.nodes.some((item) => item.id === node.id),
      ) ?? null
    );
  }, [db, node]);

  if (!node) {
    return (
      <main className="content">
        <div className="empty-state">
          <h1>{i18n.t("branch.notFound")}</h1>
          <p>{i18n.t("branch.notFoundText", { gameId })}</p>
          <Link to="/branch" className="inline-link">
            ← {i18n.t("branch.back")}
          </Link>
        </div>
      </main>
    );
  }

  const previous = branchPredecessors(db, node);
  const next = (node.next ?? [])
    .map((id) => db.entityById.get(id))
    .filter(
      (record): record is StoryNodeEntity =>
        record !== undefined && isStoryNode(record),
    );
  const charts = (node.charts ?? [])
    .map((id) => db.entityById.get(id))
    .filter(
      (record): record is ChartEntity =>
        record !== undefined && isChart(record),
    );
  const gate = branchGate(node);
  const openNode = (id: string) => navigate(branchHref(id));

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/branch" className="backlink" data-testid="back-to-branch">
            ← {i18n.t("branch.back")}
          </Link>
          <BackButton />
        </div>

        <article className="detail" data-testid="branch-node" data-node-id={node.id}>
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("branch.nodeEyebrow")} ·{" "}
              <code>{node.source_file ?? "-"}</code>
            </p>
            <h1>{entityTitle(db, node, lang, i18n)}</h1>
            <p className="byline">
              <code>{node.game_id}</code>
              {gate === null ? null : (
                <>
                  {" · "}
                  <span className="level-badge">
                    {i18n.t("common.level", { level: gate })}
                  </span>
                </>
              )}
            </p>
          </header>

          {group ? (
            <BranchMap
              nodes={group.nodes}
              activeId={node.id}
              onOpen={openNode}
            />
          ) : null}

          {node.cutscene ? (
            <section
              className="detail-section"
              data-testid="branch-cutscene"
              data-clip={node.cutscene}
            >
              <h2>{i18n.t("section.osCutscene")}</h2>
              <VideoPlayer clip={node.cutscene} />
            </section>
          ) : null}

          <section className="detail-section" data-testid="branch-node-body">
            <h2>{i18n.t("branch.bodyTitle")}</h2>
            {branchOpensReader(node) ? null : (
              <p className="hint" data-testid="branch-body-skipped">
                {i18n.t("branch.storyOnly")}
              </p>
            )}
            {/* The game opens no reader for branch points and endings, but the
                file still carries text and the (DUMMY) attachments: show the
                archive copy either way. */}
            <TextBody textRef={node.text_ref ?? null} lang={lang} />
          </section>

          <section className="detail-section" data-testid="branch-node-facts">
            <h2>{i18n.t("branch.factsTitle")}</h2>
            <dl className="facts">
              <div className="fact">
                <dt>{i18n.t("fact.position")}</dt>
                <dd>{node.position ?? "-"}</dd>
              </div>
              <div className="fact">
                <dt>{i18n.t("fact.order")}</dt>
                <dd>{node.order ?? "-"}</dd>
              </div>
              <div className="fact">
                <dt>{i18n.t("fact.level")}</dt>
                <dd>
                  {node.level === undefined
                    ? "-"
                    : i18n.t("common.level", { level: node.level })}
                </dd>
              </div>
              <div className="fact">
                <dt>{i18n.t("fact.state")}</dt>
                <dd>
                  <BranchStateText node={node} />{" "}
                  <code>{stateText(node)}</code>
                </dd>
              </div>
              <div className="fact">
                <dt>{i18n.t("fact.sourceFile")}</dt>
                <dd>
                  <code>{node.source_file ?? "-"}</code>
                </dd>
              </div>
              <div className="fact">
                <dt>{i18n.t("fact.levelLocks")}</dt>
                <dd>
                  <LevelLockList db={db} locks={node.level_locks} levelOffset={0} />
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-section" data-testid="branch-prev">
            <h2>{i18n.t("branch.prevTitle")}</h2>
            {previous.length === 0 ? (
              <p className="muted">{i18n.t("branch.noPrev")}</p>
            ) : (
              <ul className="link-list">
                {previous.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={branchHref(item.game_id)}
                      className="entity-link"
                      data-testid="branch-prev-link"
                      data-node-id={item.id}
                    >
                      <span className="entity-link-title">
                        {entityTitle(db, item, lang, i18n)}
                      </span>
                      <span className="entity-link-meta">
                        {item.game_id} · #{item.position ?? "-"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail-section" data-testid="branch-next">
            <h2>{i18n.t("section.nextNodes")}</h2>
            {next.length === 0 ? (
              <p className="muted">{i18n.t("value.noNextNode")}</p>
            ) : (
              <ul className="link-list">
                {next.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={branchHref(item.game_id)}
                      className="entity-link"
                      data-testid="branch-next-link"
                      data-node-id={item.id}
                    >
                      <span className="entity-link-title">
                        {entityTitle(db, item, lang, i18n)}
                      </span>
                      <span className="entity-link-meta">
                        {item.game_id} · #{item.position ?? "-"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <BranchConsequences db={db} node={node} lang={lang} />

          {charts.length === 0 ? null : (
            <section className="detail-section" data-testid="branch-charts">
              <h2>{i18n.t("branch.chartsTitle")}</h2>
              <ChartLinks db={db} charts={charts} testId="branch-chart-link" />
            </section>
          )}
        </article>
      </main>

      <BranchAside
        nodes={group?.nodes.length ?? 0}
        positions={group?.positions.length ?? 0}
        rows={
          group
            ? new Set(
                branchPlacements(group.nodes).map((placement) => placement.row),
              ).size
            : 0
        }
        charts={group?.chartRefs.length ?? 0}
      />
    </>
  );
}
