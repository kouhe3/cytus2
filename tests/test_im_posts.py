from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, ROOT, copy_input, run_build, run_render

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "im_posts"
SNAPSHOT = FIXTURE / "snapshot"

GOLDEN_PAGES = {
    # Rich text: level lock, comment delimiters, quote block, hyperlink, chart.
    "P0101": (
        "{{Im/帖\n"
        "|剧情排序=1\n"
        "|全局排序=1\n"
        "|iM_ID=Alpha-Official\n"
        "|标题=第一篇贴文\n"
        "|内容=第一行: 你好;世界<br>{{引用段落|引用一段}}<br>"
        "[https://example.com <b>官网</b>]\n"
        "|评论={{im/评论|Fan；One:好耶：试玩；真棒;Pipe｜Fan:A｜B;"
        "Line Fan:第一行<br>第二行}}\n"
        "|点赞数=42\n"
        "|解锁条件=Alpha达到Lv.1\n"
        "|解锁谱面=[[First]]（CHAOS）\n"
        "|配图文件名=attach01.png\n"
        "}}\n"
        "[[分类:Im剧情]]\n"
    ),
    # Empty body and only an empty reply: both parameters are omitted.
    "P0201": (
        "{{Im/帖\n"
        "|剧情排序=1\n"
        "|全局排序=2\n"
        "|iM_ID=Alpha Side\n"
        "|标题=仅附件\n"
        "|点赞数=7\n"
        "|解锁条件=已阅读过iM贴文“[[旧页-第一篇]]”\n"
        "}}\n"
        "[[分类:Im剧情]]\n"
    ),
    # First post of a duplicated title keeps it; see P0401 for the suffix.
    "P0301": (
        "{{Im/帖\n"
        "|剧情排序=1\n"
        "|全局排序=3\n"
        "|iM_ID=Beta\n"
        "|标题=重复标题\n"
        "|内容=Beta 正文\n"
        "|点赞数=3\n"
        "}}\n"
        "[[分类:Im剧情]]\n"
    ),
    "P0401": (
        "{{Im/帖\n"
        "|剧情排序=1\n"
        "|全局排序=4\n"
        "|iM_ID=Gamma\n"
        "|标题=重复标题\n"
        "|内容=Gamma 正文\n"
        "|点赞数=0\n"
        "|解锁条件=已完成剧情 story_alpha01\n"
        "}}\n"
        "[[分类:Im剧情]]\n"
    ),
}


@pytest.fixture(scope="session")
def im_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("im_posts")
    input_dir = root / "input"
    copy_input(FIXTURE_INPUT, input_dir)
    shutil.copytree(FIXTURE / "text", input_dir / "text", dirs_exist_ok=True)

    build_dir = root / "build"
    result = run_build(input_dir, build_dir)
    assert result.returncode == 0, result.stderr

    previous = os.environ.get("CYTUS2_WIKI_SNAPSHOT")
    os.environ["CYTUS2_WIKI_SNAPSHOT"] = str(SNAPSHOT)
    try:
        out = root / "wiki"
        result = run_render(build_dir, out)
    finally:
        if previous is None:
            os.environ.pop("CYTUS2_WIKI_SNAPSHOT", None)
        else:
            os.environ["CYTUS2_WIKI_SNAPSHOT"] = previous
    assert result.returncode == 0, result.stderr
    return out


def read_report(out: Path) -> dict:
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def report_page(out: Path, entity: str) -> dict:
    pages = {page["entity"]: page for page in read_report(out)["pages"]}
    return pages[entity]


def page_text(out: Path, entity: str) -> str:
    page = report_page(out, entity)
    return (out / page["file"]).read_text(encoding="utf-8")


def parameter(text: str, name: str) -> str:
    for line in text.splitlines():
        if line.startswith(f"|{name}="):
            return line[len(name) + 2 :]
    raise AssertionError(f"parameter {name!r} not emitted")


def test_render_writes_one_page_per_post(im_output: Path) -> None:
    report = read_report(im_output)
    im_pages = [page for page in report["pages"] if page["page_type"] == "im_post"]
    assert report["counts"]["im_post"] == 4
    assert {page["entity"] for page in im_pages} == {
        "im/P0101",
        "im/P0201",
        "im/P0301",
        "im/P0401",
    }
    for page in im_pages:
        assert (im_output / page["file"]).is_file()


@pytest.mark.parametrize("game_id", sorted(GOLDEN_PAGES))
def test_golden_im_pages(im_output: Path, game_id: str) -> None:
    path = im_output / "pages" / "im_post" / f"{game_id}.wikitext"
    assert path.read_text(encoding="utf-8") == GOLDEN_PAGES[game_id]


def test_comments_use_the_site_format_and_escape_delimiters(im_output: Path) -> None:
    comments = parameter(page_text(im_output, "im/P0101"), "评论")
    assert comments == (
        "{{im/评论|Fan；One:好耶：试玩；真棒;Pipe｜Fan:A｜B;Line Fan:第一行<br>第二行}}"
    )
    assert ";" in comments.split("{{im/评论|", 1)[1]
    assert ":" in comments.split("{{im/评论|", 1)[1]


