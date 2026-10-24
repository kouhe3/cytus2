from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, copy_input, run_build

OVERLAY = Path(__file__).resolve().parent / "fixtures" / "extras"
LANGS = ("en", "ja", "zh-Hant", "ko", "zh-Hans")


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_entities(out: Path, name: str) -> list[dict]:
    return read_jsonl(out / "db" / f"{name}.jsonl")


def extras_records(out: Path) -> list[dict]:
    return read_jsonl(out / "text" / "extras.jsonl")


def records_by_ref(records: list[dict], ref: str) -> dict[str, dict]:
    return {record["lang"]: record for record in records if record["ref"] == ref}


def build_with_overlay(root: Path, out: Path) -> None:
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    result = run_build(root, out)
    assert result.returncode == 0, result.stderr


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("extras") / "input"
    out = tmp_path_factory.mktemp("extras_out")
    build_with_overlay(root, out)
    return out


def test_assistant_dialogue_entities(built: Path) -> None:
    assistants = {row["id"]: row for row in load_entities(built, "assistant_dialogue")}
    assert set(assistants) == {
        "assistant_dialogue/assistant_missing_en",
        "assistant_dialogue/assistant_tutorial",
    }

    tutorial = assistants["assistant_dialogue/assistant_tutorial"]
    assert tutorial["type"] == "assistant_dialogue"
    assert tutorial["game_id"] == "assistant_tutorial"
    assert tutorial["trigger"] == 0
    assert tutorial["target"] == "P0201"
    assert tutorial["version"] == "1.0.0"
    assert tutorial["progress"] == 1
    assert tutorial["page_count"] == 2
    assert tutorial["pages"] == [
        {"page": 1, "assistant_id": 2, "image_id": "", "sound_id": "AI_001_F"},
        {"page": 2, "assistant_id": 2, "image_id": "", "sound_id": ""},
    ]
    assert tutorial["text_ref"] == "assistant_dialogue/assistant_tutorial"
    assert tutorial["missing_languages"] == []
    assert any(
        entry["kind"] == "text_asset"
        and entry["locator"] == "text/imdata/im_assistant_data[0]"
        for entry in tutorial["provenance"]
    )

    missing_en = assistants["assistant_dialogue/assistant_missing_en"]
    assert missing_en["target"] == "story_alpha01"
    assert missing_en["trigger"] == 1
    assert missing_en["progress"] == 2
    assert missing_en["page_count"] == 1
    assert missing_en["missing_languages"] == ["en"]
    assert missing_en["pages"] == [
        {"page": 1, "assistant_id": 7, "image_id": "p0501", "sound_id": "AI_004_F"}
    ]


def test_title_screen_entities(built: Path) -> None:
    titles = {row["id"]: row for row in load_entities(built, "title_screen")}
    assert set(titles) == {"title_screen/0", "title_screen/2", "title_screen/9"}

    wake_up = titles["title_screen/0"]
    assert wake_up["type"] == "title_screen"
    assert wake_up["number"] == 0
    assert wake_up["name"] == "Wake Up"
    assert wake_up["unlock_conditions"] == []
    assert wake_up["video_clips"] == ["title01"]
    assert wake_up["text_ref"] == "title_screen/0"

    can_you_hear = titles["title_screen/2"]
    assert can_you_hear["unlock_conditions"] == [
        {"kind": "story", "value": "story_alpha01"}
    ]
    assert can_you_hear["video_clips"] == ["title03_1", "title03_2"]
    assert any(
        entry["kind"] == "manual" and entry["locator"].endswith("TITLE_CLIPS")
        for entry in can_you_hear["provenance"]
    )

    together = titles["title_screen/9"]
    assert together["name"] == "Together, Forever"
    assert together["unlock_conditions"] == [
        {"kind": "story", "value": "story_ending03_main"}
    ]
    assert together["video_clips"] == ["trueEndTitle"]


def test_extras_text_store_resolves_every_text_ref(built: Path) -> None:
    records = extras_records(built)
    assert len(records) == (2 + 3) * len(LANGS)

    entities = load_entities(built, "assistant_dialogue") + load_entities(
        built, "title_screen"
    )
    for entity in entities:
        languages = records_by_ref(records, entity["text_ref"])
        assert set(languages) == set(LANGS), entity["id"]

    tutorial = records_by_ref(records, "assistant_dialogue/assistant_tutorial")
    assert tutorial["en"]["blocks"] == [
        {
            "kind": "page",
            "page": 1,
            "assistant_id": 2,
            "image_id": "",
            "sound_id": "AI_001_F",
            "text": "Welcome to iM",
        },
        {
            "kind": "page",
            "page": 2,
            "assistant_id": 2,
            "image_id": "",
            "sound_id": "",
            "text": "Second page",
        },
    ]
    assert tutorial["zh-Hans"]["blocks"][0]["text"] == "欢迎使用 iM"

    missing_en = records_by_ref(records, "assistant_dialogue/assistant_missing_en")
    assert missing_en["en"]["missing"] is True
    assert missing_en["en"]["blocks"] == []
    assert missing_en["ja"]["blocks"][0]["text"] == "中国語だけ"
    assert missing_en["zh-Hant"]["blocks"][0]["text"] == "只有中文"

    title = records_by_ref(records, "title_screen/2")
    for code in LANGS:
        assert title[code]["name"] == "Can You Hear Me"
        assert title[code]["text"] == "Can You Hear Me"
        assert "missing" not in title[code]


def test_extras_artifacts_are_deterministic(
    tmp_path: Path, built: Path
) -> None:
    root = tmp_path / "input"
    out = tmp_path / "build"
    build_with_overlay(root, out)

    assert (out / "text" / "extras.jsonl").read_bytes() == (
        built / "text" / "extras.jsonl"
    ).read_bytes()
    for name in ("assistant_dialogue", "title_screen"):
        assert (out / "db" / f"{name}.jsonl").read_bytes() == (
            built / "db" / f"{name}.jsonl"
        ).read_bytes()
    assert (out / "spa" / "data.json").read_bytes() == (
        built / "spa" / "data.json"
    ).read_bytes()


def test_unknown_title_type_fails_the_build(
    tmp_path: Path, fixture_input: Path
) -> None:
    root = tmp_path / "input"
    copy_input(fixture_input, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    path = root / "text" / "titleinfodata" / "title_info"
    rows = json.loads(path.read_text(encoding="utf-8"))
    rows.append({"Type": 10, "Name": "Unknown", "Conditions": []})
    path.write_text(json.dumps(rows), encoding="utf-8")

    result = run_build(root, tmp_path / "build")
    assert result.returncode != 0
    assert "unknown title Type" in result.stderr
