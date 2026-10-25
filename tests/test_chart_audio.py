from __future__ import annotations

from cytus2db.entities import song_and_charts


def _raw_song(music_ids: dict[str, str]) -> dict[str, object]:
    return {
        "song_id": "alpha001_000",
        "song_name": "Alpha",
        "artist": "Tester",
        "charts": {
            difficulty: {
                "Level": str(index + 1),
                "MusicID": music_id,
                "NeedUnlock": True,
            }
            for index, (difficulty, music_id) in enumerate(music_ids.items())
        },
    }


AUDIO = {
    "alpha001_000": {
        "alpha001_000": 120.0,
        "alpha001_000_0": 80.57,
        "alpha001_000_1": 67.71,
        "alpha001_000_2": 138.87,
    }
}


def test_chart_duration_comes_from_its_own_music_id() -> None:
    _, charts = song_and_charts(
        _raw_song({"Easy": "alpha001_000_0", "Hard": "alpha001_000_1", "Chaos": "alpha001_000_2"}),
        "alpha001",
        "test.song",
        audio_lengths=AUDIO,
    )

    durations = {chart["difficulty"]: chart["duration_seconds"] for chart in charts}
    assert durations == {"Easy": 80.57, "Hard": 67.71, "Chaos": 138.87}


def test_chart_without_music_id_uses_the_song_audio() -> None:
    _, charts = song_and_charts(
        _raw_song({"Easy": "", "Chaos": "alpha001_000_2"}),
        "alpha001",
        "test.song",
        audio_lengths=AUDIO,
    )

    by_difficulty = {chart["difficulty"]: chart for chart in charts}
    assert by_difficulty["Easy"]["duration_seconds"] == 120.0
    assert by_difficulty["Chaos"]["duration_seconds"] == 138.87


def test_unknown_audio_is_omitted_not_guessed() -> None:
    _, charts = song_and_charts(
        _raw_song({"Easy": "missing_track"}),
        "alpha001",
        "test.song",
        audio_lengths=AUDIO,
    )

    assert "duration_seconds" not in charts[0]


def test_duration_is_optional_without_bundles() -> None:
    _, charts = song_and_charts(
        _raw_song({"Easy": "alpha001_000_0"}),
        "alpha001",
        "test.song",
        audio_lengths={},
    )

    assert "duration_seconds" not in charts[0]
