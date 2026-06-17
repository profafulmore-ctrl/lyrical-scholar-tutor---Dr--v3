// ElevenLabs text-to-speech in YOUR cloned voice.
//
// Handles long lecture scripts by chunking each scene under the request limit
// and stitching the audio back together with ffmpeg. Prosody continuity across
// chunks is preserved via previous_text / next_text / previous_request_ids.
//
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech

import fs from 'node:fs';
import path from 'node:path';
import { http, requireEnv, concatMedia, ensureDir, log } from './util.mjs';
import { chunkText } from './script.mjs';

const API = 'https://api.elevenlabs.io/v1';

export function voiceSettings() {
  return {
    stability: Number(process.env.ELEVEN_STABILITY ?? 0.5),
    similarity_boost: Number(process.env.ELEVEN_SIMILARITY ?? 0.8),
    style: Number(process.env.ELEVEN_STYLE ?? 0.0),
    use_speaker_boost: (process.env.ELEVEN_SPEAKER_BOOST ?? 'true') === 'true',
  };
}

async function ttsChunk({ text, voiceId, modelId, outputFormat, prevText, nextText, prevRequestIds }) {
  const apiKey = requireEnv('ELEVENLABS_API_KEY');
  const res = await http(
    `${API}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings(),
        previous_text: prevText || undefined,
        next_text: nextText || undefined,
        previous_request_ids: prevRequestIds.length ? prevRequestIds.slice(-3) : undefined,
      }),
    },
    { label: 'ElevenLabs TTS' },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const requestId = res.headers.get('request-id') || res.headers.get('x-request-id') || null;
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, requestId };
}

// Synthesize one scene's text into a single mp3 at outPath.
export async function synthesizeScene(text, outPath, { voiceId } = {}) {
  voiceId = voiceId || requireEnv('ELEVENLABS_VOICE_ID', 'This is your cloned-voice id.');
  const modelId = process.env.ELEVEN_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = process.env.ELEVEN_OUTPUT_FORMAT || 'mp3_44100_128';
  const maxChars = Number(process.env.ELEVEN_MAX_CHARS || 2500);

  ensureDir(path.dirname(outPath));
  const chunks = chunkText(text, maxChars);
  const prevRequestIds = [];

  if (chunks.length === 1) {
    const { buf } = await ttsChunk({ text: chunks[0], voiceId, modelId, outputFormat, prevRequestIds });
    fs.writeFileSync(outPath, buf);
    return outPath;
  }

  // Multiple chunks: render each, then concat.
  const partFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const { buf, requestId } = await ttsChunk({
      text: chunks[i],
      voiceId, modelId, outputFormat,
      prevText: chunks[i - 1]?.slice(-400),
      nextText: chunks[i + 1]?.slice(0, 400),
      prevRequestIds,
    });
    if (requestId) prevRequestIds.push(requestId);
    const part = `${outPath}.part${String(i + 1).padStart(2, '0')}.mp3`;
    fs.writeFileSync(part, buf);
    partFiles.push(part);
    log.dim(`chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
  }
  await concatMedia(partFiles, outPath);
  for (const p of partFiles) fs.rmSync(p, { force: true });
  return outPath;
}
