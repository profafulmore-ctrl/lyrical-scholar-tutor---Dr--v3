// HeyGen avatar video generation, lip-synced to YOUR ElevenLabs audio.
//
// Flow per scene:
//   1. Upload the scene's mp3 as a HeyGen audio asset.
//   2. Generate a video where your avatar/clone speaks that exact audio
//      (voice.type = "audio"), so the lips match your cloned voice.
//   3. Poll until the render completes, then download the mp4.
//
// Docs: https://docs.heygen.com/reference/create-an-avatar-video-v2

import fs from 'node:fs';
import path from 'node:path';
import { http, requireEnv, ensureDir, sleep, log } from './util.mjs';

const API = 'https://api.heygen.com';
const UPLOAD = 'https://upload.heygen.com';

function keyHeader() {
  return { 'X-Api-Key': requireEnv('HEYGEN_API_KEY') };
}

// Upload a local audio file; returns the HeyGen audio asset id.
export async function uploadAudioAsset(filePath) {
  const data = fs.readFileSync(filePath);
  const res = await http(
    `${UPLOAD}/v1/asset`,
    { method: 'POST', headers: { ...keyHeader(), 'Content-Type': 'audio/mpeg' }, body: data },
    { label: 'HeyGen upload' },
  );
  const json = await res.json();
  const id = json?.data?.id || json?.data?.asset_id;
  if (!id) throw new Error(`HeyGen upload returned no asset id: ${JSON.stringify(json).slice(0, 300)}`);
  return id;
}

// Build the character block for either an Instant Avatar or a Photo Avatar clone.
function characterBlock(avatarId) {
  const type = process.env.HEYGEN_AVATAR_TYPE || 'avatar'; // 'avatar' | 'talking_photo'
  const id = avatarId || requireEnv('HEYGEN_AVATAR_ID', 'Your HeyGen clone/avatar id.');
  if (type === 'talking_photo') {
    return { type: 'talking_photo', talking_photo_id: id };
  }
  return { type: 'avatar', avatar_id: id, avatar_style: process.env.HEYGEN_AVATAR_STYLE || 'normal' };
}

// Kick off a render; returns the HeyGen video_id.
export async function generateAvatarVideo({ audioAssetId, avatarId, width = 1920, height = 1080 }) {
  const body = {
    video_inputs: [
      {
        character: characterBlock(avatarId),
        voice: { type: 'audio', audio_asset_id: audioAssetId },
        background: process.env.HEYGEN_BACKGROUND_COLOR
          ? { type: 'color', value: process.env.HEYGEN_BACKGROUND_COLOR }
          : undefined,
      },
    ],
    dimension: { width, height },
  };
  const res = await http(
    `${API}/v2/video/generate`,
    { method: 'POST', headers: { ...keyHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { label: 'HeyGen generate' },
  );
  const json = await res.json();
  const videoId = json?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen generate failed: ${JSON.stringify(json).slice(0, 400)}`);
  return videoId;
}

// Poll until done; returns the downloadable video_url.
export async function waitForVideo(videoId, { timeoutMs = 30 * 60 * 1000, intervalMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await http(`${API}/v1/video_status.get?video_id=${videoId}`, { headers: keyHeader() }, { label: 'HeyGen status' });
    const json = await res.json();
    const status = json?.data?.status;
    if (status === 'completed') return json.data.video_url;
    if (status === 'failed') throw new Error(`HeyGen render failed: ${JSON.stringify(json?.data?.error || json).slice(0, 300)}`);
    log.dim(`avatar render: ${status || 'pending'}…`);
    await sleep(intervalMs);
  }
  throw new Error(`HeyGen render timed out after ${Math.round(timeoutMs / 60000)} min (video_id=${videoId})`);
}

export async function downloadTo(url, outPath) {
  ensureDir(path.dirname(outPath));
  const res = await http(url, {}, { label: 'HeyGen download' });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

// Full per-scene helper: audio file in -> avatar mp4 out.
export async function renderSceneAvatar({ audioPath, outPath, avatarId, width, height }) {
  const assetId = await uploadAudioAsset(audioPath);
  const videoId = await generateAvatarVideo({ audioAssetId: assetId, avatarId, width, height });
  const url = await waitForVideo(videoId);
  return downloadTo(url, outPath);
}
