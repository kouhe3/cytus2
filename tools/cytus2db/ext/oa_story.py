"""OA content, story nodes, Backup Database and boss stages.

Sources:

``text/oasystemdata/oa_system_data``            OA characters/objects/documents/descriptions
``text/branchingosdata/<file>``                 Branching OS nodes (``story_node`` kind=branch)
``text/cutscenedata/cutscene_data_os``          Branch node first-open cutscene clips
``text/gallerydata/folder`` + ``<folderId>``     Backup Database folders and items
``text/imdata/im_lock_condition_data``          story gate topic lists (data only, no gate entity)
``il2cppdumper/dump.cs``                        story events (``kind=event``) and their constants

Localized text is not inlined for documents/descriptions or branch bodies.  A
record's ``text_ref`` is its own entity id; ``write_artifacts`` writes
``build/text/oa.jsonl`` and ``build/text/story.jsonl`` with one line per
language: ``{"ref", "entity", "lang", "text", "name"?}``.

Boss stages are keyed by the Backup Database ``FileLocation`` (the resource /
location name).  A stage's display name and the story-event ``BOSS_STAGE_ID``
values that resolve to it are aliases.  Values that cannot be derived from the
keyword tables live in ``BOSS_STAGE_ALIAS_OVERRIDES`` and carry ``manual``
provenance; a value mapped to ``None`` is the explicit unmapped marker.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

from ..blocks import paged_dialogue, parse_blocks
from ..cutscenes import CUTSCENE_LOCATOR, cutscene_clips
from ..errors import BuildError, InputError
from ..keys import DIFFICULTIES, chart_key, entity_key
from ..provenance import manual, sort_record, text_asset
from ..sources import LANGS, InputSource, Table

OA_TABLE = ("oasystemdata", "oa_system_data")
DUMP_PATH = ("il2cppdumper", "dump.cs")

# Story BOSS_STAGE_ID values that are not a gallery FileLocation and cannot be
# matched by display name.  ``vanessa_v`` is the display name of the boss stage
# reached from story_ending03_main's trigger gallery entry (ending03).  The
# ``None`` entries are stages absent from this dataset: they stay explicit
# unmapped markers instead of inventing an entity.
BOSS_STAGE_ALIAS_OVERRIDES: dict[str, str | None] = {
    "vanessa_v": "ending03",
    "ROBO Radio": None,
    "chaos": None,
    "ivy001_014_1": None,
    "vanessa_chaos": None,
}

OVERRIDE_LOCATOR = "tools/cytus2db/ext/oa_story.py:BOSS_STAGE_ALIAS_OVERRIDES"

_ICON_KINDS = {
    "icon_video": "video",
    "icon_image": "image",
    "icon_bossstage": "boss_stage",
}
_FORMAT_KINDS = {
    1: "video",
    2: "boss_stage",
    3: "image",
    4: "boss_stage",
    5: "boss_stage",
}
_CONDITIONS = {
    "StoryLockCondition": ("story", "storyId"),
    "OSFileLockCondition": ("os", "fileId"),
    "IMTopicLockCondition": ("im", "topicId"),
    "BranchingOSFileLockCondition": ("branch", "branchingFileId"),
}
_STORY_CONST_KEYS = (
    "TRIGGER_OS_ID",
    "TRIGGER_TOPIC_ID",
    "START_TOPIC_ID",
    "END_TOPIC_ID",
    "DELETED_TOPIC_ID",
    "TRIGGER_GALLERY_FOLDER_ID",
    "TRIGGER_GALLERY_FILE_LOCATION",
    "MOVIE_FILE",
    "CUTSCENE_MOVIE_FILE",
)

# Nested EndPlay classes declare the stage they play, not a BOSS_STAGE_ID:
# ``StoryTairitsuBranch01.BranchingEndPlay`` carries ``private const SONG_ID``
# and ``VIDEO_ID``.  Both hold the stage id when the game ships that id in
# ``other_song_info_list``; the catalog filter in ``_known_stages`` keeps plain
# song ids (``vanessa001_010``) out.
_STAGE_REF_KEYS = ("SONG_ID", "VIDEO_ID")
# ``0_TOUCH_BOS_TAOS010``: the story waits for the player to pick that
# Branching OS file, so the step value names the branch node that triggers it.
_BRANCH_STEP = re.compile(r"^(?:\d+_)?TOUCH_BOS_([A-Za-z0-9]+)$")


# --------------------------------------------------------------------- helpers
_text_asset = text_asset
_sorted_provenance = sort_record


def _manual(note: str) -> dict[str, str]:
    return manual(OVERRIDE_LOCATOR, note)


def _unique(values: Iterable[Any]) -> list[Any]:
    seen: set[Any] = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _dedupe(records: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        identifier = record["id"]
        if identifier in by_id:
            raise BuildError(f"duplicate {label} id: {identifier}")
        by_id[identifier] = record
    return [by_id[key] for key in sorted(by_id)]


def _required(raw: dict[str, Any], key: str, where: str) -> Any:
    value = raw.get(key)
    if value is None or value == "":
        raise BuildError(f"{where}: missing {key}")
    return value


def _slots(values: Any, where: str) -> list[str]:
    if not isinstance(values, list):
        raise BuildError(f"{where}: expected a list of language slots")
    return [str(value) if value is not None else "" for value in values]


def _texts(values: Any, where: str) -> dict[str, str]:
    slots = _slots(values, where)
    return {
        code: slots[slot] if slot < len(slots) else ""
        for code, slot in LANGS
    }


def _slot(values: Any, index: int) -> str:
    if not isinstance(values, list) or index >= len(values):
        return ""
    value = values[index]
    return str(value) if value is not None else ""


def _short_type(raw: dict[str, Any]) -> str:
    return str(raw.get("$type") or "").split(".")[-1].split(",")[0]


# ------------------------------------------------------------------------ OA
def _oa_table(source: InputSource) -> Table | None:
    table = source.text_json(*OA_TABLE)
    if table is not None and not isinstance(table.data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    return table


def _oa_locks(
    values: Any, where: str, character_id: str
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Split level locks (character + level) from OS/story conditions."""
    if values is None:
        return [], []
    if not isinstance(values, list):
        raise BuildError(f"{where}: expected a list")
    level_locks = []
    conditions = []
    for index, raw in enumerate(values):
        if not isinstance(raw, dict):
            raise BuildError(f"{where}[{index}]: expected an object")
        kind = _short_type(raw)
        if kind == "OASystemLevelLock":
            owner = str(raw.get("CharacterId") or character_id)
            level_locks.append(
                {
                    "character": entity_key("character", owner),
                    "level": int(raw.get("LockLevel") or 0),
                }
            )
        elif kind == "OASystemOSLock":
            conditions.append(
                {"kind": "os", "value": str(_required(raw, "OSLockId", where))}
            )
        elif kind == "OASystemStoryLock":
            conditions.append(
                {"kind": "story", "value": str(_required(raw, "StoryId", where))}
            )
        else:
            raise BuildError(f"{where}[{index}]: unknown OA lock type {kind!r}")
    return level_locks, conditions


