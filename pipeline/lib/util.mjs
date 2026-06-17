// Shared utilities: env loading, logging, HTTP, and ffmpeg/ffprobe wrappers.
// Zero external dependencies — Node 18+ (global fetch) required; Node 20+ recommended.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const COLORS = { gray: '\x1b[90m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const paint = (c, s) => (process.stdout.isTTY ? `${COLORS[c]}${s}${COLORS.reset}` : s);

export const log = {
  step: (m) => console.log(paint('cyan', `\n▸ ${m}`)),
  info: (m) => console.log(`  ${m}`),
  ok: (m) => console.log(paint('green', `  ✓ ${m}`)),
  warn: (m) => console.warn(paint('yellow', `  ! ${m}`)),
  err: (m) => console.error(paint('red', `  ✗ ${m}`)),
  dim: (m) => console.log(paint('gray', `  ${m}`)),
};

// ---------------------------------------------------------------------------
// .env loading (no dependency). Looks for pipeline/.env then repo-root .env.
// ---------------------------------------------------------------------------
export function loadEnv() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [path.join(here, '..', '.env'), path.join(here, '..', '..', '.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

export function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var ${name}.${hint ? ' ' + hint : ''} Set it in pipeline/.env (see .env.example).`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
export const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
export const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJSON = (f, obj) => { ensureDir(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); };
export const exists = (f) => fs.existsSync(f);

// ---------------------------------------------------------------------------
// HTTP with retry/backoff. Returns the raw Response so callers can read
// json() or arrayBuffer() as needed.
// ---------------------------------------------------------------------------
export async function http(url, opts = {}, { retries = 4, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => '');
        throw new Error(`${label} failed ${res.status}: ${body.slice(0, 300)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const wait = Math.min(2000 * 2 ** attempt, 16000);
      log.warn(`${label} retry ${attempt + 1}/${retries} in ${wait / 1000}s (${err.message})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe wrappers
// ---------------------------------------------------------------------------
export function run(cmd, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stderr = '';
    if (quiet && child.stderr) child.stderr.on('data', (d) => (stderr += d));
    let out = '';
    if (quiet && child.stdout) child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) =>
      reject(e.code === 'ENOENT' ? new Error(`'${cmd}' not found. Install it and ensure it is on your PATH.`) : e));
    child.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-1000)}`)));
  });
}

export async function haveBinary(cmd) {
  try { await run(cmd, ['-version'], { quiet: true }); return true; }
  catch { return false; }
}

export async function probeDuration(file) {
  const out = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { quiet: true });
  const sec = parseFloat(out);
  return Number.isFinite(sec) ? sec : 0;
}

// Concatenate same-codec media files via the ffmpeg concat demuxer.
export async function concatMedia(files, outPath, { reencode = false } = {}) {
  ensureDir(path.dirname(outPath));
  const listPath = outPath + '.concat.txt';
  fs.writeFileSync(listPath, files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n'));
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
  if (reencode) args.push('-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p');
  else args.push('-c', 'copy');
  args.push(outPath);
  try { await run('ffmpeg', args, { quiet: true }); }
  finally { fs.rmSync(listPath, { force: true }); }
  return outPath;
}

export function fmtTimecode(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
