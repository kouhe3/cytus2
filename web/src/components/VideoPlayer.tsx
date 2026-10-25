import { useEffect, useRef, useState } from "react";
import { useI18n } from "../data/i18n";
import { useLanguage } from "../data/language";
import {
  mediaUrl,
  pickVideo,
  type MediaAsset,
  type SubtitleTrack,
} from "../data/media";
import { LANGUAGES } from "../data/messages";
import { useMediaManifest } from "../data/useMedia";
import type { Lang } from "../types";

const MP4_SUFFIX = /\.mp4$/i;

/**
 * Manifest keys are bare clip ids. `story_node.movie_files` keep the `.mp4`
 * suffix, and gallery/OS cutscene references are already bare; normalising
 * here means every caller can pass either form.
 */
export function normalizeClipId(clip: string): string {
  return clip.replace(MP4_SUFFIX, "").trim();
}

export interface VideoPlayerProps {
  /** Bare manifest key; a trailing `.mp4` is stripped. */
  readonly clip: string;
  /** Exact subtitle group key. Defaults to the clip id; `null` never attaches a track. */
  readonly subtitleKey?: string | null;
  /** Defaults to the sidebar language. */
  readonly lang?: Lang;
  /** Seconds to seek to once metadata is available (subtitle-cue jumps). */
  readonly startAt?: number;
  /** Muxed variant key `<clip>|<song>` from `manifest.videoAudio`. */
  readonly audioKey?: string;
  /** Accessible name and caption text. */
  readonly label?: string;
  /** `note` explains absent media; `hide` keeps the inline-movie/OA behaviour. */
  readonly missing?: "note" | "hide";
  /** Optional test id for the figure root; the `<video>` is always `video-player`. */
  readonly testId?: string;
}

/**
 * One video component for every archive surface. It resolves through the media
 * manifest, attaches the active language's VTT when that exact group has one,
 * and never autoplays.
 */
export function VideoPlayer({
  clip,
  subtitleKey,
  lang,
  startAt,
  audioKey,
  label,
  missing = "note",
  testId,
}: VideoPlayerProps) {
  const i18n = useI18n();
  const { lang: activeLang } = useLanguage();
  const { status, manifest } = useMediaManifest();
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const clipId = normalizeClipId(clip);
  const resolvedLang = lang ?? activeLang;
  const langLabel =
    LANGUAGES.find((option) => option.code === resolvedLang)?.title ?? resolvedLang;
  const hide = missing === "hide";

  const muxed: MediaAsset | null =
    audioKey && manifest?.videoAudio ? manifest.videoAudio[audioKey] ?? null : null;
  const asset: MediaAsset | null =
    muxed ?? (manifest ? pickVideo(manifest, clipId) : null);

  const subtitleGroup = subtitleKey === null ? null : subtitleKey ?? clipId;
  const groupTracks =
    subtitleGroup && manifest?.subtitles
      ? manifest.subtitles[subtitleGroup]
      : undefined;
  const track: SubtitleTrack | null = groupTracks?.[resolvedLang] ?? null;
  /** `videos` is the only map with the flag; aliases and old manifests stay quiet. */
  const silent = manifest?.videos?.[clipId]?.hasAudio === false;

  useEffect(() => {
    setFailed(false);
  }, [asset?.file, clipId]);

  useEffect(() => {
    if (startAt === undefined) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const seek = () => {
      video.currentTime = startAt;
    };
    if (video.readyState >= 1) {
      seek();
      return;
    }
    video.addEventListener("loadedmetadata", seek, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", seek);
    };
  }, [startAt, asset?.file, failed]);

  if (!asset || failed) {
    // Inline movies and OA scenes rendered nothing when the export was
    // missing, and they had no playback-error surface of their own.
    if (hide) {
      return null;
    }
    if (!failed && status === "loading") {
      return null;
    }
    const reason = failed ? "playback" : status === "error" ? "manifest" : "missing";
    return (
      <p
        className="video-note"
        data-testid="video-missing"
        data-clip={clipId}
        data-reason={reason}
      >
        {reason === "playback"
          ? i18n.t("video.playbackError", { clip: clipId })
          : reason === "manifest"
            ? i18n.t("video.manifestError")
            : i18n.t("video.missing", { clip: clipId })}
      </p>
    );
  }

  if (hide) {
    return (
      <video
        className="media-video"
        data-testid="video-player"
        data-clip={clipId}
        src={mediaUrl(asset.file)}
        controls
        preload="metadata"
        aria-label={label ?? clipId}
      />
    );
  }

  return (
    <figure className="video-figure" data-testid={testId} data-clip={clipId}>
      <div className="video-frame">
        <video
          ref={videoRef}
          className="video-el"
          data-testid="video-player"
          data-clip={clipId}
          src={mediaUrl(asset.file)}
          controls
          preload="metadata"
          aria-label={label ?? clipId}
          onError={() => setFailed(true)}
        >
          {track ? (
            <track
              key={`${resolvedLang}:${track.file}`}
              kind="subtitles"
              default
              srcLang={resolvedLang}
              label={langLabel}
              src={mediaUrl(track.file)}
              data-testid="video-track"
            />
          ) : null}
        </video>
      </div>
      {label ? <figcaption className="video-caption">{label}</figcaption> : null}
      {silent ? (
        <p className="video-note" data-testid="video-no-audio" data-clip={clipId}>
          {i18n.t("video.noAudio")}
        </p>
      ) : null}
      {subtitleGroup && !track ? (
        <p
          className="video-note"
          data-testid="video-subtitle-missing"
          data-clip={clipId}
          data-lang={resolvedLang}
        >
          {i18n.t(groupTracks ? "video.subtitleMissing" : "video.noSubtitle", {
            lang: langLabel,
          })}
        </p>
      ) : null}
    </figure>
  );
}
