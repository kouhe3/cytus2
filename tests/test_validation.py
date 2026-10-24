from __future__ import annotations

import json
from pathlib import Path

import pytest

from cytus2db.validate import SchemaError, SchemaValidator


def song_record(**overrides: object) -> dict:
    record = {
        "id": "song/alpha001_000",
        "type": "song",
        "game_id": "alpha001_000",
        "name": "First",
        "artist": "Artist A",
        "pack_id": "pack/alpha001",
        "category": "",
        "is_hidden": False,
        "download_only": False,
        "hide_when_locked": False,
        "search_terms": [],
        "provenance": [
            {"kind": "text_asset", "locator": "text/song_pack_data/offline_song_pack_list[0]"}
        ],
    }
    record.update(overrides)
    return record


def test_valid_record_passes() -> None:
    validator = SchemaValidator()
    assert validator.errors("song", song_record()) == []


def test_missing_provenance_is_reported() -> None:
    validator = SchemaValidator()
    record = song_record()
    del record["provenance"]
    errors = validator.errors("song", record)
    assert any("provenance" in error for error in errors)


def test_wrong_field_type_is_reported() -> None:
    validator = SchemaValidator()
    errors = validator.errors("song", song_record(artist=123))
    assert any("artist" in error and "type" in error for error in errors)


def test_unknown_field_is_reported() -> None:
    validator = SchemaValidator()
    errors = validator.errors("song", song_record(unexpected="x"))
    assert any("unexpected" in error for error in errors)


def test_chart_difficulty_enum_is_enforced() -> None:
    validator = SchemaValidator()
    record = {
        "id": "song/alpha001_000@Expert",
        "type": "chart",
        "game_id": "alpha001_000@Expert",
        "song_id": "song/alpha001_000",
        "difficulty": "Expert",
        "level": "1",
        "need_unlock": False,
        "music_id": "",
        "provenance": [],
    }
    errors = validator.errors("chart", record)
    assert errors


def test_pack_text_lives_behind_text_ref() -> None:
    validator = SchemaValidator()
    record = {
        "id": "pack/alpha001",
        "type": "pack",
        "game_id": "alpha001",
        "name": "Alpha",
        "category": "Main",
        "theme_color": "#112233",
        "is_iap": False,
        "has_im": True,
        "price": "",
        "text_ref": "pack/alpha001",
        "provenance": [],
    }
    assert validator.errors("pack", record) == []
    # Inline localized text is rejected: it belongs in build/text/packs.jsonl.
    assert validator.errors("pack", {**record, "descriptions": {"en": "x"}})
    assert validator.errors("pack", {**record, "text_ref": "alpha001"})


def test_unsupported_schema_keyword_is_a_hard_error(tmp_path: Path) -> None:
    (tmp_path / "song.schema.json").write_text(
        json.dumps({"type": "object", "madeUpKeyword": True}), encoding="utf-8"
    )
    validator = SchemaValidator(tmp_path)
    with pytest.raises(SchemaError):
        validator.errors("song", {})
