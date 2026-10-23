import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { TextBody } from "../components/TextBody";
import { Avatar } from "../components/ui";
import { oaGroups, findOaGroup } from "../data/collections";
import { useLanguage } from "../data/language";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

export function OaIndexView({ db }: { db: Database }) {
  const groups = oaGroups(db);
  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Open Archive</p>
          <h1>OA</h1>
          <p className="lede">
            Every explorable OA archive, ordered by character. Objects open their
            own text; documents and hotspot descriptions stay attached to the
            character that owns them.
          </p>
          <div className="page-stats" data-testid="oa-stats">
            <strong>{groups.length}</strong> characters ·{" "}
            {groups.reduce((sum, group) => sum + group.objects.length, 0)} objects ·{" "}
            {groups.reduce((sum, group) => sum + group.documents.length, 0)} documents ·{" "}
            {groups.reduce((sum, group) => sum + group.descriptions.length, 0)}{" "}
            descriptions
          </div>
        </header>

        <div className="card-grid" data-testid="oa-index">
          {groups.map((group) => (
            <Link
              key={group.oa.id}
              to={`/oa/${encodeURIComponent(group.oa.game_id)}`}
              className="collection-card"
              data-testid="oa-character-card"
              data-oa-id={group.oa.id}
            >
              <Avatar name={group.oa.name} />
              <span className="collection-title">{group.oa.name}</span>
              <span className="collection-meta">
                {group.objects.length} objects · {group.documents.length} documents
                · {group.descriptions.length} descriptions
              </span>
              <span className="collection-id">
                <code>{group.oa.game_id}</code>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <aside className="context" aria-label="OA details">
        <section className="panel">
          <h2>OA archive</h2>
          <p>
            OA has its own unlock conditions and is never merged into the iM/OS
            timeline.
          </p>
          <p className="hint">
            An archive groups one character's clickable objects, the files
            attached to them, and condition-driven hotspot descriptions.
          </p>
        </section>
        <section className="panel">
          <h2>Counts</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Characters</dt>
              <dd>{groups.length}</dd>
            </div>
            <div className="fact">
              <dt>Objects</dt>
              <dd>{groups.reduce((sum, group) => sum + group.objects.length, 0)}</dd>
            </div>
            <div className="fact">
              <dt>Documents</dt>
              <dd>{groups.reduce((sum, group) => sum + group.documents.length, 0)}</dd>
            </div>
            <div className="fact">
              <dt>Descriptions</dt>
              <dd>
                {groups.reduce((sum, group) => sum + group.descriptions.length, 0)}
              </dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}

export function OaCharacterView({
  db,
  gameId,
}: {
  db: Database;
  gameId: string;
}) {
  const { lang } = useLanguage();
  const group = findOaGroup(db, gameId);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedObjectId(null);
  }, [gameId]);

  if (!group) {
    return (
      <main className="content">
        <div className="empty-state">
          <h1>OA archive not found</h1>
          <p>
            No character has the OA archive <code>{gameId}</code>.
          </p>
          <Link to="/oa" className="inline-link">
            ← All OA archives
          </Link>
        </div>
      </main>
    );
  }

  const activeObject =
    group.objects.find((object) => object.id === selectedObjectId) ??
    group.objects[0] ??
    null;
  const attachedDocuments = activeObject
    ? group.documents.filter((document) => document.object_id === activeObject.id)
    : group.documents.filter((document) => document.object_id === null);
  const galleryFolder = group.oa.gallery_folder_id
    ? db.entityById.get(group.oa.gallery_folder_id)
    : undefined;

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/oa" className="backlink" data-testid="back-to-oa">
            ← OA
          </Link>
          <BackButton />
        </div>

        <article className="detail" data-testid="oa-workspace" data-oa-id={group.oa.id}>
          <header className="detail-head">
            <p className="eyebrow">
              OA archive · <code>{group.oa.game_id}</code>
            </p>
            <h1>{group.oa.name}</h1>
            <p className="byline">
              {group.objects.length} objects · {group.documents.length} documents ·{" "}
              {group.descriptions.length} descriptions
            </p>
          </header>

          <nav className="tab-strip" aria-label="OA objects" data-testid="oa-object-tabs">
            {group.objects.map((object) => (
              <button
                key={object.id}
                type="button"
                className={
                  activeObject?.id === object.id ? "tab active" : "tab"
                }
                aria-pressed={activeObject?.id === object.id}
                data-testid="oa-object-tab"
                data-object-id={object.id}
                onClick={() => setSelectedObjectId(object.id)}
              >
                {object.game_id}
              </button>
            ))}
            {group.objects.length === 0 ? (
              <span className="muted">No clickable objects.</span>
            ) : null}
          </nav>

          {activeObject ? (
            <section className="oa-object-panel" data-testid="oa-object-panel">
              <header className="oa-object-head">
                <h2>{activeObject.game_id}</h2>
                <Link
                  to={entityHref(activeObject.id)}
                  className="inline-link"
                  data-testid="oa-object-entity-link"
                >
                  Object detail →
                </Link>
              </header>
              <TextBody textRef={activeObject.text_ref} lang={lang} />
              <h3>Documents ({attachedDocuments.length})</h3>
              {attachedDocuments.length === 0 ? (
                <p className="muted">No document is attached to this object.</p>
              ) : (
                <ul className="link-list">
                  {attachedDocuments.map((document) => (
                    <li key={document.id}>
                      <EntityLink
                        db={db}
                        entity={document}
                        lang={lang}
                        testId="oa-document-link"
                        meta={document.mission_id ?? undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="detail-section" data-testid="oa-descriptions">
            <h2>Descriptions ({group.descriptions.length})</h2>
            <ul className="link-list">
              {group.descriptions.map((description) => (
                <li key={description.id}>
                  <EntityLink
                    db={db}
                    entity={description}
                    lang={lang}
                    testId="oa-description-link"
                    meta={`weight ${description.weight}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        </article>
      </main>

      <aside className="context" aria-label="OA character details">
        <section className="panel">
          <h2>Character</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Name</dt>
              <dd>{group.oa.name}</dd>
            </div>
            <div className="fact">
              <dt>Game ID</dt>
              <dd>
                <code>{group.oa.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>Objects</dt>
              <dd>{group.objects.length}</dd>
            </div>
            <div className="fact">
              <dt>Documents</dt>
              <dd>{group.documents.length}</dd>
            </div>
            <div className="fact">
              <dt>Descriptions</dt>
              <dd>{group.descriptions.length}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2>Links</h2>
          <ul className="link-list">
            {galleryFolder ? (
              <li>
                <EntityLink db={db} entity={galleryFolder} lang={lang} />
              </li>
            ) : null}
            <li>
              <EntityLink db={db} entity={group.oa} lang={lang} />
            </li>
          </ul>
        </section>
      </aside>
    </>
  );
}