def _gallery_names(source: InputSource) -> tuple[dict[str, str], dict[str, str]]:
    table = source.gallery_folders()
    names: dict[str, str] = {}
    locators: dict[str, str] = {}
    if table is None or not isinstance(table.data, list):
        return names, locators
    for index, row in enumerate(table.data):
        if not isinstance(row, dict) or not row.get("Id"):
            continue
        folder_id = str(row["Id"])
        names[folder_id] = str(row.get("Name") or "")
        locators[folder_id] = f"{table.locator}[{index}].Name"
    return names, locators


def _build_oa(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    table = _oa_table(source)
    if table is None:
        return {
            "oa_character": [],
            "oa_object": [],
            "oa_document": [],
            "oa_description": [],
        }
    data = table.data
    gallery_names, gallery_locators = _gallery_names(source)

    raw_objects = data.get("Objects") or []
    raw_descriptions = data.get("Descriptions") or []
    raw_documents = data.get("Documents") or []
    raw_missions = data.get("Missions") or []
    for name, rows in (
        ("Objects", raw_objects),
        ("Descriptions", raw_descriptions),
        ("Documents", raw_documents),
        ("Missions", raw_missions),
    ):
        if not isinstance(rows, list):
            raise InputError(f"{table.locator}/{name} must be a list")

    mission_object = {
        str(row.get("MissionId")): str(row.get("ObjectId"))
        for row in raw_missions
        if isinstance(row, dict) and row.get("MissionId") and row.get("ObjectId")
    }

    characters: set[str] = set()
    objects = []
    documents = []
    descriptions = []

    for index, raw in enumerate(raw_objects):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}.Objects[{index}]: expected an object")
        where = f"{table.locator}.Objects[{index}]"
        object_id = str(_required(raw, "ObjectId", where))
        character_id = str(_required(raw, "CharacterId", where))
        characters.add(character_id)
        text_ref = entity_key("oa_object", object_id)
        level_locks, conditions = _oa_locks(
            raw.get("OASystemLocks"), f"{where}.OASystemLocks", character_id
        )
        objects.append(
            {
                "id": text_ref,
                "type": "oa_object",
                "game_id": object_id,
                "character_id": entity_key("character", character_id),
                "text_ref": text_ref,
                "analyze_type_id": str(raw.get("AnalyzeTypeId") or "") or None,
                "analyze_type": int(raw.get("AnalyzeType") or 0),
                "level_locks": level_locks,
                "conditions": conditions,
                "provenance": [_text_asset(where)],
            }
        )

    for index, raw in enumerate(raw_documents):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}.Documents[{index}]: expected an object")
        where = f"{table.locator}.Documents[{index}]"
        document_id = str(_required(raw, "DocumentId", where))
        character_id = str(_required(raw, "CharacterId", where))
        characters.add(character_id)
        mission_id = str(raw.get("MissionId") or "") or None
        object_id = mission_object.get(mission_id) if mission_id else None
        text_ref = entity_key("oa_document", document_id)
        documents.append(
            {
                "id": text_ref,
                "type": "oa_document",
                "game_id": document_id,
                "character_id": entity_key("character", character_id),
                "object_id": entity_key("oa_object", object_id) if object_id else None,
                "mission_id": mission_id,
                "text_ref": text_ref,
                "digit_lock": (
                    str(raw.get("DigitLock")) if raw.get("DigitLock") is not None else None
                ),
                "provenance": [_text_asset(where)],
            }
        )

    for index, raw in enumerate(raw_descriptions):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}.Descriptions[{index}]: expected an object")
        where = f"{table.locator}.Descriptions[{index}]"
        description_id = str(_required(raw, "Id", where))
        character_id = str(_required(raw, "CharacterId", where))
        characters.add(character_id)
        text_ref = entity_key("oa_description", description_id)
        enable_level_locks, enable_conditions = _oa_locks(
            raw.get("EnableCondition"), f"{where}.EnableCondition", character_id
        )
        disable_level_locks, disable_conditions = _oa_locks(
            raw.get("DisableCondition"), f"{where}.DisableCondition", character_id
        )
        descriptions.append(
            {
                "id": text_ref,
                "type": "oa_description",
                "game_id": description_id,
                "character_id": entity_key("character", character_id),
                "description_object_id": str(
                    _required(raw, "DescriptionObjectId", where)
                ),
                "weight": int(raw.get("Weight") or 0),
                "event": int(raw.get("DescriptionEvent") or 0),
                "enable_level_locks": enable_level_locks,
                "enable_conditions": enable_conditions,
                "disable_level_locks": disable_level_locks,
                "disable_conditions": disable_conditions,
                "text_ref": text_ref,
                "provenance": [_text_asset(where)],
            }
        )

    oa_characters = []
    for character_id in sorted(characters):
        provenance = [
            _text_asset(f"{table.locator}.Objects", "CharacterId union"),
            _text_asset(f"{table.locator}.Documents", "CharacterId union"),
            _text_asset(f"{table.locator}.Descriptions", "CharacterId union"),
        ]
        name = gallery_names.get(character_id, "")
        if name:
            provenance.append(_text_asset(gallery_locators[character_id]))
        record = {
            "id": entity_key("oa_character", character_id),
            "type": "oa_character",
            "game_id": character_id,
            "character_id": entity_key("character", character_id),
            "name": name or character_id,
            "gallery_folder_id": (
                entity_key("gallery_folder", character_id)
                if character_id in gallery_names
                else None
            ),
            "provenance": provenance,
        }
        _sorted_provenance(record)
        oa_characters.append(record)

    for record in objects + documents + descriptions:
        _sorted_provenance(record)
    return {
        "oa_character": _dedupe(oa_characters, "oa_character"),
        "oa_object": _dedupe(objects, "oa_object"),
        "oa_document": _dedupe(documents, "oa_document"),
        "oa_description": _dedupe(descriptions, "oa_description"),
    }


