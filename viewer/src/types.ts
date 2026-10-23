export type Lang = "en" | "ja" | "zh-Hant" | "ko" | "zh-Hans";

export type LangMap<T> = Record<Lang, T>;

export interface Meta {
  title: string;
  game: string;
  gameVersion: string;
  languages: { code: Lang; label: string }[];
  counts: Record<string, number>;
}

export interface Chapter {
  id: number;
  name: string;
  category: number;
  count: number;
  index: [number, number];
  date: [string, string] | null;
  folders: string[];
  packs: [string, number][];
  inversions: number;
  movies: number;
  entries: string[];
}

export interface Folder {
  name: string;
  count: number;
  chapters: string[];
  packs: string[];
  entries: string[];
}

export interface PackLevel {
  level: number;
  im: string[];
  os: string[];
  /** Branching OS（Tairitsu）：该等级解锁的分支节点 */
  branch?: string[];
  /** 该等级解锁的谱面 */
  charts?: string[];
}

export interface Pack {
  id: string;
  /** branching = Tairitsu 的 Branching OS（没有 iM 帖与传统 OS 档案） */
  kind?: "branching";
  folders: string[];
  chapters: [string, number][];
  levels: PackLevel[];
  imCount: number;
  osCount: number;
  syncCount: number;
  branchCount?: number;
}

export interface ImMeta {
  id: string;
  order: number;
  author: string;
  avatar: string;
  titles: LangMap<string>;
  gate: string;
  packs: [string, number][];
  attachments: string[];
  charts: { SongId?: string; Difficulty?: number }[];
  likes: number;
  replies: number;
  storyTrigger?: { story: string; step: string } | null;
  /** 阅读顺序阶段（export_im_order.py 推导：角色等级 + 剧情 + 帖子依赖） */
  stage?: number;
  /** 阶段内的阅读序号：账号线程（同一主角连续）→ 该帖等级需求 → 数据表顺序 */
  readIndex?: number;
  /** 账号线程序号（0=PAFF,1=NEKO,2=ROBO,3=Ivy,4=Xenon,5=ConneR,6=Cherry,7=JOE,8=其他） */
  lane?: number;
  /** 该阶段三主角达到的等级（游戏里的 LOCK 点） */
  lockLevel?: number;
  /** 模型外的依赖（stage 98）：如 story_cherry02 需要 OS 过场 cpos033 */
  external?: string;
  /** 结局分支（善终1 / 善终2 / 结局04）—— 同一周目只会走其中一条 */
  branch?: string;
  /** 解锁成本（各条件等级之和）：多条件锁更晚 */
  cost?: number;
}

export interface OsMeta {
  id: string;
  file: string;
  folder: string;
  character: string;
  characterId: string;
  chapter: string;
  index: number;
  date: string;
  category: string | null;
  type: number;
  packs: [string, number][];
  fileLock: string;
  movies: string[];
  cutscene?: string | null;
  names: LangMap<string>;
}

export interface Gate {
  id: string;
  topics: string[];
}

export interface SyncPoint {
  pack: string;
  level: number;
  im: string[];
  os: string[];
}

export interface OaCharacter {
  character: string;
  objects: string[];
  descriptions: string[];
  documents: string[];
}

export interface BackupNode {
  id: string;
  names?: LangMap<string>;
  type: number;
  /** 分支节点解锁条件：曲包等级 + 分支状态（Branching OS） */
  level?: number;
  stateId?: number;
  stateValue?: string;
  charts?: string[];
  position: number | null;
  order: number | null;
  next: string[];
  branch: string;
}

export interface TitleInfo {
  Type: number;
  Name: string;
  Conditions?: { storyId?: string }[];
}

export interface GalleryFolder {
  id: string;
  name: string;
  avatar: string;
}

export interface GalleryItem {
  folder: string;
  location: string;
  name: string;
  icon: string;
  format: number;
  size: [number, number] | null;
  conditions: string[];
}

export interface IllustrationMeta {
  id: string;
  character: string;
  characterName: string;
  costume: string;
  available: boolean;
}

