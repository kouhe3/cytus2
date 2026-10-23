"""Entity content for song pages, independent of any wiki dialect.

This module decides *what* a song page says: which template fields exist,
which unlock sources grant each chart and how the unlock prose reads.  It does
not know Bili parameter names or wikitext syntax.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable

from ..keys import DIFFICULTIES
from .db import Database
from .model import SEMANTIC_TEMPLATE, Conflict, Field, Link, PageModel, Section, Text

_LANG_ORDER = ("zh-Hans", "zh-Hant", "en", "ja", "ko")
_DIFFICULTY_INDEX = {name: index for index, name in enumerate(DIFFICULTIES)}
_TRAILING_NUMBER = re.compile(r"^(?P<prefix>.*_)(?P<number>[0-9]+)$")

# Store wording the wiki uses for unlock sources.  The exact templates for
# OS/OA/Gallery pages arrive in ticket #11; until then the entity title is the
# link target and the source kind selects the verb.
_SOURCE_VERBS = {
    "im_post": "阅读 iM 贴文",
    "os_log": "阅读 OS 档案",
    "oa_object": "分析 OA 档案",
    "story_node": "完成剧情",
    "capso_shop_item": "在 CAPSO 商店购买",
    "gacha_reward": "通过抽奖获得",
}


@dataclass(frozen=True)
class _UnlockLine:
    difficulty: str
    text: Text


def build_song_pages(db: Database) -> list[PageModel]:
    """Return one page model per song entity, sorted by entity id."""
    packs = {record["id"]: record for record in db.records("pack")}
    characters_by_pack: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for character in db.records("character"):
        pack_id = character.get("pack_id")
        if pack_id:
            characters_by_pack[pack_id].append(character)

    charts_by_song: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chart in db.records("chart"):
        charts_by_song[chart["song_id"]].append(chart)

    songs = sorted(db.records("song"), key=lambda record: record["id"])
    sort_keys = _pack_sort_keys(songs)
    oa_names = _oa_object_names(db)

    pages: list[PageModel] = []
    for song in songs:
        conflicts: list[Conflict] = []
        omitted: dict[str, str] = {}
        fields: list[Field] = []

        name = _text(song.get("name"))
        if name:
            fields.append(Field("title", Text.of(name)))

        artist = _text(song.get("artist"))
        if artist:
            fields.append(Field("artist", Text.of(artist)))

        pack = packs.get(song.get("pack_id") or "")
        if pack is None:
            omitted["pack"] = "pack_reference_missing"
            conflicts.append(
                Conflict("missing_pack", f"{song['id']} -> {song.get('pack_id')!r}")
            )
        else:
            pack_name = _text(pack.get("name")) or _text(pack.get("game_id"))
            if pack_name:
                fields.append(Field("pack", Text.of(pack_name)))

        characters = sorted(
            characters_by_pack.get(song.get("pack_id") or "", []),
            key=lambda record: record["id"],
        )
        if characters:
            names = [_text(character.get("name")) or character["game_id"] for character in characters]
            if len(names) > 1:
                conflicts.append(
                    Conflict(
                        "multiple_characters",
                        f"{song['id']} pack has {len(names)} characters",
                    )
                )
            fields.append(Field("character", Text.of("、".join(names))))
        else:
            omitted["character"] = "character_not_found"

        charts = charts_by_song.get(song["id"], [])
        ratings = _ratings(charts, conflicts)
        for difficulty, level in ratings:
            fields.append(Field(f"rating.{difficulty}", Text.of(level)))

        charts_with_unlock = [chart for chart in charts if chart.get("need_unlock")]
        unlock = _unlock_method(
            song, charts_with_unlock, db, oa_names=oa_names, conflicts=conflicts
        )
        if unlock is not None:
            fields.append(Field("unlock_method", unlock))
        else:
            omitted["unlock_method"] = "no_unlock_edges"

        sort_key = sort_keys.get(song["id"])
        if sort_key is not None:
            fields.append(Field("sort_key", Text.of(str(sort_key))))

        pages.append(
            PageModel(
                entity_id=song["id"],
                page_type="song",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("song",),
                omitted=omitted,
                conflicts=tuple(_dedupe_conflicts(conflicts)),
            )
        )
    return pages


# ------------------------------------------------------------------ helpers
def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _localized(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    for language in _LANG_ORDER:
        text = _text(value.get(language))
        if text:
            return text
    return ""


def _ratings(
    charts: Iterable[dict[str, Any]], conflicts: list[Conflict]
) -> list[tuple[str, str]]:
    by_difficulty: dict[str, dict[str, Any]] = {}
    for chart in sorted(charts, key=lambda record: record["id"]):
        difficulty = chart["difficulty"]
        if difficulty in by_difficulty:
            conflicts.append(
                Conflict("duplicate_chart", f"{chart['song_id']}@{difficulty}")
            )
            continue
        by_difficulty[difficulty] = chart
    return [
        (difficulty, str(by_difficulty[difficulty]["level"]))
        for difficulty in DIFFICULTIES
        if difficulty in by_difficulty
    ]


def _pack_sort_keys(songs: Iterable[dict[str, Any]]) -> dict[str, int]:
    """Pack-local song number.

    Existing pages use the in-game song number: packs whose ids start at
    ``_000`` display ``suffix + 1``, packs starting at ``_001`` use the
    suffix.  The DB carries no catalog order, so this is the only stable
    value derivable without re-reading the source.
    """
    by_pack: dict[str, list[str]] = defaultdict(list)
    for song in songs:
        by_pack[song.get("pack_id") or ""].append(song["id"])
    order: dict[str, int] = {}
    for song_ids in by_pack.values():
        numbers: dict[str, int] = {}
        unnumbered: list[str] = []
        for song_id in song_ids:
            match = _TRAILING_NUMBER.match(song_id.split("/", 1)[-1])
            if match:
                numbers[song_id] = int(match.group("number"))
            else:
                unnumbered.append(song_id)
        offset = 1 if numbers and min(numbers.values()) == 0 else 0
        for song_id, number in numbers.items():
            order[song_id] = number + offset
        next_number = max(numbers.values(), default=0) + offset + 1
        for index, song_id in enumerate(sorted(unnumbered)):
            order[song_id] = next_number + index
    return order


def _oa_object_names(db: Database) -> dict[str, str]:
    """OA object display names from the optional text store, zh-Hans first."""
    names: dict[str, dict[str, str]] = defaultdict(dict)
    for record in db.text_records("oa"):
        if record.get("entity") != "oa_object":
            continue
        ref = str(record.get("ref") or "")
        language = str(record.get("lang") or "")
        name = _text(record.get("name"))
        if ref and language and name:
            names[ref].setdefault(language, name)
    result = {}
    for ref, by_language in names.items():
        for language in _LANG_ORDER:
            if language in by_language:
                result[ref] = by_language[language]
                break
    return result


def _level_prefix(record: dict[str, Any], db: Database) -> str:
    parts = []
    seen: set[tuple[str, int]] = set()
    locks = sorted(
        record.get("level_locks") or [],
        key=lambda item: (str(item.get("character")), int(item.get("level") or 0)),
    )
    for lock in locks:
        character_id = str(lock.get("character") or "")
        level = int(lock.get("level") or 0)
        if not character_id or (character_id, level) in seen:
            continue
        seen.add((character_id, level))
        character = db.get(character_id)
        name = _text(character.get("name")) if character else ""
        parts.append(f"{name or character_id.split('/', 1)[-1]} 等级达到 Lv.{level + 1}")
    return "、".join(parts)


def _os_title(record: dict[str, Any], db: Database) -> str:
    name = _localized(record.get("names")) or _text(record.get("game_id"))
    character = db.get(f"character/{record.get('file')}")
    if character is not None:
        owner = _text(character.get("name")) or character["game_id"]
        return f"{name}（{owner}）"
    return name


def _source_entry(
    source: dict[str, Any],
    db: Database,
    oa_names: dict[str, str],
    conflicts: list[Conflict],
) -> Text | None:
    kind = source.get("type")
    if kind == "im_post":
        title = _localized(source.get("titles")) or _text(source.get("game_id"))
        action = Text.of(_SOURCE_VERBS[kind] + " ", Link(title))
    elif kind == "os_log":
        title = _os_title(source, db)
        action = Text.of(_SOURCE_VERBS[kind] + " ", Link(title))
    elif kind == "oa_object":
        title = oa_names.get(f"oa_object/{source['game_id']}")
        if title:
            action = Text.of(_SOURCE_VERBS[kind] + " ", Link(title))
        else:
            action = Text.of(_SOURCE_VERBS[kind], f" {source['game_id']}")
            conflicts.append(
                Conflict("unlinked_source", f"oa_object/{source['game_id']}")
            )
    elif kind == "story_node":
        title = _localized(source.get("names"))
        if title:
            action = Text.of(_SOURCE_VERBS[kind] + " ", Link(title))
        else:
            action = Text.of(_SOURCE_VERBS[kind], f" {source['game_id']}")
            conflicts.append(
                Conflict("unlinked_source", f"story_node/{source['game_id']}")
            )
    elif kind == "capso_shop_item":
        pack = db.get(str(source.get("pack_id") or ""))
        name = _text(pack.get("name")) if pack else ""
        if name:
            action = Text.of(_SOURCE_VERBS[kind] + " ", Link(name))
        else:
            action = Text.of(_SOURCE_VERBS[kind])
            conflicts.append(
                Conflict("unlinked_source", f"capso_shop_item/{source['game_id']}")
            )
    elif kind == "gacha_reward":
        action = Text.of(_SOURCE_VERBS[kind])
    else:
        action = Text.of(f"解锁于 {source.get('id') or kind}")
        conflicts.append(
            Conflict("unknown_unlock_source", f"{source.get('id') or kind}")
        )

    prefix = _level_prefix(source, db)
    if prefix:
        return Text.of(prefix, " 后", action)
    return action


def _unlock_method(
    song: dict[str, Any],
    charts: list[dict[str, Any]],
    db: Database,
    *,
    oa_names: dict[str, str],
    conflicts: list[Conflict],
) -> Text | None:
    groups: dict[Text, list[str]] = defaultdict(list)
    for chart in charts:
        for edge in db.incoming("unlocks_chart", chart["id"]):
            source = db.require(edge.source)
            entry = _source_entry(source, db, oa_names, conflicts)
            if entry is None:
                continue
            groups[entry].append(chart["difficulty"])

    if not groups:
        return None

    lines: list[tuple[tuple[int, str], Text]] = []
    for entry, difficulties in groups.items():
        unique = sorted(
            set(difficulties), key=lambda item: _DIFFICULTY_INDEX.get(item, 99)
        )
        labels = "/".join(difficulty.upper() for difficulty in unique)
        suffix = _unlock_suffix(entry)
        text = Text.of(f"{labels} 难度：", entry, suffix)
        minimum = min(_DIFFICULTY_INDEX.get(item, 99) for item in unique)
        lines.append(((minimum, text.plain()), text))
    lines.sort(key=lambda item: item[0])
    parts: list[str | Text] = []
    for index, (_, text) in enumerate(lines):
        if index:
            parts.append("\n")
        parts.append(text)
    return Text.of(*parts)


def _unlock_suffix(entry: Text) -> str:
    last = entry.parts[-1] if entry.parts else ""
    if isinstance(last, Link):
        return " 解锁。"
    if last and last[-1].isascii() and last[-1].isalnum():
        return " 解锁。"
    return "解锁。"


def _dedupe_conflicts(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
