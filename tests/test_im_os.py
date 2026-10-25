from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, copy_input, run_build
from cytus2db.validate import SchemaValidator

OVERLAY = Path(__file__).resolve().parent / "fixtures" / "im_os"
CUTSCENE_OVERLAY = Path(__file__).resolve().parent / "fixtures" / "cutscene"
CUTSCENE_LOCATOR = "text/cutscenedata/cutscene_data_os"
LANGS = ("en", "ja", "zh-Hant", "ko", "zh-Hans")


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_entities(out: Path, name: str) -> list[dict]:
    return read_jsonl(out / "db" / f"{name}.jsonl")


def text_records(out: Path) -> list[dict]:
    return read_jsonl(out / "text" / "im_os.jsonl")


def records_by_ref(records: list[dict], ref: str) -> dict[str, dict]:
    return {record["lang"]: record for record in records if record["ref"] == ref}


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("im_os") / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    out = tmp_path_factory.mktemp("im_os_out")
    result = run_build(root, out)
    assert result.returncode == 0, result.stderr
    return out


def test_im_posts_are_entities_in_reading_order(built: Path) -> None:
    posts = load_entities(built, "im_post")
    by_game_id = {post["game_id"]: post for post in posts}
    assert set(by_game_id) == {"P0101", "P0201", "P0301"}
    assert [post["id"] for post in sorted(posts, key=lambda row: row["order"])] == [
        "im/P0101",
        "im/P0201",
        "im/P0301",
    ]
    assert [post["order"] for post in sorted(posts, key=lambda row: row["order"])] == [1, 2, 3]

    first = by_game_id["P0101"]
    assert first["id"] == "im/P0101"
    assert first["type"] == "im_post"
    assert first["author"] == "Alpha-Official"
    assert first["avatar"] == "alpha_01"
    assert first["likes"] == 42
    assert first["reply_count"] == 2
    assert first["titles"] == {
        "en": "First Post",
        "ja": "最初の投稿",
        "zh-Hant": "第一篇貼文",
        "ko": "첫 게시물",
        "zh-Hans": "第一篇贴文",
    }
    assert first["attachments"] == ["attach01"]
    assert first["charts"] == [
        "song/alpha001_000@Easy",
        "song/alpha001_000@Chaos",
    ]
    assert first["story_gate"] == "story_alpha01"
    assert first["topic_gate"] is None
    assert first["level_locks"] == [
        {"character": "character/alpha001", "level": 9}
    ]
    assert first["text_ref"] == "im/P0101"

    second = by_game_id["P0201"]
    assert second["topic_gate"] == "P0101"
    assert second["story_gate"] is None
    assert second["level_locks"] == []
    assert second["reply_count"] == 1


def test_replies_are_flat_and_reference_posts(built: Path) -> None:
    replies = load_entities(built, "im_reply")
    assert [reply["id"] for reply in replies] == [
        "im_reply/P0101#1",
        "im_reply/P0101#2",
        "im_reply/P0201#1",
    ]
    expected_keys = {
        "id",
        "type",
        "game_id",
        "post_id",
        "order",
        "author",
        "avatar",
        "text_ref",
        "missing_languages",
        "provenance",
    }
    for reply in replies:
        assert set(reply) == expected_keys
        assert "parent" not in reply
        assert "replies" not in reply
        assert reply["type"] == "im_reply"
        assert reply["text_ref"] == reply["id"]
        assert reply["order"] >= 1

    by_id = {reply["id"]: reply for reply in replies}
    assert by_id["im_reply/P0101#1"]["post_id"] == "im/P0101"
    assert by_id["im_reply/P0101#1"]["game_id"] == "P0102"
    assert by_id["im_reply/P0101#2"]["author"] == "Gamma Fan"
    assert by_id["im_reply/P0201#1"]["post_id"] == "im/P0201"

    posts = {post["id"]: post for post in load_entities(built, "im_post")}
    counts = {post_id: 0 for post_id in posts}
    for reply in replies:
        counts[reply["post_id"]] += 1
    for post_id, post in posts.items():
        assert post["reply_count"] == counts[post_id]


