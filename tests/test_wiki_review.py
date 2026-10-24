from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, ROOT, run_build, run_render
from cytus2db.errors import InputError
from cytus2db.wiki.bili import load_profile
from cytus2db.wiki.build import build_page_models
from cytus2db.wiki.db import Database
from cytus2db.wiki.review import (
    parse_batch_spec,
    render_review,
    select_pages,
)

FIXTURE_IM_OS = Path(__file__).resolve().parent / "fixtures" / "im_os"
FIXTURE_REVIEW = (
    Path(__file__).resolve().parent / "fixtures" / "wiki_review" / "snapshot"
)
PROFILE = ROOT / "wiki" / "profiles" / "bili.json"

BATCH_IDS = [
    "character/alpha001",
    "song/alpha001_000",
    "im/P0101",
    "os/gos001",
    "oa_document/alpha001_obj001_oa001",
]
BATCH_SPEC = ",".join(BATCH_IDS)

FILTER_SPEC = (
    "song/alpha001_000,song/alpha001_001,song/beta001_000,"
    "character/alpha001,im/P0101"
)

SITE_PAGES = {
    "Alpha": (
        "角色",
        {
            "角色名": "Alpha",
            "拥有系统": "im",
            "角色分类": "人工分类",
            "轶事": "人工轶事",
            "站内备注": "人工补充",
        },
    ),
    "First": (
        "歌曲",
        {
            "曲名": "First",
            "曲师": "Old Artist",
            "原文": "人工填写的旧值",
            "轶事": "人工轶事",
            "歌词": "人工歌词",
        },
    ),
    "第一篇贴文": (
        "Im/帖",
        {
            "标题": "第一篇贴文",
            "iM_ID": "Alpha-Official",
            "内容": "<poem>旧内容</poem>",
            "评论": "{{im/评论|旧评论}}",
            "全局排序": "1",
            "剧情排序": "1",
        },
    ),
    "第一个OS（Alpha）": (
        "Os/文件",
        {
            "文件名": "第一个OS",
            "所属角色": "Alpha",
            "文件ID": "gos001",
            "ver": "1.0",
            "文件类型": "cam",
            "剧情排序": "1",
            "内容": "{{os/对话|Alpha|旧对话}}",
        },
    ),
    "Alpha Doc（Alpha）": (
        "Oa/文件",
        {
            "文件名": "Alpha Doc",
            "所属角色": "Alpha",
            "所属物品": "阿尔法装置",
            "描述": "旧描述",
            "剧情排序": "1",
            "内容": "<poem>旧文件。</poem>",
        },
    ),
}


@pytest.fixture(scope="session")
def review_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("wiki_review")
    input_dir = root / "input"
    shutil.copytree(FIXTURE_INPUT, input_dir)
    shutil.copytree(FIXTURE_IM_OS / "text", input_dir / "text", dirs_exist_ok=True)
    (input_dir / "text" / "osdata" / "gamma001").replace(
        input_dir / "text" / "osdata" / "alpha001"
    )
    build_dir = root / "build"
    result = run_build(input_dir, build_dir)
    assert result.returncode == 0, result.stderr
    return build_dir


@pytest.fixture(scope="session")
def review_models(review_db: Path) -> tuple[list, object]:
    database = Database.load(review_db)
    return build_page_models(database), load_profile(PROFILE)


@pytest.fixture(scope="session")
def review_output(
    tmp_path_factory: pytest.TempPathFactory, review_db: Path
) -> Path:
    out = tmp_path_factory.mktemp("wiki_review_out")
    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--batch",
        BATCH_SPEC,
        "--batch-name",
        "example-5",
    )
    assert result.returncode == 0, result.stderr
    return out


def read_review(out: Path, name: str = "example-5") -> str:
    return (out / "review" / f"{name}.md").read_text(encoding="utf-8")


def _wikitext(template: str, params: dict[str, str]) -> str:
    lines = ["{{" + template]
    lines.extend(f"|{name}={value}" for name, value in params.items())
    lines.append("}}")
    return "\n".join(lines) + "\n[[分类:测试]]\n"


