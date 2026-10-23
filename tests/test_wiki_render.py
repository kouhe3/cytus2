from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, ROOT, copy_input, run_build, run_render

FIXTURE_IM_OS = Path(__file__).resolve().parent / "fixtures" / "im_os"

GOLDEN_PAGES = {
    # iM + OA + gacha unlocks; no OS source for this song.
    "alpha001_000": (
        "{{歌曲\n"
        "|歌曲排序=1\n"
        "|曲名=First\n"
        "|所属角色=Alpha\n"
        "|曲师=Artist A\n"
        "|所属曲包=Alpha\n"
        "|EasyRating=1\n"
        "|HardRating=5\n"
        "|ChaosRating=9\n"
        "|GlitchRating=10\n"
        "|获取方式=CHAOS 难度：Alpha 等级达到 Lv.10 后阅读 iM 贴文 [[第一篇贴文]] 解锁。\n"
        "CHAOS 难度：Alpha 等级达到 Lv.4 后分析 OA 档案 [[阿尔法装置]] 解锁。\n"
        "GLITCH 难度：通过抽奖获得解锁。\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    ),
    # OS + story unlocks on the same song.
    "alpha001_001": (
        "{{歌曲\n"
        "|歌曲排序=2\n"
        "|曲名=Second\n"
        "|所属角色=Alpha\n"
        "|曲师=Artist B\n"
        "|所属曲包=Alpha\n"
        "|EasyRating=2\n"
        "|HardRating=6\n"
        "|ChaosRating=11\n"
        "|CrashRating=β\n"
        "|获取方式=HARD 难度：通过抽奖获得解锁。\n"
        "HARD/CHAOS 难度：在 CAPSO 商店购买 [[Alpha Pack]] 解锁。\n"
        "CHAOS 难度：Alpha 等级达到 Lv.10 后阅读 OS 档案 [[第一个OS（Alpha）]] 解锁。\n"
        "CRASH 难度：完成剧情 story_alpha01 解锁。\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    ),
    # Default pack unlock; the Dream/Drop charts have no unlock edges.
    "beta001_000": (
        "{{歌曲\n"
        "|歌曲排序=1\n"
        "|曲名=Third\n"
        "|所属角色=Beta\n"
        "|所属曲包=Beta\n"
        "|EasyRating=3\n"
        "|DreamRating=12\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    ),
}


@pytest.fixture(scope="session")
def wiki_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("wiki")
    input_dir = root / "input"
    copy_input(FIXTURE_INPUT, input_dir)
    shutil.copytree(FIXTURE_IM_OS / "text", input_dir / "text", dirs_exist_ok=True)
    # The OS fixture file is named after a character so the page title gets the
    # site's "<file>（<character>）" form.
    (input_dir / "text" / "osdata" / "gamma001").replace(
        input_dir / "text" / "osdata" / "alpha001"
    )

    build_dir = root / "build"
    result = run_build(input_dir, build_dir)
    assert result.returncode == 0, result.stderr

    out = root / "wiki"
    result = run_render(build_dir, out)
    assert result.returncode == 0, result.stderr
    return out


def read_report(out: Path) -> dict:
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def report_page(out: Path, entity: str) -> dict:
    pages = {page["entity"]: page for page in read_report(out)["pages"]}
    return pages[entity]


def merged_profile() -> dict:
    merged: dict = {}
    sources = [
        ROOT / "wiki" / "profiles" / "bili.json",
        *sorted((ROOT / "wiki" / "profiles" / "bili.d").glob("*.json")),
    ]
    for path in sources:
        merged = _deep_merge(merged, json.loads(path.read_text(encoding="utf-8")))
    return merged


def _deep_merge(base: dict, overlay: dict) -> dict:
    result = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def test_render_writes_one_page_and_report_entry_per_song(wiki_output: Path) -> None:
    report = read_report(wiki_output)
    counts = report["counts"]
    assert counts["character"] == 2
    assert counts["gallery_item"] == 5
    assert counts["oa_document"] == 2
    assert counts["os_log"] == 3
    assert counts["pack"] == 2
    assert counts["song"] == 3
    assert report["page_count"] == sum(counts.values())
    song_pages = [page for page in report["pages"] if page["page_type"] == "song"]
    assert {page["entity"] for page in song_pages} == {
        "song/alpha001_000",
        "song/alpha001_001",
        "song/beta001_000",
    }
    for page in song_pages:
        assert (wiki_output / page["file"]).is_file()
        assert page["title_source"] == "generated"


@pytest.mark.parametrize("game_id", sorted(GOLDEN_PAGES))
def test_golden_song_pages(wiki_output: Path, game_id: str) -> None:
    path = wiki_output / "pages" / "song" / f"{game_id}.wikitext"
    assert path.read_text(encoding="utf-8") == GOLDEN_PAGES[game_id]


def test_default_song_omits_unverifiable_fields(wiki_output: Path) -> None:
    page = report_page(wiki_output, "song/beta001_000")
    emitted = set(page["emitted"])
    assert "获取方式" not in emitted
    assert {"BPM", "时长", "谱师", "歌词", "曲绘"} & emitted == set()
    omitted = {row.get("param") for row in page["omitted"]}
    assert {"BPM", "时长", "谱师", "歌词", "曲绘", "EasyNote"} <= omitted
    reasons = {row.get("param"): row["reason"] for row in page["omitted"]}
    assert reasons["曲绘"] == "conditional_omitted"
    assert page["conflicts"] == []


def test_im_unlock_line_links_the_post_and_carries_the_level(wiki_output: Path) -> None:
    page = report_page(wiki_output, "song/alpha001_000")
    text = (wiki_output / page["file"]).read_text(encoding="utf-8")
    assert (
        "CHAOS 难度：Alpha 等级达到 Lv.10 后阅读 iM 贴文 [[第一篇贴文]] 解锁。"
        in text
    )
    assert {"target": "第一篇贴文", "label": "第一篇贴文"} in page["links"]


def test_os_unlock_line_uses_the_file_character_title(wiki_output: Path) -> None:
    page = report_page(wiki_output, "song/alpha001_001")
    text = (wiki_output / page["file"]).read_text(encoding="utf-8")
    assert (
        "CHAOS 难度：Alpha 等级达到 Lv.10 后阅读 OS 档案 "
        "[[第一个OS（Alpha）]] 解锁。"
    ) in text


def test_drop_rating_is_reported_not_emitted(wiki_output: Path) -> None:
    page = report_page(wiki_output, "song/beta001_000")
    text = (wiki_output / page["file"]).read_text(encoding="utf-8")
    assert "DropRating" not in text
    assert "DropRating" not in page["emitted"]
    assert {
        "field": "rating.Drop",
        "reason": "no_profile_parameter",
    } in page["omitted"]


def test_every_emitted_parameter_exists_in_the_profile_and_conditionals_hold(
    wiki_output: Path,
) -> None:
    profile = merged_profile()
    template = profile["templates"]["歌曲"]
    known = set(template["params"])
    conditional = {
        name for name, meta in template["params"].items() if meta["conditional"]
    }
    observed_unknown = set(profile["pages"]["song"]["observed_unknown_params"])

    for page in read_report(wiki_output)["pages"]:
        page_template = profile["templates"][page["template"]]
        assert set(page["emitted"]) <= set(page_template["params"]), page["entity"]
        if page["page_type"] != "song":
            continue
        emitted = set(page["emitted"])
        assert emitted <= known, page["entity"]
        assert emitted.isdisjoint(observed_unknown), page["entity"]
        assert {"曲绘", "曲绘版本", "曲绘文件"}.isdisjoint(emitted)
        assert "曲名" in emitted
        text = (wiki_output / page["file"]).read_text(encoding="utf-8")
        for name in conditional:
            assert f"|{name}=\n" not in text, page["entity"]


def test_render_is_deterministic(wiki_output: Path, tmp_path: Path) -> None:
    second = tmp_path / "wiki"
    result = run_render(wiki_output.parent / "build", second)
    assert result.returncode == 0, result.stderr
    first_pages = {
        path.relative_to(wiki_output): path.read_bytes()
        for path in (wiki_output / "pages").rglob("*.wikitext")
    }
    second_pages = {
        path.relative_to(second): path.read_bytes()
        for path in (second / "pages").rglob("*.wikitext")
    }
    assert first_pages == second_pages
    assert json.loads((wiki_output / "report.json").read_text("utf-8")) == json.loads(
        (second / "report.json").read_text("utf-8")
    )


def test_parameter_not_in_the_profile_fails_the_build(
    wiki_output: Path, tmp_path: Path
) -> None:
    profile = json.loads((ROOT / "wiki" / "profiles" / "bili.json").read_text("utf-8"))
    profile["templates"]["歌曲"]["fields"]["artist"] = "NotAParameter"
    broken = tmp_path / "broken.json"
    broken.write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")

    result = run_render(
        wiki_output.parent / "build",
        tmp_path / "wiki",
        "--profile",
        str(broken),
    )
    assert result.returncode == 1
    assert "unknown parameter" in result.stderr