/** iM 账户过滤器（im_filter_data）：一个图标可覆盖多个账号，例如 PAFF = paff_01 + paff_02 */
export interface ImFilterItem {
  avatar: string;
  avatars: string[];
  name: string;
}

export interface ImFilters {
  items: ImFilterItem[];
  otherAvatar: string;
  likeAvatar?: string | null;
}

/** 角色分级：free 主线免费 / paid 主线付费 / side 支线（DLC 联动）/ plot 剧情角色 */
export type CharacterTier = "free" | "paid" | "side" | "plot";

/** 剧情事件（dump.cs 的 Story 类 + 其 Action 类常量） */
export interface StoryEvent {
  id: string;
  cls: string;
  actions?: string[];
  trigger_os_id?: string;
  trigger_topic_id?: string;
  start_topic_id?: string;
  end_topic_id?: string;
  trigger_gallery_file_location?: string;
  boss_stage_id?: string;
  movie_file?: string;
  cutscene_movie_file?: string;
  steps?: string[];
  imTopics?: string[];
}

export interface IndexData {
  meta: Meta;
  chapters: Chapter[];
  folders: Folder[];
  packs: Pack[];
  im: ImMeta[];
  imFilters?: ImFilters;
  os: OsMeta[];
  gates: Gate[];
  storyEvents?: StoryEvent[];
  sync: SyncPoint[];
  timeline: string[];
  characters: Record<string, string>;
  characterTiers?: Record<string, CharacterTier>;
  illustrations: IllustrationMeta[];
  oa: OaCharacter[];
  gallery: { folders: GalleryFolder[]; items: GalleryItem[] };
  backup: BackupNode[];
  branching: BackupNode[];
  titleInfo: TitleInfo[];
}

export type Block =
  | { kind: "dialogue"; speaker: string; text: string }
  | { kind: "narration"; text: string }
  | { kind: "image"; id: string }
  | { kind: "imageviewer"; id: string; viewer?: string }
  | { kind: "movie"; id: string }
  | { kind: "sound"; name: string; label: string }
  | { kind: "bgm"; name: string }
  | { kind: "mail"; title: string; from: string; to: string; body: string }
  | { kind: "booklet"; title: string; subtitle: string; paragraphs: string[] }
  | { kind: "note"; directive: string; value: string };

export interface ReplyNode {
  id: string;
  author: string;
  avatar: string;
  text: string;
  attachments: string[];
  replies: ReplyNode[];
}

export interface ImText {
  title: string;
  text: string;
  replies: ReplyNode[];
}

export interface OsText {
  name: string;
  blocks: Block[];
}

export interface OaItem {
  kind: "object" | "description" | "document";
  name?: string;
  /** 描述点位分组（DescriptionObjectId），同一组是同一热点的不同阶段变体 */
  group?: string;
  event?: number;
  /** 变体阶段语义（wiki：初始 / Vanessa（恨意）/ 4.0 通关后） */
  stage?: string;
  stageOrder?: number;
  /** 描述名在游戏数据里只有一份（繁体中文），不随语言切换 */
  nameLocked?: boolean;
  enable?: string[];
  disable?: string[];
  details?: string;
  text?: string;
  /** 描述按数据里的 `---` 切成的对话段落（游戏内一段一段显示） */
  lines?: string[];
  blocks?: Block[];
  object?: string | null;
  character?: string;
}

export interface AudioSub {
  id: string;
  character: string;
  text: string;
}

export interface Assistant {
  id: string;
  trigger: number | null;
  target: string | null;
  pages: string[];
}

export interface ImContent {
  lang: Lang;
  im: Record<string, ImText>;
}
export interface OsContent {
  lang: Lang;
  os: Record<string, OsText>;
}
export interface ExtraContent {
  lang: Lang;
  label: string;
  oa: Record<string, OaItem>;
  backup: Record<string, { blocks: Block[] }>;
  audio: AudioSub[];
  assistants: Assistant[];
}
