"""Unit tests for the shared title normalisation (ticket #20)."""

from __future__ import annotations

from pathlib import Path

from cytus2db.wiki.bili import RenderedPage, TitleMatch, load_profile, render_page
from cytus2db.wiki.model import SEMANTIC_TEMPLATE, Field, Link, PageModel, Section, Text
from cytus2db.wiki.patches import (
    PatchPage,
    Snapshot,
    SnapshotPage,
    match_pages,
    plan_patches,
)
from cytus2db.wiki.titles import TitleResolver, match_key, normalise_title

ROOT = Path(__file__).resolve().parents[1]


# ------------------------------------------------------------------ title key
def test_first_letter_is_case_insensitive_but_the_rest_is_not() -> None:
    assert normalise_title("illMenate") == normalise_title("IllMenate")
    assert normalise_title("Bring the light") != normalise_title("Bring the Light")
    # NEKO and Neko are two real character pages; only the first letter folds.
    assert normalise_title("Neko") != normalise_title("NEKO")
    assert normalise_title("neko") == normalise_title("Neko")


def test_underscores_are_mediawiki_spaces() -> None:
    assert normalise_title("Audio_Baro03_702_12_20") == normalise_title(
        "Audio Baro03 702 12 20"
    )
    assert normalise_title("A__B") == normalise_title("A B")


def test_nfkc_folds_full_width_letters_and_roman_numerals() -> None:
    assert normalise_title("ＶＯＥＺ Collection Ⅰ") == normalise_title(
        "VOEZ Collection I"
    )
    assert normalise_title("ＣＯＤＥ：ＲＥＤ") == normalise_title("CODE:RED")


def test_full_width_parentheses_are_equivalent() -> None:
    assert normalise_title("バステット（Cytus II Edit）") == normalise_title(
        "バステット(Cytus II Edit)"
    )
    assert normalise_title("Baptism of Fire （CliqTrack remix）") == normalise_title(
        "Baptism of Fire(CliqTrack remix)"
    )


def test_parenthesis_spacing_and_dash_variants() -> None:
    assert normalise_title("Baptism of Fire (CliqTrack remix)") == normalise_title(
        "Baptism of Fire(CliqTrack remix)"
    )
    assert normalise_title("VOEZ Collection I–VII") == normalise_title(
        "VOEZ Collection I-VII"
    )
    assert normalise_title("Renewal − version") == normalise_title("Renewal - version")


def test_colon_variants() -> None:
    assert normalise_title("Re：boot") == normalise_title("Re:boot")
    assert normalise_title("Re：The END -再-") == normalise_title("Re:The END -再-")


def test_cjk_whitespace_is_insignificant() -> None:
    assert normalise_title("CyTus 流量年度报告") == normalise_title(
        "CyTus流量年度报告"
    )
    assert normalise_title(
        "Æsir-FEST 损毁资料修复进度......80%"
    ) == normalise_title("Æsir-FEST损毁资料修复进度......80%")


def test_match_key_folds_the_looser_variants() -> None:
    # Case anywhere.
    assert match_key("Bring the light") == match_key("Bring the Light")
    assert match_key("Hunted") == match_key("HUNTED")
    assert match_key("Concentric circles") == match_key("Concentric Circles")
    # Decorative slashes and star glyphs.
    assert match_key("CHAOS //System Offline//") == match_key("CHAOS System Offline")
    assert match_key("V. //System Offline//") == match_key("V. System Offline")
    assert match_key("Mirai (Prod. ☆Taku Takahashi)") == match_key(
        "Mirai (Prod. ✰Taku Takahashi)"
    )


# -------------------------------------------------------------------- resolver
def test_resolver_returns_the_site_spelling() -> None:
    resolver = TitleResolver.from_titles(
        [
            "IllMenate",
            "Bring the Light",
            "Baptism of Fire(CliqTrack remix)",
            "バステット(Cytus II Edit)",
            "Re：boot",
        ]
    )

    assert resolver.resolve("illMenate") == "IllMenate"
    assert resolver.resolve("Bring the light") == "Bring the Light"
    assert resolver.resolve("Baptism of Fire (CliqTrack remix)") == (
        "Baptism of Fire(CliqTrack remix)"
    )
    assert resolver.resolve("バステット（Cytus II Edit）") == "バステット(Cytus II Edit)"
    assert resolver.resolve("Re:boot") == "Re：boot"


def test_resolver_never_guesses_between_case_variants() -> None:
    resolver = TitleResolver.from_titles(["NEKO", "Neko"])

    # Strict MediaWiki keys still resolve; only the loose fallback is withheld.
    assert resolver.resolve("neko") == "Neko"
    assert resolver.resolve("neKo") == "neKo"


def test_resolver_maps_a_generated_variant_to_the_matched_page() -> None:
    resolver = TitleResolver.from_titles(["Audio Baro03 702 12 20（NEKO）"])
    resolver.add_generated(
        "Audio_Baro03_702_12_20（NEKO#ΦωΦ）",
        "Audio Baro03 702 12 20（NEKO）",
    )

    assert (
        resolver.resolve("Audio_Baro03_702_12_20（NEKO#ΦωΦ）")
        == "Audio Baro03 702 12 20（NEKO）"
    )
    assert resolver.is_known("Audio_Baro03_702_12_20（NEKO#ΦωΦ）") is True


def test_resolver_leaves_unknown_targets_alone() -> None:
    resolver = TitleResolver.from_titles(["IllMenate"])

    assert resolver.resolve("VOEZ Collection I") == "VOEZ Collection I"
    assert resolver.is_known("VOEZ Collection I") is False


# ------------------------------------------------------------------- matching
def song_page(title: str, **params: str) -> PatchPage:
    return PatchPage(
        entity_id="song/paff002_004",
        page_type="song",
        template="歌曲",
        title=title,
        params={"曲名": title, **params},
    )


