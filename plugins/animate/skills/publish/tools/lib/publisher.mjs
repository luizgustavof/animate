// The publishing flow shared by the CLI (tools/publish.mjs) and the studio (tools/studio.mjs): which pieces wait, the next free
// slot, validate → upload → record in state.json, and the stats pull. Nothing here prints: progress goes out as events, so the
// CLI turns them into lines and the studio into a progress bar.
//   events: { type: 'skip', platform, reason }            a platform the channel has but this tool can't post to
//           { type: 'item', platform, key, ... }          what will be sent (file, video, time, warnings, errors, request)
//           { type: 'already', platform, entry }          posted before (force to post again)
//           { type: 'log', platform, message }            a line worth showing (channel, resume, retry)
//           { type: 'preparing', platform, done }       making the light copy first (done 0..1)
//           { type: 'progress', platform, sent, total, mbps }
//           { type: 'done', platform, entry }             the state.json entry, with the link
//           { type: 'failed', platform, error }
import fs from 'node:fs';
import path from 'node:path';
import {
  listPieces, loadChannels, channelFor, readJson, metaFile, loadState, saveState, videoFile, probe, lock,
} from './store.mjs';
import { PLATFORMS, platformState } from './platforms.mjs';
import { ensureLight } from './encode.mjs';

export class PublishError extends Error {}

export function platformsOf(channel, wanted) {
  const configured = Object.keys(channel.platforms || {});
  const list = wanted ? (Array.isArray(wanted) ? wanted : String(wanted).split(',')).map(s => s.trim()).filter(Boolean) : configured;
  const ready = [], skipped = [];
  for (const p of list) {
    if (!configured.includes(p)) throw new PublishError(`the channel has no "${p}" block in publish/channels.json`);
    const st = platformState(p);
    if (st === 'ready') ready.push(p);
    else skipped.push({ platform: p, reason: st === 'planned' ? 'not built yet' : 'unknown platform' });
  }
  return { ready, skipped };
}

// every time already taken on this channel and platform, across all pieces
function takenTimes(root, key) {
  const out = [];
  for (const p of listPieces(root)) {
    const e = loadState(p).posts[key];
    const t = e?.publishAt || e?.postedAt;
    if (t) out.push(new Date(t).getTime());
  }
  return out;
}

// the channel's next "schedule" slot (this computer's time zone) at least 30 min away and an hour clear of any post
export function nextSlot(root, channelName, channel, platform, { extraTaken = [] } = {}) {
  const slots = (channel.schedule || []).slice().sort();
  if (!slots.length) throw new PublishError('"next" needs a "schedule" on the channel, e.g. ["12:00", "19:00"]');
  const taken = [...takenTimes(root, `${channelName}/${platform}`), ...extraTaken];
  const now = Date.now();
  for (let day = 0; day < 60; day++) {
    for (const s of slots) {
      const [h, m] = s.split(':').map(Number);
      const d = new Date(); d.setDate(d.getDate() + day); d.setHours(h, m, 0, 0);
      if (d.getTime() < now + 30 * 60e3) continue;
      if (taken.some(t => Math.abs(t - d.getTime()) < 60 * 60e3)) continue;
      return d;
    }
  }
  throw new PublishError('no free schedule slot in the next 60 days');
}

// "next", "YYYY-MM-DD HH:MM" (local), an ISO time, a Date, or nothing (now)
export function parseAt(at, root, channelName, channel, platform) {
  if (!at) return null;
  if (at instanceof Date) return at;
  if (at === 'next') return nextSlot(root, channelName, channel, platform);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(at) ? at.replace(' ', 'T') : at);
  if (Number.isNaN(d.getTime())) throw new PublishError(`time "${at}": use next, "YYYY-MM-DD HH:MM" or an ISO time`);
  return d;
}

// one row per piece: render, meta, the channel it belongs to (strict: only a channel's series), posts, what's left to post
export function overview(root, { strict = false } = {}) {
  let channels = {};
  try { channels = loadChannels(root); } catch {}
  return listPieces(root).map(p => {
    let render = null;
    try { const f = videoFile(p); render = { file: path.basename(f), ...probe(f) }; } catch {}
    let hit = null;
    try { hit = channelFor(p, channels, undefined, { strict }); } catch {}
    const posts = loadState(p).posts;
    // what's left: built platforms this channel is connected to and hasn't posted to yet (an unconnected one isn't "left")
    const todo = hit ? Object.entries(hit[1].platforms || {}).filter(([pl, cfg]) => platformState(pl) === 'ready'
      && !posts[`${hit[0]}/${pl}`]?.id && PLATFORMS[pl].connected(cfg.account || hit[0])).map(([pl]) => pl) : [];
    return {
      p, slug: p.slug, title: p.piece.title || p.slug, series: p.piece.series || null,
      channel: hit?.[0] || null, render, meta: fs.existsSync(metaFile(p)), posts, todo,
    };
  });
}

