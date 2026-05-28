"""Insert B-roll clips when matching keywords are spoken.

B-roll folder convention: filename stem (lowercase, hyphens to spaces) is the trigger keyword.
  pizza.mp4         -> trigger "pizza"
  break-even.mp4    -> trigger "break even"
Or provide broll.json with explicit {"file": "...", "keywords": ["...", "..."]}.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import json
import re

from .transcribe import Segment


@dataclass
class BRollCue:
    clip: Path
    start: float
    end: float
    trigger: str


_VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm"}


def load_broll_manifest(broll_dir: Path) -> list[dict]:
    manifest = broll_dir / "broll.json"
    if manifest.exists():
        return json.loads(manifest.read_text(encoding="utf-8"))["clips"]
    items = []
    for p in sorted(broll_dir.iterdir()):
        if p.suffix.lower() in _VIDEO_EXTS:
            keyword = p.stem.lower().replace("-", " ").replace("_", " ")
            items.append({"file": p.name, "keywords": [keyword]})
    return items


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower())


def find_broll_cues(
    broll_dir: Path,
    segments: list[Segment],
    overlay_duration: float = 4.0,
    min_gap_between: float = 8.0,
) -> list[BRollCue]:
    manifest = load_broll_manifest(broll_dir)
    if not manifest:
        return []

    cues: list[BRollCue] = []
    last_end = -min_gap_between
    used_files: set[str] = set()

    for seg in segments:
        seg_text = _normalize_text(seg.text)
        for item in manifest:
            file = item["file"]
            if file in used_files:
                continue
            for kw in item.get("keywords", []):
                kw_norm = _normalize_text(kw).strip()
                if kw_norm and re.search(rf"\b{re.escape(kw_norm)}\b", seg_text):
                    start = max(seg.start, last_end + min_gap_between)
                    if start >= seg.end:
                        continue
                    end = min(seg.end, start + overlay_duration)
                    cues.append(BRollCue(clip=broll_dir / file, start=start, end=end, trigger=kw_norm))
                    last_end = end
                    used_files.add(file)
                    break
    return cues
