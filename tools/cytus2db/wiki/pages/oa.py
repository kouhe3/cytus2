"""OA file page builder (ticket #11).

One page per ``oa_document``.  The body comes from ``text/oa.jsonl``; the
mission sentence and its target come from the derived ``oa_mission`` text
artifact and are split exactly the way the site's existing pages do it.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from ..db import Database
from ..model import (
    SEMANTIC_TEMPLATE,
    Conflict,
    Field,
    PageModel,
    Section,
    Text,
    provenance_of,
)
from ._content import (
    disambiguate_titles,
    display_name,
    grouped_records,
    localized,
    one_line,
    parse_script,
    pick_language,
    render_document,
)

_DOCUMENT_ORDER = re.compile(r"_oa(\d+)$")
_SONG_MISSION_TYPES = {
    "play_song",
    "play_song_with_combo",
    "play_song_with_combo_difficulty",
    "play_song_with_difficulty",
    "play_song_with_rank",
    "play_song_with_rank_difficulty",
    "play_song_with_specific_rank",
    "song_record_with_tp",
    "song_record_with_tp_difficulty",
}


def build(db: Database) -> list[PageModel]:
    characters = {record["id"]: record for record in db.records("character")}
    oa_text = grouped_records(db.text_records("oa"), "oa_object")
    document_text = grouped_records(db.text_records("oa"), "oa_document")
    missions = grouped_records(db.text_records("oa_missions"), "oa_mission")
    models: list[PageModel] = []
    for document in sorted(db.records("oa_document"), key=lambda item: item["id"]):
        fields: list[Field] = []
        omitted: dict[str, str] = {}
        conflicts: list[Conflict] = []

        records = document_text.get(str(document.get("text_ref") or ""), {})
        name = one_line(pick_language(records, "name")) or document["game_id"]
        character_key = str(document.get("character_id") or "")
        character = characters.get(character_key)
        character_name = one_line(character.get("name")) if character else ""
        if not character_name:
            oa_character = db.get(
                f"oa_character/{character_key.split('/', 1)[-1]}"
            )
            character_name = one_line(oa_character.get("name")) if oa_character else ""
        title = (
            f"{display_name(name)}（{display_name(character_name)}）"
            if character_name
            else display_name(name)
        )
        fields.append(Field("title", Text.of(title)))

        object_name = ""
        object_record = db.get(str(document.get("object_id") or ""))
        if object_record is not None:
            object_records = oa_text.get(str(object_record.get("text_ref") or ""), {})
            object_name = one_line(pick_language(object_records, "name"))
        if object_name:
            fields.append(Field("object", Text.of(object_name)))
        else:
            omitted["object"] = "object_name_missing"
            conflicts.append(Conflict("missing_object_name", document["game_id"]))

        fields.append(Field("filename", Text.of(name)))

        description, condition = _mission_text(document, db, missions, conflicts)
        if description:
            fields.append(Field("description", Text.of(description)))
        else:
            omitted["description"] = "mission_text_missing"
        if condition:
            fields.append(Field("condition", Text.of(condition)))

        sort_key = _document_order(document["game_id"])
        if sort_key is not None:
            fields.append(Field("sort_key", Text.of(str(sort_key))))
        else:
            omitted["sort_key"] = "document_order_unavailable"

        content = str(pick_language(records, "text") or "")
        rendered, block_conflicts = render_document(
            parse_script(content),
            dialogue_template="oa/对话",
            sound_template="oa/声音",
            poem_prose=True,
        )
        conflicts.extend(block_conflicts)
        if rendered:
            fields.append(Field("content", Text.of(rendered)))
        else:
            omitted["content"] = "content_missing"
            conflicts.append(Conflict("missing_content", document["game_id"]))

        models.append(
            PageModel(
                entity_id=document["id"],
                page_type="oa_document",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("oa",),
                omitted=omitted,
                conflicts=tuple(_dedupe(conflicts)),
                provenance=provenance_of(document),
            )
        )
    disambiguate_titles(models)
    return models


def _document_order(game_id: str) -> int | None:
    match = _DOCUMENT_ORDER.search(game_id)
    return int(match.group(1)) if match else None


def _mission_text(
    document: dict[str, Any],
    db: Database,
    missions: dict[str, dict[str, dict[str, Any]]],
    conflicts: list[Conflict],
) -> tuple[str, str]:
    mission_id = str(document.get("mission_id") or "")
    if not mission_id:
        return "", ""
    records = missions.get(f"oa_mission/{mission_id}", {})
    if not records:
        conflicts.append(Conflict("mission_text_missing", mission_id))
        return "", ""
    details = _multiline(pick_language(records, "text"))
    lines = [line.strip() for line in details.split("\n") if line.strip()]
    if not lines:
        conflicts.append(Conflict("mission_text_missing", mission_id))
        return "", ""
    description = lines[0]
    condition = " ".join(lines[1:])
    if not condition:
        condition = _condition_target(records, db)
    return description, condition


def _multiline(value: Any) -> str:
    """Keep mission line breaks; only normalise carriage returns."""
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _condition_target(
    records: dict[str, dict[str, Any]], db: Database
) -> str:
    sample = next(iter(records.values()), {})
    mission_type = str(sample.get("mission_type") or "")
    args = str(sample.get("args") or "")
    if mission_type in _SONG_MISSION_TYPES:
        song_id = args.split(",", 1)[0].strip()
        song = db.get(f"song/{song_id}") if song_id else None
        return one_line(song.get("name")) if song else song_id
    if mission_type == "read_os_file":
        log = db.get(f"os/{args}")
        return localized(log.get("names")) if log else args
    if mission_type == "read_branching_os_file":
        node = db.get(f"story_node/{args}")
        return localized(node.get("names")) if node else args
    return ""


def _dedupe(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
