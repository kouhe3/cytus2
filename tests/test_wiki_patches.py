from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, run_build, run_render
from cytus2db.wiki.patches import (
    PatchError,
    PatchPage,
    Snapshot,
    SnapshotPage,
    apply_patch,
    load_snapshot,
    match_pages,
    plan_patches,
)

FIXTURE_IM_OS = Path(__file__).resolve().parent / "fixtures" / "im_os"
FIXTURE_SNAPSHOT = (
    Path(__file__).resolve().parent / "fixtures" / "wiki_patches" / "snapshot"
)

EXISTING_SONG = """{{歌曲
|曲名=First
|曲师=Old Artist
|原文=人工填写的旧值
|轶事=人工轶事
}}
== 轶事 ==
这段是人工写的，包含 [[人工链接|别名]] 与 {{ref|人工来源}}。
{{歌曲/歌词|第一行
第二行}}
[[分类:歌曲]]
"""


def snapshot_pages() -> Snapshot:
    return load_snapshot(FIXTURE_SNAPSHOT)


def song_page(**params: str) -> PatchPage:
    return PatchPage(
        entity_id="song/alpha001_000",
        page_type="song",
        template="歌曲",
        title=params.get("曲名", "First"),
        params=params,
    )


def test_apply_patch_preserves_unknown_parameters_and_human_sections() -> None:
    page = song_page(曲名="First", 曲师="Artist A", EasyRating="7")
    entry = plan_patches([page], snapshot_pages())["song/alpha001_000"]

    assert entry.patch is not None
    patch = entry.patch
    assert patch["title"] == "First"
    assert patch["template"] == "歌曲"
    assert patch["page_exists"] is True
    assert patch["params"] == {"曲师": "Artist A", "EasyRating": "7"}

    applied = apply_patch(EXISTING_SONG, patch)

    human_section = EXISTING_SONG[EXISTING_SONG.index("\n== 轶事 =="):]
    assert applied.endswith(human_section)
    assert "|原文=人工填写的旧值\n" in applied
    assert "|轶事=人工轶事\n" in applied
    assert "|曲师=Artist A\n" in applied
    assert "|EasyRating=7\n" in applied
    assert "|曲师=Old Artist" not in applied


