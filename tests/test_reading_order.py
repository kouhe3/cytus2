from __future__ import annotations

import json
import os
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
    # A multi-character lock costs the sum of every character's level, and the
    # lane comes from the first non-main lock (alpha, a free account).
    assert row["cost"] == 5 + 9 + 2
    assert row["lane"] == 4
    assert row["lane_character"] == "character/alpha001"
    assert row["read_index"] == 10
    assert row["stage"] == 1


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

    # The gate is a deferral, not a lock: the own level survives and the
    # effective level is the max of the own level and the gate threshold.
    for row in ivy_rows:
        assert row["level_gate"] == max(row["original_level"], 24)


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


def test_lane_tiers_are_free_paid_side(entities: dict[str, dict]) -> None:
    # Known free characters keep their editorial order, unknown packs in a tier
    # are appended sorted by id.
    assert entities["im/I0101"]["lane"] == 3
    assert entities["im/I0101"]["lane_character"] == "character/ivy001"
    assert entities["im/P0101"]["lane"] == 4
    assert entities["im/B0101"]["lane"] == 101
    assert entities["os/gos001"]["lane"] == 200
    assert entities["os/gos001"]["lane_character"] == "character/side001"
    assert (
        entities["im/P0101"]["lane"]
        < entities["im/B0101"]["lane"]
        < entities["os/gos001"]["lane"]
    )


def test_cost_sums_every_level_lock(entities: dict[str, dict]) -> None:
    assert entities["im/P0301"]["cost"] == 16
    assert entities["im/P0201"]["cost"] == 0
    assert entities["os/gos001"]["cost"] == 1


def test_im_tier_comes_from_locks_not_the_posting_account(
    entities: dict[str, dict],
) -> None:
    # Beta is a paid pack, but this post only needs the free PAFF level, so a
    # free player can read it: free tier, paid account lane.
    row = entities["im/B0201"]
    assert row["tier"] == "free"
    assert row["stage"] == 1
    assert row["lane"] == 101
    assert row["lane_character"] == "character/beta001"
    assert row["read_index"] == 5


def test_paid_account_posts_split_by_their_own_gates(
    entities: dict[str, dict],
) -> None:
    # Xenon's ambient post only needs PAFF level 0: first stage, free tier, but
    # the Xenon lane orders it after the free accounts.
    ambient = entities["im/X0101"]
    assert ambient["stage"] == 1
    assert ambient["tier"] == "free"
    assert ambient["lane"] == 100
    assert ambient["lane_character"] == "character/xenon001"

    # The ending post needs the branch story (which closes in round 2) and
    # Xenon's own level 41, so it lands after the ending nodes.
    gated = entities["im/Q6501"]
    assert gated["tier"] == "paid"
    assert gated["stage"] == 2
    assert {lock["character"] for lock in gated["level_locks"]} == {
        "character/xenon001"
    }
    assert gated["level_locks"][0]["level"] == 41
    assert gated["branch"] == "善终1"
    ending = entities["story_node/story_ending03_main"]
    assert ending["stage"] == 1
    assert gated["stage"] > ending["stage"]
    assert gated["order"] > ending["order"]


def test_branch_labels_and_blocked_posts(entities: dict[str, dict]) -> None:
    first = entities["im/Q0101"]
    assert first["branch"] == "善终1"
    assert first["external"] is None
    assert first["stage"] == 2
    assert first["read_index"] == 12

    fourth = entities["im/Q0201"]
    assert fourth["branch"] == "结局04"
    assert fourth["external"] is None
    assert fourth["stage"] == 2
    assert fourth["read_index"] == 13
    assert first["order"] < fourth["order"]

    # A story lock that never fires leaves the post outside the model.
    blocked = entities["im/B0901"]
    assert blocked["stage"] == 98
    assert blocked["external"] == "story_outside01"
    assert blocked["read_index"] == 15

    assert any(
        entry["kind"] == "manual"
        and "branch label for story_ending03_good_ending1" in entry.get("note", "")
        for entry in first["provenance"]
    )


