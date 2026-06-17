# Lecture Video Pipeline

Automates the scriptable parts of your lecture-video workflow:

```
script.md ──prep──▶ manifest ──voice──▶ ElevenLabs (your cloned voice)
                                   └─────▶ HeyGen avatar (lip-synced to that audio)
                                              └──assemble──▶ rough cut (slides + b-roll + avatar PiP)
                                                     └──shownotes──▶ titles · description · chapters (Claude)
```

What stays manual: **final polish in Camtasia** (your step 6) and recording your
own b-roll. Everything up to a postable rough cut is one command.

## How it maps to your current process

| Your step | This pipeline |
|-----------|---------------|
| Update script in Claude | Write `script.md` (Claude can draft/edit it) |
| ElevenLabs voice | `voice` — chunks long scripts, stitches audio in your voice |
| HeyGen clone | `avatar` — feeds your ElevenLabs audio to HeyGen so lips match your voice |
| Combine in Camtasia / Premiere | `assemble` — flat ffmpeg rough cut · **`project` — editable Premiere timeline (FCP7 XML)** |
| Add b-roll / updates | `[broll: clip.mp4]` / `[slide: 03.png]` hints in the script |
| Final edit & post | Premiere/Camtasia for polish; `shownotes` gives titles/description/chapters |

### Two ways to get to final edit

- **`assemble`** → a flat `final.mp4` rough cut (quick preview, or post as-is).
- **`project`** → an **editable Adobe Premiere sequence** (`*.premiere.xml`, FCP7
  XMEML). Import via *File ▸ Import* and you get real tracks to polish:
  - **V1** — slides / b-roll background per scene
  - **V2** — your avatar, pre-scaled + positioned as a PiP (a Basic Motion filter
    you can nudge in Premiere's *Motion* controls)
  - **A1** — your voiceover, timed scene-by-scene

  ```bash
  node pipeline/lecture.mjs project --lecture example-lecture --target premiere
  ```
  Run `voice` first so scenes have real durations. `all` produces both the
  rough cut and the Premiere project.

## Setup

1. **Node 18+** (you have 22) and **ffmpeg/ffprobe** on your PATH (for durations + assembly).
2. Copy keys:
   ```bash
   cp pipeline/.env.example pipeline/.env
   # then edit pipeline/.env with your ElevenLabs, HeyGen, and Anthropic keys/ids
   ```
3. Verify:
   ```bash
   node pipeline/lecture.mjs doctor
   ```

## Usage

```bash
# Run the whole pipeline on the sample lecture:
node pipeline/lecture.mjs all --lecture example-lecture

# Or step by step:
node pipeline/lecture.mjs prep      --lecture example-lecture
node pipeline/lecture.mjs voice     --lecture example-lecture
node pipeline/lecture.mjs avatar    --lecture example-lecture
node pipeline/lecture.mjs assemble  --lecture example-lecture
node pipeline/lecture.mjs project   --lecture example-lecture --target premiere
node pipeline/lecture.mjs shownotes --lecture example-lecture
```

Flags: `--force` (re-render cached steps), `--dry-run` (print ffmpeg, write nothing),
`--skip-avatar` (slides + voiceover only, no talking head).

## Authoring a lecture

Create `pipeline/lectures/<your-id>/script.md`. Markdown with optional frontmatter:

- `# Heading` / `## Heading` → a **chapter** boundary (used for chapters + scene splits)
- `## Scene: name` or a lone `---` → force a **scene** break
- `[pause 1.5s]` → natural pause (ElevenLabs `<break>`)
- `[slide: 03.png]` → background for that scene (drop files in `lectures/<id>/slides/`)
- `[broll: clip.mp4]` → b-roll background (drop files in `lectures/<id>/broll/`)
- Everything else → narration

Optional per-lecture files:
- `slides/`, `broll/` — your visuals (referenced by the hints above)
- `assets/intro.mp4`, `assets/outro.mp4` — auto-stitched around the body
- `edl.json` — override assembly settings (resolution, avatar size/position, etc.)

Outputs land in `lectures/<id>/build/`: `audio/`, `avatar/`, `renders/`,
`final.mp4`, `transcript.txt`, `chapters.txt`, `shownotes.md`, `metadata.json`.

## Automated final edits

The deterministic parts of "final edits and cuts" — the ones that don't need a
human eye — are built in:

| Edit | How |
|------|-----|
| **Tighten pace** | `--max-pause 0.8` caps `[pause]` markers (safe for TTS; trimming real silence would desync the avatar's lips) |
| **Cut sections / bad takes** | wrap them in `[cut] … [/cut]` in `script.md` — removed everywhere (voice, avatar, captions) |
| **Captions** | `captions` command → `captions.srt`, exactly synced (your TTS *is* the transcript). Sidecar by default; set `"captions": true` in `edl.json` to burn into `final.mp4` |
| **B-roll** | `[broll: clip.mp4]` per scene |
| **Zoom / emphasis** | `[zoom]` on a scene (or `SLIDE_ZOOM=true` / `"zoom": true` globally) → gentle Ken Burns on that slide |

What still needs *you*: the taste calls — which exact moment to punch in on, comedic/
dramatic timing, "this part drags." The pipeline gives you the mechanisms and a
clean, captioned, paced cut; you make the judgment calls in Premiere.

## Notes & limits

- **Avatar voice** uses HeyGen's "audio" voice mode, so the talking head lip-syncs
  to your actual ElevenLabs audio — not a re-synthesis.
- HeyGen renders per scene (keeps clips short, parallel-friendly, and resumable —
  finished scenes are cached; `--force` re-renders).
- The assembler is a **rough cut**, not a full NLE. It composites background +
  avatar PiP + voiceover. Fine cuts, callouts, and zooms stay in Camtasia.
- Keys live only in `pipeline/.env` (gitignored). Nothing is uploaded anywhere
  except the ElevenLabs / HeyGen / Anthropic APIs you configured.
