"""Read the artifacts produced by ``cytus2db build`` for rendering."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..errors import BuildError, InputError


@dataclass(frozen=True)
class Edge:
    source: str
    relation: str
    target: str
    provenance: tuple[dict[str, str], ...] = ()


class Database:
    """Entities, edges and optional text records of one build directory."""

    def __init__(
        self,
        entities: dict[str, dict[str, dict[str, Any]]],
        edges: list[Edge],
        text: dict[str, list[dict[str, Any]]],
    ) -> None:
        self.entities = entities
        self.edges = edges
        self._text = text
        self._by_id = {
            identifier: record
            for records in entities.values()
            for identifier, record in records.items()
        }
        self._incoming: dict[tuple[str, str], list[Edge]] = {}
        for edge in edges:
            self._incoming.setdefault((edge.relation, edge.target), []).append(edge)

    @classmethod
    def load(cls, build_dir: Path | str) -> "Database":
        root = Path(build_dir)
        db_dir = root / "db"
        if not db_dir.is_dir():
            raise InputError(
                f"missing {db_dir}; run `python -m cytus2db build` before rendering"
            )
        entities: dict[str, dict[str, dict[str, Any]]] = {}
        for path in sorted(db_dir.glob("*.jsonl")):
            if path.name == "edges.jsonl":
                continue
            by_id: dict[str, dict[str, Any]] = {}
            for record in _read_jsonl(path):
                identifier = str(record.get("id") or "")
                if not identifier:
                    raise BuildError(f"{path}: record without id")
                by_id[identifier] = record
            entities[path.stem] = by_id

        edges_path = db_dir / "edges.jsonl"
        edges = [
            Edge(
                source=str(record["source"]),
                relation=str(record["relation"]),
                target=str(record["target"]),
                provenance=tuple(record.get("provenance") or ()),
            )
            for record in _read_jsonl(edges_path)
        ]
        text = {
            path.stem: _read_jsonl(path)
            for path in sorted((root / "text").glob("*.jsonl"))
        }
        return cls(entities, edges, text)

    def records(self, entity_type: str) -> list[dict[str, Any]]:
        return list(self.entities.get(entity_type, {}).values())

    def get(self, identifier: str) -> dict[str, Any] | None:
        return self._by_id.get(identifier)

    def require(self, identifier: str) -> dict[str, Any]:
        record = self.get(identifier)
        if record is None:
            raise BuildError(f"edge references missing entity {identifier!r}")
        return record

    def incoming(self, relation: str, target: str) -> list[Edge]:
        return self._incoming.get((relation, target), [])

    def text_records(self, name: str) -> list[dict[str, Any]]:
        return self._text.get(name, [])


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise BuildError(f"{path}: expected JSON objects")
                records.append(value)
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    return records