# ------------------------------------------------------------------- gallery
def _gallery_conditions(values: Any, where: str) -> list[dict[str, str]]:
    if values is None:
        return []
    if not isinstance(values, list):
        raise BuildError(f"{where}: expected a list")
    conditions = []
    for index, raw in enumerate(values):
        if not isinstance(raw, dict):
            raise BuildError(f"{where}[{index}]: expected an object")
        kind = _short_type(raw)
        if kind not in _CONDITIONS:
            raise BuildError(f"{where}[{index}]: unknown gallery condition {kind!r}")
        condition_kind, field = _CONDITIONS[kind]
        conditions.append(
            {
                "kind": condition_kind,
                "value": str(_required(raw, field, f"{where}[{index}]")),
            }
        )
    return conditions


def _gallery_size(value: Any) -> list[int] | None:
    if not isinstance(value, str) or "," not in value:
        return None
    left, _, right = value.partition(",")
    try:
        width, height = int(left.strip()), int(right.strip())
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return [width, height]


def _gallery_kind(icon: str, fmt: int, where: str) -> str:
    icon_kind = _ICON_KINDS.get(icon)
    format_kind = _FORMAT_KINDS.get(fmt)
    if icon_kind is not None and format_kind is not None and icon_kind != format_kind:
        raise BuildError(
            f"{where}: icon {icon!r} and format {fmt} disagree about the item kind"
        )
    if icon_kind is not None:
        return icon_kind
    if format_kind is not None:
        return format_kind
    raise BuildError(f"{where}: unknown gallery icon/format {icon!r}/{fmt}")


