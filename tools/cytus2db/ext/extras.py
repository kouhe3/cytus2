"""Appendix entities: iM assistant dialogues and title-screen evolution.

Two families are extracted here, both from ``cytus2_work/text``:

``assistant_dialogue``
    A group from ``text/imdata/im_assistant_data``.  Each group has a trigger,
    a target, a progress order and one or more pages.  Page bodies are not
    localized fields on the entity: ``write_artifacts`` writes
    ``build/text/extras.jsonl`` with one record per group and language, whose
    blocks keep the raw page metadata next to the text.

``title_screen``
    An entry from ``text/titleinfodata/title_info``.  A title is unlocked by a
    story node and is animated by one or more ``video_title_*`` clips.  The
    game data has no clip field, so the type -> clip mapping is the one the
    frozen viewer documented, recorded as manual provenance.

The title rows have no localized body.  Their text record carries the title
name for each language (the game does not translate it) so every entity's
``text_ref`` resolves through the same store contract as the other appendix
family.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..errors import BuildError, InputError
from ..keys import entity_key
from ..sources import LANGS, InputSource

# Title.Type -> video_title_* clips.  Verified against the media export, whose
# ``titles`` manifest names the clips ``title01`` .. ``title06_*`` plus the
# three special endings.  The game data only contains the integer type.
TITLE_VIDEO_CLIPS: dict[int, tuple[str, ...]] = {
    0: ("title01",),
    1: ("title02",),
    2: ("title03_1", "title03_2"),
    3: ("title04",),
    4: ("title05_1", "title05_2"),
    5: ("title06_1", "title06_2"),
    6: ("goodEndTitle",),
    7: ("goodEndTitle",),
    8: ("VanessaLv11Title",),
    9: ("trueEndTitle",),
}
TITLE_CLIPS_LOCATOR = "viewer/src/views/ExtrasReader.tsx:TITLE_CLIPS"

# LANGS slot -> raw page field.  Slot 2 is ``ContentTw``; ``ContentCht`` is a
# duplicate traditional field (it differs only in trailing whitespace).
_ASSISTANT_TEXT_FIELDS: tuple[tuple[str, str], ...] = (
    ("en", "ContentEn"),
    ("ja", "ContentJp"),
    ("zh-Hant", "ContentTw"),
    ("ko", "ContentKr"),
    ("zh-Hans", "ContentChs"),
)
_TEXT_ARTIFACT = Path("text") / "extras.jsonl"
_LANG_ORDER = {code: index for index, (code, _) in enumerate(LANGS)}


# --------------------------------------------------------------------- helpers
def _text_asset(locator: str, note: str | None = None) -> dict[str, str]:
    entry = {"kind": "text_asset", "locator": locator}
    if note:
        entry["note"] = note
    return entry


def _manual(locator: str, note: str) -> dict[str, str]:
    return {"kind": "manual", "locator": locator, "note": note}


def _sorted_provenance(record: dict[str, Any]) -> None:
    unique = {
        (entry.get("kind"), entry.get("locator"), entry.get("note")): entry
        for entry in record["provenance"]
    }
    record["provenance"] = [
        unique[key]
        for key in sorted(
            unique, key=lambda item: (item[0] or "", item[1] or "", item[2] or "")
        )
    ]


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
    if value is None or (isinstance(value, str) and not value.strip()):
        raise BuildError(f"{where}: missing {key}")
    return value


def _integer(raw: dict[str, Any], key: str, where: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise BuildError(f"{where}: {key} must be an integer")
    return value


def _rows(table: Any, what: str) -> list[dict[str, Any]]:
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list ({what})")
    rows: list[dict[str, Any]] = []
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}[{index}]: must be an object ({what})")
        rows.append(raw)
    return rows


def _page_field(page: dict[str, Any], field: str) -> str:
    value = page.get(field)
    return value if isinstance(value, str) else ""


def _page_metadata(page: dict[str, Any], where: str) -> dict[str, Any]:
    return {
        "page": _integer(page, "Page", where),
        "assistant_id": _integer(page, "AssistantId", where),
        "image_id": _page_field(page, "ImageId"),
        "sound_id": _page_field(page, "SoundId"),
    }


def _missing_languages(pages: list[dict[str, Any]]) -> list[str]:
    missing = []
    for code, field in _ASSISTANT_TEXT_FIELDS:
        if not any(_page_field(page, field).strip() for page in pages):
            missing.append(code)
    return missing


# --------------------------------------------------------- assistant dialogues
def _build_assistants(source: InputSource) -> list[dict[str, Any]]:
    table = source.im_assistant_data()
    if table is None:
        return []

    entities: list[dict[str, Any]] = []
    for index, raw in enumerate(_rows(table, "im_assistant_data")):
        where = f"{table.locator}[{index}]"
        game_id = str(_required(raw, "Id", where))
        raw_pages = raw.get("Pages")
        if not isinstance(raw_pages, list) or not raw_pages:
            raise BuildError(f"{where}: Pages must be a non-empty list")
        pages = []
        for page_index, page in enumerate(raw_pages):
            page_where = f"{where}.Pages[{page_index}]"
            if not isinstance(page, dict):
                raise BuildError(f"{page_where}: must be an object")
            pages.append(_page_metadata(page, page_where))
        target = raw.get("TargetId")
        entities.append(
            {
                "id": entity_key("assistant_dialogue", game_id),
                "type": "assistant_dialogue",
                "game_id": game_id,
                "trigger": _integer(raw, "Trigger", where),
                "target": str(target) if target else None,
                "version": str(raw.get("Version") or ""),
                "progress": _integer(raw, "Progress", where),
                "page_count": len(pages),
                "pages": pages,
                "text_ref": entity_key("assistant_dialogue", game_id),
                "missing_languages": _missing_languages(raw_pages),
                "provenance": [_text_asset(where)],
            }
        )
    return _dedupe(entities, "assistant_dialogue")


# ------------------------------------------------------------- title screens
def _build_titles(source: InputSource) -> list[dict[str, Any]]:
    table = source.title_info()
    if table is None:
        return []

    entities: list[dict[str, Any]] = []
    for index, raw in enumerate(_rows(table, "title_info")):
        where = f"{table.locator}[{index}]"
        number = _integer(raw, "Type", where)
        name = str(_required(raw, "Name", where))
        clips = TITLE_VIDEO_CLIPS.get(number)
        if clips is None:
            raise BuildError(
                f"{where}: unknown title Type {number!r}; add its video clips "
                "to TITLE_VIDEO_CLIPS"
            )
        raw_conditions = raw.get("Conditions") or []
        if not isinstance(raw_conditions, list):
            raise BuildError(f"{where}: Conditions must be a list")
        conditions = []
        for condition_index, condition in enumerate(raw_conditions):
            condition_where = f"{where}.Conditions[{condition_index}]"
            if not isinstance(condition, dict):
                raise BuildError(f"{condition_where}: must be an object")
            story_id = str(_required(condition, "storyId", condition_where))
            conditions.append({"kind": "story", "value": story_id})

        identifier = entity_key("title_screen", str(number))
        entities.append(
            {
                "id": identifier,
                "type": "title_screen",
                "game_id": str(number),
                "number": number,
                "name": name,
                "unlock_conditions": conditions,
                "video_clips": list(clips),
                "text_ref": identifier,
                "provenance": [
                    _text_asset(where),
                    _manual(
                        TITLE_CLIPS_LOCATOR,
                        "title Type -> video_title_* clips inferred from "
                        "Title01..Title06 order and the special ending names",
                    ),
                ],
            }
        )
    for record in entities:
        _sorted_provenance(record)
    return _dedupe(entities, "title_screen")


# ------------------------------------------------------------------ text store
def _assistant_text_records(
    source: InputSource, entities: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    table = source.im_assistant_data()
    if table is None:
        return []
    raw_by_id = {
        str(raw.get("Id")): raw
        for raw in _rows(table, "im_assistant_data")
        if raw.get("Id")
    }
    records: list[dict[str, Any]] = []
    for entity in sorted(entities, key=lambda row: row["id"]):
        raw = raw_by_id.get(entity["game_id"])
        if raw is None:
            raise BuildError(
                f"{entity['id']}: group disappeared from {table.locator}"
            )
        raw_pages = raw.get("Pages") or []
        for code, field in _ASSISTANT_TEXT_FIELDS:
            blocks = []
            for page in raw_pages:
                blocks.append(
                    {
                        "kind": "page",
                        **_page_metadata(
                            page, f"{table.locator}.{entity['game_id']}.Pages"
                        ),
                        "text": _page_field(page, field),
                    }
                )
            if any(block["text"].strip() for block in blocks):
                records.append(
                    {
                        "ref": entity["text_ref"],
                        "entity": "assistant_dialogue",
                        "lang": code,
                        "blocks": blocks,
                    }
                )
            else:
                records.append(
                    {
                        "ref": entity["text_ref"],
                        "entity": "assistant_dialogue",
                        "lang": code,
                        "blocks": [],
                        "missing": True,
                    }
                )
    return records


def _title_text_records(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for entity in sorted(entities, key=lambda row: row["id"]):
        for code, _ in LANGS:
            records.append(
                {
                    "ref": entity["text_ref"],
                    "entity": "title_screen",
                    "lang": code,
                    "name": entity["name"],
                    "text": entity["name"],
                }
            )
    return records


def _check_text(
    records: list[dict[str, Any]],
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    by_ref: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        by_ref.setdefault(record["ref"], {})[record["lang"]] = record

    expected_languages = {code for code, _ in LANGS}
    for entity in entities.get("assistant_dialogue", []):
        languages = by_ref.get(entity["text_ref"])
        if languages is None or set(languages) != expected_languages:
            raise BuildError(
                f"{entity['id']}: text_ref {entity['text_ref']!r} is missing language records"
            )
        missing = sorted(
            code for code, record in languages.items() if record.get("missing")
        )
        if missing != sorted(entity["missing_languages"]):
            raise BuildError(
                f"{entity['id']}: missing_languages disagrees with the text store"
            )
        for code, record in languages.items():
            if record.get("missing"):
                if record["blocks"]:
                    raise BuildError(
                        f"{entity['id']}: {code} is marked missing but has blocks"
                    )
                continue
            if len(record["blocks"]) != entity["page_count"]:
                raise BuildError(
                    f"{entity['id']}: {code} has {len(record['blocks'])} page blocks, "
                    f"expected {entity['page_count']}"
                )

    for entity in entities.get("title_screen", []):
        languages = by_ref.get(entity["text_ref"])
        if languages is None or set(languages) != expected_languages:
            raise BuildError(
                f"{entity['id']}: text_ref {entity['text_ref']!r} is missing language records"
            )
        for code, record in languages.items():
            if record.get("missing") or record.get("text") != entity["name"]:
                raise BuildError(
                    f"{entity['id']}: {code} does not carry the title name"
                )


def write_artifacts(
    out: Path,
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    assistants = entities.get("assistant_dialogue", [])
    titles = entities.get("title_screen", [])
    if not assistants and not titles:
        return
    records = _assistant_text_records(source, assistants) + _title_text_records(titles)
    _check_text(records, entities)

    path = Path(out) / _TEXT_ARTIFACT
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(
        records, key=lambda record: (record["ref"], _LANG_ORDER[record["lang"]])
    )
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in ordered:
            handle.write(
                json.dumps(
                    record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
            )
            handle.write("\n")


# ------------------------------------------------------------------------- api
def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    return {
        "assistant_dialogue": _build_assistants(source),
        "title_screen": _build_titles(source),
    }
