// Show-notes / metadata generation via the Claude API (Anthropic Messages API).
//
// Produces post-ready assets from the lecture script: title options, a
// description, key takeaways, and tags. Chapter TIMESTAMPS are computed locally
// from real audio durations (see lecture.mjs) — the model only writes prose.
//
// Docs: https://docs.anthropic.com/en/api/messages

import { http, requireEnv } from './util.mjs';

const API = 'https://api.anthropic.com/v1/messages';

export async function generateMetadata({ title, transcript, chapters }) {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const system =
    'You write metadata for recorded university-style lecture videos. ' +
    'Return ONLY valid minified JSON, no markdown fences, matching exactly this shape: ' +
    '{"titles":[string x5],"description":string,"takeaways":[string],"tags":[string],"chapter_blurbs":[{"title":string,"blurb":string}]}. ' +
    'Titles are compelling but accurate (no clickbait). Description is 2-3 short paragraphs for a video page. ' +
    'takeaways: 4-7 bullets. tags: 8-15 lowercase keywords. chapter_blurbs: one short blurb per provided chapter, same order.';

  const user =
    `Lecture title: ${title}\n\n` +
    `Chapters (in order):\n${chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}\n\n` +
    `Transcript:\n${transcript.slice(0, 60000)}`;

  const res = await http(
    API,
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    },
    { label: 'Anthropic messages' },
  );
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Could not parse model JSON. Raw response:\n' + text.slice(0, 500));
  }
}