def _build_gallery(
    source: InputSource,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    table = source.gallery_folders()
    if table is None:
        return [], []
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")

    folders = []
    items = []
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}[{index}]: expected an object")
        where = f"{table.locator}[{index}]"
        folder_id = str(_required(raw, "Id", where))
        folders.append(
            {
                "id": entity_key("gallery_folder", folder_id),
                "type": "gallery_folder",
                "game_id": folder_id,
                "name": str(raw.get("Name") or folder_id),
                "avatar_id": str(raw.get("AvatarId") or "") or None,
                "provenance": [_text_asset(where)],
            }
        )

        item_table = source.text_json("gallerydata", folder_id)
        if item_table is None:
            continue
        if not isinstance(item_table.data, list):
            raise InputError(f"{item_table.locator} must be a JSON list")
        for item_index, item in enumerate(item_table.data):
            if not isinstance(item, dict):
                raise BuildError(f"{item_table.locator}[{item_index}]: expected an object")
            item_where = f"{item_table.locator}[{item_index}]"
            location = str(_required(item, "FileLocation", item_where))
            name = str(_required(item, "FileName", item_where))
            icon = str(item.get("IconType") or "")
            fmt = int(item.get("Format") or 0)
            items.append(
                {
                    "id": entity_key("gallery_item", f"{folder_id}/{location}"),
                    "type": "gallery_item",
                    "game_id": f"{folder_id}/{location}",
                    "folder_id": entity_key("gallery_folder", folder_id),
                    "location": location,
                    "name": name,
                    "icon": icon,
                    "format": fmt,
                    "kind": _gallery_kind(icon, fmt, item_where),
                    "size": _gallery_size(item.get("Location")),
                    "conditions": _gallery_conditions(
                        item.get("Conditions"), f"{item_where}.Conditions"
                    ),
                    "obtainable": bool(item.get("Obtainable")),
                    "provenance": [_text_asset(item_where)],
                }
            )

    for record in folders:
        _sorted_provenance(record)
    for record in items:
        _sorted_provenance(record)
    return _dedupe(folders, "gallery_folder"), _dedupe(items, "gallery_item")


# --------------------------------------------------------------- story dump
class _DumpClass:
    __slots__ = (
        "constants",
        "boss_stages",
        "stage_refs",
        "movie_files",
        "steps",
        "topics",
    )

    def __init__(self) -> None:
        self.constants: dict[str, str] = {}
        self.boss_stages: list[str] = []
        self.stage_refs: list[str] = []
        self.movie_files: list[str] = []
        self.steps: list[str] = []
        self.topics: set[str] = set()


def _dump_path(source: InputSource) -> Path:
    return source.root.joinpath(*DUMP_PATH)


_TYPE_LINE = re.compile(r"public (?:static )?class ([\w.]+)")


def _collect_consts(target: _DumpClass, line: str, *, public: bool) -> None:
    """Collect one ``const string`` declaration into ``target``.

    Nested action classes declare the stage they play as ``private const``;
    only the stage keys are read from those so unrelated private constants (and
    compiler-generated classes) stay out of the story record.
    """
    found = re.search(r'(?<![A-Z_])BOSS_STAGE_ID = "([^"]*)"', line)
    if found:
        target.boss_stages.append(found.group(1))
    for key in _STAGE_REF_KEYS:
        found = re.search(rf'(?<![A-Z_]){key} = "([^"]*)"', line)
        if found:
            target.stage_refs.append(found.group(1))
    if not public:
        return
    found = re.search(r'const string ID = "([^"]+)"', line)
    if found:
        target.constants.setdefault("ID", found.group(1))
    for key in _STORY_CONST_KEYS:
        found = re.search(rf'(?<![A-Z_]){key} = "([^"]*)"', line)
        if found:
            if key in ("MOVIE_FILE", "CUTSCENE_MOVIE_FILE"):
                target.movie_files.append(found.group(1))
            else:
                target.constants.setdefault(key, found.group(1))
    found = re.search(
        r'const string ((?:STEP_[A-Z0-9_]*)'
        r'|(?:STATE_[A-Z0-9_]*_STEP_[A-Z0-9_]*)) = "([^"]+)"',
        line,
    )
    if found:
        target.steps.append(found.group(2))


