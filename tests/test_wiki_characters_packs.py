from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import FIXTURE_INPUT, ROOT, copy_input, run_build, run_render

FIXTURE_IM_OS = Path(__file__).resolve().parent / "fixtures" / "im_os"

# The character page only emits APK-verifiable fields.  最高等级 has no entity
# in the canonical DB and stays out; IMID is the distinct iM account names that
# authored the character's own posts.
CHARACTER_PAGES = {
    "alpha001": (
        "{{角色\n"
        "|角色名=Alpha\n"
        "|拥有系统=im,os,oa,gallery\n"
        "|角色分类=免费角色\n"
        "|IMID=Alpha-Official,Alpha Side\n"
        "|主题色=112233\n"
        "|获取方式=免费\n"
        "}}\n"
        "[[分类:角色]]\n"
    ),
    "beta001": (
        "{{角色\n"
        "|角色名=Beta\n"
        "|拥有系统=im,os,oa,gallery\n"
        "|角色分类=支线角色\n"
        "|IMID=Beta\n"
        "|主题色=445566\n"
        "|获取方式=USD 1.99\n"
        "}}\n"
        "[[分类:角色]]\n"
    ),
}

PACK_PAGES = {
    "alpha001": (
        "{{曲包\n"
        "|曲包名=Alpha\n"
        "|所属角色=Alpha\n"
        "|属性=alpha\n"
        "}}\n"
        "[[分类:曲包]]\n"
    ),
    "beta001": (
        "{{曲包\n"
        "|曲包名=Beta\n"
        "|所属角色=Beta\n"
        "|属性=beta\n"
        "}}\n"
        "[[分类:曲包]]\n"
    ),
}


def build_input(root: Path) -> Path:
    input_dir = root / "input"
    copy_input(FIXTURE_INPUT, input_dir)
    shutil.copytree(FIXTURE_IM_OS / "text", input_dir / "text", dirs_exist_ok=True)
    # The OS fixture file is named after a character; keep the site's
    # "<file>（<character>）" page-title rule working.
    (input_dir / "text" / "osdata" / "gamma001").replace(
        input_dir / "text" / "osdata" / "alpha001"
    )
    return input_dir


def render(input_dir: Path, root: Path) -> Path:
    build_dir = root / "build"
    result = run_build(input_dir, build_dir)
    assert result.returncode == 0, result.stderr
    out = root / "wiki"
    result = run_render(build_dir, out)
    assert result.returncode == 0, result.stderr
    return out


@pytest.fixture(scope="session")
def character_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("character_pages")
    return render(build_input(root), root)


def read_report(out: Path) -> dict:
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def report_pages(out: Path, page_type: str) -> list[dict]:
    return [
        page for page in read_report(out)["pages"] if page["page_type"] == page_type
    ]


def report_page(out: Path, entity: str) -> dict:
    pages = {page["entity"]: page for page in read_report(out)["pages"]}
    return pages[entity]


def profile_template(template: str) -> dict:
    sources = [
        ROOT / "wiki" / "profiles" / "bili.json",
        *sorted((ROOT / "wiki" / "profiles" / "bili.d").glob("*.json")),
    ]
    merged: dict = {}
    for path in sources:
        data = json.loads(path.read_text(encoding="utf-8"))
        merged = _deep_merge(merged, data)
    return merged["templates"][template]


def _deep_merge(base: dict, overlay: dict) -> dict:
    result = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


@pytest.mark.parametrize("game_id", sorted(CHARACTER_PAGES))
def test_golden_character_pages(character_output: Path, game_id: str) -> None:
    path = character_output / "pages" / "character" / f"{game_id}.wikitext"
    assert path.read_text(encoding="utf-8") == CHARACTER_PAGES[game_id]


@pytest.mark.parametrize("game_id", sorted(PACK_PAGES))
def test_golden_pack_pages(character_output: Path, game_id: str) -> None:
    path = character_output / "pages" / "pack" / f"{game_id}.wikitext"
    assert path.read_text(encoding="utf-8") == PACK_PAGES[game_id]


def test_every_character_page_has_data_derived_systems(character_output: Path) -> None:
    pages = report_pages(character_output, "character")
    assert len(pages) == 2
    for page in pages:
        text = (character_output / page["file"]).read_text(encoding="utf-8")
        emitted = dict(
            line[1:].split("=", 1)
            for line in text.splitlines()
            if line.startswith("|") and "=" in line
        )
        systems = emitted.get("拥有系统", "")
        assert systems, page["entity"]
        assert set(systems.split(",")) <= {"im", "os", "oa", "gallery"}


def test_every_emitted_parameter_exists_in_the_profile(character_output: Path) -> None:
    pages = [
        *report_pages(character_output, "character"),
        *report_pages(character_output, "pack"),
    ]
    for page in pages:
        template = profile_template(page["template"])
        assert set(page["emitted"]) <= set(template["params"]), page["entity"]
        required = {
            name
            for name, meta in template["params"].items()
            if meta.get("required")
        }
        assert required <= set(page["emitted"]), page["entity"]


def test_character_page_omits_unverifiable_fields(character_output: Path) -> None:
    page = report_page(character_output, "character/alpha001")
    omitted = {item.get("param"): item["reason"] for item in page["omitted"]}
    assert omitted["最高等级"] == "exp_table_not_extracted"
    assert omitted["角色排序"] == "no_verifiable_value"
    assert omitted["简介"] == "no_verifiable_value"
    text = (character_output / page["file"]).read_text(encoding="utf-8")
    assert "|最高等级=\n" not in text
    assert "|简介=\n" not in text


def test_pack_titles_stay_distinct_from_character_titles(character_output: Path) -> None:
    report = read_report(character_output)
    titles = [page["title"] for page in report["pages"]]
    assert len(titles) == len(set(titles))
    assert report_page(character_output, "character/alpha001")["title"] == "Alpha"
    assert report_page(character_output, "pack/alpha001")["title"] == "Alpha（曲包）"


def test_systems_follow_the_entities(tmp_path: Path) -> None:
    input_dir = build_input(tmp_path)
    text_dir = input_dir / "text"

    folders = json.loads((text_dir / "gallerydata" / "folder").read_text("utf-8"))
    (text_dir / "gallerydata" / "folder").write_text(
        json.dumps([row for row in folders if row["Id"] != "beta001"]),
        encoding="utf-8",
    )
    oa_path = text_dir / "oasystemdata" / "oa_system_data"
    oa = json.loads(oa_path.read_text("utf-8"))
    for key, rows in oa.items():
        oa[key] = [
            row for row in rows if row.get("CharacterId") not in (None, "beta001")
        ]
    oa_path.write_text(json.dumps(oa), encoding="utf-8")

    out = render(input_dir, tmp_path)
    page = report_page(out, "character/beta001")
    text = (out / page["file"]).read_text(encoding="utf-8")
    assert "|拥有系统=im,os\n" in text
    assert "|拥有系统=im,os,oa,gallery\n" not in text


def test_character_title_avoids_a_same_named_song(tmp_path: Path) -> None:
    input_dir = build_input(tmp_path)
    path = input_dir / "text" / "song_pack_data"
    catalog = json.loads(path.read_text("utf-8"))
    catalog["offline_song_pack_list"][0]["song_info_list"][0][
        "song_name"
    ] = "Alpha"
    path.write_text(json.dumps(catalog), encoding="utf-8")

    out = render(input_dir, tmp_path)
    assert report_page(out, "character/alpha001")["title"] == "Alpha（角色）"
    assert report_page(out, "song/alpha001_000")["title"] == "Alpha"
