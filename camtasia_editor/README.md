# Camtasia Editor — auto-build a lecture from ElevenLabs voice + Gamma slides

A Python tool that takes:

- a **voice track** from ElevenLabs (`.mp3` or `.wav`)
- a folder of **slide images** exported from Gamma (PNG/JPG)
- (optional) a folder of **B-roll clips** (`.mp4`)

…and produces:

- `project.tscproj` — a **Camtasia project file** you double-click to open. Voice on
  track 1, slides aligned to the voice on track 2, B-roll overlay on track 3, and
  silence regions marked on the timeline ready for ripple-delete.
- `preview.mp4` — a **pre-rendered preview** with silences cut and B-roll overlaid,
  so you can sanity-check the edit before opening Camtasia.
- `report.json` — what the tool decided: timestamps, transcript, silences, B-roll hits.

> **Honest note on Camtasia automation.** Camtasia has no published macro / plugin
> API. What this tool does is build the project file directly (it's JSON under the
> hood). You open the `.tscproj` in Camtasia and tweak whatever you don't like —
> it's a real, fully editable project, not a flattened render.

## Windows setup

Tested on Windows 11 + Camtasia 2023.

1. **Install Python 3.10+** from python.org. During install, tick *Add Python to PATH*.
2. **Install ffmpeg** — easiest:

   ```powershell
   winget install Gyan.FFmpeg
   ```

   Restart your terminal so `ffmpeg` is on `PATH`. Verify with `ffmpeg -version`.

3. **Clone this repo** and create a virtualenv:

   ```powershell
   cd lyrical-scholar-tutor---Dr--v3
   py -m venv .venv
   .venv\Scripts\activate
   pip install -r camtasia_editor\requirements.txt
   ```

   The first run downloads a Whisper model (the `base` model is ~140 MB).

## Prepare your inputs

```
my-lecture/
├── voice.mp3                       # ElevenLabs export
├── slides/
│   ├── slides.json                 # optional; see below
│   ├── 01-title.png                # exported from Gamma
│   ├── 02-cvp-overview.png
│   └── ...
└── broll/                          # optional
    ├── broll.json                  # optional
    ├── pizza-shop.mp4
    └── chart-up.mp4
```

### `slides.json` (optional but recommended)

Tells the tool when to switch slides by matching a short phrase from your voice.

```json
{
  "slides": [
    {"image": "01-title.png",        "cue": "welcome to managerial accounting"},
    {"image": "02-cvp-overview.png", "cue": "cost volume profit analysis"},
    {"image": "03-break-even.png",   "cue": "break even point is reached when"}
  ]
}
```

If `slides.json` is missing, slides are spread evenly across the audio.

### `broll.json` (optional)

```json
{
  "clips": [
    {"file": "pizza-shop.mp4", "keywords": ["pizza", "restaurant"]},
    {"file": "chart-up.mp4",   "keywords": ["profit", "growth"]}
  ]
}
```

If `broll.json` is missing, each clip's filename stem is used as its keyword
(`break-even.mp4` triggers on "break even").

## Run it

```powershell
python -m camtasia_editor build `
    --voice  my-lecture\voice.mp3 `
    --slides my-lecture\slides `
    --broll  my-lecture\broll `
    --out    my-lecture\out
```

Then open `my-lecture\out\project.tscproj` in Camtasia.

### Useful flags

| flag | default | purpose |
| --- | --- | --- |
| `--whisper-model` | `base` | `tiny` (fast) / `base` / `small` / `medium` / `large-v3` (best, slow) |
| `--language` | auto | force a language code, e.g. `en` |
| `--min-silence-ms` | `800` | trim silences longer than this |
| `--silence-thresh-db` | `-40` | silence threshold (lower = stricter) |
| `--no-preview` | off | skip the preview render (faster) |
| `--no-tscproj` | off | skip the project file |

## Workflow tips

- **Slide cues** — pick a short, distinctive phrase from each slide's narration as the
  `cue`. Five-word phrases work better than single words.
- **B-roll length** — clips overlay for up to 4 seconds, with at least 8 seconds
  between insertions, so the video doesn't feel choppy.
- **Silence markers** — when you open the `.tscproj`, the timeline has yellow
  markers at every detected silence. Use Camtasia's "Ripple Delete" on each one
  to apply the cuts. (The preview `.mp4` already has them cut.)
- **Re-running** — re-running rewrites everything in `--out`. Move files you want
  to keep before re-running.

## Limits / known issues

- The `.tscproj` writer targets Camtasia 2021+ on Windows. Mac Camtasia uses a
  slightly different field set; open and re-save once for compatibility.
- Auto-zoom on cursor clicks isn't implemented yet (requires screen-recording
  metadata that ElevenLabs voice tracks don't carry).
- Filler-word removal (`um`, `uh`) currently relies on silence detection picking
  them up. A future pass could trim them via Whisper's word timestamps.
