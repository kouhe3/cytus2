from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from conftest import copy_input, run_build

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

DIFFICULTIES = ("Easy", "Hard", "Chaos", "Glitch", "Crash", "Dream", "Drop")


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_built(built_db: Path) -> dict[str, list[dict]]:
    return {name: read_jsonl(built_db / "db" / f"{name}.jsonl") for name in ENTITY_TYPES}


def test_one_command_writes_jsonl_sqlite_and_spa(built_db: Path) -> None:
    for name in ENTITY_TYPES:
        assert (built_db / "db" / f"{name}.jsonl").is_file(), name
    assert (built_db / "db" / "edges.jsonl").is_file()
    assert (built_db / "db" / "edges.jsonl").read_text(encoding="utf-8") == ""
    assert (built_db / "db.sqlite").is_file()
    assert (built_db / "spa" / "data.json").is_file()


def test_entity_counts_follow_the_fixture(built_db: Path) -> None:
    entities = load_built(built_db)
    assert len(entities["pack"]) == 2
    assert len(entities["song"]) == 3
    assert len(entities["chart"]) == 11
    assert len(entities["character"]) == 2
    assert len(entities["folder"]) == 2
    assert len(entities["chapter"]) == 2
    assert len(entities["illustration"]) == 2
    assert len(entities["asset"]) == 11
    assert len(entities["subtitle_line"]) == 1


def test_chart_keys_use_the_difficulty_enum(built_db: Path) -> None:
    charts = load_built(built_db)["chart"]
    ids = {chart["id"] for chart in charts}
    assert ids == {
        "song/alpha001_000@Easy",
        "song/alpha001_000@Hard",
        "song/alpha001_000@Chaos",
        "song/alpha001_000@Glitch",
        "song/alpha001_001@Easy",
        "song/alpha001_001@Hard",
        "song/alpha001_001@Chaos",
        "song/alpha001_001@Crash",
        "song/beta001_000@Easy",
        "song/beta001_000@Dream",
        "song/beta001_000@Drop",
    }
    assert {chart["difficulty"] for chart in charts} == set(DIFFICULTIES)
    for chart in charts:
        assert chart["id"] == f"{chart['song_id']}@{chart['difficulty']}"
        assert chart["difficulty"] in DIFFICULTIES


def test_song_and_pack_keys_and_fields(built_db: Path) -> None:
    entities = load_built(built_db)
    songs = {song["id"]: song for song in entities["song"]}
    assert set(songs) == {"song/alpha001_000", "song/alpha001_001", "song/beta001_000"}
    assert songs["song/alpha001_001"]["pack_id"] == "pack/alpha001"
    assert songs["song/alpha001_001"]["category"] == "VOEZ"
    assert songs["song/beta001_000"]["artist"] is None
    packs = {pack["id"]: pack for pack in entities["pack"]}
    assert packs["pack/alpha001"]["name"] == "Alpha"
    assert packs["pack/alpha001"]["is_iap"] is False
    assert packs["pack/beta001"]["is_iap"] is True
    assert packs["pack/alpha001"]["descriptions"] == {
        "en": "Alpha pack",
        "zh-Hans": "Alpha 曲包",
    }


def test_organizational_dimensions(built_db: Path) -> None:
    entities = load_built(built_db)
    folders = {folder["id"]: folder for folder in entities["folder"]}
    assert set(folders) == {"folder/alpha", "folder/alpha-beta"}
    assert folders["folder/alpha-beta"]["name"] == "Alpha & Beta"
    chapters = {chapter["id"]: chapter for chapter in entities["chapter"]}
    assert chapters["chapter/0"] == {
        "id": "chapter/0",
        "type": "chapter",
        "game_id": "0",
        "name": "Architects",
        "category": 0,
        "provenance": chapters["chapter/0"]["provenance"],
    }
    assert chapters["chapter/1"]["category"] == 1


def test_characters_illustrations_and_subtitles(built_db: Path) -> None:
    entities = load_built(built_db)
    characters = {character["id"]: character for character in entities["character"]}
    assert characters["character/alpha001"]["name"] == "Alpha"
    assert characters["character/alpha001"]["pack_id"] == "pack/alpha001"
    assert characters["character/alpha001"]["avatar_id"] == "alpha001"
    assert characters["character/beta001"]["bg_movie"]["need_capso"] is True
    assert characters["character/beta001"]["bg_movie"]["level_lock_level"] == 9
    assert [p["prefab"] for p in characters["character/beta001"]["bg_movie"]["prefabs"]] == [
        "beta001",
        "beta001_alt",
    ]

    illustrations = {row["id"]: row for row in entities["illustration"]}
    assert illustrations["illustration/alpha001_s001"]["costume"] == "Kimono"
    assert illustrations["illustration/alpha001_s001"]["available"] is False
    assert illustrations["illustration/alpha001_s001"]["asset_id"] == "asset/illustration/alpha001_s001"

    subtitles = entities["subtitle_line"]
    assert len(subtitles) == 1
    subtitle = subtitles[0]
    assert subtitle["id"] == "subtitle_line/CE0001"
    assert subtitle["character"] == "Alpha"
    assert subtitle["voice_asset_id"] == "asset/voice/CE0001"
    assert subtitle["text"] == {
        "en": "Hello",
        "ja": "こんにちは",
        "zh-Hant": "你好",
        "ko": "안녕",
        "zh-Hans": "你好（简体）",
    }


