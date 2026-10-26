from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from conftest import copy_input, run_build
from cytus2db.validate import SchemaValidator

CUTSCENE_OVERLAY = Path(__file__).resolve().parent / "fixtures" / "cutscene"
CUTSCENE_LOCATOR = "text/cutscenedata/cutscene_data_os"

ENTITY_TYPES = (
    "oa_character",
    "oa_object",
    "oa_document",
    "oa_description",
    "story_node",
    "gallery_folder",
    "gallery_item",
    "boss_stage",
)


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_built(built_db: Path, *names: str) -> dict[str, list[dict]]:
    return {name: read_jsonl(built_db / "db" / f"{name}.jsonl") for name in names}


@pytest.fixture(scope="module")
def built_with_cutscene(
    tmp_path_factory: pytest.TempPathFactory, fixture_input: Path
) -> Path:
    root = tmp_path_factory.mktemp("story_cutscene") / "input"
    copy_input(fixture_input, root)
    shutil.copytree(CUTSCENE_OVERLAY, root, dirs_exist_ok=True)
    out = tmp_path_factory.mktemp("story_cutscene_out")
    result = run_build(root, out)
    assert result.returncode == 0, result.stderr
    return out


# --------------------------------------------------------------------- OA
def test_oa_entities_come_from_the_system_table(built_db: Path) -> None:
    entities = load_built(
        built_db,
        "oa_character",
        "oa_object",
        "oa_document",
        "oa_description",
    )
    assert {row["id"] for row in entities["oa_character"]} == {
        "oa_character/alpha001",
        "oa_character/beta001",
    }
    characters = {row["id"]: row for row in entities["oa_character"]}
    assert characters["oa_character/alpha001"]["name"] == "Alpha"
    assert characters["oa_character/alpha001"]["character_id"] == "character/alpha001"

    objects = {row["id"]: row for row in entities["oa_object"]}
    assert set(objects) == {
        "oa_object/alpha001_obj001",
        "oa_object/beta001_obj001",
    }
    assert objects["oa_object/alpha001_obj001"]["character_id"] == "character/alpha001"
    assert objects["oa_object/alpha001_obj001"]["level_locks"] == [
        {"character": "character/alpha001", "level": 3}
    ]
    assert objects["oa_object/alpha001_obj001"]["conditions"] == []
    assert objects["oa_object/beta001_obj001"]["level_locks"] == []
    assert objects["oa_object/beta001_obj001"]["conditions"] == [
        {"kind": "os", "value": "pos001"},
        {"kind": "story", "value": "story_alpha01"},
    ]
    assert objects["oa_object/beta001_obj001"]["analyze_type_id"] is None

    documents = {row["id"]: row for row in entities["oa_document"]}
    assert set(documents) == {
        "oa_document/alpha001_obj001_oa001",
        "oa_document/beta001_obj001_oa001",
    }
    assert documents["oa_document/alpha001_obj001_oa001"]["object_id"] == (
        "oa_object/alpha001_obj001"
    )
    assert documents["oa_document/alpha001_obj001_oa001"]["mission_id"] == (
        "alpha001_obj001_mission001"
    )
    assert documents["oa_document/beta001_obj001_oa001"]["digit_lock"] == "1234"

    descriptions = {row["id"]: row for row in entities["oa_description"]}
    assert set(descriptions) == {
        "oa_description/alpha001_desc001",
        "oa_description/beta001_desc001_alt001",
    }
    assert descriptions["oa_description/alpha001_desc001"]["description_object_id"] == (
        "alpha001_desc001"
    )
    assert descriptions["oa_description/alpha001_desc001"]["enable_level_locks"] == [
        {"character": "character/alpha001", "level": 4}
    ]
    assert descriptions["oa_description/alpha001_desc001"]["enable_conditions"] == []
    assert descriptions["oa_description/alpha001_desc001"]["disable_conditions"] == [
        {"kind": "story", "value": "story_ending03_main"}
    ]
    assert descriptions["oa_description/beta001_desc001_alt001"]["event"] == 1


