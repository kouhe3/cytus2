from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
FIXTURE_INPUT = Path(__file__).resolve().parent / "fixtures" / "input"

sys.path.insert(0, str(TOOLS))


def run_build(input_dir: Path, out_dir: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(TOOLS) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "cytus2db",
            "build",
            "--input",
            str(input_dir),
            "--out",
            str(out_dir),
            *extra,
        ],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def copy_input(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination)


@pytest.fixture(scope="session")
def fixture_input() -> Path:
    return FIXTURE_INPUT


@pytest.fixture(scope="session")
def built_db(tmp_path_factory: pytest.TempPathFactory, fixture_input: Path) -> Path:
    out = tmp_path_factory.mktemp("built")
    result = run_build(fixture_input, out)
    assert result.returncode == 0, result.stderr
    return out
