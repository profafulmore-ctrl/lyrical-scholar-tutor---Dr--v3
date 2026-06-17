#!/usr/bin/env node
// Lecture-video pipeline CLI.
//
//   node pipeline/lecture.mjs <command> --lecture <id> [flags]
//
// Commands:
//   prep        Parse script.md -> build/manifest.json (+ transcript, report)
//   voice       ElevenLabs TTS in your cloned voice -> build/audio/*.mp3
//   avatar      HeyGen avatar lip-synced to that audio -> build/avatar/*.mp4
//   assemble    ffmpeg rough cut (slides/b-roll + avatar PiP) -> build/final.mp4
//   shownotes   Claude-generated titles/description/chapters -> build/*.md,*.txt
//   all         prep -> voice -> avatar -> assemble -> shownotes
//   doctor      Check API keys + ffmpeg/ffprobe availability
//
// Flags: --lecture <id|path>  --force  --dry-run  --skip-avatar

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnv, log, readJSON, writeJSON, ensureDir, exists,
  probeDuration, concatMedia, haveBinary, fmtTimecode,
} from './lib/util.mjs';
import { parseScript } from './lib/script.mjs';
import { synthesizeScene } from './lib/elevenlabs.mjs';
import { renderSceneAvatar } from './lib/heygen.mjs';
import { assembleLecture } from './lib/assemble.mjs';
import { exportPremiere } from './lib/premiere.mjs';
import { generateMetadata } from './lib/anthropic.mjs';

loadEnv();
const ROOT = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

function resolveLecture(flag) {
  if (!flag || flag === true) {
    log.err('Specify a lecture with --lecture <id> (a folder under pipeline/lectures/).');
    process.exit(1);
  }
  const dir = path.isAbsolute(flag) ? flag
    : exists(path.join(ROOT, 'lectures', flag)) ? path.join(ROOT, 'lectures', flag)
    : path.resolve(flag);
  const scriptPath = exists(path.join(dir, 'script.md')) ? path.join(dir, 'script.md') : dir;
  const lectureDir = fs.statSync(scriptPath).isFile() ? path.dirname(scriptPath) : dir;
  return { dir: lectureDir, scriptPath, buildDir: path.join(lectureDir, 'build') };
}

