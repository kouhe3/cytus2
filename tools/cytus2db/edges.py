"""Derive the cross-entity edge table from the built entities and their sources.

Edges are never hand-maintained: every relation below is computed from a raw
TextAsset field or from a reference another extractor already resolved.  The
required relations are:

``unlocks_chart``
    A source that grants a chart: iM post (``im_topic_data`` ``UnlockCharts``),
    OS log (``osdata`` ``UnlockCharts``), OA object (``oa_system_data``
    ``Rewards``), story node (``storychartunlock`` plus Branching OS
    ``UnlockedCharts``), CAPSO shop item and gacha reward.
``requires_story``
    An iM post gated by ``StoryLockId``; the story itself is an entity, the
    gate is only this edge.
``same_level``
    A sync point: one character level unlocks an iM post and an OS log.  The
    edge is emitted once, post -> log.
``belongs_to_pack``
    Song -> pack, even though ``song.pack_id`` already carries the value.
``appears_in_gallery``
    Story node ``gallery_ref`` or boss stage -> Backup Database item.
``same_stage``
    Story event -> boss stage when the ``BOSS_STAGE_ID`` reference resolved
    (directly, by display-name alias, or through an alias override).
``has_reply``
    iM reply -> the post it belongs to (``im_reply.post_id``).  The reply
    entity is already flat and carries no parent field, so this edge is the
    only place the thread relation is represented.

``mentions_song`` is deliberately **not** emitted.  No TextAsset field names a
song from a post or log body: ``UnlockCharts`` is an unlock grant (already
``unlocks_chart``), and the game's rich text has no stable song reference.
Deriving it would mean fuzzy title matching, which ADR-0003 forbids, so the
SPA has no relation label for it either.

Chart edges skip charts whose ``NeedUnlock`` is false: owning the song already
grants those charts, so they have no unlock source.  A reference to a chart
that does not exist in the catalog is kept as an edge on purpose, so the
integrity check fails the build instead of silently dropping data.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Iterable

from .errors import BuildError, ValidationError
from .keys import DIFFICULTIES, chart_key, entity_key
from .provenance import sorted_entries, text_asset
from .sources import InputSource, Table
from .validate import SchemaValidator

RELATIONS = frozenset(
    {
        "unlocks_chart",
        "requires_story",
        "same_level",
        "belongs_to_pack",
        "appears_in_gallery",
        "same_stage",
        "has_reply",
    }
)

_OA_TABLE = ("oasystemdata", "oa_system_data")
_CHART_REWARD_RE = re.compile(
    r"^(?P<song>.+)_(?P<indices>[0-9]+(?:,[0-9]+)*)$"
)
_MAX_REPORTED = 20


# ------------------------------------------------------------------- helpers
_text_asset = text_asset


def _rows(table: Table, what: str) -> list[Any]:
    if not isinstance(table.data, list):
        raise BuildError(f"{table.locator} must be a JSON list ({what})")
    return table.data


def _difficulty(value: Any, where: str) -> str:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BuildError(f"{where}: unknown Difficulty {value!r}")
    if not 0 <= value < len(DIFFICULTIES):
        raise BuildError(f"{where}: unknown Difficulty {value!r}")
    return DIFFICULTIES[value]


class _EdgeSet:
    """Keyed collector: duplicate ``(source, relation, target)`` merge provenance."""

    def __init__(self) -> None:
        self._edges: dict[tuple[str, str, str], list[dict[str, str]]] = {}

    def add(
        self,
        source: str,
        relation: str,
        target: str,
        provenance: Iterable[dict[str, str]] | dict[str, str] | None,
    ) -> None:
        if relation not in RELATIONS:
            raise BuildError(f"unknown edge relation {relation!r}")
        bucket = self._edges.setdefault((source, relation, target), [])
        if provenance is None:
            return
        if isinstance(provenance, dict):
            bucket.append(provenance)
        else:
            bucket.extend(provenance)

    def records(self) -> list[dict[str, Any]]:
        records = []
        for (source, relation, target), provenance in sorted(self._edges.items()):
            record: dict[str, Any] = {
                "source": source,
                "relation": relation,
                "target": target,
            }
            if provenance:
                record["provenance"] = sorted_entries(provenance)
            records.append(record)
        return records


def _chart_edge(
    edges: _EdgeSet,
    charts: dict[str, dict[str, Any]],
    source: str,
    target: str,
    provenance: dict[str, str],
) -> None:
    chart = charts.get(target)
    if chart is not None and not chart["need_unlock"]:
        return
    edges.add(source, "unlocks_chart", target, provenance)


# ---------------------------------------------------------------- unlock: iM
def _im_chart_edges(
    source: InputSource,
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    table = source.text_json("imdata", "im_topic_data")
    if table is None:
        return
    for index, row in enumerate(_rows(table, "im_topic_data")):
        if not isinstance(row, dict):
            raise BuildError(f"{table.locator}[{index}]: must be an object")
        topic_id = str(row.get("Id") or "").strip().upper()
        if not topic_id:
            raise BuildError(f"{table.locator}[{index}]: missing Id")
        for position, reference in enumerate(row.get("UnlockCharts") or []):
            where = f"{table.locator}[{index}].UnlockCharts[{position}]"
            if not isinstance(reference, dict):
                raise BuildError(f"{where}: must be an object")
            song_id = str(reference.get("SongId") or "").strip()
            if not song_id:
                raise BuildError(f"{where}: missing SongId")
            target = chart_key(song_id, _difficulty(reference.get("Difficulty"), where))
            _chart_edge(
                edges,
                charts,
                entity_key("im", topic_id),
                target,
                _text_asset(where),
            )


# ---------------------------------------------------------------- unlock: OS
def _os_chart_edges(
    source: InputSource,
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    for table in source.os_tables():
        for index, row in enumerate(_rows(table, "os_log")):
            if not isinstance(row, dict):
                raise BuildError(f"{table.locator}[{index}]: must be an object")
            log_id = str(row.get("Id") or "").strip()
            if not log_id:
                raise BuildError(f"{table.locator}[{index}]: missing Id")
            for position, reference in enumerate(row.get("UnlockCharts") or []):
                where = f"{table.locator}[{index}].UnlockCharts[{position}]"
                if not isinstance(reference, dict):
                    raise BuildError(f"{where}: must be an object")
                song_id = str(reference.get("SongId") or "").strip()
                if not song_id:
                    raise BuildError(f"{where}: missing SongId")
                target = chart_key(
                    song_id, _difficulty(reference.get("Difficulty"), where)
                )
                _chart_edge(
                    edges,
                    charts,
                    entity_key("os", log_id),
                    target,
                    _text_asset(where),
                )


# ---------------------------------------------------------------- unlock: OA
def _oa_chart_edges(
    source: InputSource,
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    table = source.text_json(*_OA_TABLE)
    if table is None:
        return
    if not isinstance(table.data, dict):
        raise BuildError(f"{table.locator} must be a JSON object")
    rewards = table.data.get("Rewards") or []
    if not isinstance(rewards, list):
        raise BuildError(f"{table.locator}/Rewards must be a list")
    for index, reward in enumerate(rewards):
        where = f"{table.locator}.Rewards[{index}]"
        if not isinstance(reward, dict):
            raise BuildError(f"{where}: must be an object")
        # 0 = chart, 1 = illustration/skin.
        if int(reward.get("Type") or 0) != 0:
            continue
        object_id = str(reward.get("ObjectId") or "").strip()
        reward_id = str(reward.get("RewardId") or "").strip()
        if not object_id:
            raise BuildError(f"{where}: missing ObjectId")
        match = _CHART_REWARD_RE.match(reward_id)
        if match is None:
            raise BuildError(f"{where}: malformed chart RewardId {reward_id!r}")
        song_id = match.group("song")
        for difficulty in match.group("indices").split(","):
            target = chart_key(song_id, _difficulty(int(difficulty), where))
            _chart_edge(
                edges,
                charts,
                entity_key("oa_object", object_id),
                target,
                _text_asset(where),
            )


# ------------------------------------------------------------- unlock: story
def _story_chart_edges(
    source: InputSource,
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    table = source.json_or_bundle(
        (("chartunlock",),), "chartunlock.ab", "storychartunlock"
    )
    if not isinstance(table.data, dict):
        raise BuildError(f"{table.locator} must be a JSON object")
    for story_id in sorted(table.data):
        entries = table.data[story_id]
        if not isinstance(entries, list):
            raise BuildError(f"{table.locator}.{story_id} must be a list")
        for index, reference in enumerate(entries):
            where = f'{table.locator}["{story_id}"][{index}]'
            if not isinstance(reference, dict):
                raise BuildError(f"{where}: must be an object")
            song_id = str(reference.get("SongId") or "").strip()
            if not song_id:
                raise BuildError(f"{where}: missing SongId")
            target = chart_key(song_id, _difficulty(reference.get("Difficulty"), where))
            _chart_edge(
                edges,
                charts,
                entity_key("story_node", story_id),
                target,
                _text_asset(where),
            )


def _branch_chart_edges(
    entities: dict[str, list[dict[str, Any]]],
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    for node in entities.get("story_node", []):
        if node.get("kind") != "branch":
            continue
        for target in node.get("charts") or []:
            _chart_edge(edges, charts, node["id"], target, node["provenance"])


# ------------------------------------------------------- unlock: commerce
def _commerce_chart_edges(
    entities: dict[str, list[dict[str, Any]]],
    charts: dict[str, dict[str, Any]],
    edges: _EdgeSet,
) -> None:
    for entity_type in ("capso_shop_item", "gacha_reward"):
        for item in entities.get(entity_type, []):
            if item.get("kind") != "chart":
                continue
            for target in item.get("chart_ids") or []:
                _chart_edge(
                    edges, charts, item["id"], target, item.get("provenance") or []
                )


# ------------------------------------------------------------ requires_story
def _im_lock_rows(
    source: InputSource,
) -> tuple[Table, dict[str, tuple[int, dict[str, Any]]]] | None:
    table = source.text_json("imdata", "im_lock_condition_data")
    if table is None:
        return None
    rows: dict[str, tuple[int, dict[str, Any]]] = {}
    for index, row in enumerate(_rows(table, "im_lock_condition_data")):
        if not isinstance(row, dict):
            raise BuildError(f"{table.locator}[{index}]: must be an object")
        topic_id = str(row.get("TopicId") or "").strip().upper()
        if not topic_id:
            raise BuildError(f"{table.locator}[{index}]: missing TopicId")
        rows[topic_id] = (index, row)
    return table, rows


def _requires_story_edges(
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    locks = _im_lock_rows(source)
    if locks is None:
        return
    table, rows = locks
    posts = {post["game_id"] for post in entities.get("im_post", [])}
    for topic_id, (index, row) in sorted(rows.items()):
        if topic_id not in posts:
            continue
        story_id = str(row.get("StoryLockId") or "").strip()
        if not story_id:
            continue
        edges.add(
            entity_key("im", topic_id),
            "requires_story",
            entity_key("story_node", story_id),
            _text_asset(f"{table.locator}[{index}].StoryLockId"),
        )


# ---------------------------------------------------------------- same_level
def _same_level_edges(
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    locks = _im_lock_rows(source)
    if locks is None:
        return
    lock_table, lock_rows = locks
    posts = {post["game_id"] for post in entities.get("im_post", [])}

    posts_by_level: dict[tuple[str, int], list[str]] = defaultdict(list)
    post_locators: dict[str, str] = {}
    for topic_id, (index, row) in sorted(lock_rows.items()):
        if topic_id not in posts:
            continue
        locator = f"{lock_table.locator}[{index}].LevelLocks"
        post_locators[entity_key("im", topic_id)] = locator
        seen = set()
        for lock in row.get("LevelLocks") or []:
            if not isinstance(lock, dict):
                raise BuildError(f"{locator}: level lock must be an object")
            character_id = str(lock.get("SongPackId") or "").strip()
            if not character_id:
                raise BuildError(f"{locator}: missing SongPackId")
            level = int(lock.get("Level") or 0)
            key = (entity_key("character", character_id), level)
            if key in seen:
                continue
            seen.add(key)
            posts_by_level[key].append(entity_key("im", topic_id))

    logs_by_level: dict[tuple[str, int], list[str]] = defaultdict(list)
    log_locators: dict[str, str] = {}
    for table in source.os_tables():
        for index, row in enumerate(_rows(table, "os_log")):
            if not isinstance(row, dict):
                raise BuildError(f"{table.locator}[{index}]: must be an object")
            log_id = str(row.get("Id") or "").strip()
            if not log_id:
                raise BuildError(f"{table.locator}[{index}]: missing Id")
            lock = row.get("OSLockCondition") or {}
            if not isinstance(lock, dict):
                raise BuildError(f"{table.locator}[{index}].OSLockCondition: must be an object")
            locator = f"{table.locator}[{index}].OSLockCondition.LevelLocks"
            log_locators[entity_key("os", log_id)] = locator
            seen = set()
            for level_lock in lock.get("LevelLocks") or []:
                if not isinstance(level_lock, dict):
                    raise BuildError(f"{locator}: level lock must be an object")
                character_id = str(level_lock.get("SongPackId") or "").strip()
                if not character_id:
                    raise BuildError(f"{locator}: missing SongPackId")
                level = int(level_lock.get("Level") or 0)
                key = (entity_key("character", character_id), level)
                if key in seen:
                    continue
                seen.add(key)
                logs_by_level[key].append(entity_key("os", log_id))

    for key in sorted(set(posts_by_level) & set(logs_by_level)):
        character, level = key
        note = f"{character} level {level}"
        for post_id in posts_by_level[key]:
            for log_id in logs_by_level[key]:
                edges.add(
                    post_id,
                    "same_level",
                    log_id,
                    [
                        _text_asset(post_locators[post_id], note),
                        _text_asset(log_locators[log_id], note),
                    ],
                )


# ------------------------------------------------------------------- static
def _belongs_to_pack_edges(
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    for song in entities.get("song", []):
        pack_id = song.get("pack_id")
        if pack_id:
            edges.add(song["id"], "belongs_to_pack", pack_id, song["provenance"])


def _appears_in_gallery_edges(
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    for node in entities.get("story_node", []):
        reference = node.get("gallery_ref")
        if not reference:
            continue
        folder = reference["folder_id"].split("/", 1)[-1]
        target = entity_key("gallery_item", f"{folder}/{reference['location']}")
        provenance = [
            entry for entry in node["provenance"] if entry.get("kind") == "rva"
        ] or node["provenance"]
        edges.add(node["id"], "appears_in_gallery", target, provenance)
    for stage in entities.get("boss_stage", []):
        provenance = [
            entry for entry in stage["provenance"] if entry.get("kind") == "text_asset"
        ] or stage["provenance"]
        edges.add(
            stage["id"],
            "appears_in_gallery",
            stage["gallery_item_id"],
            provenance,
        )


def _same_stage_edges(
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    stages = {stage["id"]: stage for stage in entities.get("boss_stage", [])}
    for node in entities.get("story_node", []):
        if node.get("kind") != "event":
            continue
        rva = [entry for entry in node["provenance"] if entry.get("kind") == "rva"]
        for reference in node.get("boss_stages") or []:
            target = reference.get("entity_id")
            if not target:
                continue
            provenance = list(rva)
            stage = stages.get(target)
            if stage is not None:
                provenance.extend(stage["provenance"])
            edges.add(node["id"], "same_stage", target, provenance)


def _im_reply_edges(
    entities: dict[str, list[dict[str, Any]]],
    edges: _EdgeSet,
) -> None:
    for reply in entities.get("im_reply", []):
        edges.add(
            reply["id"],
            "has_reply",
            reply["post_id"],
            reply.get("provenance") or [],
        )


# --------------------------------------------------------------------- build
def build_edges(
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    charts = {chart["id"]: chart for chart in entities.get("chart", [])}
    edges = _EdgeSet()
    _im_chart_edges(source, charts, edges)
    _os_chart_edges(source, charts, edges)
    _oa_chart_edges(source, charts, edges)
    _story_chart_edges(source, charts, edges)
    _branch_chart_edges(entities, charts, edges)
    _commerce_chart_edges(entities, charts, edges)
    _requires_story_edges(source, entities, edges)
    _same_level_edges(source, entities, edges)
    _belongs_to_pack_edges(entities, edges)
    _appears_in_gallery_edges(entities, edges)
    _same_stage_edges(entities, edges)
    _im_reply_edges(entities, edges)
    return edges.records()


def validate_edge_records(edges: list[dict[str, Any]]) -> None:
    validator = SchemaValidator()
    errors: list[str] = []
    for edge in edges:
        for message in validator.errors("edge", edge):
            errors.append(
                f"{edge['source']} --{edge['relation']}--> {edge['target']}: {message}"
            )
    if errors:
        raise ValidationError(errors)


def validate_edges(
    edges: list[dict[str, Any]], entities: dict[str, list[dict[str, Any]]]
) -> None:
    known = {
        record["id"] for records in entities.values() for record in records
    }
    dangling_sources = sorted(
        {edge["source"] for edge in edges if edge["source"] not in known}
    )
    dangling_targets = sorted(
        {edge["target"] for edge in edges if edge["target"] not in known}
    )
    messages: list[str] = []
    if dangling_sources:
        messages.append(
            _describe("edge source", dangling_sources, edges, "source")
        )
    if dangling_targets:
        messages.append(
            _describe("edge target", dangling_targets, edges, "target")
        )
    if messages:
        raise BuildError("; ".join(messages))


def _describe(
    label: str, missing: list[str], edges: list[dict[str, Any]], field: str
) -> str:
    examples = []
    for identifier in missing[:_MAX_REPORTED]:
        edge = next(edge for edge in edges if edge[field] == identifier)
        examples.append(
            f"{identifier!r} (from {edge['source']} --{edge['relation']}--> {edge['target']})"
        )
    suffix = ""
    if len(missing) > _MAX_REPORTED:
        suffix = f"; and {len(missing) - _MAX_REPORTED} more"
    return (
        f"dangling {label}(s): {len(missing)} missing: "
        + "; ".join(examples)
        + suffix
    )