def _parse_dump(source: InputSource) -> dict[str, _DumpClass]:
    path = _dump_path(source)
    if not path.is_file():
        raise InputError(
            f"missing {path}; story events need the Il2CppDumper output "
            "(dump.cs) next to the unpacked text tables"
        )
    classes: dict[str, _DumpClass] = {}
    current: _DumpClass | None = None
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            # Every type block starts with its namespace comment.  Resetting
            # here keeps constants of compiler-generated and private classes
            # out of the public class printed above them.
            if line.startswith("// Namespace:"):
                current = None
                continue
            match = _TYPE_LINE.match(line)
            if match:
                # Nested classes keep the dotted name (Parent.Child) so the
                # story-class merge below can attribute their constants.
                current = classes.setdefault(match.group(1), _DumpClass())
                continue
            if current is None:
                continue
            stripped = line.strip()
            if stripped.startswith("public const"):
                _collect_consts(current, line, public=True)
            elif stripped.startswith("private const"):
                _collect_consts(current, line, public=False)
            for topic in re.findall(r"TOUCH_IM_(?:POST|TOPIC)_([A-Za-z0-9]+)", line):
                current.topics.add(topic)
            if line.startswith("}"):
                current = None
    return classes


def _known_stages(
    refs: Iterable[str], stage_catalog: dict[str, dict[str, Any]]
) -> list[str]:
    """Keep only ``SONG_ID``/``VIDEO_ID`` values the game lists as a stage."""
    return [ref for ref in refs if ref in stage_catalog]


def _branch_trigger(steps: Iterable[str]) -> str | None:
    """Branching OS file id named by a ``TOUCH_BOS_<id>`` story step."""
    for step in steps:
        found = _BRANCH_STEP.match(step)
        if found:
            return found.group(1).lower()
    return None


