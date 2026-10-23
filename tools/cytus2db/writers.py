"""Write the derived artifacts: JSONL, SQLite and the SPA projection."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from . import SCHEMA_VERSION
from .keys import DIFFICULTIES

# Explicit columns next to the full JSON record so common queries do not need
# SQLite's JSON1 extension. ``id`` and ``data`` are generic for every table.
TABLE_COLUMNS: dict[str, tuple[tuple[str, str], ...]] = {
    "character": (
        ("game_id", "TEXT"),
        ("name", "TEXT"),
        ("pack_id", "TEXT"),
    ),
    "pack": (
        ("game_id", "TEXT"),
        ("name", "TEXT"),
        ("category", "TEXT"),
        ("is_iap", "INTEGER"),
        ("has_im", "INTEGER"),
        ("price", "TEXT"),
    ),
    "folder": (
        ("game_id", "TEXT"),
        ("name", "TEXT"),
    ),
    "chapter": (
        ("game_id", "TEXT"),
        ("name", "TEXT"),
        ("category", "INTEGER"),
    ),
    "song": (
        ("game_id", "TEXT"),
        ("name", "TEXT"),
        ("artist", "TEXT"),
        ("pack_id", "TEXT"),
    ),
    "chart": (
        ("game_id", "TEXT"),
        ("song_id", "TEXT"),
        ("difficulty", "TEXT"),
        ("level", "TEXT"),
        ("need_unlock", "INTEGER"),
    ),
    "illustration": (
        ("game_id", "TEXT"),
        ("character_id", "TEXT"),
        ("costume", "TEXT"),
        ("available", "INTEGER"),
    ),
    "asset": (
        ("game_id", "TEXT"),
        ("kind", "TEXT"),
        ("name", "TEXT"),
        ("bundle", "TEXT"),
    ),
    "subtitle_line": (
        ("game_id", "TEXT"),
        ("character", "TEXT"),
        ("voice_asset_id", "TEXT"),
    ),
}

_INDEXES = (
    ("chart", "song_id"),
    ("chart", "difficulty"),
    ("song", "pack_id"),
    ("illustration", "character_id"),
    ("asset", "kind"),
    ("subtitle_line", "character"),
)


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in sorted(records, key=lambda item: item["id"]):
            handle.write(
                json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )
            handle.write("\n")


def write_edges(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8", newline="\n")


def write_sqlite(
    path: Path,
    entities: dict[str, list[dict[str, Any]]],
    counts: dict[str, int],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    try:
        for entity_type, columns in TABLE_COLUMNS.items():
            declarations = ["id TEXT PRIMARY KEY"]
            declarations.extend(f"{name} {kind}" for name, kind in columns)
            declarations.append("data TEXT NOT NULL")
            connection.execute(
                f"CREATE TABLE {entity_type} ({', '.join(declarations)})"
            )
            names = ["id", *(name for name, _ in columns), "data"]
            placeholders = ", ".join("?" for _ in names)
            insert = (
                f"INSERT INTO {entity_type} ({', '.join(names)}) VALUES ({placeholders})"
            )
            rows = []
            for record in sorted(entities[entity_type], key=lambda item: item["id"]):
                values = [record["id"]]
                values.extend(
                    _column_value(record.get(name)) for name, _ in columns
                )
                values.append(
                    json.dumps(
                        record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    )
                )
                rows.append(values)
            connection.executemany(insert, rows)

        connection.execute(
            "CREATE TABLE edges (source TEXT NOT NULL, relation TEXT NOT NULL, "
            "target TEXT NOT NULL, data TEXT)"
        )
        connection.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

        for table, column in _INDEXES:
            connection.execute(f"CREATE INDEX idx_{table}_{column} ON {table} ({column})")
        connection.execute("CREATE INDEX idx_edges_source ON edges (source)")
        connection.execute("CREATE INDEX idx_edges_target ON edges (target)")

        meta = [("schema_version", str(SCHEMA_VERSION))]
        meta.extend((f"count:{key}", str(value)) for key, value in sorted(counts.items()))
        connection.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", meta)
        connection.commit()
    finally:
        connection.close()


def write_spa(path: Path, entities: dict[str, list[dict[str, Any]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    counts = {name: len(records) for name, records in entities.items()}
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "counts": counts,
        "difficulties": list(DIFFICULTIES),
        "entities": entities,
        "edges": [],
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _column_value(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    return value
