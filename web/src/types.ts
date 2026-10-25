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

export type TimelineScope = "timeline" | "character" | "none";

export type ReadingBranch = "good_ending1" | "good_ending2" | "ending04";

export interface ProvenanceEntry {
  kind: string;
  locator: string;
  note?: string;
}

export interface LevelLock {
  character: string;
  level: number;
}

export interface ConditionEntry {
  readonly kind: string;
  readonly value: string;
}

export interface StoryBossStageRef {
  readonly entity_id: string | null;
  readonly raw: string;
  readonly status: string;
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
  readonly title_only: boolean;
  readonly removed_after_read: boolean;
  readonly level_locks: LevelLock[];
  readonly attachments: string[];
  readonly charts: string[];
  readonly text_ref: string;
  readonly missing_languages: Lang[];
  readonly provenance: ProvenanceEntry[];
}

export interface ImReplyEntity extends BaseEntity {
  readonly type: "im_reply";
  readonly game_id: string;
  readonly author: string;
  readonly avatar: string;
  readonly order: number;
  readonly post_id: string;
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
  readonly position: number;
  readonly level_lock_display: boolean;
  readonly log_type: number;
  readonly names: LocalizedText;
  readonly file_lock: string | null;
  readonly level_locks: LevelLock[];
  readonly movies: string[];
  /** First-open cutscene clip, a bare media-manifest key; absent on most logs. */
  readonly cutscene?: string;
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
  readonly expansion_pack_id?: string;
  readonly category: string | null;
  readonly search_terms: string[];
}