def test_empty_replies_are_skipped_and_counted(im_output: Path) -> None:
    page = report_page(im_output, "im/P0101")
    assert page["conflicts"] == [
        {"kind": "empty_replies_skipped", "detail": "1 empty replies skipped"}
    ]
    # Only the empty reply is left, so the comment block is omitted entirely.
    empty = report_page(im_output, "im/P0201")
    assert "评论" not in empty["emitted"]
    assert {"field": "comments", "param": "评论", "reason": "only_empty_replies"} in empty["omitted"]
    assert empty["conflicts"] == [
        {"kind": "empty_replies_skipped", "detail": "1 empty replies skipped"}
    ]


def test_titles_prefer_existing_pages(im_output: Path) -> None:
    assert report_page(im_output, "im/P0101")["title"] == "旧页-第一篇"
    assert report_page(im_output, "im/P0201")["title"] == "仅附件"


def test_duplicate_titles_use_the_game_id_form(im_output: Path) -> None:
    first = report_page(im_output, "im/P0301")
    second = report_page(im_output, "im/P0401")
    assert first["title"] == "重复标题"
    assert second["title"] == "重复标题（P0401）"


def test_every_emitted_parameter_is_declared_by_the_template(im_output: Path) -> None:
    catalog = json.loads(
        (ROOT / "wiki" / "snapshot" / "template_params.json").read_text("utf-8")
    )
    declared = set(catalog["templates"]["Im/帖"]["params"])
    assert len(declared) == 12

    profile = json.loads(
        (ROOT / "wiki" / "profiles" / "bili.d" / "im_posts.json").read_text("utf-8")
    )
    template = profile["templates"]["Im/帖"]
    assert set(template["param_order"]) == declared
    assert set(template["params"]) == declared
    assert set(template["fields"].values()) <= declared

    for page in read_report(im_output)["pages"]:
        if page["page_type"] != "im_post":
            continue
        assert set(page["emitted"]) <= declared, page["entity"]
        text = (im_output / page["file"]).read_text(encoding="utf-8")
        for line in text.splitlines():
            if not line.startswith("|"):
                continue
            name = line[1:].split("=", 1)[0]
            assert name in declared, page["entity"]


def test_unlock_conditions_and_charts_come_from_edges_and_locks(
    im_output: Path,
) -> None:
    text = page_text(im_output, "im/P0101")
    assert parameter(text, "解锁条件") == "Alpha达到Lv.1"
    # Only the chart whose NeedUnlock is true is granted by an edge.
    assert parameter(text, "解锁谱面") == "[[First]]（CHAOS）"
    assert parameter(text, "配图文件名") == "attach01.png"

    gated = page_text(im_output, "im/P0201")
    assert parameter(gated, "解锁条件") == "已阅读过iM贴文“[[旧页-第一篇]]”"
    targets = [link["target"] for link in report_page(im_output, "im/P0201")["links"]]
    assert "旧页-第一篇" in targets

    assert parameter(page_text(im_output, "im/P0401"), "解锁条件") == (
        "已完成剧情 story_alpha01"
    )


def test_im_page_report_omits_absent_values(im_output: Path) -> None:
    page = report_page(im_output, "im/P0201")
    reasons = {(row.get("field"), row["reason"]) for row in page["omitted"]}
    assert ("content", "text_missing") in reasons
    assert ("comments", "only_empty_replies") in reasons
    assert ("attachment", "no_attachment") in reasons
    assert ("ending_branch", "no_ending_branch") in reasons
    assert ("avatar_override", "default_avatar") in reasons
    # page_title is the renderer's title input, never a template parameter.
    assert {"field": "page_title", "reason": "no_profile_parameter"} in page["omitted"]


# ------------------------------------------------------- page-model behaviour
def build_dir_of(out: Path) -> Path:
    return out.parent / "build"


def test_ending_branch_and_avatar_override(im_output: Path) -> None:
    from cytus2db.wiki.db import Database
    from cytus2db.wiki.pages import im_posts

    db = Database.load(build_dir_of(im_output))
    good = db.entities["im_post"]["im/P0301"]
    good["story_gate"] = "story_ending03_good_ending1"
    bad = db.entities["im_post"]["im/P0401"]
    bad["story_gate"] = "story_ending03_good_ending2"
    overridden = db.entities["im_post"]["im/P0201"]
    overridden["author"] = "Alpha-Official"
    overridden["avatar"] = "alpha_alt_01"

    models = {model.entity_id: model for model in im_posts.build(db)}
    assert models["im/P0301"].field_value("ending_branch") == "GE"
    assert models["im/P0401"].field_value("ending_branch") == "BE"
    assert models["im/P0201"].field_value("avatar_override") == "alpha alt 01"
    assert models["im/P0101"].field_value("avatar_override") == ""


def test_rich_text_maps_game_markup_to_wikitext(
    im_output: Path,
) -> None:
    from cytus2db.wiki.pages import im_posts

    assert (
        im_posts._rich_text("a\n>>\nquoted\n<<\nb")
        == "a<br>{{引用段落|quoted}}<br>b"
    )
    assert (
        im_posts._rich_text(
            '>>hyperlink\n{"Content":"<color=#fff2ccff>官网</color>",'
            '"Urls":{"Editor":"https://example.com"}}\n<<hyperlink'
        )
        == "[https://example.com 官网]"
    )
    assert im_posts._rich_text("<color=red>红</color><Size=20>大</Size>") == "红大"
