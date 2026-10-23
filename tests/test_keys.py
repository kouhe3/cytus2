from __future__ import annotations

import pytest

from cytus2db.keys import DIFFICULTIES, asset_key, chart_key, entity_key, slug, song_key


def test_difficulty_enum_is_the_seven_game_values() -> None:
    assert DIFFICULTIES == ("Easy", "Hard", "Chaos", "Glitch", "Crash", "Dream", "Drop")


def test_song_and_chart_keys() -> None:
    assert song_key("paff001_016") == "song/paff001_016"
    assert chart_key("paff001_016", "Glitch") == "song/paff001_016@Glitch"


@pytest.mark.parametrize("difficulty", ["0", "2", "Expert", "easy", ""])
def test_chart_key_rejects_non_enum_difficulty(difficulty: str) -> None:
    with pytest.raises(ValueError):
        chart_key("paff001_016", difficulty)


def test_entity_and_asset_keys() -> None:
    assert entity_key("pack", "paff001") == "pack/paff001"
    assert asset_key("image", "aios0301") == "asset/image/aios0301"
    assert asset_key("audio", "Kaori Singing") == "asset/audio/Kaori%20Singing"


def test_slug_is_stable_and_avoids_slashes() -> None:
    assert slug("Crystal PuNK") == "crystal-punk"
    assert slug("Ivy & Vanessa") == "ivy-vanessa"
    assert slug("Ilka_1") == "ilka-1"
    assert slug("N/A") == "n-a"
    with pytest.raises(ValueError):
        slug("///")