def _story_events(
    source: InputSource, stage_catalog: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    classes = _parse_dump(source)
    events = []
    for name, data in classes.items():
        story_id = data.constants.get("ID")
        if not story_id:
            continue
        constants = dict(data.constants)
        boss_stages = list(data.boss_stages) + _known_stages(
            data.stage_refs, stage_catalog
        )
        steps = list(data.steps)
        movie_files = list(data.movie_files)
        topics = set(data.topics)
        actions = []
        for other, extra in classes.items():
            if other == name or not other.startswith(name):
                continue
            if extra.constants.get("ID"):
                continue
            if not (
                extra.boss_stages
                or extra.stage_refs
                or extra.movie_files
                or extra.steps
                or extra.topics
                or extra.constants
            ):
                continue
            actions.append(other)
            for key, value in extra.constants.items():
                if key != "ID":
                    constants.setdefault(key, value)
            boss_stages.extend(extra.boss_stages)
            boss_stages.extend(_known_stages(extra.stage_refs, stage_catalog))
            movie_files.extend(extra.movie_files)
            steps.extend(extra.steps)
            topics |= extra.topics

        unique_steps = _unique(steps)
        event = {
            "id": entity_key("story_node", story_id),
            "type": "story_node",
            "kind": "event",
            "game_id": story_id,
            "class_name": name,
            "actions": sorted(actions),
            "steps": unique_steps,
            "topic_ids": [],
            "boss_stages": [],
            "trigger_os_id": constants.get("TRIGGER_OS_ID") or None,
            "trigger_topic_id": constants.get("TRIGGER_TOPIC_ID") or None,
            "trigger_branch_id": _branch_trigger(unique_steps),
            "start_topic_id": constants.get("START_TOPIC_ID") or None,
            "end_topic_id": constants.get("END_TOPIC_ID") or None,
            "deleted_topic_id": constants.get("DELETED_TOPIC_ID") or None,
            "gallery_ref": None,
            "movie_files": _unique(movie_files),
            "trigger_topics": sorted(topics),
            "_boss_raw": _unique(boss_stages),
            "provenance": [
                {
                    "kind": "rva",
                    "locator": f"il2cppdumper/dump.cs:{name}",
                    "note": "story id and action constants",
                }
            ],
        }
        gallery_folder = constants.get("TRIGGER_GALLERY_FOLDER_ID")
        gallery_location = constants.get("TRIGGER_GALLERY_FILE_LOCATION")
        if gallery_folder and gallery_location:
            event["gallery_ref"] = {
                "folder_id": entity_key("gallery_folder", gallery_folder),
                "location": gallery_location,
            }
        events.append(event)
    return sorted(events, key=lambda event: event["id"])


# ---------------------------------------------------------------- boss stages
def _stage_catalog(source: InputSource) -> dict[str, dict[str, Any]]:
    """``song_pack_data.other_song_info_list``: the game's special stages.

    Boss stages that are not Backup Database entries only exist here (the two
    Branching OS branch points).  The bundle ships ``song_name: null`` for
    them, so the id doubles as the display name.
    """
    table = source.song_catalog()
    if not isinstance(table.data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    entries = table.data.get("other_song_info_list") or []
    if not isinstance(entries, list):
        raise InputError(f"{table.locator}.other_song_info_list must be a list")
    catalog: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        where = f"{table.locator}.other_song_info_list[{index}]"
        if not isinstance(entry, dict):
            raise BuildError(f"{where}: must be an object")
        song_id = str(entry.get("song_id") or "").strip()
        if not song_id:
            raise BuildError(f"{where}: missing song_id")
        name = entry.get("song_name")
        catalog[song_id] = {
            "name": name.strip() if isinstance(name, str) and name.strip() else None,
            "locator": where,
        }
    return catalog


def _build_boss_stages(
    gallery_items: list[dict[str, Any]],
    events: list[dict[str, Any]],
    stage_catalog: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, tuple[str | None, dict[str, str] | None]]]:
    items = [
        item for item in gallery_items if item["kind"] == "boss_stage"
    ]
    by_location = {item["location"]: item for item in items}
    alias_map: dict[str, str] = {}
    for item in items:
        display = item["name"]
        if display and display != item["location"]:
            previous = alias_map.get(display)
            if previous is not None and previous != item["location"]:
                raise BuildError(
                    f"boss stage display alias {display!r} maps to both "
                    f"{previous!r} and {item['location']!r}"
                )
            alias_map[display] = item["location"]

    resolutions: dict[str, tuple[str | None, dict[str, str] | None]] = {}
    resolved_aliases: dict[str, set[str]] = {}
    manual_by_location: dict[str, list[dict[str, str]]] = {}
    for raw in sorted(
        {raw for event in events for raw in event["_boss_raw"]}
    ):
        if raw in by_location:
            resolutions[raw] = (raw, None)
            continue
        if raw in alias_map:
            resolutions[raw] = (alias_map[raw], None)
            continue
        if raw in stage_catalog:
            resolutions[raw] = (raw, None)
            continue
        if raw not in BOSS_STAGE_ALIAS_OVERRIDES:
            raise BuildError(
                f"boss stage reference {raw!r} is not a gallery FileLocation, "
                "display name, special-stage id or override; add it to "
                "BOSS_STAGE_ALIAS_OVERRIDES"
            )
        target = BOSS_STAGE_ALIAS_OVERRIDES[raw]
        note = f"{raw} -> {target if target is not None else 'unmapped'}"
        if target is not None and target not in by_location:
            raise BuildError(
                f"boss stage override {raw!r} targets unknown FileLocation {target!r}"
            )
        resolutions[raw] = (target, _manual(note))
        if target is not None:
            resolved_aliases.setdefault(target, set()).add(raw)
            manual_by_location.setdefault(target, []).append(_manual(note))

    stages = []
    for item in items:
        location = item["location"]
        display = item["name"] or location
        aliases = set(resolved_aliases.get(location, set()))
        if display and display != location:
            aliases.add(display)
        record = {
            "id": entity_key("boss_stage", location),
            "type": "boss_stage",
            "game_id": location,
            "display_name": display,
            "aliases": sorted(aliases),
            "folder_id": item["folder_id"],
            "gallery_item_id": item["id"],
            "conditions": list(item["conditions"]),
            "provenance": list(item["provenance"])
            + manual_by_location.get(location, []),
        }
        _sorted_provenance(record)
        stages.append(record)

    catalog_locations = sorted(
        {
            target
            for target, (_manual_ref) in resolutions.values()
            if target is not None and target not in by_location
        }
    )
    for location in catalog_locations:
        entry = stage_catalog[location]
        record = {
            "id": entity_key("boss_stage", location),
            "type": "boss_stage",
            "game_id": location,
            "display_name": entry["name"] or location,
            "aliases": [],
            "folder_id": None,
            "gallery_item_id": None,
            "conditions": [],
            "provenance": [_text_asset(entry["locator"])],
        }
        _sorted_provenance(record)
        stages.append(record)
    return _dedupe(stages, "boss_stage"), resolutions


# --------------------------------------------------------------------- story
def _gate_topics(source: InputSource) -> dict[str, list[str]]:
    """Map story ids to the iM topics they gate (data for later edges)."""
    table = source.text_json("imdata", "im_lock_condition_data")
    if table is None:
        return {}
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    buckets: dict[str, set[str]] = {}
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}[{index}]: expected an object")
        story_id = str(raw.get("StoryLockId") or "")
        topic_id = str(raw.get("TopicId") or "")
        if not story_id or not topic_id:
            continue
        buckets.setdefault(story_id, set()).add(topic_id)
    return {story_id: sorted(topics) for story_id, topics in buckets.items()}


