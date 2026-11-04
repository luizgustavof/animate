// Titles, descriptions, captions and hashtags for a piece, written by the user's own Claude Code (`claude -p`, no API key).
// The prompt is built here with everything inline (the spoken script, the brief, the series bible, the channel profile, what
// worked before), so Claude needs no tools and answers in one turn, as JSON matching SCHEMA.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJson, listPieces, loadState, metaFile } from './store.mjs';

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n[…]` : s || '');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates', 'chosen', 'why', 'youtube', 'tiktok', 'instagram'],
  properties: {
    candidates: {
      type: 'array', minItems: 5, maxItems: 5,
      items: { type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } },
    },
    chosen: { type: 'integer', minimum: 0, maximum: 4 },
    why: { type: 'string' },
    youtube: {
      type: 'object', additionalProperties: false, required: ['title', 'description', 'tags'],
      properties: { title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    },
    tiktok: { type: 'object', additionalProperties: false, required: ['caption'], properties: { caption: { type: 'string' } } },
    instagram: { type: 'object', additionalProperties: false, required: ['caption'], properties: { caption: { type: 'string' } } },
  },
};

// what the channel's best and worst posts were called (by views), for the "what works" lesson
function track(p, channelName) {
  const rows = [];
  for (const q of listPieces(p.root)) {
    for (const [key, e] of Object.entries(loadState(q).posts)) {
      if (key.startsWith(`${channelName}/`) && e.stats && e.title) rows.push({ title: e.title, views: e.stats.views, platform: e.platform });
    }
  }
  rows.sort((a, b) => b.views - a.views);
  return { best: rows.slice(0, 3), worst: rows.length > 3 ? rows.slice(-3) : [] };
}

export function context(p, channelName, channel) {
  const script = readJson(path.join(p.dir, 'voice', 'script.json'), null);
  const lines = script?.lines?.map(l => `- ${l.text}`).join('\n') || '';
  const brief = read(path.join(p.dir, 'brief.md'));
  const bible = p.piece.series ? read(path.join(p.root, p.piece.series, 'bible.md')) : '';
  const prev = readJson(metaFile(p), null);
  return { title: p.piece.title || p.slug, lines, brief, bible, prev, track: track(p, channelName), channel };
}

export function prompt(ctx, { feedback } = {}) {
  const c = ctx.channel;
  const lang = c.language || 'pt-BR';
  const t = ctx.track;
  return [
    `You write the publishing words for one short video on the channel "${c.name}". Write everything in ${lang}.`,
    '',
    '## The channel',
    `Audience: ${c.audience || '(not set)'}`,
    `Voice: ${c.voice || '(not set)'}`,
    `Hashtags always used: ${(c.hashtags?.always || []).join(' ') || '(none)'}`,
    `Hashtag pool to pick from (or add fitting new ones): ${(c.hashtags?.pool || []).join(' ') || '(none)'}`,
    t.best.length ? `Best performing titles so far:\n${t.best.map(r => `- "${r.title}" (${r.views} views)`).join('\n')}` : 'No performance data yet.',
    t.worst.length ? `Worst performing titles:\n${t.worst.map(r => `- "${r.title}" (${r.views} views)`).join('\n')}` : '',
    '',
    '## The video',
    `Working title: ${ctx.title}`,
    ctx.lines ? `What is spoken, line by line:\n${clip(ctx.lines, 6000)}` : '',
    ctx.brief ? `Brief:\n${clip(ctx.brief, 4000)}` : '',
    ctx.bible ? `Series bible (context; never spoil what the video doesn't reveal):\n${clip(ctx.bible, 5000)}` : '',
    ctx.prev?.youtube?.title ? `A previous draft title (do better or keep it): "${ctx.prev.youtube.title}"` : '',
    '',
    '## Rules',
    '- 5 title candidates, each with one short line on why; then pick the best (chosen = its index) and say why in one line.',
    '- A good title opens, in its first 40 characters, a question only the video answers; uses words people would search;',
    '  sounds like the channel voice, not an ad; keeps the series naming pattern if there is one.',
    '- True to the video: never promise what it does not show, never use another franchise or creator name, no fake "part 2".',
    '- YouTube: title at most 70 characters (hard limit 100), no < or >. Description: first line is the hook, then one or two',
    '  lines of context, then 3-5 hashtags at the end. tags: 3-6 search phrases without #.',
    '- TikTok caption: hook first, then 3-5 hashtags, under 300 characters. Instagram caption: hook within 125 characters,',
    '  a line of context, then 3-5 hashtags. Each platform written for its own feed, not copied.',
    feedback ? `\n## Fix this from your last attempt\n${feedback}` : '',
  ].filter(Boolean).join('\n');
}

export class WriterError extends Error {}

// runs `claude -p`; resolves to the parsed object matching SCHEMA
export function runClaude(text, { signal, model = process.env.STUDIO_WRITER_MODEL || 'sonnet', timeoutMs = 4 * 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--no-session-persistence', '--tools', '', '--model', model];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new WriterError('Claude took more than 4 minutes; try again')); }, timeoutMs);
    const onAbort = () => { child.kill(); reject(new WriterError('cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      reject(new WriterError(e.code === 'ENOENT' ? 'Claude Code is not installed on this computer (the "claude" command is missing)' : e.message));
    });
    child.on('close', () => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return;
      let j;
      try { j = JSON.parse(out); } catch { return reject(new WriterError(`Claude answered something unreadable: ${(err || out).slice(0, 300)}`)); }
      if (j.is_error) {
        const msg = String(j.result || '');
        if (/authenticate|log ?in|OAuth|credential/i.test(msg)) return reject(new WriterError('NEEDS_LOGIN: Claude Code is signed out on this computer. Open a terminal, run "claude" and sign in once.'));
        return reject(new WriterError(`Claude failed: ${msg.slice(0, 300)}`));
      }
      let data = j.structured_output;
      if (!data && typeof j.result === 'string') { try { data = JSON.parse(j.result.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {} }
      if (!data?.youtube?.title) return reject(new WriterError('Claude answered without the expected fields'));
      resolve(data);
    });
    child.stdin.end(text);
  });
}

// the meta.json shape the rest of the tool reads, from Claude's answer
export function toMeta(ans, lang) {
  return {
    language: lang,
    candidates: { youtube: ans.candidates.map(c => c.title) },
    reasons: { youtube: ans.candidates.map(c => c.why) },
    chosen: ans.chosen,
    why: ans.why,
    youtube: ans.youtube,
    tiktok: ans.tiktok,
    instagram: ans.instagram,
    writtenBy: 'claude -p',
    writtenAt: new Date().toISOString(),
  };
}

// write → validate with the platform's own rules → one retry with the errors
export async function write(p, channelName, channel, { signal, emit = () => {}, validate } = {}) {
  const ctx = context(p, channelName, channel);
  emit({ type: 'log', message: 'Lendo o roteiro e o perfil do canal' });
  let ans = await runClaude(prompt(ctx), { signal });
  let meta = toMeta(ans, channel.language || 'pt-BR');
  const errors = validate ? validate(meta) : [];
  if (errors.length) {
    emit({ type: 'log', message: 'Ajustando o que passou do limite' });
    ans = await runClaude(prompt(ctx, { feedback: errors.join('\n') }), { signal });
    meta = toMeta(ans, channel.language || 'pt-BR');
  }
  return meta;
}
