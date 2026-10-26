import { useState } from "react";
import { Link } from "react-router-dom";
import { TextBody } from "../components/TextBody";
import { TypeBadge } from "../components/ui";
import { isAssistantDialogue, isTitleScreen } from "../data/database";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { conditionLink, entityHref } from "../data/selectors";
import { useMediaManifest } from "../data/useMedia";
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
      return entityHref(db, id);
    }
  }
  return null;
}

export function ExtrasIndexView({ db }: { db: Database }) {
  const i18n = useI18n();
  const assistants = assistantEntities(db);
  const titles = titleEntities(db);
  const pages = assistants.reduce((sum, group) => sum + group.page_count, 0);
  const clips = titles.reduce((sum, title) => sum + title.video_clips.length, 0);
  const { manifest } = useMediaManifest();
  const songSelect = manifest?.songSelect;
  const normalSongSelect = Object.keys(songSelect?.normal ?? {}).length;
  const trueEndSongSelect = songSelect?.sceneOrder?.length ?? 0;

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("extras.eyebrow")}</p>
          <h1>{i18n.t("extras.title")}</h1>
          <p className="lede">{i18n.t("extras.lede")}</p>
          <div className="page-stats" data-testid="extras-stats">
            {i18n.t("extras.stats", {
              groups: formatUnit(i18n, "groups", assistants.length),
              pages: formatUnit(i18n, "pages", pages),
              titles: formatUnit(i18n, "titles", titles.length),
              clips: formatUnit(i18n, "clips", clips),
            })}
          </div>
        </header>

        <div className="card-grid" data-testid="extras-index">
          <Link
            to="/extras/assistants"
            className="collection-card"
            data-testid="extras-assistants-card"
          >
            <span className="collection-title">
              {i18n.t("extras.assistantsCard")}
            </span>
            <span className="collection-meta">
              {i18n.t("extras.assistantsMeta", {
                groups: formatUnit(i18n, "groups", assistants.length),
                pages: formatUnit(i18n, "pages", pages),
              })}
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
            <span className="collection-title">{i18n.t("extras.titlesCard")}</span>
            <span className="collection-meta">
              {i18n.t("extras.titlesMeta", {
                titles: formatUnit(i18n, "titles", titles.length),
                clips: formatUnit(i18n, "clips", clips),
              })}
            </span>
            <span className="collection-id">
              <code>titleinfodata</code>
            </span>
          </Link>
          <Link
            to="/extras/songselect"
            className="collection-card"
            data-testid="extras-songselect-card"
          >
            <span className="collection-title">
              {i18n.t("extras.songSelectTitle")}
            </span>
            <span className="collection-meta">
              {i18n.t("extras.songSelectMeta", {
                normal: normalSongSelect
                  ? i18n.formatNumber(normalSongSelect)
                  : "—",
                trueEnd: normalSongSelect
                  ? i18n.formatNumber(trueEndSongSelect)
                  : "—",
              })}
            </span>
            <span className="collection-id">
              <code>manifest.songSelect</code>
            </span>
          </Link>
          <Link
            to="/extras/cutscenes"
            className="collection-card"
            data-testid="extras-cutscenes-card"
          >
            <span className="collection-title">
              {i18n.t("extras.cutscenesCard")}
            </span>
            <span className="collection-meta">
              {i18n.t("extras.cutscenesMeta")}
            </span>
            <span className="collection-id">
              <code>subs/*.vtt</code>
            </span>
          </Link>
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("extras.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("extras.sources")}</h2>
          <p>{i18n.t("extras.sourcesText")}</p>
          <p>{i18n.t("extras.sourcesHint")}</p>
        </section>
      </aside>
    </>
  );
}

export function AssistantsView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const assistants = assistantEntities(db);
  const pages = assistants.reduce((sum, group) => sum + group.page_count, 0);

  return (
    <>
      <main className="content" data-testid="assistants-view">
        <header className="page-head">
          <p className="eyebrow">
            iM · {i18n.t("extras.eyebrow")}
          </p>
          <h1>{i18n.t("extras.assistantsTitle")}</h1>
          <p className="lede">{i18n.t("extras.assistantsLede")}</p>
          <div className="page-stats">
            {i18n.t("extras.assistantsStats", {
              groups: formatUnit(i18n, "groups", assistants.length),
              pages: formatUnit(i18n, "pages", pages),
              lang,
            })}
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
                      {i18n.t("value.trigger", { value: group.trigger })} ·{" "}
                      {i18n.t("value.target")}{" "}
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
                      · {formatUnit(i18n, "pages", group.page_count)} · v
                      {group.version || "—"}
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

      <aside className="context" aria-label={i18n.t("extras.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("extras.reading")}</h2>
          <p>{i18n.t("extras.readingText")}</p>
          <p>{i18n.t("extras.readingHint")}</p>
        </section>
      </aside>
    </>
  );
}

function TitleClip({ clip }: { clip: string }) {
  const i18n = useI18n();
  const [missing, setMissing] = useState(false);
  const file = `${MEDIA_BASE}/titles/${encodeURIComponent(clip)}.mp4`;
  if (missing) {
    return (
      <span
        className="chip chip--warn"
        data-testid="title-video-missing"
        data-clip={clip}
        title={i18n.t("extras.expected", { file })}
      >
        {i18n.t("extras.videoMissing", { clip })}
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
        <code>{clip}</code> · <a href={file}>{i18n.t("common.open")}</a>
      </figcaption>
    </figure>
  );
}

export function TitlesView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const titles = titleEntities(db);
  const clips = titles.reduce((sum, title) => sum + title.video_clips.length, 0);

  return (
    <>
      <main className="content" data-testid="titles-view">
        <header className="page-head">
          <p className="eyebrow">
            {i18n.t("fact.title")} · {i18n.t("extras.eyebrow")}
          </p>
          <h1>{i18n.t("extras.titlesTitle")}</h1>
          <p className="lede">{i18n.t("extras.titlesLede")}</p>
          <div className="page-stats">
            {i18n.t("extras.titlesStats", {
              titles: formatUnit(i18n, "titles", titles.length),
              clips: formatUnit(i18n, "clips", clips),
            })}
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
                <span className="title-number mono">
                  {i18n.t("extras.titleNumber", { number: title.number })}
                </span>
                <div className="title-name" data-testid="title-name">
                  <TextBody textRef={title.text_ref} lang={lang} />
                </div>
                <div className="title-conditions" data-testid="title-conditions">
                  <span className="muted">{i18n.t("extras.unlock")}</span>
                  {title.unlock_conditions.length === 0 ? (
                    <span className="chip">
                      {i18n.t("value.unlockedFromStart")}
                    </span>
                  ) : (
                    title.unlock_conditions.map((condition) => {
                      const link = conditionLink(db, condition, i18n);
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

      <aside className="context" aria-label={i18n.t("extras.titleAria")}>
        <section className="panel">
          <h2>{i18n.t("extras.playback")}</h2>
          <p>{i18n.t("extras.playbackText")}</p>
          <p>{i18n.t("extras.playbackHint")}</p>
        </section>
      </aside>
    </>
  );
}
