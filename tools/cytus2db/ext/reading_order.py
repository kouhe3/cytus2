"""Reading-order projection: simulate a free player's unlock sequence.

The projection answers "what can a player who owns only the free characters
read next?".  It is derived, not authored:

* level gates come from each entity's ``level_locks``; a multi-lock entity
  needs the highest level, matching the game's "all characters advance
  together" model;
* ``IsLevelLocked`` rows act as hard caps: a character cannot pass that level
  until the other characters in the same row have reached theirs, so the
  simulation raises every character to its current cap before reading;
* phases follow the pack's wiki role: main non-IAP packs are ``free``, main
  IAP packs are ``paid``, everything else (DLC / collaboration) is ``side``.
  This reproduces the old ``characterTiers`` classification from the pack
  table instead of relying on the frozen viewer's hand-written list;
* the four ``SpoilerAlertTable`` gates defer a character's content until the
  listed prerequisite characters reach the gate's levels.  A gate is a
  deferral, not a lock: the effective level is ``max(own level, gate level)``
  and the original level plus the gate reference stay in the record.

Rows are emitted for ``im_post``, ``os_log``, ``oa_document`` and
``story_node``.  ``stage`` is the simulation round in which the entity became
readable; within a stage the order is level, thread, then the game's own
table order, so two builds always agree.  ``version`` (OS ``Category``) and
``chapter`` (OS timeline chapter) are alternate sort keys; ``test01`` and
``test02`` are marked as staging chapters so an alternate sort can push them
last.

Dependencies (an iM ``topic_gate``, an OS ``file_lock``, a story gate or an OA
object condition) are hard prerequisites: the topological pass never places a
dependent before its gate.  A gate whose target entity is absent from the
projection is ignored, because there is no entity to order against.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from ..errors import BuildError, InputError
from ..keys import entity_key
from ..provenance import manual, rva, sort_record, text_asset
from ..sources import InputSource

TIER_ORDER = ("free", "paid", "side")
TIER_RANK = {tier: index for index, tier in enumerate(TIER_ORDER)}
ENTITY_ORDER = {"im_post": 0, "os_log": 1, "oa_document": 2, "story_node": 3}
MAIN_TRIO = frozenset({"paff001", "neko001", "robo001"})

# The seven free main characters whose OS logs belong to the global unlock
# timeline.  Paid main and side/DLC OS logs are read through their character
# page only (``timeline_scope=character``).  This boundary is editorial and
# comes from the game's navigation, not from a pack field: every iM post is
# part of the global feed, but only these seven accounts have OS content in
# the unlock timeline.  See kouhe3/cytus2#24.
TIMELINE_CHARACTERS = frozenset(
    {"paff001", "neko001", "robo001", "ivy001", "cherry002", "vanessa001", "bobo001"}
)
TIMELINE_SCOPE_LOCATOR = "https://github.com/kouhe3/cytus2/issues/24"
STAGING_CHAPTERS = frozenset({"test01", "test02"})
MAX_LEVEL = 999
MAX_STAGES = 1000
UNKNOWN_THREAD_RANK = 100_000
NULL_THREAD_RANK = 200_000

# The simulation raises every character to its current cap, exactly like the
# legacy iM fixpoint (``min(cap, 99)``); the highest level lock in the data is
# 98, so the clamp never blocks a real gate.
LEVEL_CAP = 99

# Reading stages outside the fixpoint's 1..N range.  ``BLOCKED_STAGE`` is the
# legacy iM model's "outside the model" bucket; ``UNSTAGED_STAGE`` is a row the
# tier simulation could not place at all.
BLOCKED_STAGE = 98
UNSTAGED_STAGE = 99

# Lane = character account thread, laid out as free -> paid -> side.  The
# within-tier order is the legacy viewer's ``TIER_ORDER``: it is editorial
# (which account the reader follows first), not derivable from the pack table.
# Characters absent from this list are appended to their tier sorted by id.
PLOT_LANE = 300
CHARACTER_TIERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "free",
        ("paff001", "neko001", "robo001", "ivy001", "cherry002", "vanessa001", "bobo001"),
    ),
    (
        "paid",
        (
            "ilka001",
            "xenon001",
            "conner001",
            "cherry001",
            "joe001",
            "sagar001",
            "rin001",
            "paff002",
            "robo002",
            "neko002",
        ),
    ),
    (
        "side",
        (
            "graffj001",
            "miku001",
            "ai001",
            "alice001",
            "hans001",
            "kaf001",
            "amiya001",
            "tairitsu001",
            "neko003",
            "paff003",
        ),
    ),
)
CHARACTER_TIER_LOCATOR = "cytus2_work/export_im_order.py:TIER_ORDER"

# Manual tier corrections, applied on top of the pack table before the lane is
# built.  The layer exists so a tier fix never leaks into the sorting logic.
# Crystal PuNK (``cherry002``) and Bo Bo (``bobo001``) were briefly reported as
# paid; the Fandom character list puts both under Free Characters and the APK's
# ``is_iap_pack`` is false for both, so no override is applied.  Graff.J
# (``graffj001``) is "Free" on Fandom but "Extra" in the pack table; that
# remains an open question and is intentionally not overridden either.
CHARACTER_TIER_OVERRIDES: dict[str, str] = {}

# ``StoryLockId`` -> branch label, from the legacy viewer.  The three ending
# branches are indistinguishable from the data alone (all three are plain story
# locks), so the labels are manual.
BRANCH_LABELS: dict[str, str] = {
    "story_ending03_good_ending1": "善终1",
    "story_ending03_good_ending2": "善终2",
    "story_ending04_main": "结局04",
}
BRANCH_LOCATOR = "cytus2_work/export_im_order.py:branch"

# Legacy iM fixpoint inputs.  The legacy script hard-coded these because they
# are ``_ConditionCheck`` results, not TextAsset fields.
LEGACY_DONE_BY_DEFAULT = frozenset({"story01"})
LEGACY_ALWAYS = frozenset({"story05"})
LEGACY_LEVEL_STORY = {"story04": ("neko001", 24)}
LEGACY_OS_STORY_NEEDS = {"story_cherry02": "cpos033"}
LEGACY_SIDE_GATE = "story_ending02"
LEGACY_LOCATOR = "cytus2_work/export_im_order.py"

# Decompiled ``SpoilerAlertTable..cctor`` (RVA 0x254FFDC).  Levels are 0-based;
# the game UI displays level + 1.
SPOILER_RVA = "0x254FFDC"
SPOILER_ALERTS: tuple[tuple[str, str, tuple[tuple[str, int], ...]], ...] = (
    (
        "ivy001_001",
        "ivy001",
        (("paff001", 24), ("neko001", 24), ("robo001", 23)),
    ),
    (
        "cherry002_001",
        "cherry002",
        (("paff001", 71), ("neko001", 65), ("robo001", 65), ("ivy001", 38)),
    ),
    (
        "vanessa001_001",
        "vanessa001",
        (("paff001", 75), ("neko001", 69), ("robo001", 69)),
    ),
    (
        "bobo001_001",
        "bobo001",
        (("paff001", 76), ("neko001", 69), ("robo001", 69), ("vanessa001", 24)),
    ),
)

# ``_ConditionCheck`` results that are not expressible as a TextAsset field.
# They come from the same decompilation as ``export_im_order.py``: the ending
# chain has no ``TOUCH_IM_*`` constant, and ending 03's level frontier is a
# condition check, so the data alone would place it at level 0.
STORY_LEVEL_GATES: dict[str, tuple[tuple[str, int], ...]] = {
    "story04": (("neko001", 24),),
    "story_ending03_main": (("paff001", 89), ("neko001", 79), ("robo001", 79)),
}
STORY_AFTER: dict[str, tuple[str, ...]] = {
    "story_ending03_main": ("story_ending02",),
    "story_ending03_good_ending1": ("story_ending03_main",),
    "story_ending03_good_ending2": ("story_ending03_main",),
    "story_ending04_main": ("story_ending03_main",),
}
STORY_GATE_LOCATOR = "cytus2_work/export_im_order.py:LEVEL_STORY,STORY_LEVEL_REQ"


# --------------------------------------------------------------------- helpers
_text_asset = text_asset
_rva = rva
_sorted_provenance = sort_record


def _manual(note: str) -> dict[str, str]:
    return manual(STORY_GATE_LOCATOR, note)


def _character(value: Any) -> str:
    text = str(value or "").strip()
    if text.startswith("character/"):
        return text.split("/", 1)[1]
    return text


def _character_key(value: Any) -> str:
    return entity_key("character", _character(value))


def _row_level(level_locks: Iterable[dict[str, Any]]) -> int:
    return max((int(lock["level"]) for lock in level_locks), default=0)


def _sorted_level_locks(
    entries: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        (
            {"character": _character_key(entry["character"]), "level": int(entry["level"])}
            for entry in entries
        ),
        key=lambda item: (item["character"], item["level"]),
    )


def _version_order(value: str | None) -> list[int]:
    if not value:
        return []
    return [int(part) for part in re.findall(r"[0-9]+", value)]


@dataclass(frozen=True)
class _Pack:
    character_id: str
    tier: str
    rank: int


def _packs(source: InputSource) -> dict[str, _Pack]:
    table = source.song_catalog()
    if not isinstance(table.data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    raw_packs = table.data.get("offline_song_pack_list")
    if not isinstance(raw_packs, list):
        raise InputError(f"{table.locator}/offline_song_pack_list must be a list")
    packs: dict[str, _Pack] = {}
    for index, raw in enumerate(raw_packs):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}/offline_song_pack_list[{index}]: must be an object")
        character_id = str(raw.get("song_pack_id") or "").strip()
        if not character_id:
            raise BuildError(
                f"{table.locator}/offline_song_pack_list[{index}]: missing song_pack_id"
            )
        category = str(raw.get("Category") or "").strip().lower()
        is_iap = bool(raw.get("is_iap_pack"))
        if category == "main":
            tier = "paid" if is_iap else "free"
        else:
            tier = "side"
        packs.setdefault(character_id, _Pack(character_id, tier, index))
    return packs


def _tier_of(character_id: str | None, packs: dict[str, _Pack]) -> str:
    if character_id and character_id in packs:
        return packs[character_id].tier
    return "side"


@dataclass(frozen=True)
class _LaneEntry:
    lane: int
    tier: str


def _lane_table(
    packs: dict[str, _Pack],
    overrides: dict[str, str] | None = None,
) -> dict[str, _LaneEntry]:
    """Map character -> lane rank (free 0.., paid 100.., side 200..).

    The tier comes from the pack table (``Category`` + ``is_iap_pack``) with the
    manual override layer on top.  Within a tier the legacy editorial order is
    used first; characters the list does not know are appended sorted by id, so
    two builds always agree.
    """
    corrections = CHARACTER_TIER_OVERRIDES if overrides is None else overrides
    editorial = {
        tier: {character: index for index, character in enumerate(characters)}
        for tier, characters in CHARACTER_TIERS
    }
    buckets: dict[str, list[str]] = {tier: [] for tier in TIER_ORDER}
    for character in packs:
        tier = corrections.get(character, packs[character].tier)
        if tier not in buckets:
            tier = "side"
        buckets[tier].append(character)

    lanes: dict[str, _LaneEntry] = {}
    for tier in TIER_ORDER:
        order = editorial[tier]
        members = sorted(
            buckets[tier],
            key=lambda character: (
                0,
                order[character],
                character,
            )
            if character in order
            else (1, 0, character),
        )
        for index, character in enumerate(members):
            lanes[character] = _LaneEntry(TIER_RANK[tier] * 100 + index, tier)
    return lanes


def _avatar_character(avatar: str, lanes: dict[str, _LaneEntry]) -> str | None:
    """Legacy ``_pack_of_avatar``: avatar id -> account character."""
    base, _, number = (avatar or "").strip().partition("_")
    if number.isdigit():
        candidate = f"{base}{int(number):03d}"
        if candidate in lanes:
            return candidate
    direct = {
        "paff": "paff001",
        "neko": "neko001",
        "robo": "robo001",
        "cherry": "cherry001",
    }
    candidate = direct.get(base.lower())
    if candidate in lanes:
        return candidate
    return None


def _avatar_families(
    source: InputSource, lanes: dict[str, _LaneEntry]
) -> dict[str, str | None]:
    """``im_filter_data`` groups avatars under one account (PAFF owns paff_01/02)."""
    table = source.text_json("imdata", "im_filter_data")
    if table is None or not isinstance(table.data, dict):
        return {}
    families: dict[str, str | None] = {}
    for item in table.data.get("Items") or []:
        if not isinstance(item, dict):
            continue
        family = _avatar_character(str(item.get("DisplayAvatarId") or ""), lanes)
        for avatar in item.get("FilterAvatarIds") or []:
            families[str(avatar)] = family
    return families


def _thread_rank(thread: str | None, packs: dict[str, _Pack]) -> int:
    character_id = _character(thread)
    if not character_id:
        return NULL_THREAD_RANK
    pack = packs.get(character_id)
    return pack.rank if pack else UNKNOWN_THREAD_RANK


def _thread_from_locks(
    characters: Iterable[str], packs: dict[str, _Pack]
) -> str | None:
    """Pick the thread a multi-lock post belongs to.

    A lock list often includes the three main characters as a shared
    requirement.  Prefer a non-main character; the three main characters are
    the fallback and the avatar is the last resort.
    """
    known = [character for character in characters if character in packs]
    if not known:
        return None
    candidates = [character for character in known if character not in MAIN_TRIO]
    pool = candidates or known
    return min(pool, key=lambda item: (packs[item].rank, item))


def _avatar_thread(avatar: str, packs: dict[str, _Pack]) -> str | None:
    base, _, number = avatar.strip().partition("_")
    if number.isdigit():
        candidate = f"{base}{int(number):03d}"
        if candidate in packs:
            return candidate
    direct = {
        "paff": "paff001",
        "neko": "neko001",
        "robo": "robo001",
        "ivy": "ivy001",
        "cherry": "cherry002",
        "vanessa": "vanessa001",
        "bobo": "bobo001",
        "graffj": "graffj001",
    }
    candidate = direct.get(base.lower())
    if candidate in packs:
        return candidate
    candidate = f"{base}001"
    return candidate if candidate in packs else None


def _chapter_index(source: InputSource) -> dict[str, tuple[str, int | None]]:
    table = source.chapters()
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    chapters: dict[str, tuple[str, int | None]] = {}
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("Name") or "").strip()
        number = raw.get("Id")
        if not name or number is None:
            continue
        try:
            order: int | None = int(number)
        except (TypeError, ValueError):
            order = None
        chapters.setdefault(name, (entity_key("chapter", str(number)), order))
    return chapters


@dataclass
class _Row:
    entity_id: str
    entity_type: str
    thread: str | None
    raw_level: int
    level_locks: list[dict[str, Any]] = field(default_factory=list)
    # Original lock order matters: the legacy lane picks the first non-main
    # character of the list, and ``cost`` sums every lock.
    lock_pairs: list[tuple[str, int]] = field(default_factory=list)
    avatar: str | None = None
    story_lock: str | None = None
    deps: list[str] = field(default_factory=list)
    in_game_order: int = 0
    version: str | None = None
    version_order: list[int] = field(default_factory=list)
    chapter: str | None = None
    chapter_id: str | None = None
    chapter_order: int | None = None
    chapter_staged: bool = False
    story_kind: str | None = None
    has_trigger: bool = False
    provenance: list[dict[str, str]] = field(default_factory=list)
    phase: int = TIER_RANK["side"]
    stage: int = 0
    level_gate: int = 0
    spoiler_alert: str | None = None
    spoiler_conditions: list[dict[str, Any]] = field(default_factory=list)
    cost: int = 0
    lane: int = PLOT_LANE
    lane_character: str | None = None
    lock_level: int = 0
    branch: str | None = None
    external: str | None = None
    read_index: int | None = None
    timeline_scope: str = "none"

    @property
    def character(self) -> str | None:
        return _character(self.thread) or None

    def sort_key(self, packs: dict[str, _Pack]) -> tuple[Any, ...]:
        # One metric for the merged timeline: unlock cost, account lane, entity
        # type as a stable tie-break (iM before OS), then the game's own order.
        return (
            self.stage,
            self.cost,
            self.lane,
            ENTITY_ORDER[self.entity_type],
            self.in_game_order,
            self.entity_id,
        )


# ------------------------------------------------------------------- spoilers
@dataclass(frozen=True)
class _Spoiler:
    game_id: str
    character_id: str
    conditions: tuple[tuple[str, int], ...]
    threshold: int

    @property
    def entity_id(self) -> str:
        return entity_key("spoiler_alert", self.game_id)

    def record(self) -> dict[str, Any]:
        record: dict[str, Any] = {
            "id": self.entity_id,
            "type": "spoiler_alert",
            "game_id": self.game_id,
            "character": _character_key(self.character_id),
            "conditions": [
                {"character": _character_key(character), "level": level}
                for character, level in self.conditions
            ],
            "threshold": self.threshold,
            "provenance": [
                _rva(
                    SPOILER_RVA,
                    f"SpoilerAlertTable..cctor {self.game_id}",
                )
            ],
        }
        _sorted_provenance(record)
        return record


def _spoilers() -> tuple[list[_Spoiler], dict[str, _Spoiler]]:
    alerts = [
        _Spoiler(game_id, character_id, conditions, max(level for _, level in conditions))
        for game_id, character_id, conditions in SPOILER_ALERTS
    ]
    return alerts, {alert.character_id: alert for alert in alerts}


# --------------------------------------------------------------------- sources
def _im_rows(source: InputSource, packs: dict[str, _Pack]) -> list[_Row]:
    locks_table = source.text_json("imdata", "im_lock_condition_data")
    topics_table = source.text_json("imdata", "im_topic_data")
    if locks_table is None:
        return []
    if not isinstance(locks_table.data, list):
        raise InputError(f"{locks_table.locator} must be a JSON list")

    topics: dict[str, tuple[int, dict[str, Any]]] = {}
    if topics_table is not None and isinstance(topics_table.data, list):
        for index, raw in enumerate(topics_table.data):
            if not isinstance(raw, dict):
                continue
            game_id = str(raw.get("Id") or "").strip().upper()
            if not game_id:
                continue
            topics.setdefault(game_id, (index, raw))

    rows: list[_Row] = []
    for lock_index, raw in enumerate(locks_table.data):
        if not isinstance(raw, dict):
            raise BuildError(f"{locks_table.locator}[{lock_index}]: must be an object")
        game_id = str(raw.get("TopicId") or "").strip().upper()
        if not game_id:
            raise BuildError(f"{locks_table.locator}[{lock_index}]: missing TopicId")
        topic_index, topic = topics.get(game_id, (lock_index, {}))

        level_locks = []
        for entry_index, entry in enumerate(raw.get("LevelLocks") or []):
            if not isinstance(entry, dict):
                raise BuildError(
                    f"{locks_table.locator}[{lock_index}].LevelLocks[{entry_index}]:"
                    " must be an object"
                )
            character = _character(entry.get("SongPackId"))
            if not character:
                raise BuildError(
                    f"{locks_table.locator}[{lock_index}].LevelLocks[{entry_index}]:"
                    " missing SongPackId"
                )
            level_locks.append({"character": character, "level": int(entry.get("Level") or 0)})

        characters = [lock["character"] for lock in level_locks]
        avatar = str(topic.get("AvatarId") or "").strip()
        thread = _thread_from_locks(characters, packs) or _avatar_thread(avatar, packs)

        deps: list[str] = []
        topic_gate = str(raw.get("TopicLockId") or "").strip().upper()
        if topic_gate:
            deps.append(entity_key("im", topic_gate))
        story_gate = str(raw.get("StoryLockId") or "").strip()
        if story_gate:
            deps.append(entity_key("story_node", story_gate))

        row = _Row(
            entity_id=entity_key("im", game_id),
            entity_type="im_post",
            thread=_character_key(thread) if thread else None,
            raw_level=_row_level(level_locks),
            level_locks=_sorted_level_locks(level_locks),
            lock_pairs=[
                (lock["character"], lock["level"]) for lock in level_locks
            ],
            avatar=avatar or None,
            story_lock=story_gate or None,
            deps=deps,
            in_game_order=topic_index,
            provenance=[
                _text_asset(locks_table.locator),
                *(
                    [_text_asset(topics_table.locator)]
                    if topics_table is not None
                    else []
                ),
            ],
        )
        rows.append(row)
    return rows


def _os_rows(source: InputSource) -> list[_Row]:
    chapters = _chapter_index(source)
    rows: list[_Row] = []
    sequence = 0
    for table in source.os_tables():
        if not isinstance(table.data, list):
            raise InputError(f"{table.locator} must be a JSON list")
        file_name = table.locator.rsplit("/", 1)[-1]
        for index, raw in enumerate(table.data):
            if not isinstance(raw, dict):
                raise BuildError(f"{table.locator}[{index}]: must be an object")
            game_id = str(raw.get("Id") or "").strip()
            if not game_id:
                raise BuildError(f"{table.locator}[{index}]: missing Id")
            lock = raw.get("OSLockCondition") or {}
            if not isinstance(lock, dict):
                raise BuildError(f"{table.locator}[{index}]: OSLockCondition must be an object")

            level_locks = []
            for entry_index, entry in enumerate(lock.get("LevelLocks") or []):
                if not isinstance(entry, dict):
                    raise BuildError(
                        f"{table.locator}[{index}].OSLockCondition.LevelLocks"
                        f"[{entry_index}]: must be an object"
                    )
                character = _character(entry.get("SongPackId"))
                if not character:
                    raise BuildError(
                        f"{table.locator}[{index}].OSLockCondition.LevelLocks"
                        f"[{entry_index}]: missing SongPackId"
                    )
                level_locks.append(
                    {"character": character, "level": int(entry.get("Level") or 0)}
                )

            timeline = raw.get("TimelineChapter") or {}
            if not isinstance(timeline, dict):
                timeline = {}
            chapter_name = str(timeline.get("Chapter") or "").strip() or None
            chapter_id, chapter_order = (None, None)
            if chapter_name:
                chapter_id, chapter_order = chapters.get(chapter_name, (None, None))

            deps: list[str] = []
            file_lock = str(lock.get("FileLockId") or "").strip()
            if file_lock:
                deps.append(entity_key("os", file_lock))

            version = str(raw.get("Category") or "").strip() or None
            row = _Row(
                entity_id=entity_key("os", game_id),
                entity_type="os_log",
                thread=_character_key(file_name),
                raw_level=_row_level(level_locks),
                level_locks=_sorted_level_locks(level_locks),
                lock_pairs=[
                    (lock["character"], lock["level"]) for lock in level_locks
                ],
                deps=deps,
                in_game_order=sequence,
                version=version,
                version_order=_version_order(version),
                chapter=chapter_name,
                chapter_id=chapter_id,
                chapter_order=chapter_order,
                chapter_staged=chapter_name in STAGING_CHAPTERS if chapter_name else False,
                provenance=[
                    _text_asset(f"{table.locator}[{index}]"),
                ],
            )
            rows.append(row)
            sequence += 1
    return rows


def _oa_conditions(
    raw_locks: Iterable[Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    level_locks: list[dict[str, Any]] = []
    deps: list[str] = []
    for entry in raw_locks:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("$type") or "")
        if "OASystemLevelLock" in kind:
            character = _character(entry.get("CharacterId"))
            if character:
                level_locks.append(
                    {"character": character, "level": int(entry.get("LockLevel") or 0)}
                )
        elif "OASystemOSLock" in kind:
            target = str(entry.get("OSLockId") or "").strip()
            if target:
                deps.append(entity_key("os", target))
        elif "OASystemStoryLock" in kind:
            target = str(entry.get("StoryId") or "").strip()
            if target:
                deps.append(entity_key("story_node", target))
    return level_locks, deps


def _oa_rows(source: InputSource) -> list[_Row]:
    table = source.text_json("oasystemdata", "oa_system_data")
    if table is None or not isinstance(table.data, dict):
        return []

    objects: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(table.data.get("Objects") or []):
        if not isinstance(raw, dict) or not raw.get("ObjectId"):
            continue
        level_locks, deps = _oa_conditions(raw.get("OASystemLocks") or [])
        objects[str(raw["ObjectId"])] = {
            "character": _character(raw.get("CharacterId")),
            "level_locks": level_locks,
            "deps": deps,
            "locator": f"{table.locator}/Objects[{index}]",
        }

    rows: list[_Row] = []
    for index, raw in enumerate(table.data.get("Documents") or []):
        if not isinstance(raw, dict) or not raw.get("DocumentId"):
            continue
        game_id = str(raw["DocumentId"]).strip()
        object_id = str(raw.get("ObjectId") or "").strip()
        obj = objects.get(object_id)
        thread = _character(raw.get("CharacterId")) or (obj["character"] if obj else "")
        level_locks = obj["level_locks"] if obj else []
        deps = list(obj["deps"]) if obj else []
        row = _Row(
            entity_id=entity_key("oa_document", game_id),
            entity_type="oa_document",
            thread=_character_key(thread) if thread else None,
            raw_level=_row_level(level_locks),
            level_locks=_sorted_level_locks(level_locks),
            lock_pairs=[
                (lock["character"], lock["level"]) for lock in level_locks
            ],
            deps=deps,
            in_game_order=index,
            provenance=[
                _text_asset(f"{table.locator}/Documents[{index}]"),
                *([_text_asset(obj["locator"])] if obj else []),
            ],
        )
        rows.append(row)
    return rows


# ---------------------------------------------------------------------- story
_CLASS_RE = re.compile(r"public (?:static )?class ([\w.]+)")
_ID_RE = re.compile(r'const string ID = "([^"]*)"')
_TRIGGER_OS_RE = re.compile(r'(?<![A-Z_])TRIGGER_OS_ID = "([^"]*)"')
_TRIGGER_FILE_RE = re.compile(r'(?<![A-Z_])TRIGGER_FILE_ID = "([^"]*)"')
_TRIGGER_TOPIC_RE = re.compile(r'(?<![A-Z_])TRIGGER_TOPIC_ID = "([^"]*)"')
_TOUCH_RE = re.compile(r"TOUCH_IM_(?:POST|TOPIC)_([A-Za-z0-9]+)")


def _dump_path(source: InputSource) -> Path:
    return source.root / "il2cppdumper" / "dump.cs"


def _topic_triggers(source: InputSource) -> dict[str, str]:
    """``TOUCH_IM_POST_*`` constant -> story id, one class block at a time.

    This mirrors the legacy ``derive_triggers``: only a class that declares a
    story ``ID`` contributes its touch constants.
    """
    path = _dump_path(source)
    if not path.is_file():
        return {}
    triggers: dict[str, str] = {}
    topics: set[str] = set()
    story_id: str | None = None

    def flush() -> None:
        nonlocal topics, story_id
        if story_id:
            for topic in topics:
                triggers.setdefault(topic, story_id)
        topics = set()
        story_id = None

    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if _CLASS_RE.match(line):
                flush()
                continue
            if story_id is None:
                found = _ID_RE.search(line)
                if found:
                    story_id = found.group(1)
            topics.update(topic.upper() for topic in _TOUCH_RE.findall(line))
    flush()
    return triggers


def _story_definitions(source: InputSource) -> list[dict[str, Any]]:
    path = _dump_path(source)
    if not path.is_file():
        return []
    definitions: list[dict[str, Any]] = []
    by_name: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = _CLASS_RE.match(line)
            if match:
                name = match.group(1).split(".")[-1]
                current = by_name.get(name)
                if current is None:
                    current = {
                        "name": name,
                        "story_id": None,
                        "topics": set(),
                        "trigger_os": None,
                        "trigger_file": None,
                        "order": len(definitions),
                    }
                    by_name[name] = current
                    definitions.append(current)
                continue
            if current is None:
                continue
            if line.strip().startswith("public const"):
                found = _ID_RE.search(line)
                if found:
                    current["story_id"] = found.group(1)
                found = _TRIGGER_OS_RE.search(line)
                if found and found.group(1):
                    current["trigger_os"] = found.group(1)
                found = _TRIGGER_FILE_RE.search(line)
                if found and found.group(1):
                    current["trigger_file"] = found.group(1)
                found = _TRIGGER_TOPIC_RE.search(line)
                if found and found.group(1):
                    current["topics"].add(found.group(1).upper())
            for topic in _TOUCH_RE.findall(line):
                current["topics"].add(topic.upper())
            if line.startswith("}"):
                current = None

    stories: list[dict[str, Any]] = []
    for definition in definitions:
        if not definition["story_id"]:
            continue
        owner = definition
        topics = set(owner["topics"])
        trigger_os = owner["trigger_os"]
        trigger_file = owner["trigger_file"]
        for other in definitions:
            if other is owner or other["story_id"]:
                continue
            if not other["name"].startswith(owner["name"]):
                continue
            topics |= other["topics"]
            if not trigger_os:
                trigger_os = other["trigger_os"]
            if not trigger_file:
                trigger_file = other["trigger_file"]
        story_id = owner["story_id"]
        existing = next(
            (story for story in stories if story["story_id"] == story_id), None
        )
        if existing is not None:
            existing["topics"] = sorted(set(existing["topics"]) | topics)
            existing["trigger_os"] = existing["trigger_os"] or trigger_os
            existing["trigger_file"] = existing["trigger_file"] or trigger_file
            continue
        stories.append(
            {
                "story_id": story_id,
                "name": owner["name"],
                "topics": sorted(topics),
                "trigger_os": trigger_os,
                "trigger_file": trigger_file,
                "order": owner["order"],
            }
        )
    stories.sort(key=lambda item: (item["order"], item["story_id"]))
    return stories


def _branch_tables(source: InputSource) -> list[tuple[str, Any]]:
    directory = source.text_dir / "branchingosdata"
    if not directory.is_dir():
        return []
    tables: list[tuple[str, Any]] = []
    for path in sorted(directory.iterdir()):
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
            except json.JSONDecodeError as exc:
                raise InputError(
                    f"invalid JSON in text/branchingosdata/{path.name}: {exc}"
                ) from exc
            tables.append((path.name, data))
    return tables


def _story_rows(
    source: InputSource,
    packs: dict[str, _Pack],
    im_by_id: dict[str, _Row],
    os_by_id: dict[str, _Row],
) -> list[_Row]:
    rows: list[_Row] = []
    for definition in _story_definitions(source):
        story_id = str(definition["story_id"])
        trigger_ids = [entity_key("im", topic) for topic in definition["topics"]]
        trigger_ids = [target for target in trigger_ids if target in im_by_id]
        if definition["trigger_os"]:
            os_target = entity_key("os", str(definition["trigger_os"]))
            if os_target in os_by_id:
                trigger_ids.append(os_target)
        if definition["trigger_file"]:
            os_target = entity_key("os", str(definition["trigger_file"]))
            if os_target in os_by_id:
                trigger_ids.append(os_target)
        trigger_ids = sorted(set(trigger_ids))
        deps: list[str] = []
        thread: str | None = None
        raw_level = 0
        version: str | None = None
        version_order: list[int] = []
        chapter: str | None = None
        chapter_id: str | None = None
        chapter_order: int | None = None
        chapter_staged = False
        if trigger_ids:
            candidates = [
                im_by_id[target] if target in im_by_id else os_by_id[target]
                for target in trigger_ids
            ]
            trigger = min(
                candidates,
                key=lambda item: (
                    item.raw_level,
                    ENTITY_ORDER[item.entity_type],
                    item.in_game_order,
                    item.entity_id,
                ),
            )
            deps = [trigger.entity_id]
            thread = trigger.thread
            raw_level = trigger.raw_level
            if trigger.entity_type == "os_log":
                version = trigger.version
                version_order = list(trigger.version_order)
                chapter = trigger.chapter
                chapter_id = trigger.chapter_id
                chapter_order = trigger.chapter_order
                chapter_staged = trigger.chapter_staged

        row = _Row(
            entity_id=entity_key("story_node", story_id),
            entity_type="story_node",
            thread=thread,
            raw_level=raw_level,
            deps=deps,
            in_game_order=int(definition["order"]),
            version=version,
            version_order=version_order,
            chapter=chapter,
            chapter_id=chapter_id,
            chapter_order=chapter_order,
            chapter_staged=chapter_staged,
            story_kind="event",
            has_trigger=bool(trigger_ids),
            provenance=[
                _rva(
                    f"il2cppdumper/dump.cs:{definition['name']}",
                    "story id and trigger constants",
                )
            ],
        )
        rows.append(row)

    branch_rows: dict[str, _Row] = {}
    targets: dict[str, list[str]] = {}
    sequence = 0
    for file_name, data in _branch_tables(source):
        if not isinstance(data, list):
            raise InputError(f"text/branchingosdata/{file_name} must be a JSON list")
        character = Path(file_name).stem
        for index, raw in enumerate(data):
            if not isinstance(raw, dict):
                raise BuildError(f"text/branchingosdata/{file_name}[{index}]: must be an object")
            game_id = str(raw.get("Id") or "").strip()
            if not game_id:
                raise BuildError(f"text/branchingosdata/{file_name}[{index}]: missing Id")
            unlock = raw.get("UnlockCondition") or {}
            view = raw.get("ViewSetting") or {}
            level = int(unlock.get("Level") or 0) if isinstance(unlock, dict) else 0
            node_id = entity_key("story_node", game_id)
            if node_id in branch_rows:
                raise BuildError(f"duplicate story node id: {node_id}")
            row = _Row(
                entity_id=node_id,
                entity_type="story_node",
                thread=_character_key(character),
                raw_level=level,
                level_locks=[{"character": _character_key(character), "level": level}],
                in_game_order=sequence,
                story_kind="branch",
                provenance=[_text_asset(f"text/branchingosdata/{file_name}[{index}]")],
            )
            branch_rows[node_id] = row
            if isinstance(view, dict):
                targets[node_id] = [
                    entity_key("story_node", str(value))
                    for value in view.get("LinkedFileIds") or []
                    if str(value)
                ]
            sequence += 1
    for node_id, linked in targets.items():
        for target in linked:
            if target in branch_rows:
                branch_rows[target].deps.append(node_id)
    rows.extend(branch_rows.values())
    return rows


# ------------------------------------------------------------------- assembly
def _apply_known_story_gates(rows: list[_Row]) -> None:
    by_id = {row.entity_id: row for row in rows}
    for story_id, conditions in STORY_LEVEL_GATES.items():
        row = by_id.get(entity_key("story_node", story_id))
        if row is None:
            continue
        gates = [
            {"character": _character_key(character), "level": level}
            for character, level in conditions
        ]
        row.level_locks = _sorted_level_locks(row.level_locks + gates)
        row.raw_level = max(row.raw_level, max(level for _, level in conditions))
        if row.thread is None:
            character, _ = max(conditions, key=lambda item: (item[1], item[0]))
            row.thread = _character_key(character)
        row.provenance.append(
            _manual(
                f"{story_id} condition check",
            )
        )

    for story_id, dependencies in STORY_AFTER.items():
        row = by_id.get(entity_key("story_node", story_id))
        if row is None:
            continue
        for dependency in dependencies:
            target = entity_key("story_node", dependency)
            if target in by_id and target not in row.deps:
                row.deps.append(target)
        row.provenance.append(
            _manual(f"{story_id} follows {', '.join(dependencies)}")
        )


def _apply_story_fallbacks(rows: list[_Row], packs: dict[str, _Pack]) -> None:
    """Give trigger-less story events their earliest dependent's thread/level.

    ``story04`` (Neko's level-24 event) and the ending chain have no
    ``TOUCH_IM_*`` constant in ``dump.cs``: their availability is a condition
    check, not a post.  The posts gated by such a story are the only data
    points we have, so the story inherits the earliest dependent's thread and
    level.  Stories with a real trigger keep the trigger's values.
    """
    by_id = {row.entity_id: row for row in rows}
    dependents: dict[str, list[_Row]] = {}
    for row in rows:
        for dependency in row.deps:
            dependents.setdefault(dependency, []).append(row)

    for row in rows:
        if row.entity_type != "story_node" or row.story_kind != "event":
            continue
        if row.has_trigger:
            continue
        candidates = dependents.get(row.entity_id) or []
        if not candidates:
            continue
        reference = min(
            candidates,
            key=lambda item: (
                TIER_RANK[_tier_of(_character(item.thread), packs)],
                item.raw_level,
                _thread_rank(item.thread, packs),
                ENTITY_ORDER[item.entity_type],
                item.in_game_order,
                item.entity_id,
            ),
        )
        if row.thread is None and reference.thread is not None:
            row.thread = reference.thread
        row.raw_level = max(row.raw_level, reference.raw_level)


def _finalize_rows(rows: list[_Row], packs: dict[str, _Pack]) -> None:
    all_ids = {row.entity_id for row in rows}
    by_id = {row.entity_id: row for row in rows}
    for row in rows:
        row.deps = [
            dependency
            for dependency in dict.fromkeys(row.deps)
            if dependency in all_ids and dependency != row.entity_id
        ]
        # An iM post is readable whenever its own level locks and story gates
        # are satisfied; the posting account's purchase does not gate it (a
        # Xenon post with PAFF/NEKO/ROBO locks is readable for free).  Other
        # entity types live in their account's pack, so the thread counts.
        row.phase = (
            0
            if row.entity_type == "im_post"
            else TIER_RANK[_tier_of(_character(row.thread), packs)]
        )
        for lock in row.level_locks:
            row.phase = max(
                row.phase,
                TIER_RANK[_tier_of(_character(lock["character"]), packs)],
            )

    # A dependency in a later phase would break "free before paid": lift the
    # dependent to the later phase instead of placing it before its gate.
    changed = True
    while changed:
        changed = False
        for row in rows:
            phase = row.phase
            for dependency in row.deps:
                phase = max(phase, by_id[dependency].phase)
            if phase > row.phase:
                row.phase = phase
                changed = True

    for row in rows:
        row.level_gate = max(row.raw_level, 0)


def _identity_from_locks(
    lock_pairs: Iterable[tuple[str, int]],
    avatar: str | None,
    lanes: dict[str, _LaneEntry],
    families: dict[str, str | None],
) -> str | None:
    """Legacy ``resolve_identity``: account behind an iM post."""
    for character, _ in lock_pairs:
        if character in lanes and character not in MAIN_TRIO:
            return character
    family = families.get(avatar or "")
    if family in lanes:
        return family
    candidate = _avatar_character(avatar or "", lanes)
    return candidate if candidate in lanes else None


def _lane_character(
    row: _Row,
    lanes: dict[str, _LaneEntry],
    families: dict[str, str | None],
) -> str | None:
    """The account a row belongs to; other entity types use their own thread."""
    if row.entity_type == "im_post":
        return _identity_from_locks(row.lock_pairs, row.avatar, lanes, families)
    character = row.character
    return character if character in lanes else None


def _apply_lane(
    rows: list[_Row],
    lanes: dict[str, _LaneEntry],
    families: dict[str, str | None],
) -> None:
    overrides = {
        character: tier
        for character, tier in CHARACTER_TIER_OVERRIDES.items()
        if character in lanes
    }
    for row in rows:
        row.cost = sum(int(lock["level"]) for lock in row.level_locks)
        character = _lane_character(row, lanes, families)
        if character is None:
            row.lane = PLOT_LANE
            row.lane_character = None
        else:
            row.lane = lanes[character].lane
            row.lane_character = _character_key(character)
        touched = [character] + [lock["character"] for lock in row.level_locks]
        for name in dict.fromkeys(touched):
            if name in overrides:
                row.provenance.append(
                    manual(
                        CHARACTER_TIER_LOCATOR,
                        f"{name} tier {overrides[name]}",
                    )
                )
                break


def _apply_timeline_scope(rows: list[_Row]) -> None:
    """Mark which rows belong to the global unlock timeline.

    Every iM post sits in the global feed, including posts by paid, side and
    NPC accounts.  OS logs belong to the timeline only for the seven main
    characters; every other OS log is reachable through its character page
    (sorted by version) and stays out of the timeline.  OA documents and story
    nodes belong to neither list.  The scope does not feed back into stage,
    lane or order; it is a projection label consumed by the SPA.
    """
    for row in rows:
        if row.entity_type == "im_post":
            row.timeline_scope = "timeline"
        elif row.entity_type == "os_log":
            character = _character(row.thread)
            row.timeline_scope = (
                "timeline" if character in TIMELINE_CHARACTERS else "character"
            )
            row.provenance.append(
                manual(
                    TIMELINE_SCOPE_LOCATOR,
                    f"{character or row.entity_id} OS timeline scope"
                    f" {row.timeline_scope}",
                )
            )
        else:
            row.timeline_scope = "none"


def _cap_rows(source: InputSource) -> list[list[dict[str, Any]]]:
    table = source.text_json("imdata", "im_lock_condition_data")
    if table is None or not isinstance(table.data, list):
        return []
    caps: list[list[dict[str, Any]]] = []
    for raw in table.data:
        if not isinstance(raw, dict):
            continue
        entries = []
        for entry in raw.get("LevelLocks") or []:
            if not isinstance(entry, dict):
                continue
            character = _character(entry.get("SongPackId"))
            if not character:
                continue
            entries.append(
                {
                    "character": character,
                    "level": int(entry.get("Level") or 0),
                    "locked": bool(entry.get("IsLevelLocked")),
                }
            )
        if any(entry["locked"] for entry in entries):
            caps.append(entries)
    return caps


def _cap_for(
    character: str, levels: dict[str, int], caps: list[list[dict[str, Any]]]
) -> int:
    cap = MAX_LEVEL
    for entries in caps:
        target = next(
            (
                entry
                for entry in entries
                if entry["character"] == character and entry["locked"]
            ),
            None,
        )
        if target is None:
            continue
        others_ok = all(
            levels.get(entry["character"], 0) >= entry["level"]
            for entry in entries
            if entry["character"] != character
        )
        if not others_ok:
            cap = min(cap, target["level"])
    return cap


def _levels_ok(row: _Row, levels: dict[str, int]) -> bool:
    return all(
        levels.get(_character(lock["character"]), 0) >= lock["level"]
        for lock in row.level_locks
    )


def _spoiler_ok(row: _Row, levels: dict[str, int]) -> bool:
    return all(
        levels.get(_character(condition["character"]), 0) >= condition["level"]
        for condition in row.spoiler_conditions
    )


def _simulate(
    rows: list[_Row],
    packs: dict[str, _Pack],
    caps: list[list[dict[str, Any]]],
    characters: set[str],
) -> dict[tuple[int, int], int]:
    """Tier-phased simulation; returns ``(phase, stage) -> trio level``."""
    stage_levels: dict[tuple[int, int], int] = {}
    all_ids = {row.entity_id for row in rows}
    side_gate = entity_key("story_node", LEGACY_SIDE_GATE)
    if side_gate not in all_ids:
        side_gate = None
    for phase in range(len(TIER_ORDER)):
        pending = [row for row in rows if row.phase == phase]
        if not pending:
            continue
        levels: dict[str, int] = {}
        for character in sorted(characters):
            tier = _tier_of(character, packs)
            levels[character] = (
                LEVEL_CAP if TIER_RANK[tier] < phase else 0
            )
        current = sorted(
            character
            for character in characters
            if TIER_RANK[_tier_of(character, packs)] == phase
        )
        read = {
            row.entity_id for row in rows if row.phase < phase
        }
        stage = 0
        while stage < MAX_STAGES:
            stage += 1
            progressed = False
            for character in current:
                cap = _cap_for(character, levels, caps)
                if levels[character] < cap:
                    levels[character] = min(cap, LEVEL_CAP)
                    progressed = True
            stage_levels[(phase, stage)] = max(
                (levels.get(character, 0) for character in MAIN_TRIO), default=0
            )
            while True:
                newly_read = False
                for row in sorted(pending, key=lambda item: item.sort_key(packs)):
                    if row.entity_id in read:
                        continue
                    if row.phase == TIER_RANK["side"] and side_gate:
                        # The legacy model keeps side content behind ending 02.
                        if side_gate not in read:
                            continue
                    if not _levels_ok(row, levels) or not _spoiler_ok(row, levels):
                        continue
                    if any(dependency not in read for dependency in row.deps):
                        continue
                    row.stage = stage
                    read.add(row.entity_id)
                    newly_read = True
                if not newly_read:
                    break
                progressed = True
            if not progressed:
                break
        for row in pending:
            if row.stage == 0:
                row.stage = UNSTAGED_STAGE
    return stage_levels


def _final_order(rows: list[_Row], packs: dict[str, _Pack]) -> list[_Row]:
    import heapq

    by_id = {row.entity_id: row for row in rows}
    ordered: list[_Row] = []
    for phase in range(len(TIER_ORDER)):
        phase_rows = [row for row in rows if row.phase == phase]
        phase_ids = {row.entity_id for row in phase_rows}
        indegree: dict[str, int] = {}
        dependents: dict[str, list[str]] = {}
        for row in phase_rows:
            indegree[row.entity_id] = sum(
                1 for dependency in row.deps if dependency in phase_ids
            )
            for dependency in row.deps:
                if dependency in phase_ids:
                    dependents.setdefault(dependency, []).append(row.entity_id)
        heap: list[tuple[Any, ...]] = []
        for row in phase_rows:
            if indegree[row.entity_id] == 0:
                heapq.heappush(heap, (row.sort_key(packs), row.entity_id))
        placed: list[_Row] = []
        while heap:
            _, entity_id = heapq.heappop(heap)
            row = by_id[entity_id]
            placed.append(row)
            for dependent in dependents.get(entity_id, []):
                indegree[dependent] -= 1
                if indegree[dependent] == 0:
                    heapq.heappush(
                        heap, (by_id[dependent].sort_key(packs), dependent)
                    )
        if len(placed) < len(phase_rows):
            placed_ids = {row.entity_id for row in placed}
            remaining = [
                row for row in phase_rows if row.entity_id not in placed_ids
            ]
            placed.extend(sorted(remaining, key=lambda item: item.sort_key(packs)))
        ordered.extend(placed)
    return ordered


def _legacy_im_order(
    source: InputSource,
    lanes: dict[str, _LaneEntry],
    families: dict[str, str | None],
    os_by_id: dict[str, _Row],
) -> dict[str, dict[str, Any]]:
    """Reproduce the legacy iM fixpoint and its ``readIndex``.

    The merged tier simulation deliberately separates free/paid/side, so it
    cannot reproduce the legacy global sequence (paid posts appear from round
    one there).  This pass is the parity twin: levels rise to the
    ``IsLevelLocked`` caps every round, story triggers fire from read posts, and
    side lanes wait for ``story_ending02``.  ``read_index`` is the legacy
    ``readIndex``: stages in order, ordered by cost, lane, and topic table
    position, with posts outside the model appended as blocked.
    """
    locks_table = source.text_json("imdata", "im_lock_condition_data")
    topics_table = source.text_json("imdata", "im_topic_data")
    if locks_table is None or not isinstance(locks_table.data, list):
        return {}

    topic_order: dict[str, int] = {}
    avatars: dict[str, str] = {}
    if topics_table is not None and isinstance(topics_table.data, list):
        for index, raw in enumerate(topics_table.data):
            if not isinstance(raw, dict):
                continue
            game_id = str(raw.get("Id") or "").strip().upper()
            if not game_id:
                continue
            topic_order.setdefault(game_id, index)
            avatars.setdefault(game_id, str(raw.get("AvatarId") or "").strip())

    entries: list[dict[str, Any]] = []
    for raw in locks_table.data:
        if not isinstance(raw, dict):
            continue
        game_id = str(raw.get("TopicId") or "").strip().upper()
        if not game_id:
            continue
        pairs: list[tuple[str, int]] = []
        locked: list[dict[str, Any]] = []
        for entry in raw.get("LevelLocks") or []:
            if not isinstance(entry, dict):
                continue
            character = _character(entry.get("SongPackId"))
            if character:
                level = int(entry.get("Level") or 0)
                pairs.append((character, level))
                locked.append(
                    {
                        "character": character,
                        "level": level,
                        "locked": bool(entry.get("IsLevelLocked")),
                    }
                )
        entries.append(
            {
                "id": game_id,
                "pairs": pairs,
                "locked": locked,
                "story": str(raw.get("StoryLockId") or "").strip(),
                "topic": str(raw.get("TopicLockId") or "").strip().upper(),
            }
        )

    triggers = _topic_triggers(source)
    characters = sorted(
        {character for entry in entries for character, _ in entry["pairs"]}
    )
    levels = {character: 0 for character in characters}
    read: set[str] = set()
    stories_done = set(LEGACY_DONE_BY_DEFAULT)
    stages: list[dict[str, Any]] = []

    def os_ready(entry_id: str) -> bool:
        row = os_by_id.get(entity_key("os", entry_id))
        if row is None:
            return False
        if any(
            levels.get(character, 0) < level for character, level in row.lock_pairs
        ):
            return False
        for dependency in row.deps:
            kind, _, target = dependency.partition("/")
            if kind in ("os", "story_node") and target not in stories_done:
                return False
        return True

    def caps() -> dict[str, int]:
        cap = {character: MAX_LEVEL for character in characters}
        for entry in entries:
            for target in entry["locked"]:
                if not target["locked"]:
                    continue
                others = {
                    item["character"]: item["level"]
                    for item in entry["locked"]
                    if item["character"] != target["character"]
                }
                if all(
                    levels.get(other, 0) >= need for other, need in others.items()
                ):
                    continue
                cap[target["character"]] = min(
                    cap[target["character"]], target["level"]
                )
        return cap

    def lane_of(entry: dict[str, Any]) -> int:
        character = _identity_from_locks(
            entry["pairs"], avatars.get(entry["id"], ""), lanes, families
        )
        member = lanes.get(character) if character else None
        return member.lane if member else PLOT_LANE

    for stage in range(1, 200):
        before = (dict(levels), len(read), len(stories_done))
        for character, cap in caps().items():
            levels[character] = max(levels[character], min(cap, LEVEL_CAP))
        for story_id, (character, need) in LEGACY_LEVEL_STORY.items():
            if levels.get(character, 0) >= need:
                stories_done.add(story_id)
        stories_done |= LEGACY_ALWAYS
        for story_id, entry_id in LEGACY_OS_STORY_NEEDS.items():
            if story_id not in stories_done and os_ready(entry_id):
                stories_done.add(story_id)
        changed = True
        while changed:
            changed = False
            for story_id, needs in STORY_AFTER.items():
                if story_id in stories_done or not set(needs) <= stories_done:
                    continue
                required = STORY_LEVEL_GATES.get(story_id)
                if required and any(
                    levels.get(character, 0) < level
                    for character, level in required
                ):
                    continue
                stories_done.add(story_id)
                changed = True

        newly: list[str] = []
        changed = True
        while changed:
            changed = False
            for entry in entries:
                game_id = entry["id"]
                if game_id in read:
                    continue
                if entry["story"] and entry["story"] not in stories_done:
                    continue
                if entry["topic"] and entry["topic"] not in read:
                    continue
                if any(
                    levels.get(character, 0) < level
                    for character, level in entry["pairs"]
                ):
                    continue
                lane = lane_of(entry)
                if (
                    TIER_RANK["side"] * 100 <= lane < PLOT_LANE
                    and LEGACY_SIDE_GATE not in stories_done
                ):
                    continue
                read.add(game_id)
                newly.append(game_id)
                if game_id in triggers:
                    stories_done.add(triggers[game_id])
                changed = True
        if not newly and (dict(levels), len(read), len(stories_done)) == before:
            break
        stages.append(
            {
                "stage": stage,
                "lock_level": max(
                    (levels.get(character, 0) for character in MAIN_TRIO),
                    default=0,
                ),
                "posts": newly,
            }
        )

    blocked = [entry["id"] for entry in entries if entry["id"] not in read]
    cost = {
        entry["id"]: sum(level for _, level in entry["pairs"])
        for entry in entries
    }
    topic_seq = {entry["id"]: topic_order.get(entry["id"], 10_000) for entry in entries}
    lanes_by_id = {entry["id"]: lane_of(entry) for entry in entries}
    stage_of: dict[str, int] = {
        game_id: stage["stage"]
        for stage in stages
        for game_id in stage["posts"]
    }
    lock_level = {
        game_id: stage["lock_level"]
        for stage in stages
        for game_id in stage["posts"]
    }

    read_index: dict[str, int] = {}
    sequence = 0
    for stage in stages:
        ordered = sorted(
            stage["posts"],
            key=lambda game_id: (
                cost.get(game_id, 0),
                lanes_by_id.get(game_id, PLOT_LANE),
                topic_seq.get(game_id, 10_000),
            ),
        )
        for game_id in ordered:
            sequence += 1
            read_index[game_id] = sequence

    external: dict[str, str] = {}
    by_id = {entry["id"]: entry for entry in entries}
    blocked_sorted = sorted(
        blocked,
        key=lambda game_id: (
            max(
                (level for _, level in by_id[game_id]["pairs"]),
                default=0,
            ),
            topic_seq.get(game_id, 10_000),
        ),
    )
    for game_id in blocked_sorted:
        sequence += 1
        read_index[game_id] = sequence
        entry = by_id[game_id]
        external[game_id] = (
            entry["story"]
            or entry["topic"]
            or "level or prerequisite outside the model"
        )

    return {
        entry["id"]: {
            "stage": stage_of.get(entry["id"], BLOCKED_STAGE),
            "read_index": read_index.get(entry["id"]),
            "lock_level": lock_level.get(entry["id"], 0),
            "external": external.get(entry["id"]),
        }
        for entry in entries
    }


def _record(row: _Row) -> dict[str, Any]:
    return {
        "id": entity_key("reading_order", row.entity_id),
        "type": "reading_order",
        "entity_id": row.entity_id,
        "entity_type": row.entity_type,
        "timeline_scope": row.timeline_scope,
        "stage": row.stage,
        "level_gate": row.level_gate,
        "original_level": row.raw_level,
        "tier": TIER_ORDER[row.phase],
        "thread": row.thread,
        "level_locks": row.level_locks,
        "version": row.version,
        "version_order": row.version_order,
        "chapter": row.chapter,
        "chapter_id": row.chapter_id,
        "chapter_order": row.chapter_order,
        "chapter_staged": row.chapter_staged,
        "spoiler_alert": row.spoiler_alert,
        "spoiler_conditions": row.spoiler_conditions,
        "in_game_order": row.in_game_order,
        "cost": row.cost,
        "lane": row.lane,
        "lane_character": row.lane_character,
        "lock_level": row.lock_level,
        "branch": row.branch,
        "external": row.external,
        "read_index": row.read_index,
        "order": 0,
        "provenance": row.provenance,
    }


def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    alerts, alerts_by_character = _spoilers()
    packs = _packs(source)
    lanes = _lane_table(packs)
    families = _avatar_families(source, lanes)

    im_rows = _im_rows(source, packs)
    os_rows = _os_rows(source)
    oa_rows = _oa_rows(source)
    im_by_id = {row.entity_id: row for row in im_rows}
    os_by_id = {row.entity_id: row for row in os_rows}
    rows = im_rows + os_rows + oa_rows + _story_rows(source, packs, im_by_id, os_by_id)

    _apply_known_story_gates(rows)
    _apply_story_fallbacks(rows, packs)
    _finalize_rows(rows, packs)
    _apply_lane(rows, lanes, families)
    _apply_timeline_scope(rows)

    for row in rows:
        alert = alerts_by_character.get(row.character or "")
        row.level_gate = row.raw_level
        row.spoiler_alert = None
        row.spoiler_conditions = []
        if alert is not None:
            row.spoiler_alert = alert.entity_id
            row.spoiler_conditions = [
                {"character": _character_key(character), "level": level}
                for character, level in alert.conditions
            ]
            row.level_gate = max(row.level_gate, alert.threshold)

    characters: set[str] = set(packs)
    for row in rows:
        if row.character:
            characters.add(row.character)
        for lock in row.level_locks:
            character = _character(lock["character"])
            if character:
                characters.add(character)
        for condition in row.spoiler_conditions:
            characters.add(_character(condition["character"]))

    stage_levels = _simulate(rows, packs, _cap_rows(source), characters)
    legacy = _legacy_im_order(source, lanes, families, os_by_id)
    for row in rows:
        game_id = row.entity_id.split("/", 1)[1]
        legacy_row = legacy.get(game_id) if row.entity_type == "im_post" else None
        if legacy_row is not None:
            # The legacy sequence is the parity contract for iM posts: it owns
            # their stage, read index, stage trio level and blocked bucket.
            row.stage = legacy_row["stage"]
            row.read_index = legacy_row["read_index"]
            row.external = legacy_row["external"]
            row.lock_level = legacy_row["lock_level"]
        else:
            row.lock_level = stage_levels.get((row.phase, row.stage), 0)
            if row.stage == UNSTAGED_STAGE and row.external is None:
                row.external = "unresolved prerequisite"

        story = row.story_lock if row.entity_type == "im_post" else (
            game_id if row.entity_type == "story_node" else None
        )
        if story in BRANCH_LABELS:
            row.branch = BRANCH_LABELS[story]
            row.provenance.append(
                manual(BRANCH_LOCATOR, f"branch label for {story}")
            )

    ordered = _final_order(rows, packs)

    records: list[dict[str, Any]] = []
    for position, row in enumerate(ordered, start=1):
        record = _record(row)
        record["order"] = position
        _sorted_provenance(record)
        records.append(record)
    return {
        "spoiler_alert": [alert.record() for alert in alerts],
        "reading_order": records,
    }