export interface ExpansionPackEntity extends BaseEntity {
  readonly type: "expansion_pack";
  readonly game_id: string;
  readonly name: string;
  readonly price: string;
  readonly icon: string;
  readonly box_id: string;
  readonly is_box_only: boolean;
  readonly is_pre_purchase: boolean;
  readonly order: number;
  readonly song_ids: string[];
  readonly character_ids: string[];
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

export interface OaCharacterEntity extends BaseEntity {
  readonly type: "oa_character";
  readonly game_id: string;
  readonly character_id: string;
  readonly name: string;
  readonly gallery_folder_id: string | null;
  readonly provenance: ProvenanceEntry[];
}

export interface OaObjectEntity extends BaseEntity {
  readonly type: "oa_object";
  readonly game_id: string;
  readonly character_id: string;
  readonly text_ref: string;
  readonly analyze_type_id: string | null;
  readonly analyze_type: number;
  readonly level_locks: LevelLock[];
  readonly conditions: ConditionEntry[];
  readonly provenance: ProvenanceEntry[];
}

export interface OaDocumentEntity extends BaseEntity {
  readonly type: "oa_document";
  readonly game_id: string;
  readonly character_id: string;
  readonly object_id: string | null;
  readonly mission_id: string | null;
  readonly text_ref: string;
  readonly digit_lock: string | null;
  readonly provenance: ProvenanceEntry[];
}

export interface OaDescriptionEntity extends BaseEntity {
  readonly type: "oa_description";
  readonly game_id: string;
  readonly character_id: string;
  readonly description_object_id: string;
  readonly weight: number;
  readonly event: number;
  readonly text_ref: string;
  readonly enable_level_locks: LevelLock[];
  readonly enable_conditions: ConditionEntry[];
  readonly disable_level_locks: LevelLock[];
  readonly disable_conditions: ConditionEntry[];
  readonly provenance: ProvenanceEntry[];
}

export interface GalleryFolderEntity extends BaseEntity {
  readonly type: "gallery_folder";
  readonly game_id: string;
  readonly name: string;
  readonly avatar_id: string | null;
  readonly provenance: ProvenanceEntry[];
}

/** OS timeline chapter (`osdata/chapters`); category 0 is main, 1 is collab. */
export interface ChapterEntity extends BaseEntity {
  readonly type: "chapter";
  readonly game_id: string;
  readonly name: string;
  readonly category: number;
  readonly provenance: ProvenanceEntry[];
}

/** OS timeline folder (`TimelineChapter.Folder`), not a Backup Database folder. */
export interface FolderEntity extends BaseEntity {
  readonly type: "folder";
  readonly game_id: string;
  readonly name: string;
  readonly provenance: ProvenanceEntry[];
}

export interface GalleryItemEntity extends BaseEntity {
  readonly type: "gallery_item";
  readonly game_id: string;
  readonly folder_id: string;
  readonly location: string;
  readonly name: string;
  readonly icon: string;
  readonly format: number;
  readonly kind: string;
  readonly size: [number, number] | null;
  readonly conditions: ConditionEntry[];
  readonly obtainable: boolean;
  readonly provenance: ProvenanceEntry[];
}

export interface StoryNodeEntity extends BaseEntity {
  readonly type: "story_node";
  readonly kind: "event" | "branch";
  readonly game_id: string;
  readonly names?: LocalizedText;
  readonly text_ref?: string;
  readonly class_name?: string;
  readonly actions?: string[];
  readonly steps?: string[];
  readonly topic_ids?: string[];
  readonly start_topic_id?: string | null;
  readonly end_topic_id?: string | null;
  readonly deleted_topic_id?: string | null;
  readonly trigger_os_id?: string | null;
  readonly trigger_topic_id?: string | null;
  readonly trigger_topics?: string[];
  readonly boss_stages?: StoryBossStageRef[];
  readonly gallery_ref?: string | null;
  readonly movie_files?: string[];
  readonly charts?: string[];
  readonly level?: number;
  readonly level_locks?: LevelLock[];
  readonly next?: string[];
  readonly node_type?: number;
  readonly order?: number;
  readonly position?: number;
  readonly source_file?: string;
  readonly state_id?: number;
  readonly state_value?: string;
  readonly provenance: ProvenanceEntry[];
}

export interface IllustrationEntity extends BaseEntity {
  readonly type: "illustration";
  readonly game_id: string;
  readonly character_id: string;
  readonly costume: string;
  readonly available: boolean;
  readonly asset_id: string;
  readonly description: string;
  readonly provenance: ProvenanceEntry[];
}

export interface BossStageEntity extends BaseEntity {
  readonly type: "boss_stage";
  readonly game_id: string;
  readonly display_name: string;
  readonly aliases: string[];
  readonly conditions: ConditionEntry[];
  readonly folder_id: string;
  readonly gallery_item_id: string;
  readonly provenance: ProvenanceEntry[];
}

export interface CapsoShopPackEntity extends BaseEntity {
  readonly type: "capso_shop_pack";
  readonly game_id: string;
  readonly name: string;
  readonly create_order: number;
  readonly icon_path: string;
  readonly default_price_string: string;
  readonly capso_price: number;
  readonly available_for_capso: boolean;
  readonly available_for_iap: boolean;
  readonly provenance: ProvenanceEntry[];
}

export interface CapsoShopItemEntity extends BaseEntity {
  readonly type: "capso_shop_item";
  readonly game_id: string;
  readonly pack_id: string;
  readonly item_id: string;
  readonly item_type: number;
  readonly kind: string;
  readonly position: number;
  readonly song_id?: string;
  readonly chart_ids?: string[];
  readonly illustration_id?: string;
  readonly tap_fx_id?: string;
  readonly provenance: ProvenanceEntry[];
}

export interface GachaMachineEntity extends BaseEntity {
  readonly type: "gacha_machine";
  readonly game_id: string;
  readonly name: string;
  readonly create_order: number;
  readonly icon_path: string;
  readonly default_price: string;
  readonly provenance: ProvenanceEntry[];
}

export interface GachaRewardEntity extends BaseEntity {
  readonly type: "gacha_reward";
  readonly game_id: string;
  readonly machine_id: string;
  readonly reward_type: number;
  readonly kind: string;
  readonly weight: number;
  readonly create_order: number;
  readonly secret: boolean;
  readonly reward_locks: {
    readonly im_topic_id: string;
    readonly os_file_id: string;
    readonly story_lock_id: string;
  };
  readonly song_id?: string;
  readonly chart_ids?: string[];
  readonly illustration_id?: string;
  readonly tap_fx_id?: string;
  readonly provenance: ProvenanceEntry[];
}

export interface ShopBundleItem {
  readonly item_type: string;
  readonly preorder: boolean;
  readonly product_id: string;
  readonly reference_price_iap_id: string;
  readonly weight: number;
}

export interface ShopBundleTier {
  readonly iap_id: string;
  readonly remain_weight: number;
}

export interface ShopBundleEntity extends BaseEntity {
  readonly type: "shop_bundle";
  readonly game_id: string;
  readonly milestone_key: string;
  readonly trigger_free_character_level: number;
  readonly black_market: boolean;
  readonly message_ids: Record<string, string>;
  readonly items: ShopBundleItem[];
  readonly tiers: ShopBundleTier[];
  readonly provenance: ProvenanceEntry[];
}

export interface AssistantDialoguePage {
  readonly page: number;
  readonly assistant_id: number;
  readonly image_id: string;
  readonly sound_id: string;
}

export interface AssistantDialogueEntity extends BaseEntity {
  readonly type: "assistant_dialogue";
  readonly game_id: string;
  readonly trigger: number;
  readonly target: string | null;
  readonly version: string;
  readonly progress: number;
  readonly page_count: number;
  readonly pages: AssistantDialoguePage[];
  readonly text_ref: string;
  readonly missing_languages: Lang[];
  readonly provenance: ProvenanceEntry[];
}

export interface TitleScreenEntity extends BaseEntity {
  readonly type: "title_screen";
  readonly game_id: string;
  readonly number: number;
  readonly name: string;
  readonly unlock_conditions: ConditionEntry[];
  readonly video_clips: string[];
  readonly text_ref: string;
  readonly provenance: ProvenanceEntry[];
}

export interface SubtitleLineEntity extends BaseEntity {
  readonly type: "subtitle_line";
  readonly game_id: string;
  readonly character: string;
  readonly voice_asset_id: string;
  readonly text_ref: string;
  readonly provenance: ProvenanceEntry[];
}

export interface ReadingOrderRow extends BaseEntity {
  readonly type: "reading_order";
  readonly entity_id: string;
  readonly entity_type: ReadingEntityType;
  readonly timeline_scope: TimelineScope;
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
  readonly cost: number;
  readonly lane: number;
  readonly lane_character: string | null;
  readonly lock_level: number;
  readonly branch: ReadingBranch | null;
  readonly external: string | null;
  readonly read_index: number | null;
  readonly order: number;
}

export interface Edge {
  readonly source: string;
  readonly relation: string;
  readonly target: string;
  readonly provenance?: ProvenanceEntry[];
}

/** One icon of the game's iM account filter (`im_filter_data`). */
export interface ImFilterItem {
  readonly avatar: string;
  readonly avatars: string[];
  readonly name: string;
}

export interface ImFilters {
  readonly items: ImFilterItem[];
  readonly otherAvatar: string | null;
}

export interface Projection {
  readonly schemaVersion: number;
  readonly counts: Record<string, number>;
  readonly difficulties: Difficulty[];
  readonly entities: Record<string, BaseEntity[]>;
  readonly edges: Edge[];
  readonly imFilters?: ImFilters;
}

export interface TextBlock {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface TextRecord {
  readonly ref: string;
  readonly lang: Lang;
  readonly requested_lang?: Lang;
  readonly fallback?: boolean;
  readonly text: string | null;
  readonly blocks: TextBlock[] | null;
  readonly missing?: boolean;
}

export interface TextSummary {
  readonly languages: Lang[];
  readonly refs: Record<string, Partial<Record<Lang, string>>>;
  readonly names: Record<string, Partial<Record<Lang, string>>>;
}

export interface Database {
  readonly projection: Projection;
  readonly entityById: Map<string, BaseEntity>;
  readonly entitiesByType: Map<string, BaseEntity[]>;
  readonly imFilters: ImFilters;
  readonly timelineOrders: ReadingOrderRow[];
  readonly allReadingOrders: ReadingOrderRow[];
  readonly readingOrderByEntity: Map<string, ReadingOrderRow>;
  readonly textRefs: TextSummary["refs"];
  readonly textNames: TextSummary["names"];
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

export interface SearchHit {
  readonly id: string;
  readonly ref: string;
  readonly type: string;
  readonly title: string;
  readonly snippet: string;
  readonly lang: Lang;
  readonly fallback: boolean;
}

export interface SearchGroup {
  readonly type: string;
  readonly label: string;
  readonly hits: SearchHit[];
}

export interface SearchResponse {
  readonly query: string;
  readonly lang: Lang;
  readonly groups: SearchGroup[];
  readonly total: number;
}