def _branch_tables(source: InputSource) -> Iterable[tuple[str, Table]]:
    directory = source.text_dir / "branchingosdata"
    if not directory.is_dir():
        return
    for path in sorted(directory.iterdir()):
        if not path.is_file():
            continue
        table = source.text_json("branchingosdata", path.name)
        if table is not None:
            yield path.name, table


def _branch_nodes(source: InputSource) -> list[dict[str, Any]]:
    cutscenes = cutscene_clips(source)
    nodes = []
    for file_name, table in _branch_tables(source):
        if not isinstance(table.data, list):
            raise InputError(f"{table.locator} must be a JSON list")
        for index, raw in enumerate(table.data):
            if not isinstance(raw, dict):
                raise BuildError(f"{table.locator}[{index}]: expected an object")
            where = f"{table.locator}[{index}]"
            node_id = str(_required(raw, "Id", where))
            unlock = raw.get("UnlockCondition") or {}
            view = raw.get("ViewSetting") or {}
            if not isinstance(unlock, dict):
                raise BuildError(f"{where}.UnlockCondition must be an object")
            if not isinstance(view, dict):
                raise BuildError(f"{where}.ViewSetting must be an object")
            charts = []
            for chart_index, chart in enumerate(raw.get("UnlockedCharts") or []):
                if not isinstance(chart, dict):
                    raise BuildError(
                        f"{where}.UnlockedCharts[{chart_index}]: expected an object"
                    )
                song_id = str(_required(chart, "SongId", f"{where}.UnlockedCharts"))
                difficulty_index = int(chart.get("Difficulty") or 0)
                if not 0 <= difficulty_index < len(DIFFICULTIES):
                    raise BuildError(
                        f"{where}.UnlockedCharts[{chart_index}]: unknown difficulty "
                        f"{difficulty_index}"
                    )
                charts.append(chart_key(song_id, DIFFICULTIES[difficulty_index]))
            next_ids = [
                entity_key("story_node", str(value))
                for value in view.get("LinkedFileIds") or []
                if str(value)
            ]
            node = {
                "id": entity_key("story_node", node_id),
                "type": "story_node",
                "kind": "branch",
                "game_id": node_id,
                "source_file": file_name,
                "node_type": int(raw.get("Type") or 0),
                "names": _texts(raw.get("Names"), f"{where}.Names"),
                "level": int(unlock.get("Level") or 0),
                "state_id": int(unlock.get("StateId") or 0),
                "state_value": str(unlock.get("StateValue") or ""),
                "next": _unique(next_ids),
                "position": int(view.get("Position") or 0),
                "order": int(view.get("Order") or 0),
                # Branching OS unlock levels belong to the lineage character
                # (the table name), never to a song pack.
                "level_locks": [
                    {
                        "character": entity_key("character", Path(file_name).stem),
                        "level": int(unlock.get("Level") or 0),
                    }
                ],
                "charts": _unique(charts),
                "text_ref": entity_key("story_node", node_id),
                "provenance": [_text_asset(where)],
            }
            clip = cutscenes.get(node_id)
            if clip is not None:
                node["cutscene"] = clip
                node["provenance"].append(_text_asset(CUTSCENE_LOCATOR))
            _sorted_provenance(node)
            nodes.append(node)
    return _dedupe(nodes, "story_node branch")


