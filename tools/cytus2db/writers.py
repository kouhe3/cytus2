"""Write the derived artifacts: JSONL, SQLite and the SPA projection."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from . import SCHEMA_VERSION
from .errors import BuildError
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
        ("asset_id", "TEXT"),
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


def write_edges(path: Path, edges: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for edge in sorted(
            edges, key=lambda item: (item["source"], item["relation"], item["target"])
        ):
            handle.write(
                json.dumps(
                    edge, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
            )
            handle.write("\n")


def write_sqlite(
    path: Path,
    entities: dict[str, list[dict[str, Any]]],
    counts: dict[str, int],
    edges: list[dict[str, Any]],
    text_records: list[dict[str, Any]] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    try:
        for entity_type in sorted(entities):
            columns = TABLE_COLUMNS.get(entity_type, ())
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
        connection.executemany(
            "INSERT INTO edges (source, relation, target, data) VALUES (?, ?, ?, ?)",
            [
                (
                    edge["source"],
                    edge["relation"],
                    edge["target"],
                    json.dumps(
                        edge,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                )
                for edge in sorted(
                    edges,
                    key=lambda item: (
                        item["source"],
                        item["relation"],
                        item["target"],
                    ),
                )
            ],
        )
        connection.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

        for table, column in _INDEXES:
            connection.execute(f"CREATE INDEX idx_{table}_{column} ON {table} ({column})")
        connection.execute("CREATE INDEX idx_edges_source ON edges (source)")
        connection.execute("CREATE INDEX idx_edges_target ON edges (target)")

        search_rows = _search_rows(text_records or [])
        try:
            connection.execute(
                "CREATE VIRTUAL TABLE search USING fts5("
                "ref UNINDEXED, entity UNINDEXED, lang UNINDEXED, text, "
                "tokenize='unicode61')"
            )
        except sqlite3.OperationalError as exc:  # pragma: no cover - build env
            raise BuildError(
                "SQLite was built without FTS5; the canonical DB requires it "
                f"({exc})"
            ) from exc
        connection.executemany(
            "INSERT INTO search (ref, entity, lang, text) VALUES (?, ?, ?, ?)",
            search_rows,
        )

        meta = [("schema_version", str(SCHEMA_VERSION))]
        meta.extend((f"count:{key}", str(value)) for key, value in sorted(counts.items()))
        meta.append(("count:edge", str(len(edges))))
        meta.append(("count:search", str(len(search_rows))))
        connection.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", meta)
        connection.commit()
    finally:
        connection.close()


def _search_rows(
    records: list[dict[str, Any]],
) -> list[tuple[str, str, str, str]]:
    """Flatten text-store records into FTS rows, dropping empty bodies.

    ``build/text/*.jsonl`` stays the source of truth; this mirrors its
    searchable prose so ``SELECT … FROM search WHERE search MATCH …`` works
    without re-reading JSONL.
    """
    rows: list[tuple[str, str, str, str]] = []
    for record in records:
        ref = record.get("ref")
        entity = record.get("entity")
        lang = record.get("lang")
        body = _searchable_text(record)
        if not (_string(ref) and _string(entity) and _string(lang) and body):
            continue
        rows.append((str(ref), str(entity), str(lang), body))
    rows.sort()
    return rows


def _searchable_text(record: dict[str, Any]) -> str:
    parts: list[str] = []
    name = record.get("name")
    if isinstance(name, str) and name.strip():
        parts.append(name.strip())
    text = record.get("text")
    if isinstance(text, str) and text.strip():
        parts.append(text.strip())
    blocks = record.get("blocks")
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict):
                continue
            for key in ("speaker", "title", "text", "body"):
                value = block.get(key)
                if isinstance(value, str) and value.strip():
                    parts.append(value.strip())
    return "\n".join(parts)


def _string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def write_spa(
    path: Path,
    entities: dict[str, list[dict[str, Any]]],
    edges: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    counts = {name: len(records) for name, records in entities.items()}
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "counts": counts,
        "difficulties": list(DIFFICULTIES),
        "entities": entities,
        "edges": sorted(
            edges, key=lambda item: (item["source"], item["relation"], item["target"])
        ),
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