def _fake_fetcher(calls: list[dict[str, str]]):
    def fetch(api_url: str, form: dict[str, str]) -> str:
        calls.append(dict(form))
        pages = []
        for title in form["titles"].split("|"):
            template, params = SITE_PAGES[title]
            pages.append(
                {
                    "title": title,
                    "ns": 0,
                    "revisions": [
                        {"slots": {"main": {"content": _wikitext(template, params)}}}
                    ],
                }
            )
        return json.dumps({"query": {"pages": pages}}, ensure_ascii=False)

    return fetch


# ------------------------------------------------------------------ selection
def test_parse_batch_spec_reads_a_file_with_comments(tmp_path: Path) -> None:
    spec_file = tmp_path / "five-pages.txt"
    spec_file.write_text(
        "# one page per line\ncharacter/alpha001\n\nsong/alpha001_000\nim/P0101\n",
        encoding="utf-8",
    )

    spec = parse_batch_spec(str(spec_file))

    assert spec.name == "five-pages"
    assert spec.entries == (
        "character/alpha001",
        "song/alpha001_000",
        "im/P0101",
    )


def test_parse_batch_spec_accepts_inline_ids() -> None:
    spec = parse_batch_spec("character/alpha001, song/alpha001_000")

    assert spec.name == "selection"
    assert spec.entries == ("character/alpha001", "song/alpha001_000")


def test_batch_selects_by_entity_id_and_title(review_models) -> None:
    models, profile = review_models

    by_id, _ = select_pages(models, profile, parse_batch_spec(BATCH_SPEC))
    by_title, _ = select_pages(
        models,
        profile,
        parse_batch_spec("Alpha,First,第一篇贴文,第一个OS（Alpha）,Alpha Doc（Alpha）"),
    )

    assert [model.entity_id for model in by_id] == BATCH_IDS
    assert [model.entity_id for model in by_title] == BATCH_IDS


def test_batch_requires_three_to_ten_pages(review_models) -> None:
    models, profile = review_models

    with pytest.raises(InputError, match="needs 3-10"):
        select_pages(models, profile, parse_batch_spec(",".join(BATCH_IDS[:2])))

    eleven = ",".join(model.entity_id for model in models[:11])
    with pytest.raises(InputError, match="needs 3-10"):
        select_pages(models, profile, parse_batch_spec(eleven))


def test_type_filter_keeps_only_that_type_and_reports_excluded(
    review_models,
) -> None:
    models, profile = review_models

    selected, excluded = select_pages(
        models, profile, parse_batch_spec(FILTER_SPEC), page_type="song"
    )

    assert [model.entity_id for model in selected] == [
        "song/alpha001_000",
        "song/alpha001_001",
        "song/beta001_000",
    ]
    assert [model.entity_id for model in excluded] == [
        "character/alpha001",
        "im/P0101",
    ]

    with pytest.raises(InputError, match="filtered out"):
        select_pages(
            models, profile, parse_batch_spec(FILTER_SPEC), page_type="character"
        )


# ------------------------------------------------------------------ artifact
def test_batch_writes_only_the_review_file(review_output: Path) -> None:
    files = sorted(
        path.relative_to(review_output).as_posix()
        for path in review_output.rglob("*")
        if path.is_file()
    )

    assert files == ["review/example-5.md"]
    assert not (review_output / "pages").exists()
    assert not (review_output / "patches").exists()
    assert not (review_output / "report.json").exists()


def test_review_reports_title_entity_and_changed_parameters(
    review_output: Path,
) -> None:
    text = read_review(review_output)

    assert "# Wikitext 审阅批次：example-5" in text
    assert "| 1 | Alpha | `character` | `character/alpha001` | 5 | 补丁 |" in text
    assert "| 2 | First | `song` | `song/alpha001_000` | 9 | 补丁 |" in text
    assert "| 3 | 第一篇贴文 | `im_post` | `im/P0101` | 7 | 补丁 |" in text
    assert "| 4 | 第一个OS（Alpha） | `os_log` | `os/gos001` | 4 | 补丁 |" in text
    assert (
        "| 5 | Alpha Doc（Alpha） | `oa_document` "
        "| `oa_document/alpha001_obj001_oa001` | 2 | 补丁 |"
    ) in text

    # Only changed parameters appear in the diff table.
    assert "| `拥有系统` | im | im,os,oa,gallery |" in text
    assert "| `曲师` | Old Artist | Artist A |" in text
    assert "| `ver` | 1.0 | 1.4 |" in text
    assert "| `描述` | 旧描述 | 检查阿尔法。 |" in text
    assert "| `曲名` |" not in text
    assert "| `角色名` |" not in text


