export interface MediaAsset {
  readonly file: string;
  readonly w?: number;
  readonly h?: number;
}

export interface MediaManifest {
  readonly images: Record<string, readonly MediaAsset[]>;
  readonly avatars: Record<string, MediaAsset>;
  readonly illustrations: Record<string, MediaAsset>;
  readonly covers: Record<string, MediaAsset>;
  readonly galleryIcons: Record<string, MediaAsset>;
  readonly oaAssets: Record<string, MediaAsset>;
  readonly videos: Record<string, MediaAsset>;
  readonly movies: Record<string, MediaAsset>;
  readonly logos?: Record<string, MediaAsset>;
  readonly audio: {
    readonly sound?: Record<string, MediaAsset>;
    readonly bgm?: Record<string, MediaAsset>;
  };
}

let manifestPromise: Promise<MediaManifest> | null = null;

export function loadMediaManifest(): Promise<MediaManifest> {
  manifestPromise ??= fetch("/media/manifest.json").then(async (response) => {
    if (!response.ok) {
      throw new Error(`media manifest ${response.status}`);
    }
    return (await response.json()) as MediaManifest;
  });
  return manifestPromise;
}

export function mediaUrl(file: string): string {
  return `/media/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function stripExtension(value: string): string {
  return value.replace(/\.(png|jpe?g|webp|gif)$/i, "");
}

export function pickImage(
  manifest: MediaManifest,
  id: string,
  kind: "auto" | "image" | "viewer" | "avatar" | "illustration" | "logo" = "auto",
): MediaAsset | null {
  const key = stripExtension(id.trim());
  if (!key) {
    return null;
  }
  if (kind === "avatar") {
    return manifest.avatars[key] ?? { file: `avatars/${key}.png` };
  }
  if (kind === "illustration") {
    return manifest.illustrations[`illustration_${key}`] ?? manifest.illustrations[key] ?? null;
  }
  if (kind === "logo") {
    return manifest.logos?.[key] ?? manifest.galleryIcons[key] ?? null;
  }
  if (kind === "image") {
    // Gallery/OS images first.  Manifest illustrations also carry aliases
    // such as neko001_001, but that alias points at a skin illustration;
    // the gallery item with the same id is a cover.
    return (
      manifest.images[key]?.[0] ??
      manifest.covers[key] ??
      manifest.oaAssets[key] ??
      manifest.galleryIcons[key] ??
      manifest.illustrations[`illustration_${key}`] ??
      manifest.illustrations[key] ??
      null
    );
  }
  if (kind === "viewer") {
    return (
      manifest.covers[key] ??
      manifest.images[key]?.[0] ??
      manifest.oaAssets[key] ??
      manifest.illustrations[`illustration_${key}`] ??
      manifest.illustrations[key] ??
      null
    );
  }
  return (
    manifest.illustrations[`illustration_${key}`] ??
    manifest.illustrations[key] ??
    manifest.covers[key] ??
    manifest.oaAssets[key] ??
    manifest.galleryIcons[key] ??
    manifest.images[key]?.[0] ??
    null
  );
}

export function pickVideo(
  manifest: MediaManifest,
  id: string,
): MediaAsset | null {
  const key = stripExtension(id.trim());
  return manifest.movies[key] ?? manifest.videos[key] ?? null;
}

export function pickAudio(
  manifest: MediaManifest,
  id: string,
  kind: "sound" | "bgm",
): MediaAsset | null {
  const key = stripExtension(id.split(",")[0]?.trim() ?? "");
  if (!key) {
    return null;
  }
  const bucket = kind === "bgm" ? manifest.audio.bgm : manifest.audio.sound;
  return bucket?.[key] ?? null;
}
