// Caption / subtitle generation (SRT).
//
// Because the voiceover is ElevenLabs TTS of your own script, the transcript is
// EXACT — no speech-recognition guesswork. We time captions by distributing each
// scene's measured audio duration across its sentences in proportion to length.
// Result: clean, well-synced .srt you can drop into Premiere/Camtasia or upload
// as a YouTube sidecar. (For frame-perfect timing, a forced aligner could be
// added later, but for narrated lectures proportional timing is very close.)

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.mjs';

const MAX_LINE = 42;   // chars per caption line
const MAX_LINES = 2;   // lines per cue

const stripBreaks = (t) => t.replace(/<break[^>]*\/>/g, ' ').replace(/\s+/g, ' ').trim();

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mm = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${mm}`;
}

// Split text into cue-sized strings (<= MAX_LINES lines of <= MAX_LINE chars).
function toCues(text) {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter(Boolean);
  const cues = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    let lines = [''];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length <= MAX_LINE) lines[lines.length - 1] = (cur + ' ' + w).trim();
      else if (lines.length < MAX_LINES) lines.push(w);
      else { cues.push(lines.join('\n')); lines = [w]; }
    }
    if (lines.join('').trim()) cues.push(lines.join('\n'));
  }
  return cues.length ? cues : [text];
}

export function buildSRT(manifest) {
  const cues = [];
  let sceneStart = 0;
  for (const scene of manifest.scenes) {
    const dur = scene.durationSec || 0;
    const text = stripBreaks(scene.text);
    const sceneCues = toCues(text);
    const totalChars = sceneCues.reduce((n, c) => n + c.replace(/\n/g, ' ').length, 0) || 1;
    let t = sceneStart;
    for (const cue of sceneCues) {
      const share = (cue.replace(/\n/g, ' ').length / totalChars) * dur;
      cues.push({ start: t, end: t + share, text: cue });
      t += share;
    }
    sceneStart += dur;
  }
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

export function exportSRT(manifest, buildDir) {
  const srt = buildSRT(manifest);
  const out = path.join(buildDir, 'captions.srt');
  ensureDir(buildDir);
  fs.writeFileSync(out, srt);
  return out;
}
