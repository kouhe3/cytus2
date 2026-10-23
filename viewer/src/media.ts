import { useEffect, useState } from "react";

export const MEDIA_BASE = import.meta.env.BASE_URL + "media/";

export interface MediaEntry {
  file: string;
  w?: number;
  h?: number;
  fps?: number;
  frames?: number;
  bundle?: string;
  bytes?: number;
  seconds?: number;
  channels?: number;
  hz?: number;
  /** 影片是否自带音轨（video_endplay_* / video_oasystem_* 只有画面，声音由曲目另播） */
  hasAudio?: boolean;
  placeholder?: boolean;
  full?: string;
  fullW?: number;
  fullH?: number;
}

export interface MediaManifest {
  avatars?: Record<string, MediaEntry>;
  illustrations?: Record<string, MediaEntry>;
  titles?: Record<string, MediaEntry>;
  covers?: Record<string, MediaEntry>;
  galleryIcons?: Record<string, MediaEntry>;
  logos?: Record<string, MediaEntry>;
  subtitles?: Record<string, Record<string, { file: string; cues: number }>>;
  /** OA 物件面板图 / 物件主图 / 角色 LOGO（来自 bin/Data 的 UI 贴图） */
  oaAssets?: Record<string, MediaEntry>;
  images?: Record<string, MediaEntry[]>;
  videos?: Record<string, MediaEntry>;
  /** 结场影片 + 曲目音轨的合成版本，key = `<视频>|<曲目>` */
  videoAudio?: Record<string, MediaEntry & { song?: string }>;
  movies?: Record<string, MediaEntry>;
  audio?: { sound?: Record<string, MediaEntry>; bgm?: Record<string, MediaEntry> };
}

let cached: Promise<MediaManifest> | null = null;

export function loadManifest(): Promise<MediaManifest> {
  if (!cached) {
    cached = fetch(MEDIA_BASE + "manifest.json")
      .then((res) => (res.ok ? (res.json() as Promise<MediaManifest>) : ({} as MediaManifest)))
      .catch(() => ({}) as MediaManifest);
  }
  return cached;
}

export function useManifest(): MediaManifest | null {
  const [manifest, setManifest] = useState<MediaManifest | null>(null);
  useEffect(() => {
    let alive = true;
    loadManifest().then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
}

/** `aios1101_19201280` -> `aios1101` */
export function imageKey(id: string): string {
  return id.replace(/_\d{6,}$/, "");
}

export function findImage(manifest: MediaManifest | null, id: string, scope: "os" | "im"): MediaEntry | undefined {
  const key = imageKey(id);
  const entry = manifest?.images?.[key];
  if (!entry || entry.length === 0) return undefined;
  const prefix = scope === "os" ? "os-attachments/" : "im-attachments/";
  return entry.find((e) => e.file.startsWith(prefix)) ?? entry[0];
}

export function findIllustration(manifest: MediaManifest | null, id: string): MediaEntry | undefined {
  return manifest?.illustrations?.[id];
}

/** 备份数据库 Format 3 的曲绘（galleryimageviewer，纹理名 = FileLocation） */
export function findCover(manifest: MediaManifest | null, id: string): MediaEntry | undefined {
  return manifest?.covers?.[id];
}

/** 字幕 key 的等价候选：`FinalBossStage` 与分片字幕 `FinalBossStage_1/2` 视为同一段影片 */
export function subtitleKeys(manifest: MediaManifest | null, id: string): string[] {
  const all = manifest?.subtitles;
  if (!all) return [];
  if (all[id]) return [id];
  const base = id.replace(/_\d+$/, "");
  return Object.keys(all)
    .filter((k) => k !== id && k.replace(/_\d+$/, "") === base)
    .sort();
}

function pickLang(
  all: Record<string, { file: string; cues: number }> | undefined,
  lang?: string,
): { lang: string; file: string; cues: number } | undefined {
  if (!all) return undefined;
  const order = [lang, "zh-Hans", "zh-Hant", "en", "ja", "ko"].filter(Boolean) as string[];
  for (const code of order) {
    const hit = all[code];
    if (hit) return { lang: code, ...hit };
  }
  const first = Object.entries(all)[0];
  return first ? { lang: first[0], ...first[1] } : undefined;
}

/** 该影片的全部字幕变体（同一段动画可能有多份分片字幕，例如终战 1/2） */
export function findSubtitles(
  manifest: MediaManifest | null,
  id: string,
  lang?: string,
): { key: string; lang: string; file: string; cues: number }[] {
  return subtitleKeys(manifest, id).flatMap((key) => {
    const hit = pickLang(manifest?.subtitles?.[key], lang);
    return hit ? [{ key, ...hit }] : [];
  });
}

/** 过场影片字幕（srtfile_*.ab → WebVTT），按当前语言优先，缺了回退简中/英文 */
export function findSubtitle(
  manifest: MediaManifest | null,
  id: string,
  lang?: string,
): { key: string; lang: string; file: string; cues: number } | undefined {
  return findSubtitles(manifest, id, lang)[0];
}

/** 带配乐的结场影片（`<视频>|<曲目>`），没有就回退到无声原片 */
export function findVideoWithSong(
  manifest: MediaManifest | null,
  video: string,
  song?: string,
): { entry: MediaEntry; labeled: boolean } | undefined {
  if (song) {
    const hit = manifest?.videoAudio?.[`${video}|${song}`];
    if (hit) return { entry: hit, labeled: true };
  }
  const silent = findMovie(manifest, video);
  return silent ? { entry: silent, labeled: false } : undefined;
}

export function findMovie(manifest: MediaManifest | null, id: string): MediaEntry | undefined {
  return manifest?.movies?.[id] ?? manifest?.videos?.[id];
}

export function findSound(manifest: MediaManifest | null, kind: "sound" | "bgm", name: string): MediaEntry | undefined {
  const table = manifest?.audio?.[kind];
  if (!table) return undefined;
  if (table[name]) return table[name];
  const lower = name.toLowerCase();
  const hit = Object.keys(table).find((k) => k.toLowerCase() === lower);
  return hit ? table[hit] : undefined;
}
