"""Standalone document extraction — no imports from the parent OCR `extraction` package."""

from __future__ import annotations

from typing import Any

__all__ = ["extract_document"]


def __getattr__(name: str) -> Any:
    if name == "extract_document":
        from headless.run import extract_document as _fn

        return _fn
    raise AttributeError(name)


def __dir__() -> list[str]:
    return sorted([*globals().keys(), *list(__all__)])