def test_text_refs_resolve_for_all_five_languages(built: Path) -> None:
    records = text_records(built)
    posts = load_entities(built, "im_post")
    replies = load_entities(built, "im_reply")
    logs = load_entities(built, "os_log")
    assert len(records) == (len(posts) + len(replies) + len(logs)) * len(LANGS)

    for entity in posts + replies:
        languages = records_by_ref(records, entity["text_ref"])
        assert set(languages) == set(LANGS), entity["id"]
        assert {record["entity"] for record in languages.values()} == {entity["type"]}
        for lang, record in languages.items():
            if record.get("missing"):
                assert record["text"] is None
            else:
                assert isinstance(record["text"], str) and record["text"].strip()

    for log in logs:
        languages = records_by_ref(records, log["text_ref"])
        assert set(languages) == set(LANGS), log["id"]
        for record in languages.values():
            if record.get("missing"):
                assert record["blocks"] == []
            else:
                assert record["blocks"]

    assert records_by_ref(records, "im/P0101")["en"]["text"] == "Hello iM"
    assert records_by_ref(records, "im_reply/P0101#1")["ja"]["text"] == "すごい"
    assert records_by_ref(records, "im_reply/P0101#2")["en"]["text"] == "Only English"


def test_missing_languages_are_explicit(built: Path) -> None:
    posts = {post["game_id"]: post for post in load_entities(built, "im_post")}
    replies = {reply["game_id"]: reply for reply in load_entities(built, "im_reply")}
    assert posts["P0101"]["missing_languages"] == []
    assert posts["P0201"]["missing_languages"] == list(LANGS)
    assert posts["P0301"]["missing_languages"] == ["ja", "zh-Hant", "ko", "zh-Hans"]
    assert replies["P0102"]["missing_languages"] == []
    assert replies["P0103"]["missing_languages"] == ["ja", "zh-Hant", "ko", "zh-Hans"]
    assert replies["P0202"]["missing_languages"] == list(LANGS)

    records = records_by_ref(text_records(built), "im/P0201")
    assert set(records) == set(LANGS)
    assert all(record.get("missing") is True and record["text"] is None for record in records.values())


def test_os_logs_carry_file_chapter_date_and_ids(built: Path) -> None:
    logs = load_entities(built, "os_log")
    by_game_id = {log["game_id"]: log for log in logs}
    # The base fixture contributes alpha001 (2), beta001 (1); this overlay adds 2.
    assert set(by_game_id) == {"aos001", "aos002", "bos001", "gos001", "gos002"}

    first = by_game_id["gos001"]
    assert first["id"] == "os/gos001"
    assert first["type"] == "os_log"
    assert first["file"] == "gamma001"
    assert first["folder_id"] == "folder/alpha"
    assert first["chapter_id"] == "chapter/0"
    assert first["index"] == 1
    assert first["date"] == "687_06_30 18:01"
    assert first["category"] == "1.4"
    assert first["log_type"] == 3
    assert first["file_lock"] == "gos002"
    assert first["level_locks"] == [
        {"character": "character/alpha001", "level": 9}
    ]
    assert first["movies"] == ["asset/video/mov100"]
    assert first["names"] == {
        "en": "First OS",
        "ja": "最初のOS",
        "zh-Hant": "第一個OS",
        "ko": "첫 OS",
        "zh-Hans": "第一个OS",
    }
    assert first["text_ref"] == "os/gos001"
    assert first["missing_languages"] == []

    second = by_game_id["gos002"]
    assert second["folder_id"] is None
    assert second["chapter_id"] == "chapter/1"
    assert second["index"] == 2
    assert second["log_type"] == 1
    assert second["file_lock"] is None
    assert second["missing_languages"] == ["ja", "zh-Hant", "ko", "zh-Hans"]


def test_os_text_blocks_preserve_script_structure(built: Path) -> None:
    records = text_records(built)
    english = records_by_ref(records, "os/gos001")["en"]
    kinds = [block["kind"] for block in english["blocks"]]
    assert kinds == [
        "bgm",
        "dialogue",
        "image",
        "sound",
        "movie",
        "imageviewer",
        "mail",
        "narration",
    ]
    assert english["blocks"][0] == {"kind": "bgm", "name": "gamma_bgm"}
    assert english["blocks"][1] == {
        "kind": "dialogue",
        "speaker": "Alpha",
        "text": "Hello there",
    }
    assert english["blocks"][3] == {
        "kind": "sound",
        "name": "Beep",
        "label": "Beep sound",
    }
    assert english["blocks"][7] == {"kind": "narration", "text": "Body line"}

    japanese = records_by_ref(records, "os/gos002")["ja"]
    assert japanese.get("missing") is True
    assert japanese["blocks"] == []


