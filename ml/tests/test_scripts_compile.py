"""Every script compiles — scripts aren't imported by other tests, so a syntax
error in one would otherwise only show up when someone runs it."""

from __future__ import annotations

import py_compile
from pathlib import Path

import pytest

SCRIPTS = sorted((Path(__file__).resolve().parents[1] / "scripts").glob("*.py"))


@pytest.mark.filterwarnings("error::SyntaxWarning")
@pytest.mark.parametrize("script", SCRIPTS, ids=[s.name for s in SCRIPTS])
def test_script_compiles(script: Path) -> None:
    py_compile.compile(str(script), doraise=True)


def test_there_are_scripts() -> None:
    assert len(SCRIPTS) >= 10
