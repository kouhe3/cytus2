"""Build all canonical-DB artifacts for one input tree."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .entities import build_entities, extension_modules
from .edges import build_edges, validate_edge_records, validate_edges
from .errors import ValidationError
from .sources import InputSource
from .textstore import write_base_text
from .validate import SchemaValidator
from .writers import write_edges, write_jsonl, write_spa, write_sqlite

BASE_ENTITY_TYPES = (
    "character",
    "pack",
    "folder",
    "chapter",
    "song",
    "chart",
    "illustration",
    "asset",
    "subtitle_line",
)


def build_database(
    input_dir: Path | str,
    out_dir: Path | str,
    *,
    clean: bool = False,
) -> dict[str, int]:
    source = InputSource(input_dir)
    entities = build_entities(source)
    for entity_type in BASE_ENTITY_TYPES:
        entities.setdefault(entity_type, [])
    edges = build_edges(source, entities)

    validate(entities)
    validate_edge_records(edges)
    validate_edges(edges, entities)

    out = Path(out_dir)
    if clean:
        clean_outputs(out)
    out.mkdir(parents=True, exist_ok=True)

    counts = {name: len(records) for name, records in entities.items()}
    for entity_type, records in entities.items():
        write_jsonl(out / "db" / f"{entity_type}.jsonl", records)
    write_base_text(out, source, entities)
    for module in extension_modules():
        writer = getattr(module, "write_artifacts", None)
        if writer is not None:
            writer(out, source, entities)
    text_records = _read_text_store(out / "text")
    write_edges(out / "db" / "edges.jsonl", edges)
    write_sqlite(out / "db.sqlite", entities, counts, edges, text_records)
    write_spa(
        out / "spa" / "data.json",
        entities,
        edges,
        _spa_im_filters(source, entities),
    )
    return counts


def _spa_im_filters(
    source: InputSource, entities: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """The game's iM account filter groups, for the SPA timeline filter.

    ``im_filter_data`` groups several avatars under one account icon (PAFF
    owns ``paff_01`` and ``paff_02``).  The account label is resolved against
    the character entities so the SPA does not need a second name table.
    """
    empty: dict[str, Any] = {"items": [], "otherAvatar": None}
    table = source.text_json("imdata", "im_filter_data")
    if table is None or not isinstance(table.data, dict):
        return empty
    names = {
        str(record.get("game_id")): str(record.get("name") or "")
        for record in entities.get("character", [])
        if record.get("game_id")
    }

    def avatar_name(avatar: str) -> str:
        base, _, number = avatar.partition("_")
        if number.isdigit():
            candidate = f"{base}{int(number):03d}"
            if names.get(candidate):
                return names[candidate]
        for game_id in sorted(names):
            if game_id.startswith(base) and names[game_id]:
                return names[game_id]
        return avatar

    items: list[dict[str, Any]] = []
    for raw in table.data.get("Items") or []:
        if not isinstance(raw, dict):
            continue
        avatar = str(raw.get("DisplayAvatarId") or "").strip()
        if not avatar:
            continue
        avatars = [
            str(value).strip()
            for value in raw.get("FilterAvatarIds") or []
            if str(value).strip()
        ]
        items.append(
            {"avatar": avatar, "avatars": avatars, "name": avatar_name(avatar)}
        )
    other = str(table.data.get("OtherItemDisplayAvatarId") or "").strip()
    return {"items": items, "otherAvatar": other or None}


def _read_text_store(directory: Path) -> list[dict[str, Any]]:
    """Read every ``text/*.jsonl`` record so SQLite can index it.

    The JSONL files stay the source of truth: the FTS table is rebuilt from
    them on every ``build``, including the files extension modules write after
    :func:`write_base_text`.
    """
    records: list[dict[str, Any]] = []
    if not directory.is_dir():
        return records
    for path in sorted(directory.glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                records.append(json.loads(line))
    return records


def validate(entities: dict[str, list[dict[str, Any]]]) -> None:
    validator = SchemaValidator()
    errors: list[str] = []
    for entity_type, records in entities.items():
        for record in records:
            for message in validator.errors(entity_type, record):
                errors.append(f"{entity_type} {record.get('id', '?')}: {message}")
    if errors:
        raise ValidationError(errors)


def clean_outputs(out: Path) -> None:
    """Remove only the artifacts this builder owns (never ``build/wiki``)."""
    db_dir = out / "db"
    if db_dir.is_dir():
        shutil.rmtree(db_dir)
    database = out / "db.sqlite"
    if database.is_file():
        database.unlink()
    spa_dir = out / "spa"
    if spa_dir.is_dir():
        shutil.rmtree(spa_dir)
