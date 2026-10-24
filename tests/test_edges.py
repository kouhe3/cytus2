from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, copy_input, run_build

OVERLAY = Path(__file__).resolve().parent / "fixtures" / "im_os"
REQUIRED_RELATIONS = {
    "unlocks_chart",
    "requires_story",
    "same_level",
    "belongs_to_pack",
    "appears_in_gallery",
    "same_stage",
    "has_reply",
}


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def edge_tuples(edges: list[dict]) -> list[tuple[str, str, str]]:
    return [(edge["source"], edge["relation"], edge["target"]) for edge in edges]


def edges_from(edges: list[dict], source: str, relation: str) -> set[str]:
    return {
        edge["target"]
        for edge in edges
        if edge["source"] == source and edge["relation"] == relation
    }


def build_with_overlay(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    root = tmp_path_factory.mktemp("edges_input") / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    out = tmp_path_factory.mktemp("edges_out")
    result = run_build(root, out)
    assert result.returncode == 0, result.stderr
    return root, out


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    _, out = build_with_overlay(tmp_path_factory)
    return out


@pytest.fixture(scope="module")
def edges(built: Path) -> list[dict]:
    return read_jsonl(built / "db" / "edges.jsonl")


# ------------------------------------------------------------------- coverage
def test_relations_cover_the_required_set(edges: list[dict]) -> None:
    assert {edge["relation"] for edge in edges} == REQUIRED_RELATIONS


# --------------------------------------------------------------- unlocks_chart
def test_im_post_unlocks_only_charts_that_need_unlocking(edges: list[dict]) -> None:
    assert edges_from(edges, "im/P0101", "unlocks_chart") == {
        "song/alpha001_000@Chaos"
    }


def test_os_log_unlocks_charts_and_dedupes_duplicate_entries(edges: list[dict]) -> None:
    found = [
        edge
        for edge in edges
        if edge["source"] == "os/gos001" and edge["relation"] == "unlocks_chart"
    ]
    assert [edge["target"] for edge in found] == ["song/alpha001_001@Chaos"]
    assert len(found[0]["provenance"]) == 2


def test_oa_object_reward_unlocks_chart(edges: list[dict]) -> None:
    assert edges_from(edges, "oa_object/alpha001_obj001", "unlocks_chart") == {
        "song/alpha001_000@Chaos"
    }


def test_story_node_unlocks_chart_from_storychartunlock(edges: list[dict]) -> None:
    assert edges_from(edges, "story_node/story_alpha01", "unlocks_chart") == {
        "song/alpha001_001@Crash"
    }


def test_capso_item_and_gacha_reward_unlock_charts(edges: list[dict]) -> None:
    assert edges_from(
        edges, "capso_shop_item/shopA/alpha001_001_0,1,2", "unlocks_chart"
    ) == {"song/alpha001_001@Hard", "song/alpha001_001@Chaos"}
    assert edges_from(edges, "gacha_reward/alpha001_000_3", "unlocks_chart") == {
        "song/alpha001_000@Glitch"
    }
    assert edges_from(edges, "gacha_reward/alpha001_001_0,1", "unlocks_chart") == {
        "song/alpha001_001@Hard"
    }


def test_every_unlock_target_needs_unlocking(built: Path, edges: list[dict]) -> None:
    charts = {
        chart["id"]: chart for chart in read_jsonl(built / "db" / "chart.jsonl")
    }
    for edge in edges:
        if edge["relation"] != "unlocks_chart":
            continue
        assert edge["target"] in charts, edge
        assert charts[edge["target"]]["need_unlock"] is True, edge


# ------------------------------------------------------------- requires_story
def test_im_story_gate_is_an_edge_not_an_entity(edges: list[dict], built: Path) -> None:
    assert edges_from(edges, "im/P0101", "requires_story") == {
        "story_node/story_alpha01"
    }
    assert not (built / "db" / "gate.jsonl").exists()


# ------------------------------------------------------------------ same_level
def test_same_level_links_post_and_log_at_one_character_level(
    edges: list[dict],
) -> None:
    found = [
        edge
        for edge in edges
        if edge["relation"] == "same_level" and edge["source"] == "im/P0101"
    ]
    assert [edge["target"] for edge in found] == ["os/gos001"]
    notes = {entry.get("note") for entry in found[0]["provenance"]}
    assert notes == {"character/alpha001 level 9"}


# ------------------------------------------------------------ static edges
def test_songs_belong_to_packs(edges: list[dict]) -> None:
    found = {
        (edge["source"], edge["target"])
        for edge in edges
        if edge["relation"] == "belongs_to_pack"
    }
    assert found == {
        ("song/alpha001_000", "pack/alpha001"),
        ("song/alpha001_001", "pack/alpha001"),
        ("song/beta001_000", "pack/beta001"),
    }


def test_story_nodes_and_boss_stages_appear_in_gallery(edges: list[dict]) -> None:
    assert edges_from(
        edges, "story_node/story_ending03_main", "appears_in_gallery"
    ) == {"gallery_item/misc/opening"}
    assert edges_from(edges, "boss_stage/alpha_bossstage", "appears_in_gallery") == {
        "gallery_item/misc/alpha_bossstage"
    }
    assert edges_from(edges, "boss_stage/ending03", "appears_in_gallery") == {
        "gallery_item/misc/ending03"
    }


def test_story_events_share_stage_with_resolved_boss_stages(edges: list[dict]) -> None:
    assert edges_from(edges, "story_node/story_alpha01", "same_stage") == {
        "boss_stage/alpha_bossstage"
    }
    assert edges_from(edges, "story_node/story_ending03_main", "same_stage") == {
        "boss_stage/ending03"
    }
    assert edges_from(edges, "story_node/story_vanessa04", "same_stage") == set()


def test_im_replies_point_at_their_post(edges: list[dict]) -> None:
    assert edges_from(edges, "im_reply/P0101#1", "has_reply") == {"im/P0101"}
    assert edges_from(edges, "im_reply/P0101#2", "has_reply") == {"im/P0101"}
    # Replies have no outgoing relation other than their post.
    assert {
        edge["relation"]
        for edge in edges
        if edge["source"].startswith("im_reply/")
    } == {"has_reply"}


# ------------------------------------------------------------- identity rules
def test_edges_are_unique_sorted_and_carry_provenance(edges: list[dict]) -> None:
    tuples = edge_tuples(edges)
    assert tuples == sorted(tuples)
    assert len(tuples) == len(set(tuples))
    for edge in edges:
        assert edge["relation"] in REQUIRED_RELATIONS
        assert edge["provenance"]
        for entry in edge["provenance"]:
            assert entry.get("kind") and entry.get("locator")


def test_sqlite_edges_are_queryable_in_both_directions(built: Path, edges: list[dict]) -> None:
    connection = sqlite3.connect(built / "db.sqlite")
    try:
        assert connection.execute("SELECT COUNT(*) FROM edges").fetchone()[0] == len(edges)
        forward = {
            row[0]
            for row in connection.execute(
                "SELECT target FROM edges WHERE source = ? AND relation = ?",
                ("im/P0101", "unlocks_chart"),
            )
        }
        assert forward == {"song/alpha001_000@Chaos"}
        backward = {
            row[0]
            for row in connection.execute(
                "SELECT source FROM edges WHERE target = ? AND relation = ?",
                ("song/alpha001_000@Chaos", "unlocks_chart"),
            )
        }
        assert backward == {"im/P0101", "oa_object/alpha001_obj001"}
    finally:
        connection.close()


def test_spa_projection_carries_the_same_edges(built: Path, edges: list[dict]) -> None:
    data = json.loads((built / "spa" / "data.json").read_text(encoding="utf-8"))
    assert data["edges"] == edges


# -------------------------------------------------------------- failure paths
def test_dangling_chart_target_exits_non_zero(tmp_path: Path) -> None:
    root = tmp_path / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    (root / "text" / "chartunlock").write_text(
        json.dumps({"story_alpha01": [{"Difficulty": 4, "SongId": "ghost000_000"}]}),
        encoding="utf-8",
    )
    out = tmp_path / "build"
    result = run_build(root, out)
    assert result.returncode != 0
    assert "dangling edge target" in result.stderr
    assert "song/ghost000_000@Crash" in result.stderr
    assert not (out / "db").exists()


def test_dangling_story_gate_exits_non_zero(tmp_path: Path) -> None:
    root = tmp_path / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    locks_path = root / "text" / "imdata" / "im_lock_condition_data"
    locks = json.loads(locks_path.read_text(encoding="utf-8"))
    locks[0]["StoryLockId"] = "story_missing"
    locks_path.write_text(json.dumps(locks), encoding="utf-8")

    result = run_build(root, tmp_path / "build")
    assert result.returncode != 0
    assert "dangling edge target" in result.stderr
    assert "story_node/story_missing" in result.stderr


def test_edge_output_is_deterministic(
    tmp_path: Path, built: Path, fixture_input: Path
) -> None:
    root = tmp_path / "input"
    copy_input(fixture_input, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    second = tmp_path / "second"
    result = run_build(root, second)
    assert result.returncode == 0, result.stderr
    assert (built / "db" / "edges.jsonl").read_bytes() == (
        second / "db" / "edges.jsonl"
    ).read_bytes()