def test_oa_text_store_resolves_every_text_ref(built_db: Path) -> None:
    entities = load_built(
        built_db,
        "oa_object",
        "oa_document",
        "oa_description",
    )
    grouped: dict[str, list[dict]] = {}
    for record in read_jsonl(built_db / "text" / "oa.jsonl"):
        grouped.setdefault(record["ref"], []).append(record)

    for entity_type, records in entities.items():
        assert records
        for record in records:
            ref = record["text_ref"]
            assert ref == record["id"]
            languages = {row["lang"] for row in grouped[ref]}
            assert languages == {"en", "ja", "zh-Hant", "ko", "zh-Hans"}
            assert grouped[ref][0]["entity"] == entity_type

    document = next(
        row
        for row in grouped["oa_document/alpha001_obj001_oa001"]
        if row["lang"] == "zh-Hans"
    )
    assert document["name"] == "Alpha Doc"
    assert document["text"] == "##text\n阿尔法文件。\n"


# ------------------------------------------------------------------ gallery
def test_gallery_folders_and_items(built_db: Path) -> None:
    entities = load_built(built_db, "gallery_folder", "gallery_item")
    folders = {row["id"]: row for row in entities["gallery_folder"]}
    assert set(folders) == {
        "gallery_folder/alpha001",
        "gallery_folder/beta001",
        "gallery_folder/misc",
    }
    assert folders["gallery_folder/misc"]["name"] == "Main_Folder"
    assert folders["gallery_folder/misc"]["avatar_id"] == "gallery"

    items = {row["id"]: row for row in entities["gallery_item"]}
    assert set(items) == {
        "gallery_item/misc/opening",
        "gallery_item/misc/poster",
        "gallery_item/misc/ending03",
        "gallery_item/misc/alpha_bossstage",
        "gallery_item/misc/conditions",
    }
    video = items["gallery_item/misc/opening"]
    assert video["folder_id"] == "gallery_folder/misc"
    assert video["location"] == "opening"
    assert video["name"] == "Welcome_to_cyTus"
    assert video["icon"] == "icon_video"
    assert video["format"] == 1
    assert video["kind"] == "video"
    assert video["size"] is None
    assert video["conditions"] == []

    image = items["gallery_item/misc/poster"]
    assert image["kind"] == "image"
    assert image["size"] == [1024, 512]
    assert image["obtainable"] is True

    boss = items["gallery_item/misc/ending03"]
    assert boss["kind"] == "boss_stage"
    assert boss["conditions"] == [
        {"kind": "story", "value": "story_ending03_main"}
    ]

    mixed = items["gallery_item/misc/conditions"]
    assert mixed["conditions"] == [
        {"kind": "im", "value": "AL0101"},
        {"kind": "branch", "value": "taos001a"},
    ]


def test_gallery_item_kinds_follow_icon_and_format(built_db: Path) -> None:
    items = load_built(built_db, "gallery_item")["gallery_item"]
    assert {
        kind: sum(1 for row in items if row["kind"] == kind)
        for kind in ("video", "image", "boss_stage")
    } == {"video": 2, "image": 1, "boss_stage": 2}


# --------------------------------------------------------------- boss stages
def test_boss_stages_are_keyed_by_location_with_display_aliases(
    built_db: Path,
) -> None:
    stages = {row["id"]: row for row in load_built(built_db, "boss_stage")["boss_stage"]}
    assert set(stages) == {
        "boss_stage/alpha_bossstage",
        "boss_stage/ending03",
    }
    assert stages["boss_stage/ending03"]["game_id"] == "ending03"
    assert stages["boss_stage/ending03"]["display_name"] == "Ending 03 Stage"
    assert stages["boss_stage/ending03"]["gallery_item_id"] == (
        "gallery_item/misc/ending03"
    )
    assert {"Ending 03 Stage", "vanessa_v"} <= set(stages["boss_stage/ending03"]["aliases"])
    assert any(
        entry["kind"] == "manual"
        for entry in stages["boss_stage/ending03"]["provenance"]
    )
    assert "vanessa_v" not in stages["boss_stage/alpha_bossstage"]["aliases"]