def _build_story(
    source: InputSource,
    events: list[dict[str, Any]],
    resolutions: dict[str, tuple[str | None, dict[str, str] | None]],
) -> list[dict[str, Any]]:
    branches = _branch_nodes(source)
    event_ids = {event["id"] for event in events}
    branch_ids = {node["id"] for node in branches}
    for node in branches:
        for target in node["next"]:
            if target not in branch_ids:
                raise BuildError(
                    f"{node['id']}: LinkedFileIds target {target!r} is not a branch node"
                )

    topics = _gate_topics(source)

    completed = []
    for event in events:
        event = dict(event)
        raw_bosses = event.pop("_boss_raw")
        event["boss_stages"] = []
        for raw in raw_bosses:
            target, manual = resolutions[raw]
            event["boss_stages"].append(
                {
                    "raw": raw,
                    "entity_id": entity_key("boss_stage", target) if target else None,
                    "status": "resolved" if target else "unmapped",
                }
            )
            if manual is not None:
                event["provenance"].append(manual)
        event["topic_ids"] = topics.get(event["game_id"], [])
        _sorted_provenance(event)
        completed.append(event)

    for node in branches:
        if node["id"] in event_ids:
            raise BuildError(f"story node id collision: {node['id']}")
    return _dedupe(completed + branches, "story_node")


# ---------------------------------------------------------------- text stores
def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(
                json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )
            handle.write("\n")


def _oa_text_records(
    source: InputSource, entities: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    table = _oa_table(source)
    if table is None:
        return []
    data = table.data
    raw_objects = {
        str(row.get("ObjectId")): row
        for row in data.get("Objects") or []
        if isinstance(row, dict)
    }
    raw_documents = {
        str(row.get("DocumentId")): row
        for row in data.get("Documents") or []
        if isinstance(row, dict)
    }
    raw_descriptions = {
        str(row.get("Id")): row
        for row in data.get("Descriptions") or []
        if isinstance(row, dict)
    }
    records = []
    for entity_type, raw_by_id, name_field in (
        ("oa_object", raw_objects, "Names"),
        ("oa_document", raw_documents, "Names"),
        ("oa_description", raw_descriptions, "Name"),
    ):
        for entity in sorted(entities.get(entity_type, []), key=lambda row: row["id"]):
            raw = raw_by_id.get(entity["game_id"])
            if raw is None:
                continue
            name_values = raw.get(name_field)
            body_values = (
                raw.get("Details") if entity_type == "oa_object" else raw.get("Contents")
            )
            for code, slot in LANGS:
                name = (
                    _slot(name_values, slot)
                    if isinstance(name_values, list)
                    else str(name_values or "")
                )
                text = _slot(body_values, slot)
                record: dict[str, Any] = {
                    "ref": entity["text_ref"],
                    "entity": entity_type,
                    "lang": code,
                    "name": name,
                    "text": text,
                }
                if entity_type == "oa_document":
                    blocks = parse_blocks(text)
                elif entity_type == "oa_description":
                    blocks = paged_dialogue(text)
                else:
                    blocks = []
                if blocks:
                    record["blocks"] = blocks
                records.append(record)
    return records


def _story_text_records(
    source: InputSource, entities: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    raw_by_file: dict[str, dict[str, dict[str, Any]]] = {}
    for file_name, table in _branch_tables(source):
        raw_by_file[file_name] = {
            str(row.get("Id")): row
            for row in table.data
            if isinstance(row, dict)
        }
    records = []
    for entity in sorted(entities.get("story_node", []), key=lambda row: row["id"]):
        if entity.get("kind") != "branch":
            continue
        raw = raw_by_file.get(entity["source_file"], {}).get(entity["game_id"])
        if raw is None:
            continue
        for code, slot in LANGS:
            text = _slot(raw.get("Contents"), slot)
            record: dict[str, Any] = {
                "ref": entity["text_ref"],
                "entity": "story_node",
                "lang": code,
                "text": text,
            }
            blocks = parse_blocks(text)
            if blocks:
                record["blocks"] = blocks
            records.append(record)
    return records


def write_artifacts(
    out: Path,
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    oa_records = _oa_text_records(source, entities)
    if oa_records:
        _write_jsonl(out / "text" / "oa.jsonl", oa_records)
    story_records = _story_text_records(source, entities)
    if story_records:
        _write_jsonl(out / "text" / "story.jsonl", story_records)


# ------------------------------------------------------------------------- api
def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    entities: dict[str, list[dict[str, Any]]] = {}
    entities.update(_build_oa(source))
    folders, items = _build_gallery(source)
    entities["gallery_folder"] = folders
    entities["gallery_item"] = items
    stage_catalog = _stage_catalog(source)
    events = _story_events(source, stage_catalog)
    stages, resolutions = _build_boss_stages(items, events, stage_catalog)
    entities["story_node"] = _build_story(source, events, resolutions)
    entities["boss_stage"] = stages
    for records in entities.values():
        for record in records:
            _sorted_provenance(record)
    return entities
