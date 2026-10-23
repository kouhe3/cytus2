import { useState } from "react";
import { Link } from "react-router-dom";
import { TextBody } from "../components/TextBody";
import { TypeBadge } from "../components/ui";
import { isAssistantDialogue, isTitleScreen } from "../data/database";
import { useLanguage } from "../data/language";
import { conditionLink, entityHref } from "../data/selectors";
import type {
  AssistantDialogueEntity,
  Database,
  TitleScreenEntity,
} from "../types";

const MEDIA_BASE = "/media";

function assistantEntities(db: Database): AssistantDialogueEntity[] {
  return (db.entitiesByType.get("assistant_dialogue") ?? [])
    .filter(isAssistantDialogue)
    .sort(
      (left, right) =>
        left.progress - right.progress || left.game_id.localeCompare(right.game_id),
    );
}

function titleEntities(db: Database): TitleScreenEntity[] {
  return (db.entitiesByType.get("title_screen") ?? [])
    .filter(isTitleScreen)
    .sort(
      (left, right) =>
        left.number - right.number || left.id.localeCompare(right.id),
    );
}

function targetHref(db: Database, target: string): string | null {
  for (const id of [`im/${target}`, `story_node/${target}`, `os/${target}`]) {
    if (db.entityById.has(id)) {
      return entityHref(id);
    }
  }
  return null;
}

export function ExtrasIndexView({ db }: { db: Database }) {
  const assistants = assistantEntities(db);
  const titles = titleEntities(db);
  const pages = assistants.reduce((sum, group) => sum + group.page_count, 0);
  const clips = titles.reduce((sum, title) => sum + title.video_clips.length, 0);

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Appendix</p>
          <h1>Extras</h1>
          <p className="lede">
            Two appendix families that are not part of the timeline: the iM
            assistant dialogues and the title-screen evolution. Both read the
            canonical projection and the shared text store.
          </p>
          <div className="page-stats" data-testid="extras-stats">
            <strong>{assistants.length}</strong> assistant groups · {pages} pages ·{" "}
            {titles.length} titles · {clips} title clips
          </div>
        </header>

        <div className="card-grid" data-testid="extras-index">
          <Link
            to="/extras/assistants"
            className="collection-card"
            data-testid="extras-assistants-card"
          >
            <span className="collection-title">iM assistant dialogues</span>
            <span className="collection-meta">
              {assistants.length} groups · {pages} pages · five languages
            </span>
            <span className="collection-id">
              <code>im_assistant_data</code>
            </span>
          </Link>
          <Link
            to="/extras/titles"
            className="collection-card"
            data-testid="extras-titles-card"
          >
            <span className="collection-title">Title-screen evolution</span>
            <span className="collection-meta">
              {titles.length} titles · {clips} video_title_* clips · story unlocks
            </span>
            <span className="collection-id">
              <code>titleinfodata</code>
            </span>
          </Link>
        </div>
      </main>

      <aside className="context" aria-label="Extras details">
        <section className="panel">
          <h2>Sources</h2>
          <p>
            Assistant groups come from <code>im_assistant_data</code>; title
            entries come from <code>titleinfodata/title_info</code>. Page bodies
            and title names live in <code>build/text/extras.jsonl</code>.
          </p>
          <p>
            Title clips are served from the local media export; when a clip is
            not present the page marks it as not exported instead of failing.
          </p>
        </section>
      </aside>
    </>
  );
}