# --------------------------------------------------------------- story nodes
def test_story_nodes_cover_events_and_branch_nodes(built_db: Path) -> None:
    nodes = load_built(built_db, "story_node")["story_node"]
    events = [row for row in nodes if row["kind"] == "event"]
    branches = [row for row in nodes if row["kind"] == "branch"]
    assert {row["id"] for row in events} == {
        "story_node/story_alpha01",
        "story_node/story_ending03_main",
        "story_node/story_vanessa04",
    }
    assert {row["id"] for row in branches} == {
        "story_node/taos001a",
        "story_node/taos002a",
    }

    alpha = next(row for row in events if row["id"] == "story_node/story_alpha01")
    assert alpha["game_id"] == "story_alpha01"
    assert alpha["class_name"] == "StoryAlpha01"
    assert alpha["steps"] == ["0_TOUCH_IM_POST_AL0101"]
    assert alpha["movie_files"] == ["alpha.mp4"]
    assert alpha["boss_stages"] == [
        {
            "raw": "alpha_bossstage",
            "entity_id": "boss_stage/alpha_bossstage",
            "status": "resolved",
        }
    ]

    unmapped = next(
        row for row in events if row["id"] == "story_node/story_vanessa04"
    )
    assert unmapped["boss_stages"] == [
        {
            "raw": "vos061_bossstage",
            "entity_id": None,
            "status": "unmapped",
        }
    ]

    branch = next(row for row in branches if row["id"] == "story_node/taos001a")
    assert branch["source_file"] == "alpha001"
    assert branch["names"]["zh-Hans"] == "Cam_Alpha"
    assert branch["level"] == 1
    assert branch["state_id"] == 0
    assert branch["state_value"] == "0"
    assert branch["level_locks"] == [{"character": "character/alpha001", "level": 1}]
    assert branch["position"] == 1
    assert branch["order"] == 1
    assert branch["next"] == ["story_node/taos002a"]
    assert branch["charts"] == [
        "song/alpha001_000@Easy",
        "song/alpha001_000@Hard",
    ]

    end = next(row for row in branches if row["id"] == "story_node/taos002a")
    assert end["next"] == []
    assert end["charts"] == []


def test_branch_node_cutscene_comes_from_the_cutscene_table(
    built_with_cutscene: Path,
) -> None:
    nodes = {
        row["id"]: row
        for row in load_built(built_with_cutscene, "story_node")["story_node"]
        if row["kind"] == "branch"
    }
    start = nodes["story_node/taos001a"]
    assert start["cutscene"] == "taos0101"
    assert {"kind": "text_asset", "locator": CUTSCENE_LOCATOR} in start["provenance"]
    assert len(start["provenance"]) == 2
    assert "cutscene" not in nodes["story_node/taos002a"]

    data = json.loads(
        (built_with_cutscene / "spa" / "data.json").read_text(encoding="utf-8")
    )
    projected = next(
        row for row in data["entities"]["story_node"] if row["id"] == "story_node/taos001a"
    )
    assert projected["cutscene"] == "taos0101"
    assert "video" not in data["entities"]


def test_branch_node_cutscene_is_optional_and_typed(
    built_with_cutscene: Path,
) -> None:
    validator = SchemaValidator()
    nodes = {
        row["id"]: row
        for row in load_built(built_with_cutscene, "story_node")["story_node"]
        if row["kind"] == "branch"
    }
    assert validator.errors("story_node", nodes["story_node/taos002a"]) == []
    nulled = dict(nodes["story_node/taos001a"], cutscene=None)
    assert any(
        "expected type string" in error
        for error in validator.errors("story_node", nulled)
    )
    bad = dict(nodes["story_node/taos001a"], cutscene="asset/video/taos0101")
    assert any(
        "does not match pattern" in error
        for error in validator.errors("story_node", bad)
    )
    assert validator.errors("story_node", nodes["story_node/taos001a"]) == []


def test_story_event_boss_alias_override_resolves(built_db: Path) -> None:
    events = {
        row["id"]: row
        for row in load_built(built_db, "story_node")["story_node"]
        if row["kind"] == "event"
    }
    ending = events["story_node/story_ending03_main"]
    assert ending["boss_stages"] == [
        {
            "raw": "vanessa_v",
            "entity_id": "boss_stage/ending03",
            "status": "resolved",
        }
    ]
    assert any(entry["kind"] == "manual" for entry in ending["provenance"])


