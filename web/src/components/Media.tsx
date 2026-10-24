import { useEffect, useState } from "react";
import { loadMediaManifest, mediaUrl, pickImage, pickVideo, type MediaAsset } from "../data/media";

type MediaProps = {
  readonly id: string;
  readonly kind?: "auto" | "image" | "viewer" | "avatar" | "illustration";
  readonly alt?: string;
  readonly className?: string;
};

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

export function MediaImage({ id, kind = "auto", alt, className }: MediaProps) {
  const asset = useImage(id, kind);
  if (!asset) {
    return null;
  }
  return (
    <img
      className={className ?? "media-image"}
      src={mediaUrl(asset.file)}
      alt={alt ?? id}
      loading="lazy"
      decoding="async"
    />
  );
}

export function MediaVideo({ id, alt }: { readonly id: string; readonly alt?: string }) {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  useEffect(() => {
    let active = true;
    loadMediaManifest()
      .then((manifest) => {
        if (active) {
          setAsset(pickVideo(manifest, id));
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
  }, [id]);
  if (!asset) {
    return null;
  }
  return (
    <video
      className="media-video"
      src={mediaUrl(asset.file)}
      controls
      preload="metadata"
      aria-label={alt ?? id}
    />
  );
}
