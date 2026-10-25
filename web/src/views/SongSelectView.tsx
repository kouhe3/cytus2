import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { VideoPlayer } from "../components/VideoPlayer";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import { entityTitle } from "../data/selectors";
import { useMediaManifest } from "../data/useMedia";
import type { I18n } from "../data/messages";
import type { Database, Lang } from "../types";
import type { SongSelectClip } from "../data/media";

function packLabel(
  db: Database,
  pack: string,
  lang: Lang,
  i18n: I18n,
): string {
  const entity = db.entityById.get(`pack/${pack}`);
  return entity ? entityTitle(db, entity, lang, i18n) : pack;
}

function variantLabel(
  variant: string | undefined,
  i18n: I18n,
): string {
  return !variant || variant === "default"
    ? i18n.t("extras.songSelectDefault")
    : variant;
}

function clipLabel(
  db: Database,
  pack: string,
  clip: SongSelectClip,
  lang: Lang,
  i18n: I18n,
): string {
  const bits = [packLabel(db, pack, lang, i18n)];
  if (clip.variant && clip.variant !== "default") {
    bits.push(variantLabel(clip.variant, i18n));
  }
  if (clip.w && clip.h) {
    bits.push(`${clip.w}×${clip.h}`);
  }
  return bits.join(" · ");
}

export function SongSelectView({ db }: { db: Database }) {
  const { lang } = useLanguage();
  const i18n = useI18n();
  const { status, manifest } = useMediaManifest();
  const songSelect = manifest?.songSelect;
  const normal = songSelect?.normal ?? {};
  const trueEnd = songSelect?.trueEnd ?? {};
  const sceneOrder =
    songSelect?.sceneOrder && songSelect.sceneOrder.length > 0
      ? songSelect.sceneOrder
      : Object.keys(trueEnd);

  const normalGroups = (() => {
    const groups = new Map<string, { key: string; clip: SongSelectClip }[]>();
    for (const [key, clip] of Object.entries(normal)) {
      const pack = clip.pack ?? key.replace(/_song_select$/, "");
      const entries = groups.get(pack);
      if (entries) {
        entries.push({ key, clip });
      } else {
        groups.set(pack, [{ key, clip }]);
      }
    }
    return [...groups.entries()]
      .map(([pack, clips]) => ({
        pack,
        label: packLabel(db, pack, lang, i18n),
        clips: [...clips].sort(
          (left, right) =>
            (left.clip.variant === "default" ? 0 : 1) -
              (right.clip.variant === "default" ? 0 : 1) ||
            left.key.localeCompare(right.key),
        ),
      }))
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.pack.localeCompare(right.pack),
      );
  })();

  const trueEndClips = sceneOrder.flatMap((pack) => {
    const clip = trueEnd[pack];
    return clip ? [{ pack, clip }] : [];
  });
  const unused = Object.entries(trueEnd)
    .filter(([pack, clip]) => !sceneOrder.includes(pack) || clip.inSceneList === false)
    .map(([pack, clip]) =>
      clip.duplicateOf?.length
        ? `${pack} → ${clip.duplicateOf.join(" / ")}`
        : pack,
    );

  if (status === "loading") {
    return (
      <main className="content" data-testid="songselect-view">
        <p className="state">{i18n.t("extras.songSelectWait")}</p>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="content" data-testid="songselect-view">
        <p className="state">{i18n.t("video.manifestError")}</p>
      </main>
    );
  }
  if (!songSelect || (trueEndClips.length === 0 && normalGroups.length === 0)) {
    return (
      <main className="content" data-testid="songselect-view">
        <p className="state">{i18n.t("extras.songSelectEmpty")}</p>
      </main>
    );
  }

  return (
    <main className="content" data-testid="songselect-view">
      <div className="back-row">
        <Link to="/extras" className="backlink" data-testid="back-to-extras">
          ← {i18n.t("nav.extras")}
        </Link>
        <BackButton />
      </div>

      <header className="page-head">
        <p className="eyebrow">
          {i18n.t("extras.eyebrow")} · <code>songSelect</code>
        </p>
        <h1>{i18n.t("extras.songSelectTitle")}</h1>
        <p className="lede">{i18n.t("extras.songSelectLede")}</p>
        <div className="page-stats" data-testid="songselect-stats">
          {i18n.t("extras.songSelectStats", {
            packs: i18n.formatNumber(normalGroups.length),
            normal: i18n.formatNumber(Object.keys(normal).length),
            trueEnd: i18n.formatNumber(trueEndClips.length),
          })}
        </div>
      </header>

      <section className="detail-section" data-testid="songselect-trueend">
        <h2>
          {i18n.t("extras.songSelectTrueEndHeading", {
            count: i18n.formatNumber(trueEndClips.length),
          })}
        </h2>
        <p className="hint">{i18n.t("extras.songSelectTrueEndLede")}</p>
        <div className="songselect-grid">
          {trueEndClips.map(({ pack, clip }) => {
            const shared = (clip.contentMatches ?? []).filter(
              (match) => !match.startsWith(`${pack}_`),
            );
            const visibleDuplicate = (clip.duplicateOf ?? []).filter(
              (other) => sceneOrder.includes(other),
            );
            return (
              <article
                key={pack}
                className="songselect-card"
                data-testid="songselect-trueend-card"
                data-pack={pack}
              >
                <VideoPlayer
                  source={clip}
                  clip={pack}
                  subtitleKey={null}
                  label={clipLabel(db, pack, clip, lang, i18n)}
                  testId="songselect-trueend-player"
                />
                {shared.length > 0 ? (
                  <p className="video-note" data-testid="songselect-shared">
                    {i18n.t("extras.songSelectShared", {
                      clip: shared.join(", "),
                    })}
                  </p>
                ) : null}
                {visibleDuplicate.length > 0 ? (
                  <p className="video-note" data-testid="songselect-duplicate">
                    {i18n.t("extras.songSelectDuplicate", {
                      clip: visibleDuplicate.join(", "),
                    })}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
        {unused.length > 0 ? (
          <p className="hint" data-testid="songselect-unused">
            {i18n.t("extras.songSelectUnused", {
              clips: unused.join(", "),
            })}
          </p>
        ) : null}
      </section>

      <section className="detail-section" data-testid="songselect-normal">
        <h2>
          {i18n.t("extras.songSelectNormalHeading", {
            packs: i18n.formatNumber(normalGroups.length),
            count: i18n.formatNumber(Object.keys(normal).length),
          })}
        </h2>
        <p className="hint">{i18n.t("extras.songSelectNormalLede")}</p>
        {normalGroups.map((group) => (
          <section
            key={group.pack}
            className="songselect-pack"
            data-testid="songselect-pack"
            data-pack={group.pack}
          >
            <h3>
              {group.label} <code>{group.pack}</code>
            </h3>
            <div className="songselect-grid">
              {group.clips.map(({ key, clip }) => (
                <article
                  key={key}
                  className="songselect-card"
                  data-testid="songselect-normal-card"
                  data-clip={key}
                >
                  <VideoPlayer
                    source={clip}
                    clip={key}
                    subtitleKey={null}
                    label={clipLabel(db, group.pack, clip, lang, i18n)}
                    testId="songselect-normal-player"
                  />
                  {clip.duplicateOf?.length ? (
                    <p className="video-note" data-testid="songselect-duplicate">
                      {i18n.t("extras.songSelectDuplicate", {
                        clip: clip.duplicateOf.join(", "),
                      })}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>

      <p className="hint" data-testid="songselect-source">
        {i18n.t("extras.songSelectSource")}
      </p>
    </main>
  );
}
