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
from .provenance import sort_record, text_asset
from .sources import InputSource

AssetSeed = dict[str, Any]

_text_asset = text_asset
_sorted_provenance = sort_record


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
                # Localized descriptions live in build/text/packs.jsonl; the
                # entity only carries the reference (one record per language).
                "text_ref": entity_key("pack", pack_id),
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
            song, song_charts = song_and_charts(raw_song, pack_id, song_locator)
            songs.append(song)
            charts.extend(song_charts)

    for record in packs + songs + charts:
        _sorted_provenance(record)
    return (
        _dedupe(packs, "pack"),
        _dedupe(songs, "song"),
        _dedupe(charts, "chart"),
    )


def song_and_charts(
    raw_song: dict[str, Any],
    pack_id: str,
    song_locator: str,
    expansion_pack_id: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build one ``song`` record and its ``chart`` records from catalog JSON."""
    song_id = str(_require(raw_song, "song_id", song_locator))
    search_terms = [
        term.strip()
        for term in (raw_song.get("AlternativeSearchTerms") or [])
        if isinstance(term, str) and term.strip()
    ]
    song: dict[str, Any] = {
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
    if expansion_pack_id:
        song["expansion_pack_id"] = entity_key("expansion_pack", expansion_pack_id)

    charts: list[dict[str, Any]] = []
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
    return song, charts


# ---------------------------------------------------------------- exp tables
def _exp_tables(source: InputSource) -> dict[str, tuple[list[int], str]]:
    """Return ``{song_pack_id: (thresholds, locator)}`` from exp_data.

    ``text/exptable/exp_data`` is optional: older inputs and synthetic
    fixtures may omit it.  Levels are 0-based, so ``table[i]`` is the
    cumulative experience for raw level ``i`` and the highest raw level is
    ``len(table) - 1``.
    """
    table = source.text_json("exptable", "exp_data")
    if table is None:
        return {}
    if not isinstance(table.data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    rows = table.data.get("exp_table_list")
    if not isinstance(rows, list):
        raise InputError(f"{table.locator}.exp_table_list must be a JSON list")
    tables: dict[str, tuple[list[int], str]] = {}
    for index, row in enumerate(rows):
        where = f"{table.locator}.exp_table_list[{index}]"
        if not isinstance(row, dict):
            raise InputError(f"{where} must be a JSON object")
        game_id = row.get("song_pack_id")
        if not isinstance(game_id, str) or not game_id:
            raise InputError(f"{where}: missing song_pack_id")
        thresholds = row.get("table")
        if not isinstance(thresholds, list) or not thresholds:
            raise InputError(f"{where}: table must be a non-empty JSON list")
        for value in thresholds:
            if type(value) is not int or value < 0:
                raise InputError(
                    f"{where}: table entries must be non-negative integers"
                )
        if game_id in tables:
            raise InputError(f"{where}: duplicate song_pack_id {game_id!r}")
        tables[game_id] = (list(thresholds), f"{where}.table")
    return tables


# ------------------------------------------------------------------ characters
def build_characters(
    source: InputSource, packs: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[AssetSeed]]:
    table = source.bg_movies()
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    exp_tables = _exp_tables(source)
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
        exp = exp_tables.get(character_id)
        if exp is not None:
            thresholds, exp_locator = exp
            character["max_level"] = len(thresholds) - 1
            character["exp_table"] = thresholds
            provenance.append(_text_asset(exp_locator))
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
        subtitles.append(
            {
                "id": entity_key("subtitle_line", audio_id),
                "type": "subtitle_line",
                "game_id": audio_id,
                "character": str(raw.get("Character") or ""),
                "voice_asset_id": asset_key("voice", audio_id),
                # The cue text lives in build/text/subtitles.jsonl under this
                # reference; the entity stays free of localized prose.
                "text_ref": entity_key("subtitle_line", audio_id),
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
        _sorted_provenance(record)
    return [merged[key] for key in sorted(merged)]


# ---------------------------------------------------------------- orchestration
def extension_modules() -> list:
    """Return imported extension modules (``cytus2db.ext.*``), sorted by name."""
    import importlib
    import pkgutil

    from . import ext as ext_package

    modules = []
    for info in sorted(pkgutil.iter_modules(ext_package.__path__), key=lambda item: item.name):
        modules.append(importlib.import_module(f"{ext_package.__name__}.{info.name}"))
    return modules


def _build_extensions(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    """Discover ``cytus2db.ext.<name>.build`` modules and merge their entities."""
    merged: dict[str, list[dict[str, Any]]] = {}
    for module in extension_modules():
        builder = getattr(module, "build", None)
        if builder is None:
            continue
        produced = builder(source)
        if not isinstance(produced, dict):
            raise BuildError(f"{module.__name__}.build must return a dict")
        for entity_type, records in produced.items():
            merged.setdefault(entity_type, []).extend(records)
    return merged


def build_entities(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    packs, songs, charts = build_catalog(source)
    characters, character_seeds = build_characters(source, packs)
    folders, chapters, media_seeds = build_os_dimensions(source)
    illustrations, illustration_seeds = build_illustrations(source)
    subtitles, subtitle_seeds = build_subtitles(source)
    assets = build_assets(
        [character_seeds, illustration_seeds, subtitle_seeds, media_seeds]
    )
    entities = {
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
    for entity_type, records in _build_extensions(source).items():
        entities.setdefault(entity_type, []).extend(records)
    return entities
