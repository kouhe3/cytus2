"""Read the locally unpacked game inputs.

Real runs read from ``$CYTUS2_WORK`` (``--input``): JSON tables under
``text/`` and, for the tables that never reach ``text/``, TextAssets inside
``media_bundles/*.ab``. Synthetic fixtures provide the same tables as JSON
files under ``text/`` so tests never need UnityPy or the APK.

Table names used by this builder (JSON file name first, bundle fallback):

``song_pack_data``                  sharedassets0.assets:song_pack_data
``illustrationdata``                illustrationdata.ab:illustration
``bg_movie_info_data``              bgmovieinfodata.ab:bg_movie_info_data
"""

from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import InputError

LANGS: tuple[tuple[str, int], ...] = (
    ("en", 0),
    ("ja", 1),
    ("zh-Hant", 2),
    ("ko", 3),
    ("zh-Hans", 5),
)


@dataclass(frozen=True)
class Table:
    data: Any
    locator: str


class InputSource:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        if not self.root.is_dir():
            raise InputError(f"input directory does not exist: {self.root}")
        self.text_dir = self.root / "text"
        self.media_dir = self.root / "media_bundles"

    # ------------------------------------------------------------------ text
    def text_json(self, *relative: str) -> Table | None:
        path = self.text_dir.joinpath(*relative)
        if not path.is_file():
            return None
        return Table(self._load_json(path), f"text/{'/'.join(relative)}")

    def json_or_bundle(
        self,
        text_candidates: tuple[tuple[str, ...], ...],
        bundle: str,
        bundle_text_name: str,
    ) -> Table:
        for candidate in text_candidates:
            table = self.text_json(*candidate)
            if table is not None:
                return table
        return self.bundle_table(bundle, bundle_text_name)

    def song_catalog(self) -> Table:
        return self.json_or_bundle(
            (("song_pack_data",), ("sharedassets0", "song_pack_data")),
            "sharedassets0.assets",
            "song_pack_data",
        )

    def illustrations(self) -> Table:
        return self.json_or_bundle(
            (("illustrationdata",), ("illustrationdata", "illustration")),
            "illustrationdata.ab",
            "illustration",
        )

    def bg_movies(self) -> Table:
        return self.json_or_bundle(
            (("bg_movie_info_data",), ("bgmovieinfodata", "bg_movie_info_data")),
            "bgmovieinfodata.ab",
            "bg_movie_info_data",
        )

    # -------------------------------------------------------------- required
    def chapters(self) -> Table:
        table = self.text_json("osdata", "chapters")
        if table is None:
            raise InputError(
                f"missing table text/osdata/chapters under {self.text_dir}"
            )
        return table

    def gallery_folders(self) -> Table | None:
        return self.text_json("gallerydata", "folder")

    def audio_subtitles(self) -> Table | None:
        return self.text_json("audiosubtitledata", "audio_subtitle")

    def os_tables(self) -> list[Table]:
        directory = self.text_dir / "osdata"
        if not directory.is_dir():
            return []
        tables = []
        for path in sorted(directory.iterdir()):
            if not path.is_file() or path.name == "chapters":
                continue
            tables.append(Table(self._load_json(path), f"text/osdata/{path.name}"))
        return tables

    # -------------------------------------------------------------- bundles
    def bundle_table(self, bundle: str, text_name: str) -> Table:
        path = (
            self._ensure_sharedassets()
            if bundle.startswith("sharedassets")
            else self._ensure_bundle(bundle)
        )
        try:
            import UnityPy  # type: ignore[import-not-found]
        except ImportError as exc:
            raise InputError(
                "UnityPy is required to read TextAssets from AssetBundles; "
                "install it or provide the table as JSON under text/"
            ) from exc

        environment = UnityPy.load(str(path))
        for obj in environment.objects:
            if obj.type.name != "TextAsset":
                continue
            data = obj.read_typetree()
            if data.get("m_Name") != text_name:
                continue
            script = data.get("m_Script")
            if isinstance(script, bytes):
                script = script.decode("utf-8")
            try:
                parsed = json.loads(script)
            except json.JSONDecodeError as exc:
                raise InputError(f"{bundle}:{text_name} is not valid JSON: {exc}") from exc
            return Table(parsed, f"{bundle}:{text_name}")
        raise InputError(f"TextAsset {text_name!r} not found in {path}")

    def _ensure_bundle(self, bundle: str) -> Path:
        path = self.media_dir / bundle
        if path.is_file():
            return path
        for apk_name in ("split_assets_pack_1.apk", "split_assets_pack_2.apk", "base.apk"):
            apk = self._find_file(apk_name)
            if apk is None:
                continue
            member = f"assets/assetpack/{bundle}"
            with zipfile.ZipFile(apk) as archive:
                if member not in archive.namelist():
                    continue
                self.media_dir.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(member))
                return path
        raise InputError(
            f"missing AssetBundle {bundle} under {self.media_dir} and no APK could supply it"
        )

    def _ensure_sharedassets(self) -> Path:
        path = self.media_dir / "sharedassets0.assets"
        if path.is_file():
            return path
        apk = self._find_file("split_base_assets.apk")
        if apk is None:
            raise InputError(
                "missing media_bundles/sharedassets0.assets and split_base_assets.apk"
            )
        with zipfile.ZipFile(apk) as archive:
            members = [
                name
                for name in archive.namelist()
                if name.startswith("assets/bin/Data/sharedassets0.assets")
            ]
            if not members:
                raise InputError(f"split_base_assets.apk has no sharedassets0.assets")
            members.sort(key=self._split_index)
            self.media_dir.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as handle:
                for member in members:
                    handle.write(archive.read(member))
        return path

    @staticmethod
    def _split_index(member: str) -> int:
        marker = ".split"
        if marker not in member:
            return -1
        suffix = member.rsplit(marker, 1)[1]
        return int(suffix) if suffix.isdigit() else 0

    def _find_file(self, name: str) -> Path | None:
        for directory in (self.root, self.root.parent, Path.cwd()):
            candidate = directory / name
            if candidate.is_file():
                return candidate
        return None

    @staticmethod
    def _load_json(path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise InputError(f"invalid JSON in {path}: {exc}") from exc
