import { useEffect, useMemo, useState } from "react";
import { VideoPlayer } from "../components/VideoPlayer";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import type { MediaManifest } from "../data/media";
import { formatUnit, LANGUAGES } from "../data/messages";
import {
  loadSubtitleIndex,
  searchSubtitleIndex,
  type SubtitleHit,
  type SubtitleIndex,
} from "../data/subtitles";
import { useMediaManifest } from "../data/useMedia";
import type { Lang } from "../types";

/**
 * Extras cutscene library. It reads the media manifest and the exported VTT
 * files only: the canonical projection has no cutscene dialogue, and the frozen
 * viewer's `subs-index.json`/`endplay.json` exports are off limits (README §6).
 */

interface MuxedVariant {
  /** `<clip>|<song>` key in `manifest.videoAudio`. */
  readonly key: string;
  readonly song: string;
}

const TRAILING_SHARD = /_\d+$/;

/**
 * Subtitle group -> exported clip, the long-standing pairing rule: the exact
 * manifest key first, then the key with one trailing `_N` segment removed.
 * Only `FinalBossStage_1/_2` need the fallback. The reverse direction is not
 * safe (`story04_1` would inherit `story04_2`'s subtitles), so rows always pass
 * their own group as `subtitleKey`.
 */
export function pairClip(
  manifest: MediaManifest | null,
  group: string,
): string | null {
  if (!manifest) {
    return null;
  }
  if (manifest.movies?.[group] ?? manifest.videos?.[group]) {
    return group;
  }
  const base = group.replace(TRAILING_SHARD, "");
  if (base !== group && (manifest.movies?.[base] ?? manifest.videos?.[base])) {
    return base;
  }
  return null;
}

/** Every muxed variant of a clip; the group's own song is offered first. */
function muxedVariants(
  manifest: MediaManifest,
  clip: string,
  preferred?: string,
): MuxedVariant[] {
  const audio = manifest.videoAudio;
  if (!audio) {
    return [];
  }
  return Object.entries(audio)
    .filter(([key]) => key.split("|")[0] === clip)
    .map(([key, asset]) => ({
      key,
      song: asset.song ?? key.split("|")[1] ?? key,
    }))
    .sort(
      (left, right) =>
        Number(left.song !== preferred) - Number(right.song !== preferred) ||
        left.key.localeCompare(right.key),
    );
}

function languageLabel(lang: Lang): string {
  return LANGUAGES.find((option) => option.code === lang)?.title ?? lang;
}

/** `0:03.7` — cue times are seconds with millisecond precision in the VTT. */
function formatCueTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const tenths = Math.round((seconds - whole) * 10);
  return `${minutes}:${String(rest).padStart(2, "0")}.${tenths}`;
}

function AudioPicker({
  clip,
  variants,
  value,
  onChange,
}: {
  clip: string;
  variants: readonly MuxedVariant[];
  value: string;
  onChange: (value: string) => void;
}) {
  const i18n = useI18n();
  if (variants.length === 0) {
    return null;
  }
  return (
    <label className="cutscene-audio">
      <span>{i18n.t("extras.cutsceneAudio")}</span>
      <select
        data-testid="cutscene-audio"
        data-clip={clip}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{i18n.t("extras.cutsceneAudioSilent")}</option>
        {variants.map((variant) => (
          <option key={variant.key} value={variant.key}>
            {i18n.t("extras.cutsceneAudioMuxed", { song: variant.song })}
          </option>
        ))}
      </select>
    </label>
  );
}

