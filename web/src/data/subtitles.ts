import { mediaUrl, type MediaManifest } from "./media";
import { LANGUAGES } from "./messages";
import type { Lang } from "../types";

/**
 * Cutscene subtitle text only exists in the exported WebVTT files
 * (`subs/<group>.<lang>.vtt`); the canonical text store has voice lines, not
 * cutscene dialogue. The media manifest lists `{file, cues}` per language, so
 * the body has to be fetched and parsed in the browser — once per page, lazily,
 * and only when someone searches.
 */

export interface SubtitleCue {
  /** Seconds from the start of the clip. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Group -> language -> cues, mirroring `manifest.subtitles`. */
export type SubtitleIndex = Record<
  string,
  Partial<Record<Lang, readonly SubtitleCue[]>>
>;

export interface SubtitleHit {
  readonly group: string;
  readonly lang: Lang;
  readonly start: number;
  readonly text: string;
}

const TIMESTAMP = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
const INLINE_TAG = /<[^>]*>/g;
const CONCURRENCY = 8;

function toSeconds(value: string): number {
  const match = TIMESTAMP.exec(value);
  if (!match) {
    return 0;
  }
  const [, hours, minutes, seconds, millis] = match;
  const total =
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis) / 1000;
  return Math.round(total * 100) / 100;
}

/**
 * WebVTT as the media export writes it (`export_media.py` converts SRT cues to
 * `HH:MM:SS.mmm`). Cue bodies keep their line breaks, inline `<...>` styling is
 * dropped, and `WEBVTT`/`NOTE` blocks fall through because they have no arrow.
 */
export function parseVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }
    const arrow = line.indexOf("-->");
    if (arrow === -1) {
      index += 1;
      continue;
    }
    const start = toSeconds(line.slice(0, arrow));
    const end = toSeconds(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "");
    const body: string[] = [];
    index += 1;
    let next = lines[index];
    while (next !== undefined && next.trim() !== "") {
      body.push(next.trim());
      index += 1;
      next = lines[index];
    }
    const cue = body.join("\n").replace(INLINE_TAG, "").trim();
    if (cue) {
      cues.push({ start, end, text: cue });
    }
  }
  return cues;
}

async function buildIndex(manifest: MediaManifest): Promise<SubtitleIndex> {
  const jobs: { group: string; lang: Lang; file: string }[] = [];
  for (const [group, tracks] of Object.entries(manifest.subtitles ?? {})) {
    for (const option of LANGUAGES) {
      const track = tracks[option.code];
      if (track) {
        jobs.push({ group, lang: option.code, file: track.file });
      }
    }
  }

  const index: SubtitleIndex = {};
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      if (!job) {
        return;
      }
      const response = await fetch(mediaUrl(job.file));
      if (!response.ok) {
        throw new Error(`subtitle ${job.file} ${response.status}`);
      }
      const cues = parseVtt(await response.text());
      (index[job.group] ??= {})[job.lang] = cues;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()),
  );
  return index;
}

let indexPromise: Promise<SubtitleIndex> | null = null;

/**
 * One fetch pass per page lifetime. A rejected promise is dropped so a later
 * search can retry instead of staying broken for the session.
 */
export function loadSubtitleIndex(
  manifest: MediaManifest,
): Promise<SubtitleIndex> {
  indexPromise ??= buildIndex(manifest).catch((error: unknown) => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
}

/**
 * Case-insensitive substring search over every cue in every language. Groups
 * yield at most one hit (the first matching cue in the preferred language) so a
 * common word cannot flood the list with hundreds of rows. The sidebar language
 * is searched first, then the remaining languages in `LANGUAGES` order; hits
 * keep that preference when sorted.
 */
export function searchSubtitleIndex(
  index: SubtitleIndex,
  query: string,
  activeLang?: Lang,
): SubtitleHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const order: Lang[] = [
    ...(activeLang ? [activeLang] : []),
    ...LANGUAGES.map((option) => option.code).filter(
      (code) => code !== activeLang,
    ),
  ];
  const hits: SubtitleHit[] = [];
  for (const [group, tracks] of Object.entries(index)) {
    for (const lang of order) {
      const cue = tracks[lang]?.find((entry) =>
        entry.text.toLowerCase().includes(needle),
      );
      if (cue) {
        hits.push({ group, lang, start: cue.start, text: cue.text });
        break;
      }
    }
  }
  return hits.sort(
    (left, right) =>
      Number(left.lang !== activeLang) - Number(right.lang !== activeLang) ||
      (left.group < right.group ? -1 : left.group > right.group ? 1 : 0),
  );
}