export function AssistantsView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const assistants = assistantEntities(db);
  const pages = assistants.reduce((sum, group) => sum + group.page_count, 0);

  return (
    <>
      <main className="content" data-testid="assistants-view">
        <header className="page-head">
          <p className="eyebrow">iM · Appendix</p>
          <h1>iM assistant dialogues</h1>
          <p className="lede">
            Assistant messages grouped by the game&apos;s own dialogue id. Pages
            are read from the canonical text store in the selected language; a
            missing translation falls back explicitly.
          </p>
          <div className="page-stats">
            <strong>{assistants.length}</strong> groups · {pages} pages ·{" "}
            {lang}
          </div>
        </header>

        <div className="assistant-list">
          {assistants.map((group) => {
            const href = group.target ? targetHref(db, group.target) : null;
            return (
              <article
                key={group.id}
                className="assistant-group"
                data-testid="assistant-group"
                data-group-id={group.id}
              >
                <header className="assistant-head">
                  <div>
                    <h2>
                      <code>{group.game_id}</code>
                    </h2>
                    <p className="assistant-meta">
                      trigger {group.trigger} · target{" "}
                      {group.target ? (
                        href ? (
                          <Link to={href} data-testid="assistant-target">
                            {group.target}
                          </Link>
                        ) : (
                          <span className="mono">{group.target}</span>
                        )
                      ) : (
                        "—"
                      )}{" "}
                      · {group.page_count} pages · v{group.version || "—"}
                    </p>
                  </div>
                  <TypeBadge type={group.type} />
                </header>
                <div className="assistant-pages">
                  <TextBody textRef={group.text_ref} lang={lang} />
                </div>
              </article>
            );
          })}
        </div>
      </main>

      <aside className="context" aria-label="Assistant details">
        <section className="panel">
          <h2>Reading</h2>
          <p>
            Each group keeps the raw trigger, target and progress fields. Page
            blocks preserve the raw page number plus its assistant, image and
            sound ids.
          </p>
          <p>
            The language switch in the sidebar applies to every group. A group
            with no text in the selected language shows the same explicit
            fallback note as the timeline.
          </p>
        </section>
      </aside>
    </>
  );
}

function TitleClip({ clip }: { clip: string }) {
  const [missing, setMissing] = useState(false);
  const file = `${MEDIA_BASE}/titles/${encodeURIComponent(clip)}.mp4`;
  if (missing) {
    return (
      <span
        className="chip chip--warn"
        data-testid="title-video-missing"
        data-clip={clip}
        title={`expected ${file}`}
      >
        {clip} · video not exported
      </span>
    );
  }
  return (
    <figure className="title-clip">
      <video
        className="title-video"
        data-testid="title-video"
        data-clip={clip}
        controls
        preload="metadata"
        src={file}
        onError={() => setMissing(true)}
      />
      <figcaption>
        <code>{clip}</code> · <a href={file}>open</a>
      </figcaption>
    </figure>
  );
}

export function TitlesView({ db }: { db: Database }) {
  const titles = titleEntities(db);
  const clips = titles.reduce((sum, title) => sum + title.video_clips.length, 0);

  return (
    <>
      <main className="content" data-testid="titles-view">
        <header className="page-head">
          <p className="eyebrow">Title · Appendix</p>
          <h1>Title-screen evolution</h1>
          <p className="lede">
            Every title screen in release order, with the story node that
            unlocks it and the <code>video_title_*</code> clip that animates it.
            Clips missing from the local media export are marked explicitly.
          </p>
          <div className="page-stats">
            <strong>{titles.length}</strong> titles · {clips} clips
          </div>
        </header>

        <div className="title-list">
          {titles.map((title) => (
            <article
              key={title.id}
              className="title-row"
              data-testid="title-row"
              data-title-number={title.number}
            >
              <header className="title-head">
                <span className="title-number mono">Type {title.number}</span>
                <h2>{title.name}</h2>
                <div className="title-conditions" data-testid="title-conditions">
                  <span className="muted">Unlock</span>
                  {title.unlock_conditions.length === 0 ? (
                    <span className="chip">Unlocked from the start</span>
                  ) : (
                    title.unlock_conditions.map((condition) => {
                      const link = conditionLink(db, condition);
                      return link.href ? (
                        <Link
                          key={`${condition.kind}:${condition.value}`}
                          to={link.href}
                          className="chip chip-btn"
                          data-testid="title-condition"
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <span
                          key={`${condition.kind}:${condition.value}`}
                          className="chip"
                          data-testid="title-condition"
                        >
                          {link.label}
                        </span>
                      );
                    })
                  )}
                </div>
              </header>
              <div className="title-videos">
                {title.video_clips.map((clip) => (
                  <TitleClip key={`${title.id}:${clip}`} clip={clip} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </main>

      <aside className="context" aria-label="Title details">
        <section className="panel">
          <h2>Playback</h2>
          <p>
            Clips are read from <code>titles/&lt;clip&gt;.mp4</code> under the
            local media export. Set <code>CYTUS2_MEDIA_DIR</code> when the media
            lives outside <code>viewer/public/media</code>.
          </p>
          <p>
            The type-to-clip mapping is the frozen viewer&apos;s documented
            inference; it is carried as manual provenance on every title.
          </p>
        </section>
      </aside>
    </>
  );
}