// validate and (unless dryRun) upload one piece to its channel's platforms
//   opts: { channel, platform, at, privacy, force, dryRun, tiktok }   (tiktok: the per-post direct-post choices)
export async function publish(p, opts = {}, emit = () => {}) {
  const channels = loadChannels(p.root);
  const [channelName, channel] = channelFor(p, channels, opts.channel);
  const { ready: built, skipped } = platformsOf(channel, opts.platform);
  // by default only the platforms this channel is connected to; naming one (--platform) tries it and says what's missing
  const ready = opts.platform ? built : built.filter(pl => {
    const ok = PLATFORMS[pl].connected(channel.platforms[pl].account || channelName);
    if (!ok) skipped.push({ platform: pl, reason: 'not connected' });
    return ok;
  });
  for (const s of skipped) emit({ type: 'skip', ...s });
  if (!ready.length) throw new PublishError('nothing to post to');
  const meta = readJson(metaFile(p), null);
  if (!meta) throw new PublishError(`write ${metaFile(p)} first: title, description, captions per platform`);
  const release = opts.dryRun ? () => {} : lock(p);
  const results = [];
  try {
    for (const platform of ready) {
      const mod = PLATFORMS[platform];
      const cfg = { ...channel.platforms[platform] };
      const account = cfg.account || channelName;
      const key = `${channelName}/${platform}`;
      const prev = loadState(p).posts[key];
      if (prev?.id && !opts.force) { emit({ type: 'already', platform, key, entry: prev }); results.push({ platform, status: 'already', entry: prev }); continue; }

      // a platform with a light-copy recipe (TikTok) gets it made first; a failed encode falls back to the master
      if (!opts.dryRun) {
        try {
          await ensureLight(p, platform, {
            signal: opts.signal,
            log: (message) => emit({ type: 'log', platform, message }),
            onProgress: ({ done }) => emit({ type: 'preparing', platform, done }),
          });
        } catch (e) {
          if (opts.signal?.aborted) throw e;
          emit({ type: 'log', platform, message: `light copy failed, sending the master: ${e.message}` });
        }
      }
      const file = videoFile(p, cfg.file || 'final', platform);
      const video = probe(file);
      let publishAt;
      try { publishAt = parseAt(opts.at, p.root, channelName, channel, platform); }
      catch (e) { emit({ type: 'failed', platform, error: e.message }); results.push({ platform, status: 'failed', error: e.message }); continue; }
      const v = mod.validate({ meta, cfg, channel, video, publishAt, privacy: opts.privacy, tiktok: opts.tiktok });
      if (v.request && video?.duration) v.request.duration = video.duration;
      emit({
        type: 'item', platform, key, account, connected: mod.connected(account), file: path.relative(p.root, file), video, publishAt,
        warnings: v.warnings, errors: v.errors, request: v.request,
      });
      if (v.errors.length) { results.push({ platform, status: 'invalid', errors: v.errors }); continue; }
      if (opts.dryRun) { results.push({ platform, status: 'checked', warnings: v.warnings }); continue; }

      const resume = prev?.status === 'uploading' ? prev : null;
      try {
        const r = await mod.post({
          account, cfg, request: v.request, notify: v.notify, file, resume, signal: opts.signal,
          log: (message) => emit({ type: 'log', platform, message: String(message).trim() }),
          onProgress: (pr) => emit({ type: 'progress', platform, ...pr }),
          onSession: (s) => {
            const st = loadState(p);
            st.posts[key] = { platform, channel: channelName, account, status: 'uploading', file: path.relative(p.dir, file), ...s, startedAt: new Date().toISOString() };
            saveState(p, st);
          },
        });
        const st = loadState(p);
        st.posts[key] = {
          platform, channel: channelName, account, file: path.relative(p.dir, file),
          status: r.publishAt ? 'scheduled' : r.privacy,
          id: r.id, url: r.url, publishAt: r.publishAt, postedAt: new Date().toISOString(),
          title: v.request.snippet?.title || v.request.title, channelTitle: r.channelTitle,
          ...(r.warning ? { warning: r.warning } : {}),
        };
        saveState(p, st);
        emit({ type: 'done', platform, key, entry: st.posts[key] });
        results.push({ platform, status: 'done', entry: st.posts[key] });
      } catch (e) {
        emit({ type: 'failed', platform, error: e.message });
        results.push({ platform, status: 'failed', error: e.message });
      }
    }
  } finally {
    release();
  }
  return { channel: channelName, results, ok: results.every(r => ['done', 'already', 'checked'].includes(r.status)) };
}