def test_side_lane_unlocks_after_ending02(entities: dict[str, dict]) -> None:
    ending = entities["story_node/story_ending02"]
    side = entities["im/G0101"]
    assert side["tier"] == "side"
    assert side["lane"] == 200
    assert side["external"] is None
    assert ending["order"] < side["order"]


def test_legacy_read_index_is_contiguous(rows: list[dict]) -> None:
    indexed = sorted(
        (row for row in rows if row["read_index"] is not None),
        key=lambda row: row["read_index"],
    )
    assert len(indexed) == 15
    assert [row["read_index"] for row in indexed] == list(range(1, len(indexed) + 1))
    assert all(
        row["read_index"] is None
        for row in rows
        if row["entity_type"] != "im_post"
    )


def test_character_tier_override_is_a_separate_layer() -> None:
    from cytus2db.ext.reading_order import _Pack, _lane_table

    packs = {
        "paff001": _Pack("paff001", "free", 0),
        "ghost001": _Pack("ghost001", "free", 1),
    }
    assert _lane_table(packs)["ghost001"].tier == "free"
    moved = _lane_table(packs, {"ghost001": "paid"})
    assert moved["ghost001"].tier == "paid"
    assert moved["ghost001"].lane == 100


def test_legacy_im_parity_against_viewer(tmp_path: Path) -> None:
    """Byte-for-byte parity with the frozen viewer's iM ordering.

    The legacy artifacts are derived and not committed.  Point
    ``CYTUS2_LEGACY_IM_ORDER`` at the frozen ``viewer/public/data/index.json``
    (or keep it at ``viewer/public/data/index.json``) to run this check.
    """
    work = Path(os.environ.get("CYTUS2_WORK", "C:/tmp/workspace/cytus2/cytus2_work"))
    repo = Path(__file__).resolve().parents[1]
    legacy = Path(
        os.environ.get(
            "CYTUS2_LEGACY_IM_ORDER",
            repo / "viewer" / "public" / "data" / "index.json",
        )
    )
    if not (work / "text" / "imdata" / "im_lock_condition_data").is_file():
        pytest.skip("real input tree is not available")
    if not legacy.is_file():
        pytest.skip("legacy viewer index.json is not available")

    out = tmp_path / "out"
    result = run_build(work, out)
    assert result.returncode == 0, result.stderr

    legacy_rows = {
        row["id"]: row
        for row in json.loads(legacy.read_text(encoding="utf-8"))["im"]
    }
    legacy_order = legacy.parent / "im-order.json"
    stage_of = (
        json.loads(legacy_order.read_text(encoding="utf-8"))["order"]
        if legacy_order.is_file()
        else {}
    )
    differences = []
    built: dict[str, dict] = {}
    for row in read_jsonl(out / "db" / "reading_order.jsonl"):
        if row["entity_type"] != "im_post":
            continue
        built[row["entity_id"]] = row
        game_id = row["entity_id"].split("/", 1)[1]
        expected = legacy_rows[game_id]
        fields = {
            "read_index": expected["readIndex"],
            "lane": expected["lane"],
            "cost": expected["cost"],
            "lock_level": expected["lockLevel"],
        }
        if stage_of:
            fields["stage"] = stage_of[game_id]
        for field, value in fields.items():
            if row[field] != value:
                differences.append((game_id, field, row[field], value))
    assert differences == []

    # A paid character's post with free locks is readable in round one; only a
    # post that needs that character's own level is paid-gated.
    xenon = built["im/X0101"]
    assert xenon["stage"] == 1
    assert xenon["tier"] == "free"
    assert xenon["lane"] == 101
    gated = built["im/Q6501"]
    assert gated["tier"] == "paid"
    assert any(
        lock["character"] == "character/xenon001" and lock["level"] == 41
        for lock in gated["level_locks"]
    )