const stripBreaks = (t) => t.replace(/<break[^>]*\/>/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdPrep(ctx) {
  log.step(`Prep: parsing ${path.relative(process.cwd(), ctx.scriptPath)}`);
  const manifest = parseScript(ctx.scriptPath);
  ensureDir(ctx.buildDir);
  writeJSON(path.join(ctx.buildDir, 'manifest.json'), manifest);
  const transcript = manifest.scenes.map((s) => stripBreaks(s.text)).join('\n\n');
  fs.writeFileSync(path.join(ctx.buildDir, 'transcript.txt'), transcript);
  log.ok(`${manifest.stats.sceneCount} scenes, ~${manifest.stats.estWords.toLocaleString()} words, ${manifest.chapters.length} chapters`);
  log.dim(`manifest -> ${path.relative(process.cwd(), path.join(ctx.buildDir, 'manifest.json'))}`);
  return manifest;
}

function loadManifest(ctx) {
  const f = path.join(ctx.buildDir, 'manifest.json');
  if (!exists(f)) { log.err("No manifest. Run 'prep' first."); process.exit(1); }
  return readJSON(f);
}

async function cmdVoice(ctx, flags) {
  const manifest = loadManifest(ctx);
  log.step(`Voice: ElevenLabs TTS for ${manifest.scenes.length} scenes`);
  const audioDir = path.join(ctx.buildDir, 'audio');
  ensureDir(audioDir);
  const haveFfprobe = await haveBinary('ffprobe');
  for (const scene of manifest.scenes) {
    const out = path.join(audioDir, `scene-${scene.id}.mp3`);
    if (exists(out) && !flags.force) { log.dim(`scene ${scene.id}: cached`); }
    else {
      log.info(`scene ${scene.id} (${scene.charCount} chars): ${scene.name}`);
      await synthesizeScene(scene.text, out, { voiceId: manifest.voiceId });
    }
    scene.audioPath = path.relative(ctx.buildDir, out);
    scene.durationSec = haveFfprobe ? await probeDuration(out) : scene.durationSec || 0;
  }
  writeJSON(path.join(ctx.buildDir, 'manifest.json'), manifest);
  if (haveFfprobe) {
    const full = path.join(audioDir, 'full-audio.mp3');
    await concatMedia(manifest.scenes.map((s) => path.join(audioDir, `scene-${s.id}.mp3`)), full);
    const total = manifest.scenes.reduce((n, s) => n + (s.durationSec || 0), 0);
    log.ok(`audio rendered — total runtime ${fmtTimecode(total)} (${full.split('/').pop()})`);
  } else {
    log.warn('ffprobe not found — durations unknown (chapters/assembly need it). Install ffmpeg.');
  }
  return manifest;
}

async function cmdAvatar(ctx, flags) {
  if (flags['skip-avatar']) { log.warn('skip-avatar set — skipping HeyGen.'); return loadManifest(ctx); }
  const manifest = loadManifest(ctx);
  log.step(`Avatar: HeyGen render for ${manifest.scenes.length} scenes`);
  const avatarDir = path.join(ctx.buildDir, 'avatar');
  ensureDir(avatarDir);
  for (const scene of manifest.scenes) {
    const out = path.join(avatarDir, `scene-${scene.id}.mp4`);
    const audio = path.join(ctx.buildDir, 'audio', `scene-${scene.id}.mp3`);
    if (!exists(audio)) { log.err(`No audio for scene ${scene.id}. Run 'voice' first.`); process.exit(1); }
    if (exists(out) && !flags.force) { log.dim(`scene ${scene.id}: cached`); continue; }
    log.info(`scene ${scene.id}: uploading audio + rendering avatar…`);
    await renderSceneAvatar({ audioPath: audio, outPath: out, avatarId: manifest.avatarId });
    log.ok(`scene ${scene.id} avatar done`);
  }
  return manifest;
}

async function cmdAssemble(ctx, flags) {
  const manifest = loadManifest(ctx);
  if (!flags['dry-run'] && !(await haveBinary('ffmpeg'))) { log.err("ffmpeg not found — required for 'assemble'. Install it and retry."); process.exit(1); }
  const edlPath = path.join(ctx.dir, 'edl.json');
  const opts = exists(edlPath) ? readJSON(edlPath) : {};
  await assembleLecture(ctx.buildDir, manifest, { ...opts, dryRun: !!flags['dry-run'] });
  return manifest;
}

function assemblyConfig(ctx) {
  const edlPath = path.join(ctx.dir, 'edl.json');
  const opts = exists(edlPath) ? readJSON(edlPath) : {};
  return {
    width: opts.width || 1920,
    height: opts.height || 1080,
    fps: opts.fps || 30,
    avatarScale: opts.avatarScale ?? Number(process.env.AVATAR_SCALE || 0.28),
    avatarPosition: opts.avatarPosition || process.env.AVATAR_POSITION || 'bottom-right',
    margin: opts.margin ?? Number(process.env.AVATAR_MARGIN || 40),
  };
}

async function cmdProject(ctx, flags) {
  const manifest = loadManifest(ctx);
  const target = (flags.target || 'premiere').toString().toLowerCase();
  if (target !== 'premiere') { log.err(`Unsupported --target '${target}'. Supported: premiere.`); process.exit(1); }
  log.step('Project: exporting an editable Premiere (FCP7 XML) timeline');
  if (!manifest.scenes.some((s) => s.durationSec)) {
    log.warn("No scene durations yet — run 'voice' first so the timeline can be timed. Exporting anyway (gaps).");
  }
  exportPremiere(manifest, ctx.buildDir, assemblyConfig(ctx));
  log.dim('Import into Premiere: File ▸ Import ▸ select the .premiere.xml');
  return manifest;
}

async function cmdShownotes(ctx) {
  const manifest = loadManifest(ctx);
  log.step('Show notes: chapters + metadata');
  // Real chapter timestamps from cumulative scene durations.
  let t = 0;
  const sceneStart = {};
  for (const s of manifest.scenes) { sceneStart[s.id] = t; t += s.durationSec || 0; }
  const chapters = manifest.chapters.map((c) => ({ ...c, start: sceneStart[c.sceneId] ?? 0 }));
  if (chapters.length && chapters[0].start !== 0) chapters.unshift({ title: manifest.title, start: 0 });

  const chaptersTxt = chapters.map((c) => `${fmtTimecode(c.start)} ${c.title}`).join('\n');
  fs.writeFileSync(path.join(ctx.buildDir, 'chapters.txt'), chaptersTxt + '\n');
  log.ok(`chapters.txt (${chapters.length} chapters)`);

  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn('No ANTHROPIC_API_KEY — wrote chapters.txt only (skipping AI titles/description).');
    return;
  }
  const transcript = exists(path.join(ctx.buildDir, 'transcript.txt'))
    ? fs.readFileSync(path.join(ctx.buildDir, 'transcript.txt'), 'utf8')
    : manifest.scenes.map((s) => stripBreaks(s.text)).join('\n\n');
  const meta = await generateMetadata({ title: manifest.title, transcript, chapters });
  writeJSON(path.join(ctx.buildDir, 'metadata.json'), meta);

  const md = [
    `# ${manifest.title}`, '',
    '## Title options', ...(meta.titles || []).map((x) => `- ${x}`), '',
    '## Description', '', meta.description || '', '',
    '## Chapters', '```', chaptersTxt, '```', '',
    '## Key takeaways', ...(meta.takeaways || []).map((x) => `- ${x}`), '',
    '## Tags', (meta.tags || []).join(', '), '',
  ].join('\n');
  fs.writeFileSync(path.join(ctx.buildDir, 'shownotes.md'), md);
  log.ok('shownotes.md + metadata.json');
}

