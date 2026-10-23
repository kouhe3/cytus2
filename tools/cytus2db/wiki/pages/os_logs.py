"""OS archive page builder (ticket #11).

One page per ``os_log`` entity.  The page title is the OS file name plus the
owning character in full-width parentheses; ``ver`` is always emitted from the
APK's ``Category`` value because the template's default is malformed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Iterable

from ...keys import DIFFICULTIES
from ..db import Database
from ..model import SEMANTIC_TEMPLATE, Conflict, Field, PageModel, Section, Text
from ._content import (
    disambiguate_titles,
    display_name,
    grouped_records,
    localized,
    one_line,
    pick_language,
    render_blocks,
)

_FILE_TYPES = {
    0: "text",
    1: "audio",
    2: "mail",
    3: "cam",
    4: "messenger",
    5: "image",
    6: "image",
    7: "image",
    8: "booklet",
    9: "diffr2",
    10: "diffr2",
    11: "booklet",
}
_DIFFICULTY_INDEX = {name: index for index, name in enumerate(DIFFICULTIES)}
_SOURCE_INDEX = re.compile(r"\[(\d+)\]$")


def build(db: Database) -> list[PageModel]:
    characters = {record["id"]: record for record in db.records("character")}
    text = grouped_records(db.text_records("im_os"), "os_log")
    models: list[PageModel] = []
    for record in sorted(db.records("os_log"), key=lambda item: item["id"]):
        fields: list[Field] = []
        omitted: dict[str, str] = {}
        conflicts: list[Conflict] = []

        name = localized(record.get("names")) or one_line(record.get("game_id"))
        character = characters.get(f"character/{record.get('file')}")
        character_name = one_line(character.get("name")) if character else ""
        if not character_name:
            character_name = one_line(record.get("file"))
        title = (
            f"{display_name(name)}（{display_name(character_name)}）"
            if character_name
            else display_name(name)
        )
        fields.append(Field("title", Text.of(title)))
        fields.append(Field("filename", Text.of(name)))

        log_type = record.get("log_type")
        file_type = _FILE_TYPES.get(log_type) if isinstance(log_type, int) else None
        if file_type:
            fields.append(Field("file_type", Text.of(file_type)))
        else:
            omitted["file_type"] = "unknown_log_type"
            conflicts.append(Conflict("unknown_file_type", f"type {log_type!r}"))

        sort_key = _source_order(record)
        if sort_key is not None:
            fields.append(Field("sort_key", Text.of(str(sort_key))))
        else:
            omitted["sort_key"] = "source_order_unavailable"

        if character_name:
            fields.append(Field("character", Text.of(character_name)))
        else:
            omitted["character"] = "character_not_found"
            conflicts.append(
                Conflict("missing_character", f"{record.get('file')!r} has no character")
            )

        unlock_song, unlock_chart = _unlock_fields(record["id"], db, conflicts)
        if unlock_song:
            fields.append(Field("unlock_song", Text.of(unlock_song)))
        if unlock_chart:
            fields.append(Field("unlock_chart", Text.of(unlock_chart)))

        fields.append(Field("file_id", Text.of(record["game_id"])))
        date = one_line(record.get("date"))
        if date:
            fields.append(Field("time", Text.of(date)))
        else:
            omitted["time"] = "date_missing"

        content, block_conflicts = _content(record, text)
        conflicts.extend(block_conflicts)
        if content:
            fields.append(Field("content", Text.of(content)))
        else:
            omitted["content"] = "content_missing"
            conflicts.append(Conflict("missing_content", record["game_id"]))

        category = one_line(record.get("category"))
        if category:
            fields.append(Field("ver", Text.of(category)))
        else:
            omitted["ver"] = "category_missing"
            conflicts.append(Conflict("missing_ver", record["game_id"]))

        models.append(
            PageModel(
                entity_id=record["id"],
                page_type="os_log",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("os",),
                omitted=omitted,
                conflicts=tuple(_dedupe(conflicts)),
            )
        )
    disambiguate_titles(models)
    return models


def _source_order(record: dict[str, Any]) -> int | None:
    """1-based position of the row in its ``text/osdata/<file>`` table."""
    for entry in record.get("provenance") or []:
        match = _SOURCE_INDEX.search(str(entry.get("locator") or ""))
        if match:
            return int(match.group(1)) + 1
    return None


def _content(
    record: dict[str, Any], text: dict[str, dict[str, dict[str, Any]]]
) -> tuple[str, list[Conflict]]:
    records = text.get(str(record.get("text_ref") or ""), {})
    blocks = pick_language(records, "blocks")
    if not blocks:
        return "", []
    return render_blocks(
        blocks, dialogue_template="os/对话", sound_template="os/声音"
    )


def _unlock_fields(
    entity_id: str, db: Database, conflicts: list[Conflict]
) -> tuple[str, str]:
    by_song: dict[str, list[str]] = defaultdict(list)
    for edge in db.edges:
        if edge.source != entity_id or edge.relation != "unlocks_chart":
            continue
        target = edge.target
        song_id, separator, difficulty = target.partition("@")
        if not separator or not song_id.startswith("song/"):
            conflicts.append(Conflict("unknown_chart_target", target))
            continue
        by_song[song_id.split("/", 1)[1]].append(difficulty)

    songs: list[str] = []
    charts: list[str] = []
    for song_id in sorted(by_song):
        song = db.get(f"song/{song_id}")
        title = one_line(song.get("name")) if song else ""
        if not title:
            title = song_id
            conflicts.append(Conflict("missing_song", song_id))
        difficulties = sorted(
            set(by_song[song_id]), key=lambda name: _DIFFICULTY_INDEX.get(name, 99)
        )
        if len(difficulties) == 1:
            charts.append(f"[[{title}]]（{difficulties[0]}）")
        else:
            songs.append(f"[[{title}]]（{_difficulty_range(difficulties)}）")
    return "\n".join(songs), "\n".join(charts)


def _difficulty_range(difficulties: Iterable[str]) -> str:
    ordered = sorted(difficulties, key=lambda name: _DIFFICULTY_INDEX.get(name, 99))
    indices = [_DIFFICULTY_INDEX.get(name, 99) for name in ordered]
    if indices == list(range(indices[0], indices[-1] + 1)):
        return f"{ordered[0]}~{ordered[-1]}"
    return "/".join(ordered)


def _dedupe(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
