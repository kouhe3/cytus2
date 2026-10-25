"""Expansion packs: song-only DLC sold separately from character packs.

``sharedassets0.assets:expansion_pack_data`` carries ``ExpansionPackList`` and
``ExpansionBox``.  Every song in an expansion pack names the character pack it
belongs to via ``SongPackId`` (for example ``expack049`` adds five ``ai001``
songs), so an expansion pack never introduces a character of its own.
"""

from __future__ import annotations

from typing import Any

from ..entities import song_and_charts
from ..errors import BuildError, InputError
from ..keys import entity_key
from ..provenance import sort_record, text_asset
from ..sources import InputSource

_text_asset = text_asset
_sorted_provenance = sort_record


def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    table = source.expansion_packs()
    if table is None:
        return {}
    audio_lengths = source.song_audio_lengths()
    data = table.data
    if not isinstance(data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    raw_packs = data.get("ExpansionPackList")
    if not isinstance(raw_packs, list):
        raise InputError(f"{table.locator}/ExpansionPackList must be a list")

    packs: list[dict[str, Any]] = []
    songs: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []
    for pack_index, raw in enumerate(raw_packs):
        where = f"{table.locator}/ExpansionPackList[{pack_index}]"
        if not isinstance(raw, dict):
            raise BuildError(f"{where}: must be an object")
        game_id = str(raw.get("ExpansionPackId") or "").strip()
        if not game_id:
            raise BuildError(f"{where}: missing ExpansionPackId")
        raw_songs = raw.get("SongInfoList")
        if not isinstance(raw_songs, list):
            raise BuildError(f"{where}: SongInfoList must be a list")
        if not raw_songs:
            raise BuildError(f"{where}: SongInfoList must not be empty")

        song_ids: list[str] = []
        character_ids: list[str] = []
        for song_index, raw_song in enumerate(raw_songs):
            song_where = f"{where}.SongInfoList[{song_index}]"
            if not isinstance(raw_song, dict):
                raise BuildError(f"{song_where}: must be an object")
            song_pack_id = str(raw_song.get("SongPackId") or "").strip()
            if not song_pack_id:
                raise BuildError(f"{song_where}: missing SongPackId")
            # Expansion JSON uses PascalCase where the base catalog uses
            # snake_case; normalise before sharing the catalog builder.
            normalized = {
                "song_id": raw_song.get("SongId"),
                "song_name": raw_song.get("SongName"),
                "artist": raw_song.get("Artist"),
                "charts": raw_song.get("Charts") or {},
                "Category": raw_song.get("Category"),
                "is_hidden": raw_song.get("IsHidden"),
                "IsDownloadOnly": raw_song.get("IsDownloadOnly"),
                "HideWhenLocked": raw_song.get("HideWhenLocked"),
                "AlternativeSearchTerms": raw_song.get("AlternativeSearchTerms"),
            }
            song, song_charts = song_and_charts(
                normalized,
                song_pack_id,
                song_where,
                expansion_pack_id=game_id,
                audio_lengths=audio_lengths,
            )
            song_ids.append(song["id"])
            character_id = entity_key("character", song_pack_id)
            if character_id not in character_ids:
                character_ids.append(character_id)
            songs.append(song)
            charts.extend(song_charts)

        packs.append(
            {
                "id": entity_key("expansion_pack", game_id),
                "type": "expansion_pack",
                "game_id": game_id,
                "name": str(raw.get("ExpansionPackName") or ""),
                "price": str(raw.get("DefaultPrice") or ""),
                "icon": str(raw.get("IconPath") or ""),
                "box_id": str(raw.get("BoxId") or ""),
                "is_box_only": bool(raw.get("IsBoxOnly")),
                "is_pre_purchase": bool(raw.get("IsPrePurchase")),
                "order": int(raw.get("CreateOrder") or 0),
                "song_ids": song_ids,
                "character_ids": character_ids,
                "provenance": [_text_asset(f"{table.locator}/ExpansionPackList[{pack_index}]")],
            }
        )

    for record in packs + songs + charts:
        _sorted_provenance(record)
    packs.sort(key=lambda item: (item["order"], item["id"]))
    songs.sort(key=lambda item: item["id"])
    charts.sort(key=lambda item: item["id"])
    return {"expansion_pack": packs, "song": songs, "chart": charts}