def test_branch_text_store_resolves(built_db: Path) -> None:
    nodes = {
        row["id"]: row
        for row in load_built(built_db, "story_node")["story_node"]
        if row["kind"] == "branch"
    }
    grouped: dict[str, dict[str, dict]] = {}
    for record in read_jsonl(built_db / "text" / "story.jsonl"):
        grouped.setdefault(record["ref"], {})[record["lang"]] = record
    for node in nodes.values():
        ref = node["text_ref"]
        assert ref == node["id"]
        assert set(grouped[ref]) == {"en", "ja", "zh-Hant", "ko", "zh-Hans"}
    assert grouped["story_node/taos001a"]["zh-Hans"]["text"] == (
        "##text\n阿尔法分支开始。\n"
    )


def test_backup_database_and_branching_os_do_not_share_a_type(built_db: Path) -> None:
    entities = load_built(built_db, "gallery_item", "story_node")
    gallery_ids = {row["id"] for row in entities["gallery_item"]}
    branch_ids = {
        row["id"] for row in entities["story_node"] if row["kind"] == "branch"
    }
    assert gallery_ids.isdisjoint(branch_ids)
    assert all(identifier.startswith("gallery_item/") for identifier in gallery_ids)
    assert all(identifier.startswith("story_node/") for identifier in branch_ids)


# ------------------------------------------------------------- gate topics
def test_story_gate_topics_are_exposed_as_data_not_entities(
    tmp_path: Path, fixture_input: Path
) -> None:
    input_dir = tmp_path / "input"
    copy_input(fixture_input, input_dir)
    imdata = input_dir / "text" / "imdata"
    imdata.mkdir(parents=True)
    locks = [
        {
            "TopicId": "AL0101",
            "TopicLockId": "",
            "StoryLockId": "story_alpha01",
            "LevelLockDisplay": False,
            "LevelLocks": [],
        },
        {
            "TopicId": "AL0102",
            "TopicLockId": "",
            "StoryLockId": "story_alpha01",
            "LevelLockDisplay": False,
            "LevelLocks": [],
        },
        {
            "TopicId": "AL0103",
            "TopicLockId": "",
            "StoryLockId": "story01",
            "LevelLockDisplay": False,
            "LevelLocks": [],
        },
    ]
    (imdata / "im_lock_condition_data").write_text(
        json.dumps(locks), encoding="utf-8"
    )

    out = tmp_path / "build"
    result = run_build(input_dir, out)
    assert result.returncode == 0, result.stderr
    nodes = load_built(out, "story_node")["story_node"]
    alpha = next(row for row in nodes if row["id"] == "story_node/story_alpha01")
    assert alpha["topic_ids"] == ["AL0101", "AL0102"]
    assert not (out / "db" / "gate.jsonl").exists()
    assert not any(row["type"] == "gate" for row in nodes)


def test_new_tables_are_queryable_in_sqlite(built_db: Path) -> None:
    connection = sqlite3.connect(built_db / "db.sqlite")
    try:
        expected = {
            "oa_character": 2,
            "oa_object": 2,
            "oa_document": 2,
            "oa_description": 2,
            "story_node": 5,
            "gallery_folder": 3,
            "gallery_item": 5,
            "boss_stage": 2,
        }
        for table, count in expected.items():
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == count
        row = connection.execute(
            "SELECT data FROM boss_stage WHERE id = ?", ("boss_stage/ending03",)
        ).fetchone()
        assert row is not None
        assert json.loads(row[0])["display_name"] == "Ending 03 Stage"
    finally:
        connection.close()


def test_extension_output_is_deterministic(
    tmp_path: Path, fixture_input: Path, built_db: Path
) -> None:
    second = tmp_path / "second"
    result = run_build(fixture_input, second)
    assert result.returncode == 0, result.stderr
    for name in ENTITY_TYPES:
        assert (built_db / "db" / f"{name}.jsonl").read_bytes() == (
            second / "db" / f"{name}.jsonl"
        ).read_bytes()
    for name in ("oa.jsonl", "story.jsonl"):
        assert (built_db / "text" / name).read_bytes() == (
            second / "text" / name
        ).read_bytes()
