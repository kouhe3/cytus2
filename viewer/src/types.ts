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
}

export interface Pack {
  id: string;
  folders: string[];
  chapters: [string, number][];
  levels: PackLevel[];
  imCount: number;
  osCount: number;
  syncCount: number;
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

export interface IndexData {
  meta: Meta;
  chapters: Chapter[];
  folders: Folder[];
  packs: Pack[];
  im: ImMeta[];
  os: OsMeta[];
  gates: Gate[];
  sync: SyncPoint[];
  timeline: string[];
  characters: Record<string, string>;
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
