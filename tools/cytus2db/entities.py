"""Build the structure entities from the unpacked inputs.

Scope of this module: character, pack, folder (OS timeline folder), chapter,
song, chart, illustration, asset and subtitle_line. Content entities (iM, OS
logs, OA, story nodes, gallery, shops) belong to later tickets.

``asset`` is the media-resource catalog referenced by these entities:
illustration sprite bundles, voice clips, background-movie prefabs and the
image/audio/video ids used by OS content blocks. Gallery and shop media are
left to the tickets that own those entities.
"""

from __future__ import annotations

from typing import Any

from .errors import BuildError, InputError
from .keys import asset_key, chart_key, entity_key, slug, song_key
from .sources import LANGS, InputSource

AssetSeed = dict[str, Any]


def _text_asset(locator: str, note: str | None = None) -> dict[str, str]:
    entry = {"kind": "text_asset", "locator": locator}
    if note:
        entry["note"] = note
    return entry


def _sorted_provenance(record: dict[str, Any]) -> None:
    record["provenance"] = sorted(
        record["provenance"],
        key=lambda entry: (
            entry.get("kind", ""),
            entry.get("locator", ""),
            entry.get("note", ""),
        ),
    )


def _dedupe(records: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        identifier = record["id"]
        if identifier in by_id:
            raise BuildError(f"duplicate {label} id: {identifier}")
        by_id[identifier] = record
    return [by_id[key] for key in sorted(by_id)]


def _require(raw: dict[str, Any], key: str, where: str) -> Any:
    value = raw.get(key)
    if value is None or value == "":
        raise BuildError(f"{where}: missing {key}")
    return value


# --------------------------------------------------------------------- catalog
def build_catalog(
    source: InputSource,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    table = source.song_catalog()
    data = table.data
    if not isinstance(data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    raw_packs = data.get("offline_song_pack_list")
    if not isinstance(raw_packs, list):
        raise InputError(f"{table.locator}/offline_song_pack_list must be a list")

    packs: list[dict[str, Any]] = []
    songs: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []

    for pack_index, raw_pack in enumerate(raw_packs):
        pack_locator = f"{table.locator}/offline_song_pack_list[{pack_index}]"
        if not isinstance(raw_pack, dict):
            raise BuildError(f"{pack_locator}: must be an object")
        pack_id = str(_require(raw_pack, "song_pack_id", pack_locator))
        descriptions = raw_pack.get("Descriptions") or None
        if descriptions is not None and not isinstance(descriptions, dict):
            raise BuildError(f"{pack_locator}: Descriptions must be an object or null")
        packs.append(
            {
                "id": entity_key("pack", pack_id),
                "type": "pack",
                "game_id": pack_id,
                "name": str(raw_pack.get("song_pack_name") or ""),
                "category": str(raw_pack.get("Category") or ""),
                "theme_color": str(raw_pack.get("theme_color") or ""),
                "is_iap": bool(raw_pack.get("is_iap_pack")),
                "has_im": bool(raw_pack.get("hasIM")),
                "price": str(raw_pack.get("price") or ""),
                "descriptions": descriptions,
                "provenance": [_text_asset(pack_locator)],
            }
        )

        raw_songs = raw_pack.get("song_info_list")
        if not isinstance(raw_songs, list):
            raise InputError(f"{pack_locator}/song_info_list must be a list")
        for song_index, raw_song in enumerate(raw_songs):
            song_locator = f"{pack_locator}.song_info_list[{song_index}]"
            if not isinstance(raw_song, dict):
                raise BuildError(f"{song_locator}: must be an object")
            song_id = str(_require(raw_song, "song_id", song_locator))
            search_terms = [
                term.strip()
                for term in (raw_song.get("AlternativeSearchTerms") or [])
                if isinstance(term, str) and term.strip()
            ]
            songs.append(
                {
                    "id": song_key(song_id),
                    "type": "song",
                    "game_id": song_id,
                    "name": raw_song.get("song_name"),
                    "artist": raw_song.get("artist"),
                    "pack_id": entity_key("pack", pack_id),
                    "category": raw_song.get("Category"),
                    "is_hidden": bool(raw_song.get("is_hidden")),
                    "download_only": bool(raw_song.get("IsDownloadOnly")),
                    "hide_when_locked": bool(raw_song.get("HideWhenLocked")),
                    "search_terms": search_terms,
                    "provenance": [_text_asset(song_locator)],
                }
            )

            raw_charts = raw_song.get("charts") or {}
            if not isinstance(raw_charts, dict):
                raise BuildError(f"{song_locator}: charts must be an object")
            for difficulty, raw_chart in raw_charts.items():
                chart_locator = f"{song_locator}.charts.{difficulty}"
                if not isinstance(raw_chart, dict):
                    raise BuildError(f"{chart_locator}: must be an object")
                try:
                    identifier = chart_key(song_id, difficulty)
                except ValueError as exc:
                    raise BuildError(f"{chart_locator}: {exc}") from exc
                level = raw_chart.get("Level")
                if level is None or str(level).strip() == "":
                    raise BuildError(f"{chart_locator}: missing Level")
                charts.append(
                    {
                        "id": identifier,
                        "type": "chart",
                        "game_id": f"{song_id}@{difficulty}",
                        "song_id": song_key(song_id),
                        "difficulty": difficulty,
                        "level": str(level),
                        "need_unlock": bool(raw_chart.get("NeedUnlock")),
                        "music_id": str(raw_chart.get("MusicID") or ""),
                        "provenance": [_text_asset(chart_locator)],
                    }
                )

    for record in packs + songs + charts:
        _sorted_provenance(record)
    return (
        _dedupe(packs, "pack"),
        _dedupe(songs, "song"),
        _dedupe(charts, "chart"),
    )


# ------------------------------------------------------------------ characters
def build_characters(
    source: InputSource, packs: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[AssetSeed]]:
    table = source.bg_movies()
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    gallery = source.gallery_folders()
    gallery_names: dict[str, str] = {}
    avatars: dict[str, str] = {}
    gallery_locator = gallery.locator if gallery is not None else ""
    if gallery is not None and isinstance(gallery.data, list):
        for row in gallery.data:
            if not isinstance(row, dict) or not row.get("Id"):
                continue
            gallery_names[str(row["Id"])] = str(row.get("Name") or "")
            if row.get("AvatarId"):
                avatars[str(row["Id"])] = str(row["AvatarId"])

    pack_by_id = {pack["game_id"]: pack for pack in packs}
    characters: list[dict[str, Any]] = []
    seeds: list[AssetSeed] = []

    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            continue
        character_id = str(raw.get("CharacterId") or raw.get("Id") or "")
        if not character_id:
            continue
        locator = f"{table.locator}[{index}]"
        pack = pack_by_id.get(character_id)
        name = (pack["name"] if pack and pack["name"] else "") or gallery_names.get(
            character_id
        )
        provenance = [_text_asset(locator)]
        if name and pack:
            provenance.append(_text_asset(pack["provenance"][0]["locator"]))
        elif name and gallery_locator:
            provenance.append(_text_asset(f"{gallery_locator}.Name"))
        if character_id in avatars and gallery_locator:
            provenance.append(_text_asset(f"{gallery_locator}.AvatarId"))

        prefabs = []
        for prefab_index, pair in enumerate(raw.get("BGMoviePrefabPairs") or []):
            if not isinstance(pair, dict):
                continue
            prefab = {
                "prefix": str(pair.get("BGMoviePrefix") or ""),
                "prefab": str(pair.get("BGPrefabName") or ""),
                "weight": int(pair.get("Weight") or 0),
            }
            prefabs.append(prefab)
            if prefab["prefab"]:
                seeds.append(
                    {
                        "kind": "bgmovie",
                        "name": prefab["prefab"],
                        "bundle": None,
                        "character_id": entity_key("character", character_id),
                        "provenance": [
                            _text_asset(f"{locator}.BGMoviePrefabPairs[{prefab_index}]")
                        ],
                    }
                )

        character = {
            "id": entity_key("character", character_id),
            "type": "character",
            "game_id": character_id,
            "name": name or character_id,
            "pack_id": pack["id"] if pack else None,
            "avatar_id": avatars.get(character_id),
            "bg_movie": {
                "name": str(raw.get("Name") or ""),
                "os_file_id": str(raw.get("OSFileId") or ""),
                "im_file_id": str(raw.get("IMFileId") or ""),
                "story_id": str(raw.get("StoryId") or ""),
                "level_lock_character_id": str(raw.get("LevelLockCharacterId") or ""),
                "level_lock_level": int(raw.get("LevelLockLevel") or 0),
                "need_capso": bool(raw.get("NeedCapso")),
                "prefabs": prefabs,
            },
            "provenance": provenance,
        }
        _sorted_provenance(character)
        characters.append(character)

    return _dedupe(characters, "character"), seeds


# -------------------------------------------------- OS folders and chapters
def build_os_dimensions(
    source: InputSource,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[AssetSeed]]:
    chapter_table = source.chapters()
    if not isinstance(chapter_table.data, list):
        raise InputError(f"{chapter_table.locator} must be a JSON list")
    chapters = []
    for index, raw in enumerate(chapter_table.data):
        if not isinstance(raw, dict):
            continue
        number = raw.get("Id")
        if number is None:
            raise BuildError(f"{chapter_table.locator}[{index}]: missing Id")
        name = str(raw.get("Name") or "")
        if not name:
            raise BuildError(f"{chapter_table.locator}[{index}]: missing Name")
        chapters.append(
            {
                "id": entity_key("chapter", str(number)),
                "type": "chapter",
                "game_id": str(number),
                "name": name,
                "category": int(raw.get("Category") or 0),
                "provenance": [_text_asset(f"{chapter_table.locator}[{index}]")],
            }
        )

    folder_sources: dict[str, dict[str, Any]] = {}
    media_counts: dict[tuple[str, str, str], int] = {}

    for table in source.os_tables():
        if not isinstance(table.data, list):
            continue
        counts: dict[str, int] = {}
        for entry in table.data:
            if not isinstance(entry, dict):
                continue
            timeline = entry.get("TimelineChapter") or {}
            if not isinstance(timeline, dict):
                timeline = {}
            folder_name = str(timeline.get("Folder") or "")
            if folder_name and folder_name != "N/A":
                counts[folder_name] = counts.get(folder_name, 0) + 1
            for content in entry.get("Contents") or []:
                if not isinstance(content, str):
                    continue
                for kind, name in _parse_media_refs(content):
                    key = (kind, name, table.locator)
                    media_counts[key] = media_counts.get(key, 0) + 1
        for folder_name, count in counts.items():
            bucket = folder_sources.setdefault(
                folder_name,
                {"slug": slug(folder_name), "sources": []},
            )
            bucket["sources"].append(
                _text_asset(f"{table.locator}.TimelineChapter.Folder", f"{count} entries")
            )

    media_refs: list[AssetSeed] = [
        {
            "kind": kind,
            "name": name,
            "bundle": None,
            "character_id": None,
            "provenance": [_text_asset(table_locator, f"{count} OS content references")],
        }
        for (kind, name, table_locator), count in sorted(media_counts.items())
    ]

    slug_owner: dict[str, str] = {}
    folders = []
    for folder_name, bucket in folder_sources.items():
        folder_slug = bucket["slug"]
        if folder_slug in slug_owner and slug_owner[folder_slug] != folder_name:
            raise BuildError(
                f"folder slug collision: {folder_name!r} and {slug_owner[folder_slug]!r}"
                f" both map to {folder_slug!r}"
            )
        slug_owner[folder_slug] = folder_name
        record = {
            "id": entity_key("folder", folder_slug),
            "type": "folder",
            "game_id": folder_slug,
            "name": folder_name,
            "provenance": bucket["sources"],
        }
        _sorted_provenance(record)
        folders.append(record)

    return (
        _dedupe(folders, "folder"),
        _dedupe(chapters, "chapter"),
        media_refs,
    )


def _parse_media_refs(content: str) -> list[tuple[str, str]]:
    kinds = {"image": "image", "movie": "video", "sound": "audio", "bgm": "audio"}
    refs: list[tuple[str, str]] = []
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("##"):
            continue
        key, _, value = line[2:].partition("=")
        key = key.strip()
        value = value.strip()
        kind = kinds.get(key)
        if kind is None or not value:
            continue
        if key in ("sound", "bgm") and value.lower() == "mute":
            continue
        if key == "sound":
            value = value.split(",", 1)[0].strip()
        if not value:
            continue
        refs.append((kind, value))
    return refs


# --------------------------------------------------------------- illustrations
def build_illustrations(
    source: InputSource,
) -> tuple[list[dict[str, Any]], list[AssetSeed]]:
    table = source.illustrations()
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    illustrations = []
    seeds: list[AssetSeed] = []
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            continue
        meta = raw.get("Meta") or {}
        if not isinstance(meta, dict):
            raise BuildError(f"{table.locator}[{index}]: Meta must be an object")
        illustration_id = str(meta.get("Id") or "")
        character_id = str(raw.get("CharacterId") or "")
        if not illustration_id:
            raise BuildError(f"{table.locator}[{index}]: missing Meta.Id")
        if not character_id:
            raise BuildError(f"{table.locator}[{index}]: missing CharacterId")
        locator = f"{table.locator}[{index}]"
        illustrations.append(
            {
                "id": entity_key("illustration", illustration_id),
                "type": "illustration",
                "game_id": illustration_id,
                "character_id": entity_key("character", character_id),
                "costume": str(meta.get("Name") or ""),
                "available": bool(raw.get("IsAvailable")),
                "description": str(meta.get("Description") or ""),
                "asset_id": asset_key("illustration", illustration_id),
                "provenance": [_text_asset(locator)],
            }
        )
        seeds.append(
            {
                "kind": "illustration",
                "name": illustration_id,
                "bundle": f"illustration_{illustration_id}.ab",
                "character_id": entity_key("character", character_id),
                "provenance": [_text_asset(locator)],
            }
        )
    return _dedupe(illustrations, "illustration"), seeds


# -------------------------------------------------------------------- subtitles
def build_subtitles(
    source: InputSource,
) -> tuple[list[dict[str, Any]], list[AssetSeed]]:
    table = source.audio_subtitles()
    if table is None:
        return [], []
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    subtitles = []
    seeds: list[AssetSeed] = []
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            continue
        audio_id = str(raw.get("AudioId") or "")
        if not audio_id:
            raise BuildError(f"{table.locator}[{index}]: missing AudioId")
        locator = f"{table.locator}[{index}]"
        slots = raw.get("Subtitles") or []
        if not isinstance(slots, list):
            raise BuildError(f"{locator}: Subtitles must be a list")
        text = {
            code: (str(slots[slot]) if slot < len(slots) and slots[slot] is not None else "")
            for code, slot in LANGS
        }
        subtitles.append(
            {
                "id": entity_key("subtitle_line", audio_id),
                "type": "subtitle_line",
                "game_id": audio_id,
                "character": str(raw.get("Character") or ""),
                "voice_asset_id": asset_key("voice", audio_id),
                "text": text,
                "provenance": [_text_asset(locator)],
            }
        )
        seeds.append(
            {
                "kind": "voice",
                "name": audio_id,
                "bundle": None,
                "character_id": None,
                "provenance": [_text_asset(locator)],
            }
        )
    return _dedupe(subtitles, "subtitle_line"), seeds


# ---------------------------------------------------------------------- assets
def build_assets(seed_lists: list[list[AssetSeed]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for seeds in seed_lists:
        for seed in seeds:
            identifier = asset_key(seed["kind"], seed["name"])
            record = merged.get(identifier)
            if record is None:
                merged[identifier] = {
                    "id": identifier,
                    "type": "asset",
                    "game_id": seed["name"],
                    "kind": seed["kind"],
                    "name": seed["name"],
                    "bundle": seed.get("bundle"),
                    "character_id": seed.get("character_id"),
                    "provenance": list(seed["provenance"]),
                }
                continue
            if record["bundle"] is None and seed.get("bundle"):
                record["bundle"] = seed["bundle"]
            if record["character_id"] is None and seed.get("character_id"):
                record["character_id"] = seed["character_id"]
            record["provenance"].extend(seed["provenance"])

    for record in merged.values():
        unique = {
            (entry.get("kind"), entry.get("locator"), entry.get("note")): entry
            for entry in record["provenance"]
        }
        record["provenance"] = [
            unique[key]
            for key in sorted(
                unique,
                key=lambda item: (item[0] or "", item[1] or "", item[2] or ""),
            )
        ]
        _sorted_provenance(record)
    return [merged[key] for key in sorted(merged)]


# ---------------------------------------------------------------- orchestration
def build_entities(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    packs, songs, charts = build_catalog(source)
    characters, character_seeds = build_characters(source, packs)
    folders, chapters, media_seeds = build_os_dimensions(source)
    illustrations, illustration_seeds = build_illustrations(source)
    subtitles, subtitle_seeds = build_subtitles(source)
    assets = build_assets(
        [character_seeds, illustration_seeds, subtitle_seeds, media_seeds]
    )
    return {
        "character": characters,
        "pack": packs,
        "folder": folders,
        "chapter": chapters,
        "song": songs,
        "chart": charts,
        "illustration": illustrations,
        "asset": assets,
        "subtitle_line": subtitles,
    }
