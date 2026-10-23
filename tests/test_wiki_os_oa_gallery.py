from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, ROOT, copy_input, run_build, run_render

FIXTURE_WIKI_PAGES = Path(__file__).resolve().parent / "fixtures" / "wiki_pages"

GOLDEN_OS = (
    "{{Os/文件\n"
    "|ver=1.4\n"
    "|文件名=Alpha_File\n"
    "|文件类型=cam\n"
    "|剧情排序=1\n"
    "|所属角色=Alpha\n"
    "|解锁谱面=[[Second]]（Chaos）\n"
    "|文件ID=aos001\n"
    "|时间=687_06_30 18:01\n"
    "|内容={{os/对话|Alpha|Hello there}}\n"
    "{{os/声音|Beep,Beep sound}}\n"
    "[[File:img001.png|thumb]]\n"
    "<poem>\n"
    "Alpha narration line.\n"
    "</poem>\n"
    "{{os/对话|Beta|Second line}}\n"
    "{{邮件抬头|主题=Title|发件人=From|收件人=To}}\n"
    "<poem>\n"
    "Mail body\n"
    "</poem>\n"
    "}}\n"
    "[[分类:Os剧情目录]]\n"
)

GOLDEN_OA = (
    "{{Oa/文件\n"
    "|所属物品=阿尔法装置\n"
    "|文件名=Alpha_Doc\n"
    "|描述=游玩以下曲目的任意难度：\n"
    "|条件=Third\n"
    "|剧情排序=1\n"
    "|内容={{oa/对话|Alpha|Hello OA}}\n"
    "{{oa/声音|Beep,Beep sound}}\n"
    "<poem>\n"
    "OA document body.\n"
    "</poem>\n"
    "}}\n"
    "[[分类:Oa剧情]]\n"
)

GOLDEN_GALLERY = (
    "{{Gallery文件\n"
    "|文件名=Poster\n"
    "|剧情排序=2\n"
    "|所属角色=Main_Folder\n"
    "|文件类型=image\n"
    "|文件内容=[[File:poster.png|thumb]]\n"
    "}}\n"
    "[[分类:Gallery]]\n"
)


@pytest.fixture(scope="session")
def page_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("pages")
    input_dir = root / "input"
    copy_input(FIXTURE_INPUT, input_dir)
    shutil.copytree(
        FIXTURE_WIKI_PAGES / "text", input_dir / "text", dirs_exist_ok=True
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


def test_page_counts_for_os_oa_and_gallery(page_output: Path) -> None:
    report = read_report(page_output)
    assert report["counts"] == {
        "character": 2,
        "gallery_item": 5,
        "oa_document": 1,
        "os_log": 3,
        "pack": 2,
        "song": 3,
    }
    assert report["page_count"] == 16


def test_golden_os_page(page_output: Path) -> None:
    path = page_output / "pages" / "os_log" / "aos001.wikitext"
    assert path.read_text(encoding="utf-8") == GOLDEN_OS


def test_golden_oa_page(page_output: Path) -> None:
    path = (
        page_output
        / "pages"
        / "oa_document"
        / "alpha001_obj001_oa001.wikitext"
    )
    assert path.read_text(encoding="utf-8") == GOLDEN_OA


def test_golden_gallery_page(page_output: Path) -> None:
    path = page_output / "pages" / "gallery_item" / "misc_poster.wikitext"
    assert path.read_text(encoding="utf-8") == GOLDEN_GALLERY


def test_titles_follow_file_and_character_rule(page_output: Path) -> None:
    report = read_report(page_output)
    pages = {
        page["entity"]: page
        for page in report["pages"]
        if page["page_type"] in ("os_log", "oa_document", "gallery_item")
    }
    for page in pages.values():
        assert re.search(r"^.+（[^（）]+）$", page["title"]), page["entity"]
        assert "_" not in page["title"], page["entity"]

    assert pages["os/aos001"]["title"] == "Alpha File（Alpha）"
    assert pages["os/aos002"]["title"] == "Alpha File 2（Alpha）"
    assert pages["oa_document/alpha001_obj001_oa001"]["title"] == "Alpha Doc（Alpha）"
    assert pages["gallery_item/misc/poster"]["title"] == "Poster（Main Folder）"


def test_gallery_folder_title_rule() -> None:
    from cytus2db.wiki.pages.gallery import folder_title

    assert folder_title("Main_Folder") == "Main Folder（gallery）"


def test_os_ver_is_always_explicit(page_output: Path) -> None:
    report = read_report(page_output)
    for page in report["pages"]:
        if page["page_type"] != "os_log":
            continue
        assert "ver" in page["emitted"], page["entity"]
        text = (page_output / page["file"]).read_text(encoding="utf-8")
        assert "|ver=" in text, page["entity"]
        assert "|ver=\n" not in text, page["entity"]


def test_oa_body_uses_site_dialogue_and_sound_templates(page_output: Path) -> None:
    text = (
        page_output / "pages" / "oa_document" / "alpha001_obj001_oa001.wikitext"
    ).read_text(encoding="utf-8")
    assert "{{oa/对话|Alpha|Hello OA}}" in text
    assert "{{oa/声音|Beep,Beep sound}}" in text


def test_os_body_uses_site_templates_for_dialogue_voice_and_images(
    page_output: Path,
) -> None:
    text = (page_output / "pages" / "os_log" / "aos001.wikitext").read_text(
        encoding="utf-8"
    )
    assert "{{os/对话|Alpha|Hello there}}" in text
    assert "{{os/声音|Beep,Beep sound}}" in text
    assert "[[File:img001.png|thumb]]" in text


def test_emitted_parameters_are_real_template_parameters(page_output: Path) -> None:
    snapshot = json.loads(
        (ROOT / "wiki" / "snapshot" / "template_params.json").read_text(
            encoding="utf-8-sig"
        )
    )["templates"]
    for page in read_report(page_output)["pages"]:
        template = snapshot[page["template"]]
        assert set(page["emitted"]) <= set(template["params"]), page["entity"]
        if page["template"] == "Oa/文件":
            assert "任务排序" not in page["emitted"]


def test_video_gallery_item_omits_unverifiable_content(page_output: Path) -> None:
    page = report_page(page_output, "gallery_item/misc/opening")
    assert "文件内容" not in page["emitted"]
    assert {"kind": "video_source_missing", "detail": "gallery_item/misc/opening"} in (
        page["conflicts"]
    )


def test_image_gallery_item_links_the_file(page_output: Path) -> None:
    page = report_page(page_output, "gallery_item/misc/poster")
    assert page["emitted"] == [
        "文件名",
        "剧情排序",
        "所属角色",
        "文件类型",
        "文件内容",
    ]
    text = (page_output / page["file"]).read_text(encoding="utf-8")
    assert "[[File:poster.png|thumb]]" in text
