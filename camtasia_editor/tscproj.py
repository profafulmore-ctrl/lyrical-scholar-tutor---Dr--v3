"""Write a Camtasia 2021+ .tscproj project file.

The .tscproj format is JSON. Timeline times are expressed in `editRate` ticks
(default 705_600_000 ticks/sec — the LCM of common audio sample rates, which is
what Camtasia ships with). Tracks contain media items with start, duration,
mediaStart, and mediaDuration fields, all in ticks.

This writer produces a minimal but valid project that Camtasia will open. Once
opened, Camtasia normalises and re-saves it with version-specific extras.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import os

EDIT_RATE = 705_600_000


def s_to_ticks(seconds: float) -> int:
    return int(round(seconds * EDIT_RATE))


@dataclass
class Source:
    id: int
    path: Path
    kind: str  # "audio" | "image" | "video"
    duration_s: float
    width: int = 0
    height: int = 0


@dataclass
class MediaItem:
    source_id: int
    track: int
    start_s: float
    duration_s: float
    media_start_s: float = 0.0
    media_duration_s: float | None = None
    scalar: float = 1.0  # used for image stretching to fill canvas


@dataclass
class Marker:
    time_s: float
    name: str


def _source_tracks(src: Source) -> list[dict]:
    if src.kind == "audio":
        return [{
            "range": [0, s_to_ticks(src.duration_s)],
            "type": 0,
            "editRate": 44100,
            "trackRect": [0, 0, 0, 0],
            "sampleRate": 44100,
            "bitDepth": 16,
            "numChannels": 2,
            "interleaved": True,
            "integerSamples": True,
            "trackNumber": 0,
            "metaData": "",
        }]
    if src.kind == "image":
        return [{
            "range": [0, EDIT_RATE * 5],
            "type": 1,
            "editRate": 30,
            "trackRect": [0, 0, src.width, src.height],
            "trackNumber": 0,
            "metaData": "",
        }]
    return [
        {
            "range": [0, s_to_ticks(src.duration_s)],
            "type": 1,
            "editRate": 30,
            "trackRect": [0, 0, src.width, src.height],
            "trackNumber": 0,
            "metaData": "",
        },
        {
            "range": [0, s_to_ticks(src.duration_s)],
            "type": 0,
            "editRate": 44100,
            "trackRect": [0, 0, 0, 0],
            "sampleRate": 44100,
            "bitDepth": 16,
            "numChannels": 2,
            "interleaved": True,
            "integerSamples": True,
            "trackNumber": 1,
            "metaData": "",
        },
    ]


def _source_bin_entry(src: Source, project_dir: Path) -> dict:
    try:
        rel = os.path.relpath(src.path, project_dir).replace("\\", "/")
    except ValueError:
        rel = str(src.path).replace("\\", "/")
    return {
        "id": src.id,
        "src": rel,
        "rect": [0, 0, src.width, src.height],
        "lastMod": "",
        "loaded": True,
        "metadata": {"default-thumbnail-frame-time": "0"},
        "sourceTracks": _source_tracks(src),
    }


def _media_dict(item: MediaItem, src: Source, media_id: int, canvas: tuple[int, int]) -> dict:
    md = item.media_duration_s if item.media_duration_s is not None else src.duration_s
    media_type = {"audio": "AMFile", "image": "IMFile", "video": "AMFile"}[src.kind]
    base: dict[str, Any] = {
        "id": media_id,
        "_type": media_type,
        "src": src.id,
        "trackNumber": 1 if src.kind in ("video",) else 0,
        "trimStartSum": 0,
        "attributes": {"ident": src.path.name},
        "parameters": {
            "scale0": item.scalar,
            "scale1": item.scalar,
            "translation0": 0.0,
            "translation1": 0.0,
            "geometryCrop0": 0.0,
            "geometryCrop1": 0.0,
            "geometryCrop2": 0.0,
            "geometryCrop3": 0.0,
        },
        "effects": [],
        "start": s_to_ticks(item.start_s),
        "duration": s_to_ticks(item.duration_s),
        "mediaStart": s_to_ticks(item.media_start_s),
        "mediaDuration": s_to_ticks(md),
        "scalar": 1,
        "metadata": {
            "clipSpeedAttribute": False,
            "default-scale": "1",
            "effectApplied": "none",
        },
        "animationTracks": {},
    }
    return base


def write_tscproj(
    out_path: Path,
    sources: list[Source],
    timeline: list[MediaItem],
    markers: list[Marker],
    canvas: tuple[int, int] = (1920, 1080),
    fps: int = 30,
) -> None:
    project_dir = out_path.parent
    next_id = max((s.id for s in sources), default=0) + 1
    media_records = []
    for item in timeline:
        src = next(s for s in sources if s.id == item.source_id)
        media_records.append((item.track, _media_dict(item, src, next_id, canvas)))
        next_id += 1

    tracks_by_index: dict[int, list[dict]] = {}
    for track_idx, md in media_records:
        tracks_by_index.setdefault(track_idx, []).append(md)

    tracks_json = []
    for idx in sorted(tracks_by_index):
        medias = sorted(tracks_by_index[idx], key=lambda m: m["start"])
        tracks_json.append({
            "trackIndex": idx,
            "medias": medias,
            "transitions": [],
            "audioMuted": False,
            "videoHidden": False,
            "magnetic": False,
            "matte": 0,
            "solo": False,
            "metadata": {"IsLocked": "False", "trackHeight": "54"},
        })

    project = {
        "title": "",
        "description": "",
        "creator": "",
        "createdAtVer": "23.0.0",
        "editRate": EDIT_RATE,
        "authoringClientName": {
            "name": "Camtasia",
            "platform": "Windows",
            "version": "23.0.0",
        },
        "videoFormatFrameRate": fps,
        "audioFormatSampleRate": 44100,
        "allowSubFrameEditing": False,
        "width": float(canvas[0]),
        "height": float(canvas[1]),
        "sourceBin": [_source_bin_entry(s, project_dir) for s in sources],
        "timeline": {
            "id": next_id,
            "sceneTrack": {
                "scenes": [{
                    "csml": {
                        "tracks": tracks_json,
                    }
                }]
            },
            "trackAttributes": [],
            "background": "0xff000000",
            "markers": [
                {"time": s_to_ticks(m.time_s), "name": m.name}
                for m in sorted(markers, key=lambda x: x.time_s)
            ],
        },
    }

    out_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
