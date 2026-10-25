import { Link } from "react-router-dom";
import { MediaImage } from "./Media";
import { TextRecordBody } from "./TextBody";
import { useI18n } from "../data/i18n";
import { entityHref, incomingEdges } from "../data/selectors";
import { useTextRecords } from "../data/useText";
import type { Database, ImReplyEntity, Lang } from "../types";

function repliesOf(db: Database, postId: string): ImReplyEntity[] {
  return incomingEdges(db, postId)
    .filter((edge) => edge.relation === "has_reply")
    .map((edge) => db.entityById.get(edge.source))
    .filter((entity): entity is ImReplyEntity => entity?.type === "im_reply")
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.id.localeCompare(right.id, undefined, { numeric: true }),
    );
}

/**
 * Replies belong under the post body, not in the neighbour list: the list is a
 * navigation index, while people read a thread as one document. Bodies are
 * batch-loaded once per language and rendered with the same block/rich-text
 * renderer as the reply's own page.
 */
export function ImReplies({
  db,
  postId,
  lang,
}: {
  db: Database;
  postId: string;
  lang: Lang;
}) {
  const i18n = useI18n();
  const replies = repliesOf(db, postId);
  const bodies = useTextRecords(
    replies.map((reply) => reply.text_ref),
    lang,
  );
  if (replies.length === 0) {
    return null;
  }
  const loading = bodies.status === "loading" || bodies.status === "idle";
  return (
    <section className="detail-section im-replies" data-testid="im-replies">
      <h2>
        {i18n.t("section.imReplies")}{" "}
        <span className="edge-count">{replies.length}</span>
      </h2>
      <ol className="im-reply-feed">
        {replies.map((reply) => (
          <li
            key={reply.id}
            className="im-reply"
            data-testid="im-reply"
            data-ref={reply.text_ref}
            data-floor={reply.order}
          >
            <div className="im-reply-grid">
              <div className="im-reply-avatar">
                <MediaImage
                  id={reply.avatar}
                  kind="avatar"
                  alt={reply.author}
                  className="im-reply-avatar-img"
                />
              </div>
              <span className="im-reply-author">{reply.author}</span>
              <Link
                to={entityHref(reply.id)}
                className="im-reply-floor"
                data-testid="im-reply-permalink"
              >
                #{reply.order}
              </Link>
              <div className="im-reply-content">
                {loading ? (
                  <p className="muted">{i18n.t("text.loading")}</p>
                ) : bodies.status === "error" ? (
                  <p className="error-text">
                    {i18n.t("text.error", { message: bodies.error.message })}
                  </p>
                ) : (
                  <TextRecordBody
                    record={bodies.records.get(reply.text_ref) ?? null}
                    lang={lang}
                    testId="im-reply-body"
                  />
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