def test_illmenate_matches_the_existing_illmenate_page() -> None:
    snapshot = Snapshot(
        articles=frozenset({"IllMenate"}),
        pages=(SnapshotPage("IllMenate", "歌曲", {"曲名": "IllMenate"}),),
    )

    match = match_pages([song_page("illMenate")], snapshot)["song/paff002_004"]

    assert match.matched is True
    assert match.keep_page is False
    assert match.title == "IllMenate"
    assert match.source == "snapshot"


def test_bring_the_light_matches_case_insensitively() -> None:
    snapshot = Snapshot(
        articles=frozenset({"Bring the Light"}),
        pages=(SnapshotPage("Bring the Light", "歌曲", {"曲名": "Bring the Light"}),),
    )

    match = match_pages([song_page("Bring the light")], snapshot)[
        "song/paff002_004"
    ]

    assert match.matched is True
    assert match.title == "Bring the Light"
    assert match.source == "snapshot:normalised"


def test_baptism_parenthesis_spacing_matches_the_site_title() -> None:
    snapshot = Snapshot(
        articles=frozenset({"Baptism of Fire(CliqTrack remix)"}),
        pages=(
            SnapshotPage(
                "Baptism of Fire(CliqTrack remix)",
                "歌曲",
                {"曲名": "Baptism of Fire(CliqTrack remix)"},
            ),
        ),
    )

    match = match_pages(
        [song_page("Baptism of Fire (CliqTrack remix)")], snapshot
    )["song/paff002_004"]

    assert match.matched is True
    assert match.title == "Baptism of Fire(CliqTrack remix)"


def test_full_width_parentheses_match_without_a_patch_key() -> None:
    snapshot = Snapshot(
        articles=frozenset({"バステット(Cytus II Edit)"}),
        pages=(
            SnapshotPage(
                "バステット(Cytus II Edit)",
                "歌曲",
                {"曲名": "バステット(Cytus II Edit)"},
            ),
        ),
    )

    match = match_pages(
        [song_page("バステット（Cytus II Edit）")], snapshot
    )["song/paff002_004"]

    assert match.matched is True
    assert match.title == "バステット(Cytus II Edit)"


def test_underscore_and_space_filename_keys_match() -> None:
    snapshot = Snapshot(
        articles=frozenset({"Audio Baro03 702 12 20（NEKO）"}),
        pages=(
            SnapshotPage(
                "Audio Baro03 702 12 20（NEKO）",
                "Os/文件",
                {"文件名": "Audio_Baro03_702_12_20", "所属角色": "NEKO#ΦωΦ"},
            ),
        ),
    )
    page = PatchPage(
        "os_log/nos035",
        "os_log",
        "Os/文件",
        "Audio Baro03 702 12 20（NEKO#ΦωΦ）",
        {"文件名": "Audio Baro03 702 12 20", "所属角色": "NEKO#ΦωΦ"},
    )

    match = match_pages([page], snapshot)["os_log/nos035"]

    assert match.matched is True
    assert match.title == "Audio Baro03 702 12 20（NEKO）"
    assert match.source == "snapshot"


def test_a_full_page_never_overwrites_a_normalised_title() -> None:
    snapshot = Snapshot(articles=frozenset({"IllMenate"}), pages=())

    entry = plan_patches([song_page("illMenate")], snapshot)["song/paff002_004"]

    assert entry.patch is None
    assert entry.keep_page is False
    assert any(
        conflict.kind == "existing_title_without_match"
        for conflict in entry.match.conflicts
    )


# ------------------------------------------------------------------- renderer
def render_link_page(target: str, label: str = "") -> str:
    field = Field("unlock_method", Text.of("解锁：", Link(target, label)))
    return render_page_model(field).wikitext


def render_page_model(field: Field) -> RenderedPage:
    model = PageModel(
        entity_id="song/paff002_004",
        page_type="song",
        sections=(
            Section(
                SEMANTIC_TEMPLATE,
                (Field("title", Text.of("Bring the light")), field),
            ),
        ),
    )
    resolver = TitleResolver.from_titles(["Bring the Light"])
    return render_page(
        model,
        load_profile(ROOT / "wiki" / "profiles" / "bili.json"),
        TitleMatch("Bring the light", "generated"),
        resolver,
    )


def test_renderer_emits_the_snapshot_spelling() -> None:
    text = render_link_page("Bring the light")

    assert "[[Bring the Light]]" in text
    assert "[[Bring the light]]" not in text


def test_renderer_keeps_an_explicit_label() -> None:
    text = render_link_page("Bring the light", "自定义标签")

    assert "[[Bring the Light|自定义标签]]" in text


def test_renderer_canonicalises_literal_wikitext_links() -> None:
    page = render_page_model(
        Field("unlock_method", Text.of("[[Bring_the_light]]（Easy）"))
    )

    assert "[[Bring the Light]]（Easy）" in page.wikitext
    assert page.unresolved_links == ()


def test_renderer_reports_unresolved_literal_links() -> None:
    page = render_page_model(
        Field("unlock_method", Text.of("[[VOEZ Collection I]]"))
    )

    assert "[[VOEZ Collection I]]" in page.wikitext
    assert page.unresolved_links == ("VOEZ Collection I",)


def test_renderer_leaves_file_and_category_links_alone() -> None:
    page = render_page_model(
        Field(
            "unlock_method",
            Text.of("[[File:cover.png|thumb]] [[Category:Songs]]"),
        )
    )

    assert "[[File:cover.png|thumb]]" in page.wikitext
    assert "[[Category:Songs]]" in page.wikitext
    assert page.unresolved_links == ()