function CutsceneRow({
  manifest,
  group,
  clip,
}: {
  manifest: MediaManifest;
  group: string;
  clip: string | null;
}) {
  const i18n = useI18n();
  const [audioKey, setAudioKey] = useState("");
  const languages = LANGUAGES.map((option) => option.code).filter(
    (code) => manifest.subtitles?.[group]?.[code],
  );
  const variants = clip ? muxedVariants(manifest, clip, group) : [];

  return (
    <article
      className="cutscene-row"
      data-testid="cutscene-row"
      data-group={group}
      data-clip={clip ?? ""}
      data-languages={languages.join(",")}
    >
      <header className="cutscene-head">
        <h2>
          <code>{group}</code>
        </h2>
        <span className="cutscene-meta">
          {i18n.t("extras.cutsceneLanguages")}:{" "}
          {languages.map(languageLabel).join(" · ")}
        </span>
      </header>
      {clip ? (
        <>
          <p className="cutscene-pair">
            <code>{clip}</code>
          </p>
          <VideoPlayer
            clip={clip}
            subtitleKey={group}
            audioKey={audioKey || undefined}
            label={clip}
          />
          <AudioPicker
            clip={clip}
            variants={variants}
            value={audioKey}
            onChange={setAudioKey}
          />
        </>
      ) : (
        <p
          className="video-note"
          data-testid="cutscene-no-video"
          data-group={group}
        >
          {i18n.t("extras.cutsceneNoVideo", { group })}
        </p>
      )}
    </article>
  );
}

function RestClip({ manifest, clip }: { manifest: MediaManifest; clip: string }) {
  const [audioKey, setAudioKey] = useState("");
  const variants = muxedVariants(manifest, clip);
  return (
    <article className="cutscene-rest-item" data-testid="cutscene-rest" data-clip={clip}>
      <h3>
        <code>{clip}</code>
      </h3>
      <VideoPlayer
        clip={clip}
        subtitleKey={null}
        audioKey={audioKey || undefined}
        label={clip}
        testId="cutscene-rest-player"
      />
      <p className="cutscene-meta">
        <code>{manifest.videos[clip]?.file ?? clip}</code>
      </p>
      <AudioPicker
        clip={clip}
        variants={variants}
        value={audioKey}
        onChange={setAudioKey}
      />
    </article>
  );
}