def test_review_includes_copyable_parameter_block_and_apply_steps(
    review_output: Path,
) -> None:
    text = read_review(review_output)

    assert "### 新参数块" in text
    assert "````wikitext\n{{角色" in text
    assert "|拥有系统=im,os,oa,gallery" in text
    assert "|曲师=Artist A" in text
    assert "````" in text
    assert "### 人工应用步骤" in text
    assert "1. 打开 https://wiki.biligame.com/cytus2/First。" in text
    assert "点击「显示预览」" in text
    assert "参数同步：example-5" in text


def test_review_marks_human_sections_and_unknown_parameters_as_preserved(
    review_output: Path,
) -> None:
    text = read_review(review_output)

    assert "`== 轶事 ==`：人工段落，本工具不写入，保留" in text
    assert "`== 歌词 ==`：人工段落，本工具不写入，保留" in text
    assert "`|轶事`：人工维护参数，保留站内原值（人工轶事）" in text
    assert "`|歌词`：人工维护参数，保留站内原值（人工歌词）" in text

    assert "站内未知参数（1 项）：保留原值" in text
    assert "`|站内备注`：人工补充（站内未知参数，保留原值）" in text
    assert "`|原文`：人工填写的旧值（站内未知参数，保留原值）" in text
    assert "模板外正文（如有）：保留" in text


def test_review_explains_omitted_parameters_and_conflicts(
    review_output: Path,
) -> None:
    text = read_review(review_output)

    assert "**省略参数（" in text
    assert "| `BPM` |  | 无可验证值（`no_verifiable_value`） |" in text
    assert "| `歌词` |  | 无可验证值；人工维护（`no_verifiable_value`） |" in text
    assert "**冲突**\n\n- 无" in text
    assert "**未知参数**" in text


def test_review_marks_unmatched_pages_as_new_without_creating_them(
    review_output: Path, review_db: Path, tmp_path: Path
) -> None:
    out = tmp_path / "unmatched"
    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--batch",
        "song/alpha001_001,song/beta001_000,character/beta001",
    )
    assert result.returncode == 0, result.stderr
    text = read_review(out, "selection")

    assert "- 站内状态：未匹配（没有可应用的补丁；本工具不创建页面）" in text
    assert "本工具不创建页面；如需新建，请人工核对上方参数块后自行创建。" in text
    assert "| 新页 |" in text


