import { Link } from "react-router-dom";
import { EntityList } from "./EntityLink";
import { useI18n } from "../data/i18n";
import { branchBossStages, branchState, branchStories } from "../data/branch";
import { entityHref, entityTitle } from "../data/selectors";
import type { Database, Lang, StoryNodeEntity } from "../types";

/**
 * Decoded unlock gate for a Branching OS node.
 *
 * The raw `state_id`/`state_value` pair is a game enum plus a required value;
 * rendering only the numbers hides what the node actually waits for
 * (`2 / 1` means "branch point 1 tapped with Hit").
 */
export function BranchStateText({ node }: { node: StoryNodeEntity }) {
  const i18n = useI18n();
  const { kind, values } = branchState(node);
  const joined = values.join(", ");
  switch (kind) {
    case "group1":
    case "group2":
      return <>{i18n.t(`branch.state.${kind}`, { value: joined })}</>;
    case "select1":
    case "select2": {
      const tapped = values
        .map((value) =>
          value === "1" ? i18n.t("branch.select.hit") : i18n.t("branch.select.leave"),
        )
        .join(", ");
      return <>{i18n.t(`branch.state.${kind}`, { value: tapped })}</>;
    }
    case "afterFiles":
      return <>{i18n.t("branch.state.afterFiles", { files: joined })}</>;
    default:
      return <>{i18n.t("branch.state.level")}</>;
  }
}

/**
 * What reading the node does beyond showing text: the story it starts and the
 * boss stage that story plays. Both come from the dump-derived data, so a node
 * without them renders its own copy instead of an empty heading.
 */
export function BranchConsequences({
  db,
  node,
  lang,
}: {
  db: Database;
  node: StoryNodeEntity;
  lang: Lang;
}) {
  const i18n = useI18n();
  const stories = branchStories(db, node);
  const stages = branchBossStages(db, node);
  return (
    <>
      <section className="detail-section" data-testid="branch-stories">
        <h2>{i18n.t("branch.storyTitle")}</h2>
        {stories.length === 0 ? (
          <p className="muted">{i18n.t("branch.noStory")}</p>
        ) : (
          <ul className="link-list">
            {stories.map((story) => {
              const title = entityTitle(db, story, lang, i18n);
              return (
                <li key={story.id}>
                  <Link
                    to={entityHref(story.id)}
                    className="entity-link"
                    data-testid="branch-story-link"
                    data-story-id={story.id}
                  >
                    <span className="entity-link-body">
                      <span className="entity-link-title">{title}</span>
                      {title === story.game_id ? null : (
                        <span className="entity-link-meta">
                          <code>{story.game_id}</code>
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {stages.length === 0 ? null : (
        <section className="detail-section" data-testid="branch-boss-stages">
          <h2>{i18n.t("branch.bossTitle")}</h2>
          <EntityList
            db={db}
            entities={stages}
            lang={lang}
            testId="branch-boss-link"
          />
        </section>
      )}
    </>
  );
}
