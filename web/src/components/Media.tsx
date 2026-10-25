import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadMediaManifest, mediaUrl, pickAudio, pickImage, type MediaAsset } from "../data/media";

type MediaProps = {
  readonly id: string;
  readonly kind?:
    | "auto"
    | "image"
    | "viewer"
    | "avatar"
    | "osAvatar"
    | "sticker"
    | "illustration"
    | "logo";
  readonly alt?: string;
  readonly className?: string;
  /** Skip the inline 3:2 game frame and keep the asset's own aspect ratio. */
  readonly natural?: boolean;
  /** Shown instead of nothing when the manifest has no file for `id`. */
  readonly fallback?: ReactNode;
};

/** Game inline images use a 240x160 (3:2) frame scaled by the texture ratio. */
const INLINE_BASE_RATIO = 1.5;
const INLINE_MAX_HEIGHT = 560;

function useImage(id: string, kind: NonNullable<MediaProps["kind"]>): MediaAsset | null {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  useEffect(() => {
    let active = true;
    loadMediaManifest()
      .then((manifest) => {
        if (active) {
          setAsset(pickImage(manifest, id, kind));
        }
      })
      .catch(() => {
        if (active) {
          setAsset(null);
        }
      });
    return () => {
      active = false;
    };
  }, [id, kind]);
  return asset;
}

export function MediaImage({
  id,
  kind = "auto",
  alt,
  className,
  natural = false,
  fallback,
}: MediaProps) {
  const asset = useImage(id, kind);
  if (!asset) {
    return <>{fallback}</>;
  }
  const stretch =
    !natural &&
    kind !== "avatar" &&
    kind !== "osAvatar" &&
    kind !== "sticker" &&
    kind !== "logo" &&
    kind !== "illustration" &&
    asset.w &&
    asset.h;
  const aspect = stretch ? INLINE_BASE_RATIO * (asset.w! / asset.h!) : null;
  return (
    <img
      className={`${className ?? "media-image"}${stretch ? " media-stretched" : ""}`}
      src={mediaUrl(asset.file)}
      alt={alt ?? id}
      loading="lazy"
      decoding="async"
      style={
        aspect
          ? {
              aspectRatio: String(Number(aspect.toFixed(4))),
              width: `min(100%, ${Math.round(INLINE_MAX_HEIGHT * aspect)}px)`,
            }
          : undefined
      }
    />
  );
}

export function MediaAudio({
  id,
  kind,
  label,
}: {
  readonly id: string;
  readonly kind: "sound" | "bgm";
  readonly label?: string;
}) {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  useEffect(() => {
    let active = true;
    loadMediaManifest()
      .then((manifest) => {
        if (active) {
          setAsset(pickAudio(manifest, id, kind));
        }
      })
      .catch(() => {
        if (active) {
          setAsset(null);
        }
      });
    return () => {
      active = false;
    };
  }, [id, kind]);
  if (!asset) {
    return null;
  }
  return (
    <span className="media-audio-wrap">
      {label ? <span className="media-audio-label">{label}</span> : null}
      <audio
        className="media-audio"
        src={mediaUrl(asset.file)}
        controls
        preload="metadata"
        aria-label={label ?? id}
      />
    </span>
  );
}
