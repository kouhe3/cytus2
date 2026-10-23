"""Fixture tests for ``python -m cytus2db verify``.

Every test uses synthetic rendered artifacts.  The live-render tests inject a
fetcher; no test touches the network or the Edge/CDP helper.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from cytus2db.verify import verify_wiki

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
PROFILE = ROOT / "wiki" / "profiles" / "bili.json"
SNAPSHOT = Path(__file__).resolve().parent / "fixtures" / "wiki_patches" / "snapshot"

CHARACTER_PAGE = (
    "{{角色\n"
    "|角色名=Alpha New\n"
    "|拥有系统=Cytus II\n"
    "}}\n"
    "[[分类:角色]]\n"
)


def run_verify(
    wiki: Path, *extra: str, snapshot: Path = SNAPSHOT
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(TOOLS) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "cytus2db",
            "verify",
            "--wiki",
            str(wiki),
            "--profile",
            str(PROFILE),
            "--snapshot",
            str(snapshot),
            *extra,
        ],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def page_entry(
    entity: str,
    page_type: str,
    title: str,
    template: str,
    *,
    file: str | None = None,
    patch: str | None = None,
    matched: bool = False,
    emitted: tuple[str, ...] = (),
    omitted: tuple[dict, ...] = (),
    conflicts: tuple[dict, ...] = (),
    title_source: str = "generated",
) -> dict:
    return {
        "entity": entity,
        "page_type": page_type,
        "title": title,
        "title_source": title_source,
        "template": template,
        "matched": matched,
        "file": file,
        "patch": patch,
        "categories": [],
        "emitted": list(emitted),
        "omitted": list(omitted),
        "conflicts": list(conflicts),
        "links": [],
    }


def write_wiki(
    root: Path,
    entries: list[dict],
    pages: dict[str, str] | None = None,
    patches: dict[str, dict] | None = None,
) -> Path:
    wiki = root / "wiki"
    (wiki / "pages").mkdir(parents=True, exist_ok=True)
    (wiki / "patches").mkdir(parents=True, exist_ok=True)
    for relative, text in (pages or {}).items():
        path = wiki / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    for relative, data in (patches or {}).items():
        path = wiki / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["page_type"]] = counts.get(entry["page_type"], 0) + 1
    report = {
        "profile": str(PROFILE),
        "db": "fixture",
        "page_count": len(entries),
        "counts": dict(sorted(counts.items())),
        "pages": entries,
    }
    (wiki / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return wiki


def read_report(wiki: Path) -> dict:
    return json.loads((wiki / "verify.json").read_text(encoding="utf-8"))


def single_page_wiki(
    root: Path, page_text: str, *, emitted: tuple[str, ...], **kwargs
) -> Path:
    entry = page_entry(
        "character/alpha_new",
        "character",
        "Alpha New",
        "角色",
        file="pages/character/alpha_new.wikitext",
        emitted=emitted,
        **kwargs,
    )
    return write_wiki(
        root,
        [entry],
        {"pages/character/alpha_new.wikitext": page_text},
    )


# --------------------------------------------------------------- offline tests
def test_clean_artifacts_pass(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )

    result = run_verify(wiki)

    assert result.returncode == 0, result.stdout + result.stderr
    report = read_report(wiki)
    assert report["ok"] is True
    assert report["counts"] == {
        **report["counts"],
        "unknown_params": 0,
        "missing_required": 0,
        "red_links": 0,
        "category_failures": 0,
    }
    page = report["pages"][0]
    assert page["emitted"] == ["角色名", "拥有系统"]
    assert page["omitted"] == []
    assert page["title_source"] == "generated"
    assert page["conflicts"] == []
    assert page["ok"] is True
    assert set(page["checks"]) == {
        "report",
        "template_params",
        "required_params",
        "conditional_params",
        "patch_target",
        "patch_diff",
        "page_output",
        "category",
        "links",
    }
    assert "verification report" in result.stdout


def test_unknown_parameter_fails(tmp_path: Path) -> None:
    page_text = CHARACTER_PAGE.replace(
        "|拥有系统=Cytus II\n", "|拥有系统=Cytus II\n|NotAParameter=1\n"
    )
    wiki = single_page_wiki(
        tmp_path,
        page_text,
        emitted=("角色名", "拥有系统", "NotAParameter"),
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["ok"] is False
    assert report["counts"]["unknown_params"] == 1
    assert "NotAParameter" in result.stdout


def test_missing_required_parameter_fails(tmp_path: Path) -> None:
    page_text = CHARACTER_PAGE.replace("|拥有系统=Cytus II\n", "")
    wiki = single_page_wiki(
        tmp_path,
        page_text,
        emitted=("角色名",),
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["missing_required"] == 1
    assert report["pages"][0]["checks"]["required_params"]["ok"] is False
    assert "拥有系统" in result.stdout


def test_red_link_fails_and_is_reported(tmp_path: Path) -> None:
    page_text = CHARACTER_PAGE + "[[Missing Page]]\n"
    wiki = single_page_wiki(
        tmp_path,
        page_text,
        emitted=("角色名", "拥有系统"),
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["red_links"] == 1
    assert report["counts"]["red_link_targets"] == 1
    assert report["red_links"] == [
        {
            "target": "Missing Page",
            "count": 1,
            "sources": ["character/alpha_new"],
        }
    ]
    assert "Missing Page" in result.stdout


def test_missing_category_fails(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE.replace("[[分类:角色]]\n", ""),
        emitted=("角色名", "拥有系统"),
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["category_failures"] == 1
    assert report["pages"][0]["checks"]["category"]["ok"] is False
    assert "分类:角色" in result.stdout


def test_patch_targeting_a_missing_title_fails(tmp_path: Path) -> None:
    entry = page_entry(
        "character/ghost",
        "character",
        "Ghost",
        "角色",
        patch="patches/character/ghost.json",
        matched=True,
        emitted=("角色名", "拥有系统"),
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        patches={
            "patches/character/ghost.json": {
                "title": "Ghost",
                "template": "角色",
                "params": {"角色名": "Ghost"},
                "page_exists": True,
            }
        },
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["patch_target_missing"] == 1
    assert report["pages"][0]["checks"]["patch_target"]["details"]["status"] == "missing"
    assert "does not exist" in result.stdout or "does not exist" in result.stderr


def test_patch_must_only_contain_differing_parameters(tmp_path: Path) -> None:
    entry = page_entry(
        "character/alpha",
        "character",
        "Alpha",
        "角色",
        patch="patches/character/alpha.json",
        matched=True,
        emitted=("角色名", "拥有系统"),
        title_source="snapshot",
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        patches={
            "patches/character/alpha.json": {
                "title": "Alpha",
                "template": "角色",
                "params": {"角色名": "Alpha"},
                "page_exists": True,
            }
        },
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["patch_non_differing"] == 1
    assert report["pages"][0]["checks"]["patch_diff"]["ok"] is False
    assert "equals the existing snapshot value" in result.stdout


def test_patch_with_a_real_difference_passes(tmp_path: Path) -> None:
    entry = page_entry(
        "character/alpha",
        "character",
        "Alpha",
        "角色",
        patch="patches/character/alpha.json",
        matched=True,
        emitted=("角色名", "拥有系统", "角色分类"),
        title_source="snapshot",
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        patches={
            "patches/character/alpha.json": {
                "title": "Alpha",
                "template": "角色",
                "params": {"角色分类": "Generated"},
                "page_exists": True,
            }
        },
    )

    result = run_verify(wiki)

    assert result.returncode == 0, result.stdout + result.stderr
    report = read_report(wiki)
    assert report["counts"]["patches"] == 1
    assert report["counts"]["patch_non_differing"] == 0
    assert report["pages"][0]["checks"]["patch_diff"]["ok"] is True


def test_links_to_redirects_resolve_and_ignored_links_are_counted(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "snapshot"
    shutil.copytree(SNAPSHOT, snapshot)
    titles = json.loads((snapshot / "titles.json").read_text(encoding="utf-8"))
    titles["articles"] = ["Alpha"]
    titles["redirects"] = ["Beta"]
    titles["counts"] = {"articles": 1, "redirects": 1, "total": 2}
    (snapshot / "titles.json").write_text(
        json.dumps(titles, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    page_text = (
        CHARACTER_PAGE
        + "[[Beta]]\n"
        + "[[File:Alpha.png]]\n"
        + "[[Category:角色]]\n"
        + "[[https://example.invalid/page]]\n"
        + "[[#Section]]\n"
    )
    wiki = single_page_wiki(
        tmp_path,
        page_text,
        emitted=("角色名", "拥有系统"),
    )

    result = run_verify(wiki, snapshot=snapshot)

    assert result.returncode == 0, result.stdout + result.stderr
    report = read_report(wiki)
    assert report["counts"]["links_redirects"] == 1
    assert report["counts"]["red_links"] == 0
    assert report["counts"]["ignored_file_links"] == 1
    assert report["counts"]["ignored_category_links"] == 2
    assert report["counts"]["ignored_external_links"] == 1
    assert report["counts"]["ignored_anchor_links"] == 1


def test_conditional_parameter_omission_reason_is_checked(tmp_path: Path) -> None:
    page_text = (
        "{{歌曲\n"
        "|曲名=Conditional Song\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    )
    omitted = (
        {"param": "曲绘", "reason": "no_verifiable_value"},
        {"param": "曲绘版本", "reason": "conditional_omitted"},
        {"param": "曲绘文件", "reason": "conditional_omitted"},
    )
    entry = page_entry(
        "song/conditional",
        "song",
        "Conditional Song",
        "歌曲",
        file="pages/song/conditional.wikitext",
        emitted=("曲名",),
        omitted=omitted,
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        {"pages/song/conditional.wikitext": page_text},
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["conditional_violations"] == 1
    assert report["pages"][0]["checks"]["conditional_params"]["ok"] is False
    assert "conditional_omitted" in result.stdout


def test_conditional_parameters_honour_the_profile(tmp_path: Path) -> None:
    page_text = (
        "{{歌曲\n"
        "|曲名=Conditional Song\n"
        "}}\n"
        "[[分类:歌曲]]\n"
    )
    entry = page_entry(
        "song/conditional",
        "song",
        "Conditional Song",
        "歌曲",
        file="pages/song/conditional.wikitext",
        emitted=("曲名",),
        omitted=(
            {"param": "曲绘", "reason": "conditional_omitted"},
            {"param": "曲绘版本", "reason": "conditional_omitted"},
            {"param": "曲绘文件", "reason": "conditional_omitted"},
        ),
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        {"pages/song/conditional.wikitext": page_text},
    )

    result = run_verify(wiki)

    assert result.returncode == 0, result.stdout + result.stderr
    report = read_report(wiki)
    assert report["counts"]["conditional_violations"] == 0
    assert report["pages"][0]["checks"]["conditional_params"]["ok"] is True


def test_patch_unknown_parameter_fails(tmp_path: Path) -> None:
    entry = page_entry(
        "character/alpha",
        "character",
        "Alpha",
        "角色",
        patch="patches/character/alpha.json",
        matched=True,
        emitted=("角色名", "拥有系统", "Bogus"),
        title_source="snapshot",
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        patches={
            "patches/character/alpha.json": {
                "title": "Alpha",
                "template": "角色",
                "params": {"Bogus": "x"},
                "page_exists": True,
            }
        },
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["counts"]["unknown_params"] == 1
    assert report["counts"]["patch_unknown_params"] == 1
    assert report["pages"][0]["checks"]["template_params"]["ok"] is False


def test_full_page_for_an_existing_title_fails(tmp_path: Path) -> None:
    entry = page_entry(
        "character/alpha",
        "character",
        "Alpha",
        "角色",
        file="pages/character/alpha.wikitext",
        matched=False,
        emitted=("角色名", "拥有系统"),
    )
    wiki = write_wiki(
        tmp_path,
        [entry],
        {"pages/character/alpha.wikitext": CHARACTER_PAGE},
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["pages"][0]["checks"]["page_output"]["ok"] is False
    assert "existing title" in result.stdout


def test_orphan_artifact_fails(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )
    (wiki / "pages" / "character" / "stale.wikitext").write_text(
        "{{角色\n|角色名=Stale\n}}\n", encoding="utf-8"
    )

    result = run_verify(wiki)

    assert result.returncode == 1
    report = read_report(wiki)
    assert report["checks"]["artifacts"] is False
    assert report["counts"]["orphan_files"] == 1


# ----------------------------------------------------------------- live tests
def _clean_fetcher(api_url: str, form: dict) -> str:
    assert form["action"] == "parse"
    assert form["contentmodel"] == "wikitext"
    return json.dumps({"parse": {"text": "<p>rendered</p>"}})


def test_live_clean_render_passes(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )

    report = verify_wiki(
        wiki,
        PROFILE,
        SNAPSHOT,
        live=True,
        live_api="https://example.invalid/api.php",
        fetcher=_clean_fetcher,
    )

    assert report["ok"] is True
    assert report["live"]["enabled"] is True
    assert report["live"]["checked"] == 1
    assert report["live"]["failures"] == 0
    assert report["pages"][0]["checks"]["live"]["ok"] is True


def test_live_template_error_marker_fails(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )

    def error_fetcher(api_url: str, form: dict) -> str:
        return json.dumps(
            {
                "parse": {
                    "text": '<strong class="error">脚本错误：bad template</strong>'
                }
            }
        )

    report = verify_wiki(
        wiki,
        PROFILE,
        SNAPSHOT,
        live=True,
        live_api="https://example.invalid/api.php",
        fetcher=error_fetcher,
    )

    assert report["ok"] is False
    assert report["checks"]["live"] is False
    assert report["live"]["failures"] == 1
    details = report["pages"][0]["checks"]["live"]
    assert details["ok"] is False
    assert any(
        marker["marker"] == "class_error" for marker in details["details"]["markers"]
    )


def test_live_fetch_error_is_reported(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )

    def broken_fetcher(api_url: str, form: dict) -> str:
        raise RuntimeError("network down")

    report = verify_wiki(
        wiki,
        PROFILE,
        SNAPSHOT,
        live=True,
        live_api="https://example.invalid/api.php",
        fetcher=broken_fetcher,
    )

    assert report["ok"] is False
    assert report["checks"]["live"] is False
    details = report["pages"][0]["checks"]["live"]
    assert details["ok"] is False
    assert "network down" in details["errors"][0]


def test_offline_default_never_calls_the_fetcher(tmp_path: Path) -> None:
    wiki = single_page_wiki(
        tmp_path,
        CHARACTER_PAGE,
        emitted=("角色名", "拥有系统"),
    )

    def refusing_fetcher(api_url: str, form: dict) -> str:
        raise AssertionError("offline verification must not use the network")

    report = verify_wiki(
        wiki,
        PROFILE,
        SNAPSHOT,
        fetcher=refusing_fetcher,
    )

    assert report["ok"] is True
    assert report["checks"]["live"] is None
    assert report["live"] == {"enabled": False}


@pytest.mark.parametrize("entry_name", ["clean", "unknown"])
def test_cli_exit_codes(tmp_path: Path, entry_name: str) -> None:
    if entry_name == "clean":
        wiki = single_page_wiki(
            tmp_path,
            CHARACTER_PAGE,
            emitted=("角色名", "拥有系统"),
        )
        expected = 0
    else:
        page_text = CHARACTER_PAGE.replace(
            "|拥有系统=Cytus II\n", "|拥有系统=Cytus II\n|Bogus=1\n"
        )
        wiki = single_page_wiki(
            tmp_path,
            page_text,
            emitted=("角色名", "拥有系统", "Bogus"),
        )
        expected = 1

    result = run_verify(wiki)

    assert result.returncode == expected, result.stdout + result.stderr
