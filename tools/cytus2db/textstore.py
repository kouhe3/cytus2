"""Text-store artifacts for base entities.

Two structure entities carry localized prose that must not live inline in the
projection:

``pack``
    The five-language ``Descriptions`` object from ``song_pack_data``.  The
    entity keeps ``text_ref`` and the text lives in ``build/text/packs.jsonl``.

``subtitle_line``
    The five-language ``Subtitles`` slots from ``audiodesubtitledata``.  The
    entity keeps ``text_ref`` and the text lives in
    ``build/text/subtitles.jsonl``.

Both files follow the same contract as the extension text stores: one JSON
object per ``(ref, lang)`` with ``entity``, ``ref`` and either ``text`` or
``missing: true``.  The JSONL files are the source; the SQLite FTS index and
the SPA text index are derived from them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .errors import BuildError
from .sources import LANGS, InputSource

PACK_TEXT = "packs"
SUBTITLE_TEXT = "subtitles"

_LANG_ORDER = {code: index for index, (code, _) in enumerate(LANGS)}


def write_base_text(
    out: Path,
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Write ``build/text/{packs,subtitles}.jsonl`` and return the records."""
    records = _pack_records(source, entities.get("pack", []))
    records.extend(_subtitle_records(source, entities.get("subtitle_line", [])))
    directory = Path(out) / "text"
    for name in (PACK_TEXT, SUBTITLE_TEXT):
        rows = [record for record in records if record["entity"] == _ENTITY[name]]
        _write(directory / f"{name}.jsonl", rows)
    return records


_ENTITY = {PACK_TEXT: "pack", SUBTITLE_TEXT: "subtitle_line"}


def _write(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(
        records,
        key=lambda record: (record["ref"], _LANG_ORDER[record["lang"]]),
    )
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in ordered:
            handle.write(
                json.dumps(
                    record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
            )
            handle.write("\n")


def _pack_records(
    source: InputSource, packs: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not packs:
        return []
    data = source.song_catalog().data
    if not isinstance(data, dict):
        raise BuildError("song_pack_data must be a JSON object")
    raw_packs = data.get("offline_song_pack_list") or []
    descriptions: dict[str, Any] = {}
    for raw in raw_packs:
        if isinstance(raw, dict) and raw.get("song_pack_id"):
            descriptions[str(raw["song_pack_id"])] = raw.get("Descriptions") or {}

    records: list[dict[str, Any]] = []
    for pack in sorted(packs, key=lambda record: record["id"]):
        game_id = str(pack["game_id"])
        raw = descriptions.get(game_id)
        if not isinstance(raw, dict):
            raise BuildError(
                f"{pack['id']}: pack {game_id!r} has no Descriptions object"
            )
        for code, _ in LANGS:
            value = raw.get(code)
            record = {
                "ref": pack["text_ref"],
                "entity": "pack",
                "lang": code,
            }
            if isinstance(value, str) and value.strip():
                record["text"] = value
            else:
                record["missing"] = True
            records.append(record)
    return records


def _subtitle_records(
    source: InputSource, subtitles: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not subtitles:
        return []
    table = source.audio_subtitles()
    if table is None:
        raise BuildError("audio_subtitledata is missing but subtitle entities exist")
    slots_by_id: dict[str, Any] = {}
    for raw in table.data if isinstance(table.data, list) else []:
        if isinstance(raw, dict) and raw.get("AudioId"):
            slots_by_id[str(raw["AudioId"])] = raw.get("Subtitles") or []

    records: list[dict[str, Any]] = []
    for subtitle in sorted(subtitles, key=lambda record: record["id"]):
        audio_id = str(subtitle["game_id"])
        if audio_id not in slots_by_id:
            raise BuildError(
                f"{subtitle['id']}: cue disappeared from {table.locator}"
            )
        slots = slots_by_id[audio_id]
        if not isinstance(slots, list):
            raise BuildError(f"{table.locator}: Subtitles must be a list")
        for code, slot in LANGS:
            record = {
                "ref": subtitle["text_ref"],
                "entity": "subtitle_line",
                "lang": code,
            }
            value = slots[slot] if slot < len(slots) else None
            if isinstance(value, str) and value.strip():
                record["text"] = value
            else:
                record["missing"] = True
            records.append(record)
    return records
