from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, copy_input, run_build
from cytus2db.validate import SchemaValidator

OVERLAY = Path(__file__).resolve().parent / "fixtures" / "reading_order"


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def by_entity(rows: list[dict]) -> dict[str, dict]:
    return {row["entity_id"]: row for row in rows}


def ordered(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda row: row["order"])


@pytest.fixture(scope="module")
def built_pair(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    root = tmp_path_factory.mktemp("reading_order") / "input"
    copy_input(FIXTURE_INPUT, root)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    outputs = []
    for name in ("first", "second"):
        out = tmp_path_factory.mktemp(f"reading_order_{name}")
        result = run_build(root, out)
        assert result.returncode == 0, result.stderr
        outputs.append(out)
    return outputs[0], outputs[1]


@pytest.fixture(scope="module")
def rows(built_pair: tuple[Path, Path]) -> list[dict]:
    return ordered(read_jsonl(built_pair[0] / "db" / "reading_order.jsonl"))


@pytest.fixture(scope="module")
def entities(rows: list[dict]) -> dict[str, dict]:
    return by_entity(rows)


def test_spoiler_alerts_carry_the_cctor_conditions(
    built_pair: tuple[Path, Path],
) -> None:
    alerts = read_jsonl(built_pair[0] / "db" / "spoiler_alert.jsonl")
    assert len(alerts) == 4
    by_id = {alert["id"]: alert for alert in alerts}
    assert set(by_id) == {
        "spoiler_alert/ivy001_001",
        "spoiler_alert/cherry002_001",
        "spoiler_alert/vanessa001_001",
        "spoiler_alert/bobo001_001",
    }

    ivy = by_id["spoiler_alert/ivy001_001"]
    assert ivy["type"] == "spoiler_alert"
    assert ivy["character"] == "character/ivy001"
    assert ivy["conditions"] == [
        {"character": "character/paff001", "level": 24},
        {"character": "character/neko001", "level": 24},
        {"character": "character/robo001", "level": 23},
    ]
    assert ivy["threshold"] == 24
    assert ivy["provenance"] == [
        {
            "kind": "rva",
            "locator": "0x254FFDC",
            "note": "SpoilerAlertTable..cctor ivy001_001",
        }
    ]

    cherry = by_id["spoiler_alert/cherry002_001"]
    assert cherry["threshold"] == 71
    assert cherry["conditions"][-1] == {
        "character": "character/ivy001",
        "level": 38,
    }
    assert by_id["spoiler_alert/vanessa001_001"]["threshold"] == 75
    assert by_id["spoiler_alert/bobo001_001"]["threshold"] == 76


def test_every_row_matches_its_schema(built_pair: tuple[Path, Path]) -> None:
    validator = SchemaValidator()
    for entity_type in ("reading_order", "spoiler_alert"):
        for record in read_jsonl(built_pair[0] / "db" / f"{entity_type}.jsonl"):
            assert validator.errors(entity_type, record) == [], record["id"]


def test_orders_are_contiguous(rows: list[dict]) -> None:
    assert [row["order"] for row in rows] == list(range(1, len(rows) + 1))


def test_multilock_uses_the_highest_level(
    rows: list[dict], entities: dict[str, dict]
) -> None:
    row = entities["im/P0301"]
    assert {lock["character"] for lock in row["level_locks"]} == {
        "character/alpha001",
        "character/beta001",
        "character/side001",
    }
    assert row["original_level"] == 9
    assert row["level_gate"] == 9
    assert row["tier"] == "side"
    side_orders = [item["order"] for item in rows if item["tier"] == "side"]
    assert row["order"] == max(side_orders)


def test_phases_are_free_then_paid_then_side(rows: list[dict]) -> None:
    tiers = [row["tier"] for row in rows]
    ranks = {"free": 0, "paid": 1, "side": 2}
    assert tiers == sorted(tiers, key=ranks.__getitem__)
    assert {"free", "paid", "side"} == set(tiers)

    first_paid = next(row["order"] for row in rows if row["tier"] == "paid")
    last_free = max(row["order"] for row in rows if row["tier"] == "free")
    first_side = next(row["order"] for row in rows if row["tier"] == "side")
    last_paid = max(row["order"] for row in rows if row["tier"] == "paid")
    assert last_free < first_paid < first_side
    assert last_paid < first_side


def test_spoiler_gate_defers_ivy_content(rows: list[dict], entities: dict[str, dict]) -> None:
    ivy_rows = [row for row in rows if row["thread"] == "character/ivy001"]
    assert ivy_rows
    for row in ivy_rows:
        assert row["spoiler_alert"] == "spoiler_alert/ivy001_001"
        assert row["level_gate"] >= 24

    post = entities["im/I0101"]
    assert post["original_level"] == 0
    assert post["level_gate"] == 24
    assert post["spoiler_alert"] == "spoiler_alert/ivy001_001"

    # Own level above the gate is preserved, not replaced by the gate.
    above = entities["os/ivos002"]
    assert above["original_level"] == 30
    assert above["level_gate"] == 30
    assert above["spoiler_alert"] == "spoiler_alert/ivy001_001"

    lowest_ivy = min(row["order"] for row in ivy_rows)
    assert all(
        row["order"] < lowest_ivy
        for row in rows
        if row["tier"] == "free" and row["level_gate"] < 24
    )


def test_chapter_alternate_puts_test01_last(rows: list[dict], entities: dict[str, dict]) -> None:
    staged = entities["os/aos003"]
    assert staged["chapter"] == "test01"
    assert staged["chapter_staged"] is True
    assert staged["chapter_id"] == "chapter/16"

    chapter_sort = sorted(
        rows,
        key=lambda row: (
            row["chapter_staged"],
            row["chapter_order"] if row["chapter_order"] is not None else 10_000,
            row["order"],
        ),
    )
    assert chapter_sort[-1]["entity_id"] == "os/aos003"
    assert [row["chapter_staged"] for row in chapter_sort[:-1]] == [False] * (len(rows) - 1)


def test_version_alternate_orders_by_numeric_parts(rows: list[dict]) -> None:
    with_version = [row for row in rows if row["version"] is not None]
    assert {row["version"] for row in with_version} == {"1.0", "1.1", "2.0", "3.0", "9.0"}
    version_sort = sorted(
        with_version,
        key=lambda row: (row["version_order"], row["entity_id"]),
    )
    assert [row["version"] for row in version_sort] == [
        "1.0",
        "1.0",
        "1.1",
        "1.1",
        "2.0",
        "3.0",
        "9.0",
    ]
    assert {tuple(row["version_order"]) for row in with_version} == {
        (1, 0),
        (1, 1),
        (2, 0),
        (3, 0),
        (9, 0),
    }


def test_prerequisites_never_precede_their_gates(
    rows: list[dict], entities: dict[str, dict]
) -> None:
    def order(entity_id: str) -> int:
        return entities[entity_id]["order"]

    # A post triggers the story, and the story gates a lower-level post.
    assert order("im/AL0101") < order("story_node/story_alpha01")
    assert order("story_node/story_alpha01") < order("im/AL0201")

    # A topic gate is a direct post-to-post prerequisite.
    assert order("im/P0101") < order("im/P0201")

    # An OA object's story condition resolves to the same story node.
    assert order("story_node/story_alpha01") < order(
        "oa_document/beta001_obj001_oa001"
    )

    # The OS file lock chains entries inside one file.
    assert order("os/aos001") < order("os/aos002")

    # Branching OS nodes follow their LinkedFileIds.
    assert order("story_node/taos001a") < order("story_node/taos002a")


def test_two_builds_are_identical(built_pair: tuple[Path, Path]) -> None:
    first, second = built_pair
    for name in ("reading_order", "spoiler_alert"):
        assert read_jsonl(first / "db" / f"{name}.jsonl") == read_jsonl(
            second / "db" / f"{name}.jsonl"
        )


def test_all_three_orders_are_deterministic(built_pair: tuple[Path, Path]) -> None:
    first, second = built_pair
    keys = {
        "level": lambda row: (row["level_gate"], row["order"]),
        "version": lambda row: (row["version_order"], row["order"]),
        "chapter": lambda row: (
            row["chapter_staged"],
            row["chapter_order"] if row["chapter_order"] is not None else 10_000,
            row["order"],
        ),
    }
    for key in keys.values():
        left = sorted(read_jsonl(first / "db" / "reading_order.jsonl"), key=key)
        right = sorted(read_jsonl(second / "db" / "reading_order.jsonl"), key=key)
        assert left == right

    assert read_jsonl(first / "db" / "spoiler_alert.jsonl") == read_jsonl(
        second / "db" / "spoiler_alert.jsonl"
    )
