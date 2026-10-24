"""Character max level and experience table (ticket #19).

The raw ``text/exptable/exp_data`` table is 0-based: ``table[i]`` is the
cumulative experience for raw level ``i``, so a 99-entry table means the
highest raw level is 98 and the game UI displays Lv99.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, copy_input, run_build, run_render

EXP_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "exp_table"
EXP_LOCATOR = "text/exptable/exp_data.exp_table_list"


def build_input(
    root: Path,
    tables: dict[str, int] | None = None,
    *,
    include_fixture: bool = True,
) -> Path:
    input_dir = root / "input"
    copy_input(FIXTURE_INPUT, input_dir)
    if include_fixture:
        shutil.copytree(EXP_FIXTURE / "text", input_dir / "text", dirs_exist_ok=True)
    if tables is not None:
        path = input_dir / "text" / "exptable" / "exp_data"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "exp_table_list": [
                {"song_pack_id": game_id, "table": list(range(length))}
                for game_id, length in tables.items()
            ]
        }
        path.write_text(json.dumps(data), encoding="utf-8")
    return input_dir


def build(input_dir: Path, root: Path) -> Path:
    out = root / "build"
    result = run_build(input_dir, out)
    assert result.returncode == 0, result.stderr
    return out


def render(build_dir: Path, root: Path) -> Path:
    out = root / "wiki"
    result = run_render(build_dir, out)
    assert result.returncode == 0, result.stderr
    return out


def characters(build_dir: Path) -> dict[str, dict]:
    path = build_dir / "db" / "character.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    return {row["id"]: row for row in rows}


def page_report(wiki_dir: Path, entity_id: str) -> tuple[dict, str]:
    report = json.loads((wiki_dir / "report.json").read_text(encoding="utf-8"))
    page = {item["entity"]: item for item in report["pages"]}[entity_id]
    return page, (wiki_dir / page["file"]).read_text(encoding="utf-8")


def test_exp_table_is_extracted_with_provenance(tmp_path: Path) -> None:
    out = build(build_input(tmp_path), tmp_path)
    alpha = characters(out)["character/alpha001"]
    assert len(alpha["exp_table"]) == 99
    assert alpha["max_level"] == 98
    assert alpha["exp_table"][0] == 0
    assert alpha["exp_table"][-1] == 9800
    locators = {entry["locator"] for entry in alpha["provenance"]}
    assert f"{EXP_LOCATOR}[0].table" in locators

    beta = characters(out)["character/beta001"]
    assert len(beta["exp_table"]) == 40
    assert beta["max_level"] == 39
    assert f"{EXP_LOCATOR}[1].table" in {
        entry["locator"] for entry in beta["provenance"]
    }


@pytest.mark.parametrize("length", [99, 90, 50, 40])
def test_max_level_is_the_zero_based_table_index(tmp_path: Path, length: int) -> None:
    input_dir = build_input(tmp_path, {"alpha001": length}, include_fixture=False)
    alpha = characters(build(input_dir, tmp_path))["character/alpha001"]
    assert len(alpha["exp_table"]) == length
    assert alpha["max_level"] == length - 1


def test_missing_exp_table_leaves_the_fields_absent(tmp_path: Path) -> None:
    out = build(build_input(tmp_path, include_fixture=False), tmp_path)
    for character in characters(out).values():
        assert "max_level" not in character
        assert "exp_table" not in character


def test_character_without_an_exp_row_leaves_the_fields_absent(tmp_path: Path) -> None:
    input_dir = build_input(tmp_path, {"alpha001": 99}, include_fixture=False)
    rows = characters(build(input_dir, tmp_path))
    assert rows["character/alpha001"]["max_level"] == 98
    assert "max_level" not in rows["character/beta001"]
    assert "exp_table" not in rows["character/beta001"]


def test_character_page_emits_max_level_and_omits_it_without_data(
    tmp_path: Path,
) -> None:
    with_data = build_input(
        tmp_path / "with", {"alpha001": 99, "beta001": 40}, include_fixture=False
    )
    wiki = render(build(with_data, tmp_path / "with"), tmp_path / "with")
    page, text = page_report(wiki, "character/alpha001")
    assert "最高等级" in page["emitted"]
    assert "|最高等级=99\n" in text
    page, text = page_report(wiki, "character/beta001")
    assert "|最高等级=40\n" in text

    without_data = build_input(tmp_path / "without", include_fixture=False)
    wiki = render(build(without_data, tmp_path / "without"), tmp_path / "without")
    page, text = page_report(wiki, "character/alpha001")
    omitted = {item.get("param"): item["reason"] for item in page["omitted"]}
    assert "最高等级" not in page["emitted"]
    assert omitted["最高等级"] == "exp_table_not_extracted"
    assert "|最高等级=\n" not in text
