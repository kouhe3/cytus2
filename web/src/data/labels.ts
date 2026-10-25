import type { I18n, MessageKey } from "./messages";
import type { Lang, ReadingBranch, ReadingTier } from "../types";

const TYPE_KEYS: Record<string, MessageKey> = {
  im_post: "type.im_post",
  im_reply: "type.im_reply",
  os_log: "type.os_log",
  chart: "type.chart",
  song: "type.song",
  character: "type.character",
  pack: "type.pack",
  expansion_pack: "type.expansion_pack",
  folder: "type.folder",
  chapter: "type.chapter",
  story_node: "type.story_node",
  oa_character: "type.oa_character",
  oa_object: "type.oa_object",
  oa_document: "type.oa_document",
  oa_description: "type.oa_description",
  gallery_item: "type.gallery_item",
  gallery_folder: "type.gallery_folder",
  illustration: "type.illustration",
  capso_shop_pack: "type.capso_shop_pack",
  capso_shop_item: "type.capso_shop_item",
  gacha_machine: "type.gacha_machine",
  gacha_reward: "type.gacha_reward",
  shop_bundle: "type.shop_bundle",
  boss_stage: "type.boss_stage",
  spoiler_alert: "type.spoiler_alert",
  subtitle_line: "type.subtitle_line",
  assistant_dialogue: "type.assistant_dialogue",
  title_screen: "type.title_screen",
  reading_order: "type.reading_order",
};

export function entityTypeLabel(i18n: I18n, type: string): string {
  const key = TYPE_KEYS[type];
  return key ? i18n.t(key) : type;
}

const RELATION_KEYS: Record<string, MessageKey> = {
  unlocks_chart: "relation.unlocks_chart",
  requires_story: "relation.requires_story",
  same_level: "relation.same_level",
  same_stage: "relation.same_stage",
  appears_in_gallery: "relation.appears_in_gallery",
  belongs_to_pack: "relation.belongs_to_pack",
  has_reply: "relation.has_reply",
};

export function relationLabel(i18n: I18n, relation: string): string {
  const key = RELATION_KEYS[relation];
  if (key) {
    return i18n.t(key);
  }
  return relation
    .replace(/_/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

const TIER_KEYS: Record<ReadingTier, MessageKey> = {
  free: "tier.free",
  paid: "tier.paid",
  side: "tier.side",
};

export function tierLabel(i18n: I18n, tier: ReadingTier): string {
  return i18n.t(TIER_KEYS[tier]);
}

const BRANCH_KEYS: Record<ReadingBranch, MessageKey> = {
  good_ending1: "branch.good_ending1",
  good_ending2: "branch.good_ending2",
  ending04: "branch.ending04",
};

export function branchLabel(i18n: I18n, branch: string): string {
  const key = BRANCH_KEYS[branch as ReadingBranch];
  return key ? i18n.t(key) : branch;
}

const MEDIA_KIND_KEYS: Record<string, MessageKey> = {
  video: "mediaKind.video",
  image: "mediaKind.image",
  boss_stage: "mediaKind.boss_stage",
};

export function mediaKindLabel(i18n: I18n, kind: string): string {
  const key = MEDIA_KIND_KEYS[kind];
  return key ? i18n.t(key) : kind;
}

const STORY_KIND_KEYS: Record<string, MessageKey> = {
  event: "storyKind.event",
  branch: "storyKind.branch",
};

export function storyKindLabel(i18n: I18n, kind: string): string {
  const key = STORY_KIND_KEYS[kind];
  return key ? i18n.t(key) : kind;
}

const CONDITION_KIND_KEYS: Record<string, MessageKey> = {
  os: "condition.os",
  im: "condition.im",
  story: "condition.story",
  branch: "condition.branch",
  gallery: "condition.gallery",
  boss_stage: "condition.boss_stage",
};

export function conditionKindLabel(i18n: I18n, kind: string): string {
  const key = CONDITION_KIND_KEYS[kind];
  return key ? i18n.t(key) : kind;
}

const SEARCH_GROUP_KEYS: Record<string, MessageKey> = {
  im_post: "search.group.im_post",
  im_reply: "search.group.im_reply",
  os_log: "search.group.os_log",
  oa_document: "search.group.oa_document",
  subtitle_line: "search.group.subtitle_line",
  chart: "search.group.chart",
};

export function searchGroupLabel(
  i18n: I18n,
  type: string,
  fallback: string,
): string {
  const key = SEARCH_GROUP_KEYS[type];
  return key ? i18n.t(key) : fallback;
}

/** `20 / 37` while the server caps a group, `37` once every hit is shown. */
export function searchGroupCount(shown: number, total: number): number | string {
  return shown < total ? `${shown} / ${total}` : total;
}

export function fallbackNotice(
  i18n: I18n,
  requested: Lang,
  actual: Lang | null,
): string {
  if (actual === null) {
    return i18n.t("common.fallbackNone", { lang: requested });
  }
  return i18n.t("common.fallbackShowing", {
    requested,
    actual,
  });
}
