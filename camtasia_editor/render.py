"""Render a preview .mp4 from the slide cues, B-roll cues, and voice track using ffmpeg.

This is a *preview* render: slides shown full-screen, B-roll overlaid bottom-right at 30%
width, silence regions cut. Audio is the voice track minus the silence cuts.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import subprocess
import tempfile

from .align import SlideCue
from .broll import BRollCue
from .silence import SilenceRegion


def _check_ffmpeg() -> None:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("ffmpeg is required on PATH for preview rendering") from exc


def _keep_intervals(total: float, silences: list[SilenceRegion]) -> list[tuple[float, float]]:
    keeps: list[tuple[float, float]] = []
    cursor = 0.0
    for s in sorted(silences, key=lambda x: x.start):
        if s.start > cursor:
            keeps.append((cursor, s.start))
        cursor = max(cursor, s.end)
    if cursor < total:
        keeps.append((cursor, total))
    return keeps


def _filter_for_keeps(keeps: list[tuple[float, float]]) -> str:
    parts = []
    for i, (a, b) in enumerate(keeps):
        parts.append(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}]")
    concat = "".join(f"[a{i}]" for i in range(len(keeps))) + f"concat=n={len(keeps)}:v=0:a=1[aout]"
    return ";".join(parts + [concat])


def render_preview(
    voice_path: Path,
    slide_cues: list[SlideCue],
    broll_cues: list[BRollCue],
    silences: list[SilenceRegion],
    total_duration: float,
    out_path: Path,
    canvas: tuple[int, int] = (1920, 1080),
    fps: int = 30,
) -> None:
    _check_ffmpeg()
    w, h = canvas

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        slides_video = tmp / "slides.mp4"

        concat_lines = []
        for cue in slide_cues:
            dur = max(0.1, cue.end - cue.start)
            concat_lines.append(f"file '{cue.image.as_posix()}'")
            concat_lines.append(f"duration {dur:.3f}")
        if slide_cues:
            concat_lines.append(f"file '{slide_cues[-1].image.as_posix()}'")
        (tmp / "slides.txt").write_text("\n".join(concat_lines), encoding="utf-8")

        subprocess.run(
            [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", str(tmp / "slides.txt"),
                "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
                "-r", str(fps), "-pix_fmt", "yuv420p",
                str(slides_video),
            ],
            check=True, capture_output=True,
        )

        current_video = slides_video
        for i, b in enumerate(broll_cues):
            overlaid = tmp / f"step_{i}.mp4"
            ow = int(w * 0.3)
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", str(current_video),
                    "-i", str(b.clip),
                    "-filter_complex",
                    (
                        f"[1:v]scale={ow}:-2,setpts=PTS-STARTPTS+{b.start}/TB[ov];"
                        f"[0:v][ov]overlay=W-w-40:H-h-40:enable='between(t,{b.start:.3f},{b.end:.3f})'"
                    ),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-an",
                    str(overlaid),
                ],
                check=True, capture_output=True,
            )
            current_video = overlaid

        keeps = _keep_intervals(total_duration, silences)
        if not keeps:
            keeps = [(0.0, total_duration)]

        cmd = ["ffmpeg", "-y", "-i", str(voice_path), "-i", str(current_video)]
        afilter = _filter_for_keeps(keeps)
        vparts = [f"[1:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{i}]" for i, (a, b) in enumerate(keeps)]
        vconcat = "".join(f"[v{i}]" for i in range(len(keeps))) + f"concat=n={len(keeps)}:v=1:a=0[vout]"
        full_filter = ";".join([afilter] + vparts + [vconcat])
        cmd += [
            "-filter_complex", full_filter,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-r", str(fps),
            str(out_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
