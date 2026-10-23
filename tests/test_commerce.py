from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

COMMERCE_TYPES = (
    "capso_shop_pack",
    "capso_shop_item",
    "gacha_machine",
    "gacha_reward",
    "shop_bundle",
)


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def commerce(built_db: Path) -> dict[str, list[dict]]:
    return {
        name: read_jsonl(built_db / "db" / f"{name}.jsonl")
        if (built_db / "db" / f"{name}.jsonl").is_file()
        else []
        for name in COMMERCE_TYPES
    }


def test_capso_packs_and_item_types(built_db: Path) -> None:
    entities = commerce(built_db)
    packs = {pack["id"]: pack for pack in entities["capso_shop_pack"]}
    assert set(packs) == {"capso_shop_pack/shopA", "capso_shop_pack/shopB"}
    assert packs["capso_shop_pack/shopA"]["name"] == "Alpha Pack"
    assert packs["capso_shop_pack/shopA"]["capso_price"] == 10
    assert packs["capso_shop_pack/shopA"]["default_price_string"] == "$1.99"
    assert packs["capso_shop_pack/shopA"]["available_for_capso"] is True
    assert packs["capso_shop_pack/shopA"]["available_for_iap"] is True
    assert packs["capso_shop_pack/shopB"]["available_for_iap"] is False
    assert packs["capso_shop_pack/shopB"]["create_order"] == 1

    items = entities["capso_shop_item"]
    assert Counter(item["kind"] for item in items) == {
        "chart": 2,
        "illustration": 2,
        "tap_fx": 1,
    }
    chart_items = [item for item in items if item["kind"] == "chart"]
    assert sum(len(item["chart_ids"]) for item in chart_items) == 5
    first = next(item for item in items if item["id"] == "capso_shop_item/shopA/alpha001_001_0,1,2")
    assert first["pack_id"] == "capso_shop_pack/shopA"
    assert first["item_id"] == "alpha001_001_0,1,2"
    assert first["item_type"] == 0
    assert first["song_id"] == "song/alpha001_001"
    assert first["chart_ids"] == [
        "song/alpha001_001@Easy",
        "song/alpha001_001@Hard",
        "song/alpha001_001@Chaos",
    ]
    assert first["position"] == 0

    illustration_item = next(
        item for item in items if item["id"] == "capso_shop_item/shopB/alpha001_s001"
    )
    assert illustration_item["illustration_id"] == "illustration/alpha001_s001"
    assert illustration_item["item_type"] == 1
    assert "song_id" not in illustration_item
    assert "chart_ids" not in illustration_item

    tap_item = next(item for item in items if item["type"] == "capso_shop_item" and item["kind"] == "tap_fx")
    assert tap_item["id"] == "capso_shop_item/shopA/tapfx_001_air%20horn"
    assert tap_item["tap_fx_id"] == "tapfx_001_air horn"
    assert tap_item["item_type"] == 2

    # CAPSO illustration items reference the illustration entity; they do not clone it.
    illustrations = {row["id"] for row in read_jsonl(built_db / "db" / "illustration.jsonl")}
    assert illustration_item["illustration_id"] in illustrations
    assert illustrations == {"illustration/alpha001", "illustration/alpha001_s001"}


def test_gacha_machine_and_reward_weights(built_db: Path) -> None:
    entities = commerce(built_db)
    machines = {machine["id"]: machine for machine in entities["gacha_machine"]}
    assert set(machines) == {"gacha_machine/capso"}
    assert machines["gacha_machine/capso"]["name"] == "The CAPSO!"
    assert machines["gacha_machine/capso"]["default_price"] == "$9.99"
    assert machines["gacha_machine/capso"]["icon_path"] == "machine_icon_001"

    rewards = {reward["id"]: reward for reward in entities["gacha_reward"]}
    assert set(rewards) == {
        "gacha_reward/alpha001_000_3",
        "gacha_reward/alpha001_001_0,1",
        "gacha_reward/alpha001_s001",
        "gacha_reward/tapfx_001_bell",
        "gacha_reward/alpha001_001",
    }
    assert Counter(reward["kind"] for reward in rewards.values()) == {
        "chart": 2,
        "illustration": 1,
        "tap_fx": 1,
        "song": 1,
    }
    assert sum(len(reward.get("chart_ids", [])) for reward in rewards.values()) == 3

    secret = rewards["gacha_reward/alpha001_000_3"]
    assert secret["machine_id"] == "gacha_machine/capso"
    assert secret["reward_type"] == 0
    assert secret["weight"] == 5
    assert secret["secret"] is True
    assert secret["create_order"] == 1
    assert secret["song_id"] == "song/alpha001_000"
    assert secret["chart_ids"] == ["song/alpha001_000@Glitch"]

    multi = rewards["gacha_reward/alpha001_001_0,1"]
    assert multi["weight"] == 20
    assert multi["secret"] is False
    assert multi["chart_ids"] == ["song/alpha001_001@Easy", "song/alpha001_001@Hard"]
    assert multi["reward_locks"] == {
        "im_topic_id": "im001",
        "os_file_id": "",
        "story_lock_id": "",
    }

    illustration = rewards["gacha_reward/alpha001_s001"]
    assert illustration["illustration_id"] == "illustration/alpha001_s001"
    assert "chart_ids" not in illustration

    song = rewards["gacha_reward/alpha001_001"]
    assert song["kind"] == "song"
    assert song["song_id"] == "song/alpha001_001"

    tap = rewards["gacha_reward/tapfx_001_bell"]
    assert tap["tap_fx_id"] == "tapfx_001_bell"


