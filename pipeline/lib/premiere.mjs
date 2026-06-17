// Adobe Premiere Pro timeline export via FCP7 XML (XMEML v5).
//
// Premiere imports this as a real, editable sequence — no flattening:
//   V1  background  (slide image OR b-roll clip per scene)
//   V2  avatar      (your HeyGen clip, pre-scaled + positioned as a PiP via
//                    a Basic Motion filter you can tweak in Premiere's Motion)
//   A1  voiceover   (your ElevenLabs audio — the master clock)
//
// Timing comes from each scene's measured audio duration (build via `voice`,
// which records durationSec using ffprobe). Open the .xml with
// File ▸ Import in Premiere.

import fs from 'node:fs';
import path from 'node:path';
import { exists, log } from './util.mjs';

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const pathToUrl = (p) => 'file://' + encodeURI(path.resolve(p));
const secToFrames = (sec, fps) => Math.max(1, Math.round(sec * fps));

let _id = 0;
const uid = (p) => `${p}-${++_id}`;

function rateXml(fps) {
  return `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
}

function fileVideoXml(fileId, filePath, name, durFrames, fps, w, h) {
  return [
    `<file id="${xmlEsc(fileId)}">`,
    `<name>${xmlEsc(name)}</name>`,
    `<pathurl>${xmlEsc(pathToUrl(filePath))}</pathurl>`,
    rateXml(fps),
    `<duration>${durFrames}</duration>`,
    `<media><video><samplecharacteristics>${rateXml(fps)}<width>${w}</width><height>${h}</height>` +
      `<pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video></media>`,
    `</file>`,
  ].join('');
}

function fileAudioXml(fileId, filePath, name, durFrames, fps) {
  return [
    `<file id="${xmlEsc(fileId)}">`,
    `<name>${xmlEsc(name)}</name>`,
    `<pathurl>${xmlEsc(pathToUrl(filePath))}</pathurl>`,
    rateXml(fps),
    `<duration>${durFrames}</duration>`,
    `<media><audio><samplecharacteristics><depth>16</depth><samplerate>44100</samplerate></samplecharacteristics>` +
      `<channelcount>1</channelcount></audio></media>`,
    `</file>`,
  ].join('');
}

// Basic Motion filter → Premiere's Motion effect (scale + center for the PiP).
function pipFilter(scalePct, centerH, centerV) {
  return [
    '<filter><effect>',
    '<name>Basic Motion</name><effectid>basic</effectid>',
    '<effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>',
    `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${scalePct}</value></parameter>`,
    `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>${centerH}</horiz><vert>${centerV}</vert></value></parameter>`,
    '<parameter><parameterid>rotation</parameterid><name>Rotation</name><value>0</value></parameter>',
    '</effect></filter>',
  ].join('');
}

function videoClip({ filePath, name, start, end, durFrames, fps, w, h, filter }) {
  const fileId = uid('file');
  return [
    `<clipitem id="${uid('clip')}">`,
    `<name>${xmlEsc(name)}</name>`,
    `<enabled>TRUE</enabled>`,
    `<duration>${durFrames}</duration>`,
    rateXml(fps),
    `<start>${start}</start><end>${end}</end><in>0</in><out>${durFrames}</out>`,
    fileVideoXml(fileId, filePath, name, durFrames, fps, w, h),
    filter || '',
    `</clipitem>`,
  ].join('');
}

function audioClip({ filePath, name, start, end, durFrames, fps }) {
  const fileId = uid('file');
  return [
    `<clipitem id="${uid('clip')}">`,
    `<name>${xmlEsc(name)}</name>`,
    `<enabled>TRUE</enabled>`,
    `<duration>${durFrames}</duration>`,
    rateXml(fps),
    `<start>${start}</start><end>${end}</end><in>0</in><out>${durFrames}</out>`,
    fileAudioXml(fileId, filePath, name, durFrames, fps),
    `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`,
    `</clipitem>`,
  ].join('');
}

function resolveBackground(buildDir, scene) {
  const broll = scene.broll && scene.broll[0];
  if (broll) {
    const p = path.isAbsolute(broll) ? broll : path.join(buildDir, 'broll', broll);
    if (exists(p)) return { path: p, kind: 'broll' };
  }
  const slideName = scene.slide || `${scene.id}.png`;
  const sp = path.join(buildDir, 'slides', slideName);
  if (exists(sp)) return { path: sp, kind: 'slide' };
  return null;
}

export function buildPremiereXML(manifest, buildDir, cfg) {
  const { fps, width: w, height: h } = cfg;
  const v1 = []; // background
  const v2 = []; // avatar PiP
  const a1 = []; // voiceover
  const missing = [];

  // PiP geometry: bottom-right by default. FCP center is normalized to frame
  // center, +horiz = right, +vert = down. Derive from scale + margin.
  const scalePct = Math.round((cfg.avatarScale ?? 0.28) * 100);
  const half = (cfg.avatarScale ?? 0.28) / 2;
  const marginN = (cfg.margin ?? 40) / w;
  const posMap = {
    'bottom-right': [0.5 - half - marginN, 0.5 - half - (cfg.margin ?? 40) / h],
    'bottom-left': [-(0.5 - half - marginN), 0.5 - half - (cfg.margin ?? 40) / h],
    'top-right': [0.5 - half - marginN, -(0.5 - half - (cfg.margin ?? 40) / h)],
    'top-left': [-(0.5 - half - marginN), -(0.5 - half - (cfg.margin ?? 40) / h)],
  };
  const [centerH, centerV] = posMap[cfg.avatarPosition] || posMap['bottom-right'];

  let cursor = 0;
  for (const scene of manifest.scenes) {
    const durSec = scene.durationSec || 0;
    if (!durSec) { missing.push(`scene ${scene.id}: no duration (run 'voice' first)`); continue; }
    const durFrames = secToFrames(durSec, fps);
    const start = cursor;
    const end = cursor + durFrames;
    cursor = end;

    // V1 background
    const bg = resolveBackground(buildDir, scene);
    if (bg) v1.push(videoClip({ filePath: bg.path, name: `bg-${scene.id}`, start, end, durFrames, fps, w, h }));
    else missing.push(`scene ${scene.id}: no slide/b-roll (V1 gap)`);

    // V2 avatar PiP
    const avatar = path.join(buildDir, 'avatar', `scene-${scene.id}.mp4`);
    if (exists(avatar)) {
      v2.push(videoClip({ filePath: avatar, name: `avatar-${scene.id}`, start, end, durFrames, fps, w, h,
        filter: pipFilter(scalePct, centerH.toFixed(4), centerV.toFixed(4)) }));
    } else missing.push(`scene ${scene.id}: no avatar clip (V2 gap)`);

    // A1 voiceover
    const audio = path.join(buildDir, 'audio', `scene-${scene.id}.mp3`);
    if (exists(audio)) a1.push(audioClip({ filePath: audio, name: `vo-${scene.id}`, start, end, durFrames, fps }));
    else missing.push(`scene ${scene.id}: no audio (A1 gap)`);
  }

  const total = cursor;
  const seqName = manifest.title || 'Lecture';
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="5">`,
    `<sequence id="${uid('seq')}">`,
    `<name>${xmlEsc(seqName)}</name>`,
    `<duration>${total}</duration>`,
    rateXml(fps),
    `<media>`,
    `<video>`,
    `<format><samplecharacteristics>${rateXml(fps)}<width>${w}</width><height>${h}</height>` +
      `<pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>`,
    `<track>${v1.join('')}</track>`,
    `<track>${v2.join('')}</track>`,
    `</video>`,
    `<audio>`,
    `<track>${a1.join('')}</track>`,
    `</audio>`,
    `</media>`,
    `</sequence>`,
    `</xmeml>`,
  ].join('\n');

  return { xml, total, missing, fps };
}

export function exportPremiere(manifest, buildDir, cfg) {
  const { xml, total, missing, fps } = buildPremiereXML(manifest, buildDir, cfg);
  const safe = (manifest.title || 'lecture').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const out = path.join(buildDir, `${safe || 'lecture'}.premiere.xml`);
  fs.writeFileSync(out, xml);
  log.ok(`Premiere XML: ${path.relative(process.cwd(), out)} (${(total / fps).toFixed(1)}s on V1/V2/A1)`);
  if (missing.length) { log.warn(`${missing.length} gap(s):`); missing.forEach((m) => log.dim(m)); }
  return out;
}
