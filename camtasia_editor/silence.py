"""Detect silence regions and suggest cut markers."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path


@dataclass
class SilenceRegion:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def detect_silences(
    audio_path: Path,
    min_silence_ms: int = 800,
    silence_thresh_db: int = -40,
    keep_padding_ms: int = 120,
) -> list[SilenceRegion]:
    """Return silence regions longer than `min_silence_ms`, shrunk by `keep_padding_ms` on each side."""
    from pydub import AudioSegment
    from pydub.silence import detect_silence

    audio = AudioSegment.from_file(str(audio_path))
    raw = detect_silence(audio, min_silence_len=min_silence_ms, silence_thresh=silence_thresh_db)

    regions: list[SilenceRegion] = []
    for start_ms, end_ms in raw:
        start = (start_ms + keep_padding_ms) / 1000.0
        end = (end_ms - keep_padding_ms) / 1000.0
        if end - start > 0.1:
            regions.append(SilenceRegion(start=start, end=end))
    return regions


def audio_duration(audio_path: Path) -> float:
    from mutagen import File
    f = File(str(audio_path))
    if f is None or f.info is None:
        from pydub import AudioSegment
        return AudioSegment.from_file(str(audio_path)).duration_seconds
    return float(f.info.length)