def test_shop_bundles_and_black_market_flag(built_db: Path) -> None:
    bundles = {bundle["id"]: bundle for bundle in commerce(built_db)["shop_bundle"]}
    assert set(bundles) == {"shop_bundle/VOL1", "shop_bundle/VOL2"}

    vol1 = bundles["shop_bundle/VOL1"]
    assert vol1["black_market"] is False
    assert vol1["trigger_free_character_level"] == 9
    assert vol1["milestone_key"] == "bundle_sale_milestone"
    assert vol1["message_ids"] == {
        "purchased": "BUNDLE_PURCHASED_MESSAGE",
        "purchased_preorder": "BUNDLE_PURCHASED_WITH_UNAVAILABLE_CHARACTERS_MESSAGE",
        "panel_description": "BUNDLE_SALE_PANEL_DESCRIPTION",
        "panel_warning": "BUNDLE_SALE_PANEL_WARNING",
        "tab_title": "BUNDLE_TAB_TITLE",
    }
    assert vol1["items"] == [
        {
            "product_id": "alpha001",
            "item_type": "Character",
            "weight": 1,
            "reference_price_iap_id": "specialpack01",
            "preorder": False,
        },
        {
            "product_id": "beta001",
            "item_type": "Character",
            "weight": 1,
            "reference_price_iap_id": "specialpack01",
            "preorder": True,
        },
    ]
    assert vol1["tiers"] == [
        {"remain_weight": 2, "iap_id": "bundle002"},
        {"remain_weight": 1, "iap_id": "bundle001"},
    ]

    vol2 = bundles["shop_bundle/VOL2"]
    assert vol2["black_market"] is True
    assert vol2["trigger_free_character_level"] == 24
    assert [item["item_type"] for item in vol2["items"]] == [
        "Character",
        "ExpansionPack",
    ]
    assert len(vol2["tiers"]) == 3
    # Black Market is a bundle state, not a separate entity.
    assert not (built_db / "db" / "black_market.jsonl").exists()
    spa = json.loads((built_db / "spa" / "data.json").read_text(encoding="utf-8"))
    assert "black_market" not in spa["entities"]


def test_capso_illustration_reference_may_dangle(built_db: Path) -> None:
    items = {item["id"]: item for item in commerce(built_db)["capso_shop_item"]}
    dangling = items["capso_shop_item/shopA/alpha001_s002"]
    assert dangling["kind"] == "illustration"
    assert dangling["illustration_id"] == "illustration/alpha001_s002"

    illustrations = {row["id"] for row in read_jsonl(built_db / "db" / "illustration.jsonl")}
    assert dangling["illustration_id"] not in illustrations
    # The reference is kept as-is; the item does not clone a placeholder entity.
    assert len(illustrations) == 2


def test_commerce_entities_are_queryable(built_db: Path) -> None:
    import sqlite3

    entities = commerce(built_db)
    for name, records in entities.items():
        assert records, name
        for record in records:
            assert record["provenance"], record["id"]
            assert all(
                entry.get("kind") and entry.get("locator")
                for entry in record["provenance"]
            )

    connection = sqlite3.connect(built_db / "db.sqlite")
    try:
        assert connection.execute("SELECT COUNT(*) FROM capso_shop_pack").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM capso_shop_item").fetchone()[0] == 5
        assert connection.execute("SELECT COUNT(*) FROM gacha_reward").fetchone()[0] == 5
        assert connection.execute("SELECT COUNT(*) FROM shop_bundle").fetchone()[0] == 2
        row = connection.execute(
            "SELECT data FROM shop_bundle WHERE id = ?", ("shop_bundle/VOL2",)
        ).fetchone()
        assert json.loads(row[0])["black_market"] is True
        assert not connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'black_market'"
        ).fetchone()
    finally:
        connection.close()

    spa = json.loads((built_db / "spa" / "data.json").read_text(encoding="utf-8"))
    assert spa["counts"]["capso_shop_pack"] == 2
    assert spa["counts"]["gacha_reward"] == 5
    assert "black_market" not in spa["entities"]
