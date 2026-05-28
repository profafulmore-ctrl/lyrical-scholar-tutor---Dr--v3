"""Whisper transcription with word-level timestamps."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Segment:
    text: str
    start: float
    end: float
    words: list[Word]


def transcribe(audio_path: Path, model_size: str = "base", language: str | None = None) -> list[Segment]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments_iter, _ = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    out: list[Segment] = []
    for seg in segments_iter:
        words = [Word(text=w.word.strip(), start=w.start, end=w.end) for w in (seg.words or [])]
        out.append(Segment(text=seg.text.strip(), start=seg.start, end=seg.end, words=words))
    return out


def flatten_words(segments: list[Segment]) -> list[Word]:
    return [w for s in segments for w in s.words]
