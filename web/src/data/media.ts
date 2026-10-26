import type { Lang } from "../types";

export interface MediaAsset {
  readonly file: string;
  readonly w?: number;
  readonly h?: number;
  /** `videos` and `songSelect` entries carry this flag; `movies` aliases never do. */
  readonly hasAudio?: boolean;
  readonly song?: string;
  /**
   * The export is a placeholder the developers shipped (the Branching OS
   * ending attachments render `DUMMY`); showing it is expected data.
   */
  readonly placeholder?: boolean;
}

export interface SongSelectClip extends MediaAsset {
  readonly bundle?: string;
  readonly fps?: number;
  readonly frames?: number;
  readonly bytes?: number;
  readonly mode?: "normal" | "trueEnd";
  readonly pack?: string;
  readonly variant?: string;
  readonly inSceneList?: boolean;
  readonly duplicateOf?: readonly string[];
  /** Normal clips whose bytes equal this clip (e.g. Vanessa -> Miku). */
  readonly contentMatches?: readonly string[];
}

export interface SongSelectManifest {
  readonly normal?: Record<string, SongSelectClip>;
  readonly trueEnd?: Record<string, SongSelectClip>;
  readonly sceneOrder?: readonly string[];
}

export interface SubtitleTrack {
  readonly file: string;
  readonly cues: number;
}

export interface MediaManifest {
  readonly images: Record<string, readonly MediaAsset[]>;
  readonly avatars: Record<string, MediaAsset>;
  /** OS phone transcripts: sender icons keyed by the `msgs` Avatar id. */
  readonly osAvatars?: Record<string, MediaAsset>;
  /** OS phone transcripts: stickers keyed by the `msgs` Image id. */
  readonly osStickers?: Record<string, MediaAsset>;
  readonly illustrations: Record<string, MediaAsset>;
  /** Song jackets, keyed by song id: the gallery viewer's 3:2 / 2.71:1 art. */
  readonly covers: Record<string, MediaAsset>;
  /** Per-song cover art from `split_base_assets.apk` (`assets/bin/Data`). */
  readonly songCovers?: Record<string, MediaAsset>;
  readonly galleryIcons: Record<string, MediaAsset>;
  readonly oaAssets: Record<string, MediaAsset>;
  readonly videos: Record<string, MediaAsset>;
  readonly movies: Record<string, MediaAsset>;
  /** Character backgrounds used by the song-select screens. */
  readonly songSelect?: SongSelectManifest;
  readonly logos?: Record<string, MediaAsset>;
  /** VTT files keyed by subtitle group, then by language. */
  readonly subtitles?: Record<string, Partial<Record<Lang, SubtitleTrack>>>;
  /** Muxed variants keyed `<clip>|<song>`. */
  readonly videoAudio?: Record<string, MediaAsset>;
  readonly audio: {
    readonly bgm?: Record<string, MediaAsset>;
    readonly sound?: Record<string, MediaAsset>;
  };
}

let manifestPromise: Promise<MediaManifest> | null = null;

export function loadMediaManifest(): Promise<MediaManifest> {
  manifestPromise ??= fetch("/media/manifest.json")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`media manifest ${response.status}`);
      }
      return (await response.json()) as MediaManifest;
    })
    .catch((error: unknown) => {
      // A rejected promise must not stay cached: the manifest may come back
      // after a rebuild, and the player surfaces the failure as a note.
      manifestPromise = null;
      throw error;
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
  kind:
    | "auto"
    | "image"
    | "viewer"
    | "avatar"
    | "osAvatar"
    | "sticker"
    | "illustration"
    | "logo"
    | "cover" = "auto",
): MediaAsset | null {
  const key = stripExtension(id.trim());
  if (!key) {
    return null;
  }
  if (kind === "avatar") {
    return manifest.avatars[key] ?? { file: `avatars/${key}.png` };
  }
  if (kind === "osAvatar") {
    // The asset bundle names these lowercase (`linda_os_01`) while the chat
    // payload keeps its own casing (`Linda_os_01`).
    return manifest.osAvatars?.[key.toLowerCase()] ?? null;
  }
  if (kind === "sticker") {
    return manifest.osStickers?.[key] ?? null;
  }
  if (kind === "illustration") {
    return manifest.illustrations[`illustration_${key}`] ?? manifest.illustrations[key] ?? null;
  }
  if (kind === "logo") {
    return manifest.logos?.[key] ?? manifest.galleryIcons[key] ?? null;
  }
  if (kind === "cover") {
    // `songCovers` is the per-song jacket the game ships in
    // `assets/bin/Data/<hash>` (the square 1024² art).  `covers` is the
    // backup-database texture for the 22 base-game songs — a square canvas
    // holding horizontally squeezed art that only the gallery viewer stretches
    // back, so it is the fallback, not the first choice.  The manifest's
    // illustration aliases reuse song ids (cherry001_001 ->
    // illustration_cherry001_s001), so falling through to `illustrations`
    // puts a gallery illustration under the cover.
    return manifest.songCovers?.[key] ?? manifest.covers[key] ?? null;
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