def test_review_reports_title_conflicts(
    tmp_path: Path, review_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    shutil.copytree(FIXTURE_REVIEW, snapshot)
    data = json.loads((snapshot / "pages.json").read_text(encoding="utf-8"))
    data["templates"]["Im/帖"]["pages"].append(
        {
            "title": "第一篇贴文 2",
            "params": {
                "标题": "第一篇贴文",
                "全局排序": "1",
                "剧情排序": "1",
            },
        }
    )
    (snapshot / "pages.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )

    result = render_review(
        review_db,
        tmp_path / "wiki",
        PROFILE,
        snapshot,
        "character/alpha001,song/alpha001_000,im/P0101",
        batch_name="conflict",
    )

    text = read_review(tmp_path / "wiki", "conflict")
    assert "**冲突**\n\n- `title_conflict`" in text
    assert "matches 2 existing pages" in text
    assert result["page_count"] == 3


# --------------------------------------------------------------- read-only
def test_batch_with_cache_never_calls_the_network(
    tmp_path: Path, review_db: Path
) -> None:
    calls: list[str] = []

    def forbidden(api_url: str, form: dict[str, str]) -> str:
        calls.append(api_url)
        raise AssertionError("batch mode must not fetch with a local cache")

    result = render_review(
        review_db,
        tmp_path,
        PROFILE,
        FIXTURE_REVIEW,
        BATCH_SPEC,
        batch_name="cached",
        fetcher=forbidden,
    )

    assert calls == []
    assert result["page_count"] == 5
    assert (tmp_path / "review" / "cached.md").is_file()
    assert not (tmp_path / "pages").exists()
    assert not (tmp_path / "patches").exists()


def test_missing_pages_cache_names_pages_json_and_fetch_selected(
    tmp_path: Path, review_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    shutil.copy(FIXTURE_REVIEW / "titles.json", snapshot / "titles.json")
    out = tmp_path / "wiki"

    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(snapshot),
        "--batch",
        BATCH_SPEC,
    )

    assert result.returncode == 1
    assert str(snapshot / "pages.json") in result.stderr
    assert "--fetch-selected" in result.stderr
    assert "never refreshes the whole site" in result.stderr
    assert not (out / "review").exists()


def test_fetch_selected_fetches_only_selected_pages_and_reads_only(
    tmp_path: Path, review_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    shutil.copy(FIXTURE_REVIEW / "titles.json", snapshot / "titles.json")
    calls: list[dict[str, str]] = []

    result = render_review(
        review_db,
        tmp_path / "wiki",
        PROFILE,
        snapshot,
        BATCH_SPEC,
        batch_name="fetched",
        fetch_selected=True,
        fetcher=_fake_fetcher(calls),
    )

    assert result["fetched"] is True
    assert result["page_count"] == 5
    assert len(calls) == 1
    form = calls[0]
    assert form["action"] == "query"
    assert form["prop"] == "revisions"
    assert form["redirects"] == "0"
    assert set(form["titles"].split("|")) == {
        "Alpha",
        "First",
        "第一篇贴文",
        "第一个OS（Alpha）",
        "Alpha Doc（Alpha）",
    }
    assert result["fetched_titles"] == [
        "Alpha",
        "First",
        "第一篇贴文",
        "第一个OS（Alpha）",
        "Alpha Doc（Alpha）",
    ]
    assert "action=edit" not in json.dumps(calls)

    # Only the selected pages were fetched; no snapshot cache was written.
    assert not (snapshot / "pages.json").exists()
    assert [
        path.relative_to(tmp_path / "wiki").as_posix()
        for path in (tmp_path / "wiki").rglob("*")
        if path.is_file()
    ] == ["review/fetched.md"]

    text = read_review(tmp_path / "wiki", "fetched")
    assert "按选中页面单独抓取（5 页），未刷新整站快照" in text
    # The fetched old value is still used as the diff baseline.
    assert "| `曲师` | Old Artist | Artist A |" in text


def test_fetch_selected_reports_a_page_missing_from_the_site(
    tmp_path: Path, review_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    shutil.copy(FIXTURE_REVIEW / "titles.json", snapshot / "titles.json")

    def fetcher(api_url: str, form: dict[str, str]) -> str:
        pages = []
        for title in form["titles"].split("|"):
            if title == "First":
                pages.append({"title": title, "ns": 0, "missing": True})
            elif title in SITE_PAGES:
                template, params = SITE_PAGES[title]
                pages.append(
                    {
                        "title": title,
                        "ns": 0,
                        "revisions": [
                            {
                                "slots": {
                                    "main": {"content": _wikitext(template, params)}
                                }
                            }
                        ],
                    }
                )
        return json.dumps({"query": {"pages": pages}}, ensure_ascii=False)

    result = render_review(
        review_db,
        tmp_path / "wiki",
        PROFILE,
        snapshot,
        BATCH_SPEC,
        batch_name="missing",
        fetch_selected=True,
        fetcher=fetcher,
    )

    assert result["fetched_titles"] == [
        "Alpha",
        "First",
        "第一篇贴文",
        "第一个OS（Alpha）",
        "Alpha Doc（Alpha）",
    ]
    assert result["missing"] == ["song/alpha001_000"]
    text = read_review(tmp_path / "wiki", "missing")
    assert (
        "站点未返回（按新页面处理）：`song/alpha001_000`" in text
    )


def test_cli_fetch_selected_uses_the_helper_for_selected_titles_only(
    tmp_path: Path, review_db: Path
) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    shutil.copy(FIXTURE_REVIEW / "titles.json", snapshot / "titles.json")
    calls_file = tmp_path / "calls.json"
    helper = tmp_path / "fetch_helper.py"
    site = {
        title: [template, params]
        for title, (template, params) in SITE_PAGES.items()
    }
    helper.write_text(
        "import json, sys, urllib.parse\n"
        "url = sys.argv[-1]\n"
        "form = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)\n"
        "titles = form['titles'][0].split('|')\n"
        f"site = json.loads({json.dumps(json.dumps(site, ensure_ascii=False))})\n"
        "pages = []\n"
        "for title in titles:\n"
        "    template, params = site[title]\n"
        "    body = ''.join(f'|{name}={value}\\n' for name, value in params.items())\n"
        "    content = '{{' + template + '\\n' + body + '}}\\n'\n"
        "    pages.append({'title': title, 'ns': 0, 'revisions': "
        "[{'slots': {'main': {'content': content}}}]})\n"
        f"open({json.dumps(calls_file.as_posix())}, 'w', encoding='utf-8')"
        ".write(json.dumps(titles, ensure_ascii=False))\n"
        "print(json.dumps({'query': {'pages': pages}}, ensure_ascii=False))\n",
        encoding="utf-8",
    )
    helper_command = (
        f'"{Path(sys.executable).as_posix()}" "{helper.as_posix()}"'
    )
    out = tmp_path / "wiki"

    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(snapshot),
        "--batch",
        BATCH_SPEC,
        "--batch-name",
        "fetched-cli",
        "--fetch-selected",
        "--fetch-helper",
        helper_command,
    )

    assert result.returncode == 0, result.stderr
    assert (out / "review" / "fetched-cli.md").is_file()
    assert json.loads(calls_file.read_text(encoding="utf-8")) == [
        "Alpha",
        "First",
        "第一篇贴文",
        "第一个OS（Alpha）",
        "Alpha Doc（Alpha）",
    ]
    assert not (snapshot / "pages.json").exists()


# --------------------------------------------------------------------- flags
def test_batch_requires_patches(tmp_path: Path, review_db: Path) -> None:
    result = run_render(
        review_db,
        tmp_path / "wiki",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--batch",
        BATCH_SPEC,
    )

    assert result.returncode == 2
    assert "--batch requires --patches" in result.stderr


def test_batch_flags_require_batch(tmp_path: Path, review_db: Path) -> None:
    result = run_render(
        review_db,
        tmp_path / "wiki",
        "--patches",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--type",
        "song",
    )

    assert result.returncode == 2
    assert "require --batch" in result.stderr


def test_type_filter_is_applied_to_the_review(
    tmp_path: Path, review_db: Path
) -> None:
    out = tmp_path / "typed"
    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--batch",
        FILTER_SPEC,
        "--type",
        "song",
    )

    assert result.returncode == 0, result.stderr
    assert "review batch: 3 page(s)" in result.stdout
    assert "filtered out by --type: character/alpha001" in result.stdout
    text = read_review(out, "selection")
    assert "## First" in text
    assert "## Second" in text
    assert "## Third" in text
    assert "## Alpha\n" not in text
    assert "## 第一篇贴文" not in text
    assert "已按类型过滤排除" in text


def test_batch_name_comes_from_the_selection_file(
    tmp_path: Path, review_db: Path
) -> None:
    spec_file = tmp_path / "hand-review.txt"
    spec_file.write_text(BATCH_SPEC.replace(",", "\n") + "\n", encoding="utf-8")
    out = tmp_path / "wiki"

    result = run_render(
        review_db,
        out,
        "--patches",
        "--snapshot",
        str(FIXTURE_REVIEW),
        "--batch",
        str(spec_file),
    )

    assert result.returncode == 0, result.stderr
    assert (out / "review" / "hand-review.md").is_file()
