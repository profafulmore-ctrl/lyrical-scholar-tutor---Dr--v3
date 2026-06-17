// ffmpeg "rough cut" assembler.
//
// Composites, per scene: a background (b-roll clip OR slide image OR solid
// color) + your avatar as a picture-in-picture overlay + the scene's voiceover.
// Scenes are then concatenated into one mp4. The result is a rough cut you can
// drop straight into Camtasia for final polish — or post as-is.
//
// It intentionally does NOT try to be a full NLE. Timing comes from the audio;
// b-roll/slide choices come from the script hints (or an optional edl.json).

import fs from 'node:fs';
import path from 'node:path';
import { run, concatMedia, ensureDir, exists, log } from './util.mjs';

const POS = {
  'bottom-right': 'main_w-overlay_w-{m}:main_h-overlay_h-{m}',
  'bottom-left': '{m}:main_h-overlay_h-{m}',
  'top-right': 'main_w-overlay_w-{m}:{m}',
  'top-left': '{m}:{m}',
};

function resolveAsset(buildDir, sub, name) {
  if (!name) return null;
  const direct = path.isAbsolute(name) ? name : path.join(buildDir, sub, name);
  if (exists(direct)) return direct;
  const flat = path.join(buildDir, name);
  return exists(flat) ? flat : null;
}

// Render a single scene to an mp4.
async function renderScene(scene, buildDir, cfg) {
  const { width, height, fps, avatarScale, avatarPosition, margin } = cfg;
  const audio = path.join(buildDir, 'audio', `scene-${scene.id}.mp3`);
  if (!exists(audio) && !cfg.dryRun) throw new Error(`Missing audio for scene ${scene.id}: ${audio}. Run the 'voice' step first.`);

  const brollName = scene.broll && scene.broll[0];
  const broll = resolveAsset(buildDir, 'broll', brollName);
  const slide = resolveAsset(buildDir, 'slides', scene.slide || `${scene.id}.png`);
  const avatar = path.join(buildDir, 'avatar', `scene-${scene.id}.mp4`);
  const hasAvatar = exists(avatar);
  const dur = scene.durationSec || 0;

  const args = ['-y'];
  let bgIdx;
  if (broll) { args.push('-stream_loop', '-1', '-i', broll); bgIdx = 0; }
  else if (slide) { args.push('-loop', '1', '-i', slide); bgIdx = 0; }
  else { args.push('-f', 'lavfi', '-i', `color=c=${cfg.bgColor}:s=${width}x${height}:r=${fps}`); bgIdx = 0; }

  let avatarIdx = -1, audioIdx;
  if (hasAvatar) { args.push('-i', avatar); avatarIdx = 1; audioIdx = 2; }
  else { audioIdx = 1; }
  args.push('-i', audio);

  const fc = [];
  const isSlideBg = !broll && !!slide;
  const wantZoom = (cfg.zoom || scene.zoom) && isSlideBg;
  if (wantZoom) {
    // Gentle Ken Burns on static slides for visual energy (emphasis mechanism).
    const frames = Math.max(1, Math.round((dur || 6) * fps));
    fc.push(
      `[${bgIdx}:v]scale=${Math.round(width * 1.15)}:-2,` +
      `zoompan=z='min(zoom+0.0004,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},` +
      `format=yuv420p,setsar=1[bg]`);
  } else {
    fc.push(`[${bgIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p,setsar=1[bg]`);
  }
  let lastV = '[bg]';
  if (hasAvatar) {
    const aw = Math.round(avatarScale * width / 2) * 2; // even width
    const pos = POS[avatarPosition].replace(/\{m\}/g, String(margin));
    fc.push(`[${avatarIdx}:v]scale=${aw}:-2[pip]`);
    fc.push(`${lastV}[pip]overlay=${pos}:shortest=0[v]`);
    lastV = '[v]';
  }

  const out = path.join(buildDir, 'renders', `scene-${scene.id}.mp4`);
  ensureDir(path.dirname(out));
  args.push('-filter_complex', fc.join(';'));
  args.push('-map', lastV, '-map', `${audioIdx}:a`);
  args.push('-c:v', 'libx264', '-preset', cfg.preset, '-crf', String(cfg.crf), '-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
  args.push('-t', dur ? dur.toFixed(3) : '600', '-shortest', out);

  log.dim(`scene ${scene.id}: bg=${broll ? 'b-roll' : slide ? 'slide' : 'color'}${hasAvatar ? ' + avatar PiP' : ''}`);
  if (cfg.dryRun) { log.info(`ffmpeg ${args.join(' ')}`); return out; }
  await run('ffmpeg', args, { quiet: true });
  return out;
}

export async function assembleLecture(buildDir, manifest, opts = {}) {
  const cfg = {
    width: opts.width || 1920,
    height: opts.height || 1080,
    fps: opts.fps || 30,
    avatarScale: opts.avatarScale ?? Number(process.env.AVATAR_SCALE || 0.28),
    avatarPosition: opts.avatarPosition || process.env.AVATAR_POSITION || 'bottom-right',
    margin: opts.margin ?? Number(process.env.AVATAR_MARGIN || 40),
    bgColor: opts.bgColor || process.env.BG_COLOR || '0x101418',
    preset: opts.preset || 'medium',
    crf: opts.crf || 20,
    zoom: opts.zoom ?? (process.env.SLIDE_ZOOM === 'true'),
    captions: opts.captions ?? false,
    dryRun: !!opts.dryRun,
  };
  if (!POS[cfg.avatarPosition]) throw new Error(`Unknown avatar position '${cfg.avatarPosition}'. Use one of: ${Object.keys(POS).join(', ')}`);

  log.step(`Assembling rough cut (${manifest.scenes.length} scenes @ ${cfg.width}x${cfg.height})`);
  const sceneFiles = [];
  for (const scene of manifest.scenes) {
    sceneFiles.push(await renderScene(scene, buildDir, cfg));
  }
  if (cfg.dryRun) { log.warn('dry-run: printed commands only, no files written'); return null; }

  // Optional intro/outro stitched around the body.
  const intro = resolveAsset(buildDir, 'assets', 'intro.mp4');
  const outro = resolveAsset(buildDir, 'assets', 'outro.mp4');
  const sequence = [intro, ...sceneFiles, outro].filter(Boolean);

  const captionsPath = path.join(buildDir, 'captions.srt');
  const burn = cfg.captions && exists(captionsPath);
  const body = path.join(buildDir, burn ? 'final.nosub.mp4' : 'final.mp4');
  await concatMedia(sequence, body, { reencode: true });

  if (burn) {
    // Burn the SRT onto the concatenated timeline (its timings are global).
    const final = path.join(buildDir, 'final.mp4');
    const esc = captionsPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    await run('ffmpeg', ['-y', '-i', body, '-vf', `subtitles='${esc}'`,
      '-c:v', 'libx264', '-preset', cfg.preset, '-crf', String(cfg.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', final], { quiet: true });
    fs.rmSync(body, { force: true });
    log.ok(`final cut (captions burned in): ${final}`);
    return final;
  }
  log.ok(`final cut: ${body}`);
  return body;
}