async function cmdDoctor() {
  log.step('Doctor: environment check');
  const checks = [
    ['ELEVENLABS_API_KEY', !!process.env.ELEVENLABS_API_KEY],
    ['ELEVENLABS_VOICE_ID', !!process.env.ELEVENLABS_VOICE_ID],
    ['HEYGEN_API_KEY', !!process.env.HEYGEN_API_KEY],
    ['HEYGEN_AVATAR_ID', !!process.env.HEYGEN_AVATAR_ID],
    ['ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
  ];
  for (const [k, ok] of checks) ok ? log.ok(`${k} set`) : log.warn(`${k} missing`);
  for (const bin of ['ffmpeg', 'ffprobe']) {
    (await haveBinary(bin)) ? log.ok(`${bin} found`) : log.warn(`${bin} not found (needed for audio durations + assembly)`);
  }
  log.info(`node ${process.version}`);
}

async function cmdAll(ctx, flags) {
  await cmdPrep(ctx);
  await cmdVoice(ctx, flags);
  await cmdAvatar(ctx, flags);
  await cmdAssemble(ctx, flags);
  await cmdProject(ctx, flags);
  await cmdShownotes(ctx);
  log.step('Done. Edit build/*.premiere.xml in Premiere (or use build/final.mp4 as a flat preview), and use build/shownotes.md when posting.');
}

// ---------------------------------------------------------------------------
const HELP = `lecture-video pipeline

  node pipeline/lecture.mjs <command> --lecture <id> [--force] [--dry-run] [--skip-avatar] [--target premiere]

commands: prep | voice | avatar | assemble | project | shownotes | all | doctor
  project   export an editable Premiere timeline (FCP7 XML): V1 slides/b-roll, V2 avatar PiP, A1 voiceover`;

async function main() {
  const { _: positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === 'help' || flags.help) { console.log(HELP); return; }
  if (command === 'doctor') return cmdDoctor();

  const ctx = resolveLecture(flags.lecture);
  if (!exists(ctx.scriptPath)) { log.err(`No script.md found at ${ctx.dir}`); process.exit(1); }

  switch (command) {
    case 'prep': return void (await cmdPrep(ctx));
    case 'voice': return void (await cmdVoice(ctx, flags));
    case 'avatar': return void (await cmdAvatar(ctx, flags));
    case 'assemble': return void (await cmdAssemble(ctx, flags));
    case 'project': return void (await cmdProject(ctx, flags));
    case 'shownotes': return void (await cmdShownotes(ctx));
    case 'all': return cmdAll(ctx, flags);
    default: log.err(`Unknown command '${command}'.`); console.log(HELP); process.exit(1);
  }
}

main().catch((err) => { log.err(err.message); if (process.env.DEBUG) console.error(err); process.exit(1); });
