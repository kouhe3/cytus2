/**
 * Types for the canonical DB projection (`build/spa/data.json`) and its text
 * store. They mirror `schema/*.schema.json`; they do not define a second model.
 */

export type Lang = "en" | "ja" | "zh-Hant" | "ko" | "zh-Hans";

export type LocalizedText = Record<Lang, string | null>;

export type Difficulty =
  | "Easy"
  | "Hard"
  | "Chaos"
  | "Glitch"
  | "Crash"
  | "Dream"
  | "Drop";

export type ReadingTier = "free" | "paid" | "side";

export type ReadingEntityType = "im_post" | "os_log" | "oa_document" | "story_node";

export interface ProvenanceEntry {
  kind: string;
  locator: string;
  note?: string;
}

export interface LevelLock {
  character: string;
  level: number;
}

export interface BaseEntity {
  readonly id: string;
  readonly type: string;
}

export interface ImPostEntity extends BaseEntity {
  readonly type: "im_post";
  readonly game_id: string;
  readonly author: string;
  readonly avatar: string;
  readonly order: number;
  readonly titles: LocalizedText;
  readonly likes: number;
  readonly reply_count: number;
  readonly story_gate: string | null;
  readonly topic_gate: string | null;
  readonly level_locks: LevelLock[];
  readonly attachments: string[];
  readonly charts: string[];
  readonly text_ref: string;
  readonly missing_languages: Lang[];
  readonly provenance: ProvenanceEntry[];
}

export interface OsLogEntity extends BaseEntity {
  readonly type: "os_log";
  readonly game_id: string;
  readonly file: string;
  readonly folder_id: string | null;
  readonly chapter_id: string;
  readonly index: number;
  readonly date: string;
  readonly category: string;
  readonly log_type: number;
  readonly names: LocalizedText;
  readonly file_lock: string | null;
  readonly level_locks: LevelLock[];
  readonly movies: string[];
  readonly text_ref: string;
  readonly missing_languages: Lang[];
  readonly provenance: ProvenanceEntry[];
}

export interface ChartEntity extends BaseEntity {
  readonly type: "chart";
  readonly game_id: string;
  readonly song_id: string;
  readonly difficulty: Difficulty;
  readonly level: string;
  readonly need_unlock: boolean;
  readonly music_id: string;
  readonly provenance: ProvenanceEntry[];
}

export interface SongEntity extends BaseEntity {
  readonly type: "song";
  readonly game_id: string;
  readonly name: string | null;
  readonly artist: string | null;
  readonly pack_id: string;
  readonly category: string | null;
  readonly search_terms: string[];
}

export interface CharacterEntity extends BaseEntity {
  readonly type: "character";
  readonly game_id: string;
  readonly name: string;
  readonly avatar_id: string;
  readonly pack_id: string;
}

export interface SpoilerAlertEntity extends BaseEntity {
  readonly type: "spoiler_alert";
  readonly game_id: string;
  readonly character: string;
  readonly threshold: number;
  readonly conditions: LevelLock[];
}

export interface ReadingOrderRow extends BaseEntity {
  readonly type: "reading_order";
  readonly entity_id: string;
  readonly entity_type: ReadingEntityType;
  readonly stage: number;
  readonly level_gate: number;
  readonly original_level: number;
  readonly tier: ReadingTier;
  readonly thread: string | null;
  readonly level_locks: LevelLock[];
  readonly version: string | null;
  readonly version_order: number[];
  readonly chapter: string | null;
  readonly chapter_id: string | null;
  readonly chapter_order: number | null;
  readonly chapter_staged: boolean;
  readonly spoiler_alert: string | null;
  readonly spoiler_conditions: LevelLock[];
  readonly in_game_order: number;
  readonly order: number;
}

export interface Edge {
  readonly source: string;
  readonly relation: string;
  readonly target: string;
  readonly provenance?: ProvenanceEntry[];
}

export interface Projection {
  readonly schemaVersion: number;
  readonly counts: Record<string, number>;
  readonly difficulties: Difficulty[];
  readonly entities: Record<string, BaseEntity[]>;
  readonly edges: Edge[];
}

export interface TextBlock {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface TextRecord {
  readonly ref: string;
  readonly lang: Lang;
  readonly text: string | null;
  readonly blocks: TextBlock[] | null;
  readonly missing?: boolean;
}

export interface TextSummary {
  readonly languages: Lang[];
  readonly refs: Record<string, Partial<Record<Lang, string>>>;
}

export interface Database {
  readonly projection: Projection;
  readonly entityById: Map<string, BaseEntity>;
  readonly entitiesByType: Map<string, BaseEntity[]>;
  readonly timelineOrders: ReadingOrderRow[];
  readonly readingOrderByEntity: Map<string, ReadingOrderRow>;
  readonly textRefs: TextSummary["refs"];
  readonly characterById: Map<string, CharacterEntity>;
  readonly spoilerById: Map<string, SpoilerAlertEntity>;
  readonly chartsBySong: Map<string, ChartEntity[]>;
  readonly edgesFrom: Map<string, Edge[]>;
  readonly edgesTo: Map<string, Edge[]>;
  /** chart id -> entity ids whose `unlocks_chart` edge points at it */
  readonly unlockSourceIds: Map<string, string[]>;
  /** chart id -> entity ids that list the chart in `charts`/`chart_ids` */
  readonly chartReferrers: Map<string, string[]>;
}