export function CutsceneLibraryView() {
  const i18n = useI18n();
  const { lang } = useLanguage();
  const { status, manifest } = useMediaManifest();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SubtitleIndex | null>(null);
  const [indexError, setIndexError] = useState(false);
  const [selection, setSelection] = useState<SubtitleHit | null>(null);

  const groups = useMemo(
    () => Object.keys(manifest?.subtitles ?? {}).sort(),
    [manifest],
  );
  const pairs = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const group of groups) {
      map.set(group, pairClip(manifest, group));
    }
    return map;
  }, [groups, manifest]);
  const rest = useMemo(() => {
    if (!manifest) {
      return [];
    }
    const paired = new Set<string>();
    for (const clip of pairs.values()) {
      if (clip) {
        paired.add(clip);
      }
    }
    return Object.keys(manifest.videos)
      .filter((clip) => !paired.has(clip))
      .sort();
  }, [manifest, pairs]);

  useEffect(() => {
    if (!manifest || !query.trim() || index) {
      return;
    }
    let active = true;
    setIndexError(false);
    loadSubtitleIndex(manifest)
      .then((loaded) => {
        if (active) {
          setIndex(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setIndexError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [manifest, query, index]);

  const hits = useMemo(
    () => (index && query.trim() ? searchSubtitleIndex(index, query, lang) : []),
    [index, query, lang],
  );
  const selectionClip = selection ? pairClip(manifest, selection.group) : null;

  const summary = !query.trim()
    ? i18n.t("extras.cutsceneSearchHint")
    : indexError
      ? i18n.t("extras.cutsceneSearchError")
      : !index
        ? i18n.t("extras.cutsceneSearchLoading")
        : hits.length === 0
          ? i18n.t("extras.cutsceneSearchEmpty")
          : i18n.t("extras.cutsceneSearchSummary", {
              hits: i18n.formatNumber(hits.length),
              groups: i18n.formatNumber(
                new Set(hits.map((hit) => hit.group)).size,
              ),
              lang: languageLabel(lang),
            });

  return (
    <>
      <main className="content" data-testid="cutscenes-view">
        <header className="page-head">
          <p className="eyebrow">
            {i18n.t("extras.eyebrow")} · {i18n.t("extras.cutscenesCard")}
          </p>
          <h1>{i18n.t("extras.cutscenesTitle")}</h1>
          <p className="lede">{i18n.t("extras.cutscenesLede")}</p>
          <div className="page-stats" data-testid="cutscene-stats">
            {i18n.t("extras.cutscenesStats", {
              groups: formatUnit(i18n, "groups", groups.length),
              clips: formatUnit(
                i18n,
                "clips",
                new Set([...pairs.values()].filter(Boolean)).size,
              ),
              videos: formatUnit(i18n, "videos", rest.length),
            })}
          </div>
        </header>

        {!manifest ? (
          <p className="video-note" data-testid="cutscene-manifest" data-status={status}>
            {status === "error"
              ? i18n.t("video.manifestError")
              : i18n.t("extras.cutsceneWait")}
          </p>
        ) : (
          <>
            <section className="cutscene-search-block">
              <input
                type="search"
                className="search-input"
                data-testid="cutscene-search"
                value={query}
                placeholder={i18n.t("extras.cutsceneSearch")}
                aria-label={i18n.t("extras.cutsceneSearchLabel")}
                onChange={(event) => setQuery(event.target.value)}
              />
              <p className="search-summary" data-testid="cutscene-search-summary">
                {summary}
              </p>
              {selection ? (
                <section
                  className="cutscene-selection"
                  data-testid="cutscene-selection"
                  data-group={selection.group}
                  data-lang={selection.lang}
                  data-time={String(selection.start)}
                >
                  <header className="cutscene-selection-head">
                    <h2>{i18n.t("extras.cutsceneSelection")}</h2>
                    <span className="cutscene-meta">
                      <code>{selection.group}</code> ·{" "}
                      {languageLabel(selection.lang)} ·{" "}
                      {formatCueTime(selection.start)}
                    </span>
                  </header>
                  <p className="cutscene-hit-text">{selection.text}</p>
                  {selectionClip ? (
                    <VideoPlayer
                      testId="cutscene-hit-player"
                      clip={selectionClip}
                      subtitleKey={selection.group}
                      startAt={selection.start}
                      label={i18n.t("extras.cutsceneSelectionNote", {
                        clip: selectionClip,
                        time: formatCueTime(selection.start),
                      })}
                    />
                  ) : (
                    <p
                      className="video-note"
                      data-testid="cutscene-no-video"
                      data-group={selection.group}
                    >
                      {i18n.t("extras.cutsceneNoVideo", {
                        group: selection.group,
                      })}
                    </p>
                  )}
                </section>
              ) : null}
              {hits.length > 0 ? (
                <div className="cutscene-hits">
                  {hits.map((hit) => (
                    <button
                      type="button"
                      key={`${hit.group}:${hit.lang}:${hit.start}`}
                      className="cutscene-hit"
                      data-testid="cutscene-hit"
                      data-group={hit.group}
                      data-lang={hit.lang}
                      data-time={String(hit.start)}
                      onClick={() => setSelection(hit)}
                    >
                      <span className="cutscene-hit-meta">
                        <code>{hit.group}</code> · {languageLabel(hit.lang)} ·{" "}
                        {formatCueTime(hit.start)}
                      </span>
                      <span className="cutscene-hit-text">{hit.text}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="cutscene-library">
              <h2 className="section-title">
                {i18n.t("extras.cutsceneGroups")}
              </h2>
              <div className="cutscene-list">
                {groups.map((group) => (
                  <CutsceneRow
                    key={group}
                    manifest={manifest}
                    group={group}
                    clip={pairs.get(group) ?? null}
                  />
                ))}
              </div>
            </section>

            <section className="cutscene-rest-section">
              <h2 className="section-title">{i18n.t("extras.cutsceneRest")}</h2>
              <p className="lede">{i18n.t("extras.cutsceneRestLede")}</p>
              <div className="cutscene-rest-list">
                {rest.map((clip) => (
                  <RestClip key={clip} manifest={manifest} clip={clip} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <aside className="context" aria-label={i18n.t("extras.cutsceneDetailsAria")}>
        <section className="panel">
          <h2>{i18n.t("extras.cutsceneSources")}</h2>
          <p>{i18n.t("extras.cutsceneSourcesText")}</p>
          <p>{i18n.t("extras.cutsceneSourcesHint")}</p>
        </section>
      </aside>
    </>
  );
}