def test_schema_rejects_nested_replies_and_incomplete_records(built: Path) -> None:
    validator = SchemaValidator()
    posts = load_entities(built, "im_post")
    replies = load_entities(built, "im_reply")
    logs = load_entities(built, "os_log")
    for record in posts:
        assert validator.errors("im_post", record) == [], record["id"]
    for record in replies:
        assert validator.errors("im_reply", record) == [], record["id"]
    for record in logs:
        assert validator.errors("os_log", record) == [], record["id"]

    nested = dict(replies[0], parent="im_reply/P0101#1")
    assert any("unexpected property 'parent'" in error for error in validator.errors("im_reply", nested))
    with_children = dict(replies[0], children=[])
    assert validator.errors("im_reply", with_children)

    bad_chart = dict(posts[0], charts=["song/alpha001_000"])
    assert validator.errors("im_post", bad_chart)
    missing_ref = dict(posts[0])
    del missing_ref["text_ref"]
    assert validator.errors("im_post", missing_ref)

    incomplete_log = dict(logs[0])
    del incomplete_log["chapter_id"]
    assert validator.errors("os_log", incomplete_log)


def test_sqlite_has_generic_content_tables(built: Path) -> None:
    connection = sqlite3.connect(built / "db.sqlite")
    try:
        assert connection.execute("SELECT COUNT(*) FROM im_post").fetchone()[0] == 3
        assert connection.execute("SELECT COUNT(*) FROM im_reply").fetchone()[0] == 3
        assert connection.execute("SELECT COUNT(*) FROM os_log").fetchone()[0] == 5
        data = json.loads(
            connection.execute(
                "SELECT data FROM im_post WHERE id = ?", ("im/P0101",)
            ).fetchone()[0]
        )
        assert data["reply_count"] == 2
    finally:
        connection.close()


def test_missing_post_source_exits_non_zero(tmp_path: Path) -> None:
    root = tmp_path / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    (root / "text" / "imposts_alpha002" / "posts").unlink()
    out = tmp_path / "out"
    result = run_build(root, out)
    assert result.returncode != 0
    assert "P0201" in result.stderr


# ------------------------------------------------------------ OS cutscenes
@pytest.fixture(scope="module")
def built_with_cutscene(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("cutscene") / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    shutil.copytree(CUTSCENE_OVERLAY, root, dirs_exist_ok=True)
    out = tmp_path_factory.mktemp("cutscene_out")
    result = run_build(root, out)
    assert result.returncode == 0, result.stderr
    return out


def test_os_cutscene_maps_trigger_ids_and_skips_non_os_triggers(
    built_with_cutscene: Path,
) -> None:
    logs = {log["game_id"]: log for log in load_entities(built_with_cutscene, "os_log")}
    assert logs["aos001"]["cutscene"] == "aos0101"
    assert logs["gos001"]["cutscene"] == "gos0101"
    assert "cutscene" not in logs["aos002"]
    assert "cutscene" not in logs["gos002"]
    assert "cutscene" not in logs["bos001"]
    # taos001a triggers a branching-OS cutscene; it is not an OS log id.
    assert all(log.get("cutscene") != "taos0101" for log in logs.values())
    assert {"kind": "text_asset", "locator": CUTSCENE_LOCATOR} in (
        logs["aos001"]["provenance"]
    )
    assert len(logs["aos001"]["provenance"]) == 2
    assert len(logs["aos002"]["provenance"]) == 1


def test_os_cutscene_is_optional_and_typed(built_with_cutscene: Path) -> None:
    validator = SchemaValidator()
    logs = {log["game_id"]: log for log in load_entities(built_with_cutscene, "os_log")}
    assert validator.errors("os_log", logs["aos002"]) == []  # absent is valid
    nulled = dict(logs["aos002"], cutscene=None)  # null is not the contract
    assert any("expected type string" in error for error in validator.errors("os_log", nulled))
    bad = dict(logs["aos001"], cutscene="asset/video/aos0101")
    assert any("does not match pattern" in error for error in validator.errors("os_log", bad))
    assert validator.errors("os_log", logs["aos001"]) == []


def test_spa_projection_carries_os_cutscene(built_with_cutscene: Path) -> None:
    data = json.loads(
        (built_with_cutscene / "spa" / "data.json").read_text(encoding="utf-8")
    )
    rows = {row["game_id"]: row for row in data["entities"]["os_log"]}
    assert rows["aos001"]["cutscene"] == "aos0101"
    assert "cutscene" not in rows["aos002"]
    assert "video" not in data["entities"]  # the clip stays a reference, not an entity


def test_cutscene_table_shape_is_enforced(tmp_path: Path) -> None:
    root = tmp_path / "input"
    copy_input(FIXTURE_INPUT, root)
    path = root / "text" / "cutscenedata" / "cutscene_data_os"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"aos001": {"TriggerId": "aos001", "MovieFile": "aos0101.mov"}}),
        encoding="utf-8",
    )
    result = run_build(root, tmp_path / "out")
    assert result.returncode != 0
    assert "MovieFile" in result.stderr
