"""Tests for the standalone wiki snapshot tool.

All inputs are synthetic fixtures under ``tests/fixtures/wiki_snapshot``.
No test touches the network or the Edge/CDP helper.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).with_name("fixtures") / "wiki_snapshot"
RAW = FIXTURES / "raw"
EXPECTED = FIXTURES / "expected"
FIXED_TIME = "2026-01-01T00:00:00+00:00"
SONG_TEMPLATE = ("歌曲", "Template:歌曲")


@pytest.fixture(scope="session")
def tool():
    spec = importlib.util.spec_from_file_location(
        "wiki_snapshot", ROOT / "tools" / "wiki_snapshot.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_bytes(directory: Path) -> dict[str, bytes]:
    return {
        name: (directory / name).read_bytes()
        for name in ("titles.json", "template_params.json", "pages.json")
    }


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------


def test_titles_snapshot_separates_articles_and_redirects(tool):
    raw = load_json(RAW / "allpages.json")
    data = tool.build_titles_snapshot(
        [page["title"] for page in raw["articles"]["pages"]],
        [page["title"] for page in raw["redirects"]["pages"]],
        fetched_at=FIXED_TIME,
    )

    assert data == load_json(EXPECTED / "titles.json")
    assert data["articles"] == ["Alpha", "Gamma"]
    assert data["redirects"] == ["Beta"]
    assert data["counts"] == {"articles": 2, "redirects": 1, "total": 3}
    assert data["fetched_at"] == FIXED_TIME
    assert data["source_query"]


def test_titles_snapshot_is_sorted_and_disjoint(tool):
    data = tool.build_titles_snapshot(
        ["Gamma", "Alpha", "Gamma"],
        ["Beta", "Alpha "],  # distinct title, trailing space preserved
        fetched_at=FIXED_TIME,
    )
    assert data["articles"] == ["Alpha", "Gamma"]
    assert data["redirects"] == ["Alpha ", "Beta"]
    assert data["counts"]["total"] == 4
    assert not set(data["articles"]) & set(data["redirects"])


def test_titles_snapshot_rejects_article_redirect_overlap(tool):
    with pytest.raises(tool.SnapshotError, match="both article and redirect"):
        tool.build_titles_snapshot(["Same"], ["Same"], fetched_at=FIXED_TIME)


# ---------------------------------------------------------------------------
# Template parameter catalogs
# ---------------------------------------------------------------------------


def test_template_catalog_matches_expected_snapshot(tool):
    raw = load_json(RAW / "template_sources.json")
    data = tool.build_template_params_snapshot(
        raw["templates"],
        fetched_at=FIXED_TIME,
        templates=(SONG_TEMPLATE,),
    )
    assert data == load_json(EXPECTED / "template_params.json")


def test_template_catalog_required_default_conditional(tool):
    raw = load_json(RAW / "template_sources.json")
    data = tool.build_template_params_snapshot(
        raw["templates"],
        fetched_at=FIXED_TIME,
        templates=(SONG_TEMPLATE,),
    )
    template = data["templates"]["歌曲"]
    params = template["params"]

    # Source order is preserved so diffs against template documentation line up.
    assert list(params) == ["必填", "选项", "条件", "条件2", "冲突", "ver"]
    assert params["必填"] == {
        "required": True,
        "default": None,
        "conditional": False,
    }
    assert params["选项"] == {
        "required": False,
        "default": "默认",
        "conditional": False,
    }
    assert params["条件"] == {
        "required": False,
        "default": "",
        "conditional": True,
    }
    assert params["条件2"] == {
        "required": False,
        "default": "备选",
        "conditional": True,
    }
    assert template["required"] == ["必填"]
    assert template["conditional"] == ["条件", "条件2"]
    assert data["parameter_count"] == sum(
        template["param_count"] for template in data["templates"].values()
    )


def test_template_catalog_records_conflicting_and_malformed_defaults(tool):
    raw = load_json(RAW / "template_sources.json")
    data = tool.build_template_params_snapshot(
        raw["templates"],
        fetched_at=FIXED_TIME,
        templates=(SONG_TEMPLATE,),
    )
    params = data["templates"]["歌曲"]["params"]

    assert params["冲突"]["default"] == "甲"
    assert params["冲突"]["defaults_conflict"] is True
    assert params["冲突"]["defaults"] == ["甲", "乙"]

    # {{{ver||}}} means the default is the literal "|", as on the real wiki.
    assert params["ver"]["default"] == "|"
    assert params["ver"]["defaults"] == ["|", ""]
    assert params["ver"]["defaults_conflict"] is True


def test_template_catalog_accepts_localized_namespace(tool):
    data = tool.build_template_params_snapshot(
        {"模板:歌曲": "{{{名字}}}"},
        fetched_at=FIXED_TIME,
        templates=(SONG_TEMPLATE,),
    )
    assert list(data["templates"]["歌曲"]["params"]) == ["名字"]


# ---------------------------------------------------------------------------
# Entity pages
# ---------------------------------------------------------------------------


def test_pages_snapshot_matches_expected_snapshot(tool):
    raw = load_json(RAW / "pages.json")
    data = tool.build_pages_snapshot(
        raw["templates"], fetched_at=FIXED_TIME
    )
    assert data == load_json(EXPECTED / "pages.json")


def test_pages_snapshot_parses_top_level_params(tool):
    raw = load_json(RAW / "pages.json")
    data = tool.build_pages_snapshot(raw["templates"], fetched_at=FIXED_TIME)
    pages = {page["title"]: page for page in data["templates"]["歌曲"]["pages"]}

    # The nested {{歌曲}} inside {{外层}} is ignored in favour of the
    # page-level invocation.
    assert pages["Alpha"]["params"] == {"甲": "1", "未知": "keep", "条件": "x"}
    # Positional arguments are keyed by their 1-based position.
    assert pages["Gamma"]["params"] == {"甲": "2", "1": "位置参数"}


def test_pages_snapshot_skips_redirects_and_non_article_namespaces(tool):
    raw = load_json(RAW / "pages.json")
    data = tool.build_pages_snapshot(raw["templates"], fetched_at=FIXED_TIME)
    titles = [page["title"] for page in data["templates"]["歌曲"]["pages"]]
    assert titles == ["Alpha", "Gamma"]
    assert "Beta" not in titles  # redirect
    assert "模板页" not in titles  # ns=10
    assert data["templates"]["歌曲"]["page_count"] == 2


def test_pages_snapshot_orders_pages_by_title(tool):
    raw = load_json(RAW / "pages.json")
    data = tool.build_pages_snapshot(raw["templates"], fetched_at=FIXED_TIME)
    titles = [page["title"] for page in data["templates"]["歌曲"]["pages"]]
    assert titles == sorted(titles)


def test_pages_snapshot_rejects_page_without_invocation(tool):
    with pytest.raises(tool.SnapshotError, match="not found"):
        tool.build_pages_snapshot(
            {
                "歌曲": [
                    {"title": "Broken", "ns": 0, "content": "no template here"}
                ]
            },
            fetched_at=FIXED_TIME,
        )


def test_pages_snapshot_rejects_missing_revision_content(tool):
    with pytest.raises(tool.SnapshotError, match="no revision content"):
        tool.build_pages_snapshot(
            {"歌曲": [{"title": "Missing", "ns": 0, "content": None}]},
            fetched_at=FIXED_TIME,
        )


def test_pages_snapshot_tolerates_literal_single_braces(tool):
    # Real pages contain stray single braces; they must not be mistaken for
    # template delimiters (that hid a live page's invocation during development).
    content = "{{歌曲\n|内容=literal { brace } here\n|甲=1}}"
    data = tool.build_pages_snapshot(
        {"歌曲": [{"title": "Braces", "ns": 0, "content": content}]},
        fetched_at=FIXED_TIME,
    )
    assert data["templates"]["歌曲"]["pages"][0]["params"] == {
        "内容": "literal { brace } here",
        "甲": "1",
    }


# ---------------------------------------------------------------------------
# Files, schema, determinism, offline mode
# ---------------------------------------------------------------------------


def test_fixture_snapshots_pass_schema_validation(tool):
    for kind, filename in tool.SNAPSHOT_FILES.items():
        data = load_json(EXPECTED / filename)
        tool.VALIDATORS[kind](data)


def test_write_snapshots_is_byte_stable_and_round_trips(tool, tmp_path):
    data = {
        kind: load_json(EXPECTED / filename)
        for kind, filename in tool.SNAPSHOT_FILES.items()
    }

    tool.write_snapshots(tmp_path, data)
    first = read_bytes(tmp_path)
    tool.write_snapshots(tmp_path, data)
    second = read_bytes(tmp_path)

    assert first == second
    for payload in first.values():
        assert payload.endswith(b"\n")
        assert b"\r\n" not in payload
    assert tool.load_snapshots(tmp_path) == data


def test_invalid_snapshot_is_rejected(tool):
    data = load_json(EXPECTED / "titles.json")
    data["articles"] = list(reversed(data["articles"]))
    with pytest.raises(tool.SnapshotError, match="sorted"):
        tool.validate_titles_snapshot(data)

    data = load_json(EXPECTED / "titles.json")
    data["counts"]["total"] = 999
    with pytest.raises(tool.SnapshotError, match="counts.total"):
        tool.validate_titles_snapshot(data)


def test_offline_mode_rewrites_without_subprocess(tool, tmp_path, monkeypatch):
    data = {
        kind: load_json(EXPECTED / filename)
        for kind, filename in tool.SNAPSHOT_FILES.items()
    }
    tool.write_snapshots(tmp_path, data)
    before = read_bytes(tmp_path)

    def no_network(*args, **kwargs):
        raise AssertionError("offline mode must not start a process")

    monkeypatch.setattr(tool.subprocess, "run", no_network)
    assert tool.main(["--offline", "--out", str(tmp_path)]) == 0
    assert read_bytes(tmp_path) == before


def test_check_mode_validates_without_writing(tool, tmp_path):
    for filename in tool.SNAPSHOT_FILES.values():
        shutil.copyfile(EXPECTED / filename, tmp_path / filename)
    before = read_bytes(tmp_path)
    assert tool.main(["--check", "--out", str(tmp_path)]) == 0
    assert read_bytes(tmp_path) == before


def test_offline_mode_reports_missing_snapshot(tool, tmp_path):
    assert tool.main(["--offline", "--out", str(tmp_path)]) == 1