def test_apply_patch_leaves_nested_template_parameters_untouched() -> None:
    existing = (
        "{{歌曲\n"
        "|曲名=First\n"
        "|其他={{ref|name=a|group=b}}\n"
        "|歌词=第一行\n第二行\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    )
    patch = {"title": "First", "template": "歌曲", "params": {"曲名": "First!"}, "page_exists": True}

    applied = apply_patch(existing, patch)

    assert "|其他={{ref|name=a|group=b}}\n" in applied
    assert "|歌词=第一行\n第二行\n" in applied
    assert "|曲名=First!\n" in applied


def test_apply_patch_rejects_an_unknown_template() -> None:
    patch = {"title": "Nope", "template": "歌曲", "params": {"曲名": "Nope"}, "page_exists": True}
    with pytest.raises(PatchError):
        apply_patch("{{角色\n|角色名=Alpha\n}}\n", patch)


def test_unmatched_entity_keeps_its_full_page() -> None:
    page = song_page(曲名="Mystery Song")
    entry = plan_patches([page], snapshot_pages())["song/alpha001_000"]

    assert entry.patch is None
    assert entry.keep_page is True
    assert entry.match.matched is False
    assert entry.match.title == "Mystery Song"
    assert entry.match.source == "generated"


def test_matched_entity_does_not_keep_a_full_page() -> None:
    page = song_page(曲名="First", 曲师="Artist A")
    entry = plan_patches([page], snapshot_pages())["song/alpha001_000"]

    assert entry.match.matched is True
    assert entry.match.title == "First"
    assert entry.match.source == "snapshot"
    assert entry.keep_page is False


def test_pack_and_character_match_by_their_template_parameters() -> None:
    snapshot = Snapshot(
        articles=frozenset({"Alpha", "Alpha Pack"}),
        pages=(
            SnapshotPage("Alpha", "角色", {"角色名": "Alpha"}),
            SnapshotPage("Alpha Pack", "曲包", {"曲包名": "Alpha Pack"}),
        ),
    )
    pages = [
        PatchPage("character/alpha001", "character", "角色", "Alpha", {"角色名": "Alpha"}),
        PatchPage("pack/alpha001", "pack", "曲包", "Alpha Pack", {"曲包名": "Alpha Pack"}),
    ]

    matches = match_pages(pages, snapshot)

    assert matches["character/alpha001"].matched is True
    assert matches["character/alpha001"].title == "Alpha"
    assert matches["pack/alpha001"].matched is True
    assert matches["pack/alpha001"].title == "Alpha Pack"


def test_os_pages_match_on_filename_and_owner() -> None:
    snapshot = Snapshot(
        articles=frozenset({"日志（Main Folder）"}),
        pages=(
            SnapshotPage(
                "日志（Main Folder）",
                "Os/文件",
                {"文件名": "Log_01", "所属角色": "Main_Folder"},
            ),
        ),
    )
    page = PatchPage(
        "os_log/ivos001",
        "os_log",
        "Os/文件",
        "日志（Main Folder）",
        {"文件名": "Log_01", "所属角色": "Main Folder"},
    )

    match = match_pages([page], snapshot)["os_log/ivos001"]

    assert match.matched is True
    assert match.title == "日志（Main Folder）"
    assert match.source == "snapshot"

    entry = plan_patches([page], snapshot)["os_log/ivos001"]
    assert entry.patch is not None
    assert entry.patch["params"] == {}


def test_im_duplicate_titles_are_disambiguated_by_global_sort() -> None:
    page = PatchPage(
        "im_post/P0101",
        "im_post",
        "Im/帖",
        "闲聊时间",
        {"标题": "闲聊时间", "全局排序": "26"},
    )

    match = match_pages([page], snapshot_pages())["im_post/P0101"]

    assert match.matched is True
    assert match.title == "闲聊时间 2"
    assert match.source == "snapshot:sort"


def test_im_duplicate_titles_fall_back_to_story_sort() -> None:
    page = PatchPage(
        "im_post/P0102",
        "im_post",
        "Im/帖",
        "重启。",
        {"标题": "重启。", "全局排序": "999", "剧情排序": "24"},
    )

    match = match_pages([page], snapshot_pages())["im_post/P0102"]

    assert match.matched is True
    assert match.title == "重启。"
    assert match.source == "snapshot:sort"


def test_im_ambiguous_title_uses_the_post_id_title() -> None:
    page = PatchPage(
        "im_post/P0101",
        "im_post",
        "Im/帖",
        "闲聊时间",
        {"标题": "闲聊时间"},
    )

    match = match_pages([page], snapshot_pages())["im_post/P0101"]

    assert match.matched is False
    assert match.title == "闲聊时间（P0101）"
    assert match.source == "generated:disambiguated"
    assert any(conflict.kind == "title_conflict" for conflict in match.conflicts)


def test_an_existing_generated_title_is_not_overwritten() -> None:
    page = song_page(曲名="Second")
    snapshot = Snapshot(articles=frozenset({"Second"}), pages=())

    entry = plan_patches([page], snapshot)["song/alpha001_000"]

    assert entry.patch is None
    assert entry.keep_page is False
    assert any(
        conflict.kind == "existing_title_without_match"
        for conflict in entry.match.conflicts
    )


def test_a_redirect_title_is_not_shadowed_by_a_new_page() -> None:
    page = song_page(曲名="Mystery Song")
    snapshot = Snapshot(
        articles=frozenset(), redirects=frozenset({"Mystery Song"}), pages=()
    )

    entry = plan_patches([page], snapshot)["song/alpha001_000"]

    assert entry.patch is None
    assert entry.keep_page is False
    assert any(
        conflict.kind == "existing_title_without_match"
        for conflict in entry.match.conflicts
    )


def test_punctuation_variant_matches_by_the_existing_page_title() -> None:
    snapshot = Snapshot(
        articles=frozenset({"CODE:RED"}),
        pages=(
            SnapshotPage("CODE:RED", "歌曲", {"曲名": "CODE：RED"}),
        ),
    )
    page = song_page(曲名="CODE:RED")

    match = match_pages([page], snapshot)["song/alpha001_000"]

    assert match.matched is True
    assert match.title == "CODE:RED"
    # The identity key now folds the full-width colon too, so the match is
    # reported as a plain snapshot hit rather than a title-only fallback.
    assert match.source == "snapshot"

    entry = plan_patches([page], snapshot)["song/alpha001_000"]
    assert entry.patch is not None
    assert "曲名" not in entry.patch["params"]


def test_two_entities_never_patch_the_same_page() -> None:
    first = song_page(曲名="First", 曲师="Artist A")
    second = PatchPage(
        "song/alpha001_009",
        "song",
        "歌曲",
        "First",
        {"曲名": "First", "曲师": "Another Artist"},
    )

    entries = plan_patches([first, second], snapshot_pages())

    assert entries["song/alpha001_000"].match.matched is True
    assert entries["song/alpha001_009"].match.matched is False
    assert entries["song/alpha001_009"].keep_page is True
    assert entries["song/alpha001_009"].match.title == "First（alpha001_009）"
    assert any(
        conflict.kind == "title_conflict"
        for conflict in entries["song/alpha001_009"].match.conflicts
    )


@pytest.fixture(scope="session")
def patched_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("wiki_patches")
    input_dir = root / "input"
    shutil.copytree(FIXTURE_INPUT, input_dir)
    shutil.copytree(FIXTURE_IM_OS / "text", input_dir / "text", dirs_exist_ok=True)
    (input_dir / "text" / "osdata" / "gamma001").replace(
        input_dir / "text" / "osdata" / "alpha001"
    )

    build_dir = root / "build"
    result = run_build(input_dir, build_dir)
    assert result.returncode == 0, result.stderr

    out = root / "wiki"
    result = run_render(
        build_dir, out, "--patches", "--snapshot", str(FIXTURE_SNAPSHOT)
    )
    assert result.returncode == 0, result.stderr
    return out


def read_report(out: Path) -> dict:
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def report_page(out: Path, entity: str) -> dict:
    pages = {page["entity"]: page for page in read_report(out)["pages"]}
    return pages[entity]


def test_render_patches_writes_patches_and_only_unmatched_pages(
    patched_output: Path,
) -> None:
    song_patch = patched_output / "patches" / "song" / "alpha001_000.json"
    character_patch = patched_output / "patches" / "character" / "alpha001.json"
    assert song_patch.is_file()
    assert character_patch.is_file()

    assert not (patched_output / "pages" / "song" / "alpha001_000.wikitext").exists()
    assert not (patched_output / "pages" / "character" / "alpha001.wikitext").exists()
    assert (patched_output / "pages" / "song" / "alpha001_001.wikitext").is_file()
    assert (patched_output / "pages" / "character" / "beta001.wikitext").is_file()
    assert (patched_output / "pages" / "pack" / "alpha001.wikitext").is_file()

    patch = json.loads(song_patch.read_text(encoding="utf-8"))
    assert set(patch) == {"title", "template", "params", "page_exists"}
    assert patch["title"] == "First"
    assert patch["template"] == "歌曲"
    assert patch["page_exists"] is True
    assert patch["params"]["曲师"] == "Artist A"
    assert "曲名" not in patch["params"]


def test_render_patches_reports_counts_and_title_sources(patched_output: Path) -> None:
    report = read_report(patched_output)
    counts = report["patch_counts"]

    assert counts["song"] == {
        "pages": 3,
        "matched": 1,
        "unmatched": 2,
        "conflicts": 0,
        "patches": 1,
    }
    assert counts["character"]["matched"] == 1
    assert counts["character"]["unmatched"] == 1
    assert counts["pack"]["matched"] == 0
    assert counts["pack"]["unmatched"] == 2
    assert counts["im_post"] == {
        "pages": 3,
        "matched": 0,
        "unmatched": 3,
        "conflicts": 0,
        "patches": 0,
    }
    assert counts["os_log"]["unmatched"] == 3
    assert counts["oa_document"]["unmatched"] == 2
    assert counts["gallery_item"]["unmatched"] == 5

    first = report_page(patched_output, "song/alpha001_000")
    assert first["matched"] is True
    assert first["title_source"] == "snapshot"
    assert first["patch"] == "patches/song/alpha001_000.json"
    assert first["file"] is None

    second = report_page(patched_output, "song/alpha001_001")
    assert second["matched"] is False
    assert second["title_source"] == "generated"
    assert second["patch"] is None
    assert second["file"] == "pages/song/alpha001_001.wikitext"

    unmatched = {row["entity"] for row in report["unmatched"]}
    assert unmatched == {
        "song/alpha001_001",
        "song/beta001_000",
        "character/beta001",
        "pack/alpha001",
        "pack/beta001",
        "im/P0101",
        "im/P0201",
        "im/P0301",
        "os/bos001",
        "os/gos001",
        "os/gos002",
        "oa_document/alpha001_obj001_oa001",
        "oa_document/beta001_obj001_oa001",
        "gallery_item/misc/alpha_bossstage",
        "gallery_item/misc/conditions",
        "gallery_item/misc/ending03",
        "gallery_item/misc/opening",
        "gallery_item/misc/poster",
    }
    assert report["patch_conflicts"] == []


def test_patch_applies_to_the_existing_page_fixture(patched_output: Path) -> None:
    patch = json.loads(
        (patched_output / "patches" / "song" / "alpha001_000.json").read_text(
            encoding="utf-8"
        )
    )

    applied = apply_patch(EXISTING_SONG, patch)

    human_section = EXISTING_SONG[EXISTING_SONG.index("\n== 轶事 =="):]
    assert applied.endswith(human_section)
    assert "|原文=人工填写的旧值\n" in applied
    assert "|轶事=人工轶事\n" in applied
    assert "|曲师=Artist A\n" in applied
    assert "|曲名=First\n" in applied


def test_duplicate_named_parameters_use_the_last_value() -> None:
    from cytus2db.wiki.patches import template_parameters

    text = "{{歌曲\n|曲名=First\n|曲名=Second\n|曲师=Old\n}}\n"
    assert template_parameters(text, "歌曲") == {"曲名": "Second", "曲师": "Old"}

    patch = {
        "title": "First",
        "template": "歌曲",
        "params": {"曲名": "New"},
        "page_exists": True,
    }
    applied = apply_patch(text, patch)
    # MediaWiki keeps the last occurrence; the earlier duplicate is untouched.
    assert "|曲名=First\n" in applied
    assert "|曲名=New\n" in applied
    assert "|曲名=Second" not in applied


def test_patch_render_requires_the_local_pages_cache(
    tmp_path: Path, built_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    shutil.copytree(FIXTURE_SNAPSHOT, snapshot)
    (snapshot / "pages.json").unlink()

    result = run_render(
        built_db,
        tmp_path / "wiki",
        "--patches",
        "--snapshot",
        str(snapshot),
    )
    assert result.returncode != 0
    assert "pages.json" in result.stderr
