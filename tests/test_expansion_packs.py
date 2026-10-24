from __future__ import annotations

import json
from pathlib import Path

from cytus2db.ext.expansion_packs import build
from cytus2db.sources import InputSource
from cytus2db.validate import SchemaValidator


def write_expansion(tmp_path: Path) -> InputSource:
    (tmp_path / "text").mkdir()
    payload = {
        "ExpansionPackList": [
            {
                "ExpansionPackId": "expack999",
                "ExpansionPackName": "Test Extend\n2026",
                "CreateOrder": 7,
                "IconPath": "pack_icon_999",
                "DefaultPrice": "$4.99",
                "BoxId": "single",
                "IsBoxOnly": False,
                "IsPrePurchase": False,
                "SongInfoList": [
                    {
                        "SongId": "alpha001_011",
                        "SongName": "Extra One",
                        "Artist": "Tester",
                        "Charts": {
                            "Easy": {"Level": "2", "MusicID": "", "NeedUnlock": True},
                            "Hard": {"Level": "7", "MusicID": "", "NeedUnlock": True},
                        },
                        "IsHidden": False,
                        "IsDownloadOnly": False,
                        "SongPackId": "alpha001",
                        "Category": "",
                        "AlternativeSearchTerms": ["Alpha"],
                    }
                ],
            }
        ],
        "ExpansionBox": [],
    }
    (tmp_path / "text" / "expansion_pack_data").write_text(
        json.dumps(payload), encoding="utf-8"
    )
    return InputSource(tmp_path)


def test_expansion_pack_songs_belong_to_the_named_character_pack(tmp_path: Path) -> None:
    entities = build(write_expansion(tmp_path))
    packs = entities["expansion_pack"]
    songs = entities["song"]
    charts = entities["chart"]

    assert [pack["id"] for pack in packs] == ["expansion_pack/expack999"]
    assert packs[0]["character_ids"] == ["character/alpha001"]
    assert packs[0]["song_ids"] == ["song/alpha001_011"]
    assert packs[0]["price"] == "$4.99"

    assert len(songs) == 1
    song = songs[0]
    assert song["pack_id"] == "pack/alpha001"
    assert song["expansion_pack_id"] == "expansion_pack/expack999"
    assert song["name"] == "Extra One"

    assert {chart["id"] for chart in charts} == {
        "song/alpha001_011@Easy",
        "song/alpha001_011@Hard",
    }
    assert all(chart["need_unlock"] for chart in charts)


def test_expansion_records_match_their_schemas(tmp_path: Path) -> None:
    entities = build(write_expansion(tmp_path))
    validator = SchemaValidator()
    for entity_type in ("expansion_pack", "song", "chart"):
        for record in entities[entity_type]:
            assert validator.errors(entity_type, record) == []
