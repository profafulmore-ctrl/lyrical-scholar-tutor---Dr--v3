// Lecture-script parser.
//
// Turns a Markdown lecture script into a structured manifest of "scenes".
// A scene is the unit that gets: one ElevenLabs audio file + one HeyGen avatar
// clip + one slide/background in the final edit.
//
// Supported authoring syntax inside script.md:
//   ---  frontmatter ---            YAML-ish key: value block at top (optional)
//   # Heading / ## Heading          becomes a chapter boundary + chapter title
//   ## Scene: <name>                explicit scene break with an optional name
//   ---  (a lone triple-dash line)  also forces a scene break
//   [pause 1.5s]                    -> ElevenLabs <break time="1.5s" /> tag
//   [broll: clip.mp4]               -> b-roll hint attached to the current scene
//   [slide: 03.png]                 -> slide hint attached to the current scene
//   (everything else)               narration text spoken by the voice/avatar

import fs from 'node:fs';

const PAUSE_RE = /\[pause\s+([0-9.]+)\s*s?\]/gi;
const BROLL_RE = /^\[broll:\s*([^\]]+)\]\s*$/i;
const SLIDE_RE = /^\[slide:\s*([^\]]+)\]\s*$/i;
const ZOOM_RE = /^\[zoom\]\s*$/i;
const SCENE_RE = /^##\s*scene:\s*(.*)$/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function parseFrontmatter(text) {
  const meta = {};
  let body = text;
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const block = text.slice(3, end).trim();
      body = text.slice(end + 4);
      for (const line of block.split('\n')) {
        const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
        if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return { meta, body };
}

// Convert authoring pause markers into ElevenLabs break tags, capping the
// duration at maxPause seconds when set (a safe way to "tighten pace" for TTS —
// trimming real silence from rendered video would desync the avatar's lips).
const applyPauses = (s, maxPause) =>
  s.replace(PAUSE_RE, (_, sec) => {
    let v = parseFloat(sec);
    if (maxPause && v > maxPause) v = maxPause;
    return `<break time="${v.toFixed(1)}s" />`;
  });

// Remove [cut]...[/cut] blocks (marked bad takes / sections to drop). Spans lines.
const stripCuts = (s) => s.replace(/\[cut\][\s\S]*?\[\/cut\]/gi, '');

export function parseScript(filePath, { maxPause = 0 } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(raw);
  const meta = fm.meta;
  const body = stripCuts(fm.body);

  const scenes = [];
  let current = null;
  let chapter = meta.title || 'Lecture';
  let sceneName = '';

  const startScene = () => {
    if (current && current.lines.join('').trim()) scenes.push(current);
    current = { name: sceneName, chapter, lines: [], broll: [], slide: null, zoom: false };
    sceneName = '';
  };
  startScene();

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    // Scene break markers
    if (SCENE_RE.test(trimmed)) { sceneName = trimmed.match(SCENE_RE)[1].trim(); startScene(); continue; }
    if (trimmed === '---') { startScene(); continue; }

    // Headings: set chapter + force a scene break so chapters line up with scenes
    const h = trimmed.match(HEADING_RE);
    if (h) { chapter = h[2].trim(); if (!sceneName) sceneName = chapter; startScene(); continue; }

    // Asset hints
    const broll = trimmed.match(BROLL_RE);
    if (broll) { current.broll.push(broll[1].trim()); continue; }
    const slide = trimmed.match(SLIDE_RE);
    if (slide) { current.slide = slide[1].trim(); continue; }
    if (ZOOM_RE.test(trimmed)) { current.zoom = true; continue; }

    current.lines.push(line);
  }
  startScene(); // flush final

  // Finalize: build clean spoken text per scene
  const finalScenes = scenes
    .map((s, i) => {
      const text = applyPauses(s.lines.join('\n'), maxPause).replace(/\n{3,}/g, '\n\n').trim();
      return {
        index: i + 1,
        id: String(i + 1).padStart(2, '0'),
        name: s.name || `Scene ${i + 1}`,
        chapter: s.chapter,
        slide: s.slide,
        broll: s.broll,
        zoom: s.zoom,
        text,
        charCount: text.length,
      };
    })
    .filter((s) => s.text.length > 0)
    .map((s, i) => ({ ...s, index: i + 1, id: String(i + 1).padStart(2, '0') }));

  // Derive chapter list (first scene of each distinct chapter)
  const chapters = [];
  let lastChapter = null;
  for (const s of finalScenes) {
    if (s.chapter !== lastChapter) { chapters.push({ title: s.chapter, sceneId: s.id }); lastChapter = s.chapter; }
  }

  const totalChars = finalScenes.reduce((n, s) => n + s.charCount, 0);
  return {
    meta,
    title: meta.title || 'Untitled Lecture',
    voiceId: meta.voice_id || null,
    avatarId: meta.avatar_id || null,
    scenes: finalScenes,
    chapters,
    stats: { sceneCount: finalScenes.length, totalChars, estWords: Math.round(totalChars / 6) },
  };
}

// Split a scene's text into <= maxChars chunks on sentence/paragraph boundaries,
// so each chunk stays under the TTS request limit while preserving prosody.
export function chunkText(text, maxChars = 2500) {
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  const chunks = [];
  let buf = '';
  for (const sentence of sentences) {
    if ((buf + ' ' + sentence).trim().length > maxChars && buf) { chunks.push(buf.trim()); buf = ''; }
    if (sentence.length > maxChars) {
      // Extremely long sentence: hard-split on whitespace.
      for (const word of sentence.split(/\s+/)) {
        if ((buf + ' ' + word).length > maxChars) { chunks.push(buf.trim()); buf = ''; }
        buf += ' ' + word;
      }
    } else {
      buf += ' ' + sentence;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}
