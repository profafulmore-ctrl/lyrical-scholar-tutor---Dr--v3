"""Command-line entry point.

Usage:
    python -m camtasia_editor build \
        --voice path/to/voice.mp3 \
        --slides path/to/slides_dir \
        --broll  path/to/broll_dir \
        --out    path/to/output_dir \
        [--whisper-model base] [--no-preview] [--no-tscproj]

Inputs:
    voice.mp3       ElevenLabs voice export
    slides_dir/     PNG/JPG slide images. Optional slides.json:
                      {"slides": [{"image": "01.png", "cue": "next slide"}, ...]}
                    If no slides.json, slides are distributed evenly across the audio.
    broll_dir/      .mp4/.mov clips. Filename stem = keyword. Or broll.json:
                      {"clips": [{"file": "pizza.mp4", "keywords": ["pizza", "pie"]}]}

Outputs in --out:
    project.tscproj   Camtasia project (open in Camtasia, all tracks pre-laid)
    preview.mp4       Pre-rendered preview (slides + B-roll + silence-trimmed voice)
    report.json       What it did: cues, silences, B-roll insertions
"""
from __future__ import annotations
import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .align import SlideCue, align_slides
from .broll import BRollCue, find_broll_cues
from .render import render_preview
from .silence import SilenceRegion, audio_duration, detect_silences
from .transcribe import Segment, transcribe
from .tscproj import MediaItem, Marker, Source, write_tscproj


def _probe_image_size(path: Path) -> tuple[int, int]:
    from PIL import Image
    with Image.open(path) as im:
        return im.size


def _print(msg: str) -> None:
    print(f"[ce] {msg}", flush=True)


def _segments_to_dicts(segments: list[Segment]) -> list[dict]:
    return [
        {"text": s.text, "start": s.start, "end": s.end, "words": [
            {"text": w.text, "start": w.start, "end": w.end} for w in s.words]}
        for s in segments
    ]


def build(args: argparse.Namespace) -> int:
    voice = Path(args.voice).resolve()
    slides_dir = Path(args.slides).resolve()
    broll_dir = Path(args.broll).resolve() if args.broll else None
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not voice.exists():
        _print(f"voice not found: {voice}")
        return 1
    if not slides_dir.exists():
        _print(f"slides dir not found: {slides_dir}")
        return 1

    _print(f"reading audio: {voice.name}")
    total_duration = audio_duration(voice)
    _print(f"duration: {total_duration:.1f}s")

    _print(f"transcribing with whisper ({args.whisper_model})...")
    segments = transcribe(voice, model_size=args.whisper_model, language=args.language)
    _print(f"transcribed {len(segments)} segments, {sum(len(s.words) for s in segments)} words")

    _print("detecting silences...")
    silences = detect_silences(
        voice,
        min_silence_ms=args.min_silence_ms,
        silence_thresh_db=args.silence_thresh_db,
    )
    _print(f"found {len(silences)} silence regions to trim")

    _print("aligning slides...")
    slide_cues = align_slides(slides_dir, segments, total_duration)
    _print(f"placed {len(slide_cues)} slides on the timeline")

    broll_cues: list[BRollCue] = []
    if broll_dir and broll_dir.exists():
        _print("matching b-roll keywords...")
        broll_cues = find_broll_cues(broll_dir, segments)
        _print(f"queued {len(broll_cues)} b-roll insertions")

    if not args.no_tscproj:
        _print("writing camtasia project...")
        sources: list[Source] = []
        timeline: list[MediaItem] = []

        voice_src = Source(id=1, path=voice, kind="audio", duration_s=total_duration)
        sources.append(voice_src)
        timeline.append(MediaItem(source_id=1, track=0, start_s=0.0, duration_s=total_duration))

        next_id = 2
        for cue in slide_cues:
            try:
                w, h = _probe_image_size(cue.image)
            except Exception:
                w, h = 1920, 1080
            src = Source(id=next_id, path=cue.image, kind="image", duration_s=cue.end - cue.start, width=w, height=h)
            sources.append(src)
            scalar = min(1920.0 / max(1, w), 1080.0 / max(1, h))
            timeline.append(MediaItem(
                source_id=next_id, track=1,
                start_s=cue.start, duration_s=max(0.1, cue.end - cue.start),
                scalar=scalar,
            ))
            next_id += 1

        for b in broll_cues:
            src = Source(id=next_id, path=b.clip, kind="video", duration_s=b.end - b.start, width=1920, height=1080)
            sources.append(src)
            timeline.append(MediaItem(
                source_id=next_id, track=2,
                start_s=b.start, duration_s=b.end - b.start,
                scalar=0.4,
            ))
            next_id += 1

        markers = [Marker(time_s=s.start, name=f"silence {s.duration:.1f}s") for s in silences]
        write_tscproj(out_dir / "project.tscproj", sources, timeline, markers)
        _print(f"wrote {out_dir / 'project.tscproj'}")

    if not args.no_preview:
        _print("rendering preview mp4 (this can take a while)...")
        render_preview(
            voice_path=voice,
            slide_cues=slide_cues,
            broll_cues=broll_cues,
            silences=silences,
            total_duration=total_duration,
            out_path=out_dir / "preview.mp4",
        )
        _print(f"wrote {out_dir / 'preview.mp4'}")

    report = {
        "voice": str(voice),
        "duration_s": total_duration,
        "slides": [{"image": str(c.image), "start": c.start, "end": c.end} for c in slide_cues],
        "broll": [{"clip": str(b.clip), "trigger": b.trigger, "start": b.start, "end": b.end} for b in broll_cues],
        "silences": [asdict(s) for s in silences],
        "transcript": _segments_to_dicts(segments),
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    _print(f"wrote {out_dir / 'report.json'}")
    _print("done.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="camtasia_editor")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_build = sub.add_parser("build", help="Build a Camtasia project + preview mp4")
    p_build.add_argument("--voice", required=True, help="ElevenLabs voice MP3/WAV")
    p_build.add_argument("--slides", required=True, help="Folder of slide images (and optional slides.json)")
    p_build.add_argument("--broll", default=None, help="Folder of B-roll clips (and optional broll.json)")
    p_build.add_argument("--out", required=True, help="Output directory")
    p_build.add_argument("--whisper-model", default="base", help="tiny|base|small|medium|large-v3")
    p_build.add_argument("--language", default=None, help="ISO code (e.g. en); auto-detect if omitted")
    p_build.add_argument("--min-silence-ms", type=int, default=800)
    p_build.add_argument("--silence-thresh-db", type=int, default=-40)
    p_build.add_argument("--no-preview", action="store_true")
    p_build.add_argument("--no-tscproj", action="store_true")
    p_build.set_defaults(func=build)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