// take a post back: delete it on the platform and move its state.json entry to `removed` (history, never silently lost).
// The piece then counts as not posted there, so it can be scheduled again.
export async function unpublish(p, { key }, emit = () => {}) {
  const release = lock(p);
  try {
    const st = loadState(p);
    const entry = st.posts[key];
    if (!entry) throw new PublishError(`nothing posted as ${key}`);
    const mod = PLATFORMS[entry.platform];
    if (entry.id) {
      if (!mod?.remove) throw new PublishError(`${entry.platform} can't delete posts from here yet: delete it in the app, then try again`);
      const r = await mod.remove(entry.account, entry.id, { log: (message) => emit({ type: 'log', platform: entry.platform, message: String(message).trim() }) });
      if (r.already) emit({ type: 'log', platform: entry.platform, message: 'it was already gone on the platform' });
    }
    const now = loadState(p);   // re-read: the sign-in above can take minutes
    now.removed = [...(now.removed || []), { ...entry, key, removedAt: new Date().toISOString() }];
    delete now.posts[key];
    saveState(p, now);
    emit({ type: 'removed', platform: entry.platform, key, entry });
    return { key, entry };
  } finally {
    release();
  }
}

// views / likes / comments for everything posted (all pieces, or the ones given), written into each state.json
// TikTok drafts the creator has since posted in the app: mark them posted (with the link when TikTok gives one)
// a scheduled post goes live on its own at publishAt (YouTube flips it to public): mark it so once the time has passed.
// No API call; the stats refresh still reads the real numbers later.
export function settleScheduled(pieces, now = Date.now()) {
  let changed = 0;
  for (const p of pieces) {
    const st = loadState(p);
    let dirty = false;
    for (const e of Object.values(st.posts)) {
      if (e.status !== 'scheduled' || !e.publishAt || Date.parse(e.publishAt) > now) continue;
      e.status = 'public'; e.publishedAt = e.publishAt; dirty = true; changed++;
    }
    if (dirty) saveState(p, st);
  }
  return changed;
}

export async function refreshDrafts(pieces) {
  const byAccount = {};
  for (const p of pieces) for (const [key, e] of Object.entries(loadState(p).posts)) {
    if (e.platform === 'tiktok' && e.status === 'draft' && e.id && PLATFORMS.tiktok?.drafts) (byAccount[e.account] ||= []).push({ p, key, id: e.id });
  }
  let changed = 0;
  for (const [account, items] of Object.entries(byAccount)) {
    let got;
    try { got = await PLATFORMS.tiktok.drafts(account, items.map(i => i.id)); } catch { continue; }
    for (const it of items) {
      const g = got[it.id];
      if (!g || g.status !== 'PUBLISH_COMPLETE') continue;
      const st = loadState(it.p);
      const e = st.posts[it.key];
      if (!e || e.status !== 'draft') continue;
      e.status = 'public'; e.publishedAt = new Date().toISOString();
      if (g.url) e.url = g.url;
      saveState(it.p, st);
      changed++;
    }
  }
  return changed;
}

export async function refreshStats(pieces, emit = () => {}) {
  const byAccount = {};   // platform/account → [{ p, key, id }]
  for (const p of pieces) {
    for (const [key, e] of Object.entries(loadState(p).posts)) {
      if (!e.id || !PLATFORMS[e.platform]?.stats) continue;
      // TikTok counts by post id, the number in the post link (a draft or a direct post keeps its publish_id in e.id)
      const id = e.platform === 'tiktok' ? (/\/video\/(\d+)/.exec(e.url || '')?.[1] ?? null) : e.id;
      if (!id) continue;
      (byAccount[`${e.platform}/${e.account}`] ||= []).push({ p, key, id });
    }
  }
  const rows = [];
  for (const [pa, items] of Object.entries(byAccount)) {
    const [platform, account] = pa.split('/');
    let got;
    try { got = await PLATFORMS[platform].stats(account, items.map(i => i.id)); }
    catch (e) { emit({ type: 'failed', platform, error: `${pa}: ${e.message}` }); continue; }
    for (const it of items) {
      const s = got[it.id];
      if (!s) continue;
      const st = loadState(it.p);
      st.posts[it.key].stats = { ...s, at: new Date().toISOString() };
      saveState(it.p, st);
      rows.push({ slug: it.p.slug, key: it.key, title: st.posts[it.key].title, url: st.posts[it.key].url, ...s });
    }
  }
  return rows.sort((a, b) => b.views - a.views);
}
