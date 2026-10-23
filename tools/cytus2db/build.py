"""Build all canonical-DB artifacts for one input tree."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .entities import build_entities
from .errors import ValidationError
from .sources import InputSource
from .validate import SchemaValidator
from .writers import write_edges, write_jsonl, write_spa, write_sqlite

ENTITY_TYPES = (
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
    for entity_type in ENTITY_TYPES:
        entities.setdefault(entity_type, [])

    validate(entities)

    out = Path(out_dir)
    if clean:
        clean_outputs(out)
    out.mkdir(parents=True, exist_ok=True)

    counts = {name: len(entities[name]) for name in ENTITY_TYPES}
    for entity_type in ENTITY_TYPES:
        write_jsonl(out / "db" / f"{entity_type}.jsonl", entities[entity_type])
    write_edges(out / "db" / "edges.jsonl")
    write_sqlite(out / "db.sqlite", entities, counts)
    write_spa(out / "spa" / "data.json", entities)
    return counts


def validate(entities: dict[str, list[dict[str, Any]]]) -> None:
    validator = SchemaValidator()
    errors: list[str] = []
    for entity_type in ENTITY_TYPES:
        for record in entities[entity_type]:
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
