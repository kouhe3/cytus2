"""Backup Database item page builder (ticket #11).

One page per ``gallery_item``.  Folders are not page templates in this batch,
but the site's folder-page title convention (``角色（gallery）``) is kept in
:func:`folder_title` so later link builders cannot invent another form.
"""

from __future__ import annotations

import re
from collections import Counter
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
    localized,
    one_line,
)

_FILE_TYPES = {"video": "video", "image": "image", "boss_stage": "bossstage"}
_FOLDER_INDEX = re.compile(r"\[(\d+)\]$")


class GalleryPageModel(PageModel):
    """A gallery item keeps ``folder/location`` as its entity id.

    The renderer derives the output file name from ``game_id()`` and rejects
    path separators, so gallery pages sanitise only the file name and keep the
    canonical entity id intact for reports and patches.
    """

    def game_id(self) -> str:
        return super().game_id().replace("/", "_")


def folder_title(name: Any) -> str:
    """The site's gallery folder page title, e.g. ``NEKO（gallery）``."""
    return f"{display_name(name)}（gallery）"


def build(db: Database) -> list[PageModel]:
    folders = {record["id"]: record for record in db.records("gallery_folder")}
    characters = {record["id"]: record for record in db.records("character")}
    boss_stages = {
        record.get("gallery_item_id"): record
        for record in db.records("boss_stage")
        if record.get("gallery_item_id")
    }
    song_titles = {
        one_line(record.get("name")) for record in db.records("song")
    }
    models: list[PageModel] = []
    for item in sorted(db.records("gallery_item"), key=lambda record: record["id"]):
        fields: list[Field] = []
        omitted: dict[str, str] = {}
        conflicts: list[Conflict] = []

        folder = folders.get(str(item.get("folder_id") or ""))
        folder_name = one_line(folder.get("name")) if folder else ""
        character = (
            characters.get(f"character/{folder.get('game_id')}") if folder else None
        )
        character_name = one_line(character.get("name")) if character else ""
        if not character_name:
            character_name = folder_name or one_line(item.get("folder_id"))

        name = one_line(item.get("name")) or one_line(item.get("location"))
        title = (
            f"{display_name(name)}（{display_name(folder_name)}）"
            if folder_name
            else display_name(name)
        )
        fields.append(Field("title", Text.of(title)))
        fields.append(Field("filename", Text.of(name)))

        sort_key = _folder_order(item)
        if sort_key is not None:
            fields.append(Field("sort_key", Text.of(str(sort_key))))
        else:
            omitted["sort_key"] = "folder_order_unavailable"

        if character_name:
            fields.append(Field("character", Text.of(character_name)))
        else:
            omitted["character"] = "character_not_found"

        file_type = _FILE_TYPES.get(str(item.get("kind") or ""))
        if file_type:
            fields.append(Field("file_type", Text.of(file_type)))
        else:
            omitted["file_type"] = "unknown_item_kind"
            conflicts.append(
                Conflict("unknown_item_kind", repr(item.get("kind")))
            )

        content, content_conflicts = _content(item, boss_stages, song_titles)
        conflicts.extend(content_conflicts)
        if content:
            fields.append(Field("content", Text.of(content)))
        else:
            omitted["content"] = "content_unavailable"

        models.append(
            GalleryPageModel(
                entity_id=item["id"],
                page_type="gallery_item",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("gallery",),
                omitted=omitted,
                conflicts=tuple(_dedupe(conflicts)),
                provenance=provenance_of(item),
            )
        )
    disambiguate_titles(models, reserved=_os_titles(db))
    return models


def _os_titles(db: Database) -> Counter[str]:
    """OS pages already exist on the site; new gallery pages must yield."""
    characters = {record["id"]: record for record in db.records("character")}
    titles: Counter[str] = Counter()
    for record in db.records("os_log"):
        name = localized(record.get("names")) or one_line(record.get("game_id"))
        character = characters.get(f"character/{record.get('file')}")
        owner = one_line(character.get("name")) if character else ""
        if not owner:
            owner = one_line(record.get("file"))
        titles[
            f"{display_name(name)}（{display_name(owner)}）"
            if owner
            else display_name(name)
        ] += 1
    return titles


def _folder_order(item: dict[str, Any]) -> int | None:
    for entry in item.get("provenance") or []:
        match = _FOLDER_INDEX.search(str(entry.get("locator") or ""))
        if match:
            return int(match.group(1)) + 1
    return None


def _content(
    item: dict[str, Any],
    boss_stages: dict[str, dict[str, Any]],
    song_titles: set[str],
) -> tuple[str, list[Conflict]]:
    kind = str(item.get("kind") or "")
    if kind == "image":
        location = one_line(item.get("location"))
        if not location:
            return "", [Conflict("missing_location", item["id"])]
        return f"[[File:{location}.png|thumb]]", []
    if kind == "boss_stage":
        stage = boss_stages.get(item["id"])
        display = one_line(stage.get("display_name")) if stage else ""
        if display and display in song_titles:
            return f"游玩[[{display}]]", []
        return "", [Conflict("boss_song_missing", item["id"])]
    if kind == "video":
        return "", [Conflict("video_source_missing", item["id"])]
    return "", []


def _dedupe(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
