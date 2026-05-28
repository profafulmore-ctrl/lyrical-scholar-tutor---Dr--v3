"""Align Gamma slides to the ElevenLabs voice track.

Two alignment modes:
  - "script": user provides slides.json mapping each slide image to a marker phrase the voice says
  - "even":   if no markers, slides are distributed evenly across the audio duration
"""
from __future__ import annotations
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
import json
import re

from .transcribe import Segment, flatten_words


@dataclass
class SlideCue:
    image: Path
    start: float
    end: float


def load_slide_manifest(slides_dir: Path) -> list[dict]:
    """Read slides.json from the slides dir, or auto-build it from sorted image filenames."""
    manifest = slides_dir / "slides.json"
    if manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        return data["slides"]

    exts = {".png", ".jpg", ".jpeg", ".webp"}
    images = sorted(p for p in slides_dir.iterdir() if p.suffix.lower() in exts)
    return [{"image": str(p.name), "cue": None} for p in images]


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", text.lower()).strip()


def _find_cue_time(cue: str, segments: list[Segment]) -> float | None:
    needle = _normalize(cue)
    if not needle:
        return None
    needle_tokens = needle.split()

    words = flatten_words(segments)
    if not words:
        return None

    best_score = 0.0
    best_time: float | None = None
    window = max(len(needle_tokens), 3)
    for i in range(len(words) - window + 1):
        chunk = " ".join(_normalize(w.text) for w in words[i : i + window])
        score = SequenceMatcher(None, needle, chunk).ratio()
        if score > best_score:
            best_score = score
            best_time = words[i].start
    return best_time if best_score >= 0.55 else None


def align_slides(
    slides_dir: Path,
    segments: list[Segment],
    total_duration: float,
) -> list[SlideCue]:
    manifest = load_slide_manifest(slides_dir)
    if not manifest:
        return []

    starts: list[float] = []
    have_any_cue = any(item.get("cue") for item in manifest)

    if have_any_cue:
        last = 0.0
        for item in manifest:
            cue = item.get("cue")
            t = _find_cue_time(cue, segments) if cue else None
            if t is None or t < last:
                t = last
            starts.append(t)
            last = t
    else:
        step = total_duration / max(1, len(manifest))
        starts = [i * step for i in range(len(manifest))]

    cues: list[SlideCue] = []
    for i, item in enumerate(manifest):
        start = starts[i]
        end = starts[i + 1] if i + 1 < len(starts) else total_duration
        if end <= start:
            end = start + 0.5
        cues.append(SlideCue(image=slides_dir / item["image"], start=start, end=end))
    return cues
