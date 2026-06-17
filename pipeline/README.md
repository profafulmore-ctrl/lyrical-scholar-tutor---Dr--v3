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
| Combine in Camtasia | `assemble` — ffmpeg rough cut you import into Camtasia |
| Add b-roll / updates | `[broll: clip.mp4]` / `[slide: 03.png]` hints in the script |
| Final edit & post | Camtasia for polish; `shownotes` gives titles/description/chapters |

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

## Notes & limits

- **Avatar voice** uses HeyGen's "audio" voice mode, so the talking head lip-syncs
  to your actual ElevenLabs audio — not a re-synthesis.
- HeyGen renders per scene (keeps clips short, parallel-friendly, and resumable —
  finished scenes are cached; `--force` re-renders).
- The assembler is a **rough cut**, not a full NLE. It composites background +
  avatar PiP + voiceover. Fine cuts, callouts, and zooms stay in Camtasia.
- Keys live only in `pipeline/.env` (gitignored). Nothing is uploaded anywhere
  except the ElevenLabs / HeyGen / Anthropic APIs you configured.