def test_asset_catalog_is_deduplicated_and_sorted(built_db: Path) -> None:
    assets = load_built(built_db)["asset"]
    assert [asset["id"] for asset in assets] == sorted(asset["id"] for asset in assets)
    ids = {asset["id"] for asset in assets}
    assert ids == {
        "asset/audio/Beep",
        "asset/audio/alpha_bgm",
        "asset/bgmovie/alpha001",
        "asset/bgmovie/beta001",
        "asset/bgmovie/beta001_alt",
        "asset/illustration/alpha001",
        "asset/illustration/alpha001_s001",
        "asset/image/img001",
        "asset/image/img002",
        "asset/video/mov001",
        "asset/voice/CE0001",
    }
    beep = next(asset for asset in assets if asset["id"] == "asset/audio/Beep")
    # Referenced by both OS tables; the provenance keeps both sources, deduplicated.
    assert len(beep["provenance"]) == 2


def test_every_record_carries_provenance(built_db: Path) -> None:
    entities = load_built(built_db)
    for name, records in entities.items():
        for record in records:
            assert isinstance(record.get("provenance"), list), (name, record.get("id"))
            assert all(entry.get("kind") and entry.get("locator") for entry in record["provenance"])


def test_sqlite_is_queryable(built_db: Path) -> None:
    connection = sqlite3.connect(built_db / "db.sqlite")
    try:
        total = connection.execute("SELECT COUNT(*) FROM chart").fetchone()[0]
        assert total == 11
        by_difficulty = dict(
            connection.execute("SELECT difficulty, COUNT(*) FROM chart GROUP BY difficulty")
        )
        assert by_difficulty == {
            "Easy": 3,
            "Hard": 2,
            "Chaos": 2,
            "Glitch": 1,
            "Crash": 1,
            "Dream": 1,
            "Drop": 1,
        }
        row = connection.execute(
            "SELECT song_id, difficulty, level, need_unlock FROM chart WHERE id = ?",
            ("song/beta001_000@Dream",),
        ).fetchone()
        assert row == ("song/beta001_000", "Dream", "12", 1)
        pack = connection.execute(
            "SELECT name FROM pack WHERE id = ?", ("pack/alpha001",)
        ).fetchone()
        assert pack == ("Alpha",)
        illustration = connection.execute(
            "SELECT character_id, asset_id FROM illustration WHERE id = ?",
            ("illustration/alpha001_s001",),
        ).fetchone()
        assert illustration == (
            "character/alpha001",
            "asset/illustration/alpha001_s001",
        )
        assert connection.execute("SELECT COUNT(*) FROM edges").fetchone()[0] == 0
    finally:
        connection.close()


def test_spa_projection(built_db: Path) -> None:
    data = json.loads((built_db / "spa" / "data.json").read_text(encoding="utf-8"))
    assert data["schemaVersion"] == 1
    assert data["counts"]["chart"] == 11
    assert data["counts"]["song"] == 3
    assert data["difficulties"] == list(DIFFICULTIES)
    assert data["edges"] == []
    chart = next(row for row in data["entities"]["chart"] if row["id"] == "song/alpha001_000@Glitch")
    assert chart["difficulty"] == "Glitch"
    assert chart["level"] == "10"


def test_build_is_deterministic(tmp_path: Path, fixture_input: Path, built_db: Path) -> None:
    second = tmp_path / "second"
    result = run_build(fixture_input, second)
    assert result.returncode == 0, result.stderr
    for name in ENTITY_TYPES:
        assert (built_db / "db" / f"{name}.jsonl").read_bytes() == (
            second / "db" / f"{name}.jsonl"
        ).read_bytes()
    assert (built_db / "spa" / "data.json").read_bytes() == (
        second / "spa" / "data.json"
    ).read_bytes()


def test_clean_rebuild_removes_stale_outputs(tmp_path: Path, fixture_input: Path) -> None:
    out = tmp_path / "build"
    first = run_build(fixture_input, out)
    assert first.returncode == 0, first.stderr
    stale = out / "db" / "stale.jsonl"
    stale.write_text("{}\n", encoding="utf-8")
    (out / "spa" / "stale.json").write_text("{}", encoding="utf-8")
    wiki = out / "wiki" / "keep.txt"
    wiki.parent.mkdir(parents=True)
    wiki.write_text("generated by the wiki ticket\n", encoding="utf-8")

    second = run_build(fixture_input, out, "--clean")
    assert second.returncode == 0, second.stderr
    assert not stale.exists()
    assert not (out / "spa" / "stale.json").exists()
    assert wiki.read_text(encoding="utf-8") == "generated by the wiki ticket\n"
    assert (out / "db" / "chart.jsonl").is_file()


def test_schema_validation_failure_exits_non_zero(tmp_path: Path, fixture_input: Path) -> None:
    broken_input = tmp_path / "input"
    copy_input(fixture_input, broken_input)
    catalog_path = broken_input / "text" / "song_pack_data"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["offline_song_pack_list"][0]["song_info_list"][0]["artist"] = 123
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    out = tmp_path / "build"
    result = run_build(broken_input, out)
    assert result.returncode != 0
    assert "schema" in result.stderr.lower()
    assert "song/alpha001_000" in result.stderr
    assert not (out / "db").exists()
    assert not (out / "db.sqlite").exists()


def test_unknown_difficulty_exits_non_zero(tmp_path: Path, fixture_input: Path) -> None:
    broken_input = tmp_path / "input"
    copy_input(fixture_input, broken_input)
    catalog_path = broken_input / "text" / "song_pack_data"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    charts = catalog["offline_song_pack_list"][0]["song_info_list"][0]["charts"]
    charts["Expert"] = charts.pop("Easy")
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    result = run_build(broken_input, tmp_path / "build")
    assert result.returncode != 0
    assert "difficulty" in result.stderr.lower()


def test_missing_input_dir_exits_non_zero(tmp_path: Path) -> None:
    result = run_build(tmp_path / "does-not-exist", tmp_path / "build")
    assert result.returncode != 0
    assert "input" in result.stderr.lower()
