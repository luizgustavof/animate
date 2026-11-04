#!/usr/bin/env node
// Publish a finished piece to the channel's platforms: the video from <piece>/renders/, the words from <piece>/publish/meta.json,
// the record of what went where in <piece>/publish/state.json (so nothing is ever posted twice, and an interrupted upload resumes).
// The flow itself lives in lib/publisher.mjs (shared with the studio, tools/studio.mjs); this file turns its events into lines.
//   node tools/publish.mjs setup [--no-wait]                 one-time setup, step by step: finds the Google key in Downloads, signs
//                                                            each channel in; --no-wait only reports what's missing (exit 2)
//   node tools/publish.mjs next                              the episodes rendered but not yet posted, oldest first
//   node tools/publish.mjs channels                          the channels and which platforms each is signed in to
//   node tools/publish.mjs auth <channel> <platform>         sign a channel in, once (opens the browser)
//   node tools/publish.mjs status [piece]                    per piece: render, meta, and each post (scheduled / public / link)
//   node tools/publish.mjs check <piece> [options]           validate the meta and the video and print the request; sends nothing
//   node tools/publish.mjs post <piece> [options]            upload
//   node tools/publish.mjs unpost <piece> --key C/P --yes   delete a post on the platform (irreversible; asks the user first)
//   node tools/publish.mjs stats [piece]                     views / likes / comments into state.json, best first
// options:
//   --channel C         the channel in publish/channels.json (default: the one whose "series" is the piece's, or the only one)
//   --platform P[,P]    default: every platform the channel has that this tool can post to
//   --at next           the channel's next free "schedule" slot;  --at "2026-11-05 19:00" (this computer's time zone) or ISO
//   --privacy V         public | unlisted | private, overrides the channel (a first test: --privacy private)
//   --dry-run           same as check
//   --force             post again even though state.json says it was posted
// Platforms: lib/platforms.mjs (youtube today; tiktok and instagram planned, see docs/architecture.md).
import fs from 'node:fs';
import path from 'node:path';
import { resolvePiece, listPieces, loadChannels, metaFile, loadState, videoFile, probe } from './lib/store.mjs';
import { PLATFORMS, platformState } from './lib/platforms.mjs';
import { overview, publish, unpublish, refreshStats } from './lib/publisher.mjs';
import { clientDownload } from './lib/setup.mjs';
import * as youtube from './platforms/youtube.mjs';
import { openBrowser } from './lib/oauth.mjs';

const USAGE = 'usage: node tools/publish.mjs setup [--no-wait] | next | channels | auth <channel> <platform> | status [piece] | check <piece> | post <piece> [--channel C] [--platform P] [--at next|"YYYY-MM-DD HH:MM"] [--privacy V] [--dry-run] [--force] | unpost <piece> --key channel/platform --yes | stats [piece]';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name) => argv.includes(`--${name}`);
const VALUED = new Set(['--channel', '--platform', '--at', '--privacy']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const [cmd, ...args] = positional;

const mb = n => `${(n / 2 ** 20).toFixed(0)} MB`;
const when = d => d ? new Date(d).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '';
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };
const why = { planned: 'not built yet', unknown: 'unknown platform' };

function cmdChannels() {
  const channels = loadChannels(process.cwd());
  for (const [name, c] of Object.entries(channels)) {
    console.log(`${name}  ${c.name || ''}${c.series ? `  (series: ${c.series})` : ''}`);
    for (const [p, cfg] of Object.entries(c.platforms || {})) {
      const account = cfg.account || name;
      const st = platformState(p);
      const who = st === 'ready' ? PLATFORMS[p].connected(account) : null;
      const line = st !== 'ready' ? why[st]
        : who ? `signed in: ${who.title} (${who.id})` : `not signed in: node tools/publish.mjs auth ${account} ${p}`;
      console.log(`  ${p.padEnd(10)} ${line}`);
    }
  }
}

async function cmdAuth() {
  const [account, platform] = args;
  if (!account || !platform) fail('usage: auth <channel or account> <platform>');
  const st = platformState(platform);
  if (st !== 'ready') fail(st === 'planned' ? `${platform} is not built yet` : `unknown platform ${platform}`);
  const who = await PLATFORMS[platform].auth(account);
  console.log(`signed in "${account}" on ${platform}: ${who.title} (${who.id})`);
  console.log('If that is not the channel you meant, run auth again and pick the right account / brand channel.');
}

function cmdStatus() {
  const root = process.cwd();
  const pieces = args[0] ? [resolvePiece(args[0])] : listPieces(root);
  if (!pieces.length) { console.log('no pieces'); return; }
  for (const p of pieces) {
    let render = 'no render';
    try { const f = videoFile(p); const v = probe(f); render = `${path.basename(f)} ${mb(v.bytes)} ${v.duration.toFixed(0)}s ${v.width}x${v.height}`; } catch {}
    const meta = fs.existsSync(metaFile(p)) ? 'meta ok' : 'no meta';
    console.log(`${p.slug.padEnd(22)} ${render}  ·  ${meta}`);
    for (const [key, e] of Object.entries(loadState(p).posts)) {
      const s = e.status === 'scheduled' ? `scheduled ${when(e.publishAt)}` : e.status;
      const st = e.stats ? `  ${e.stats.views} views, ${e.stats.likes} likes` : '';
      console.log(`  ${key.padEnd(20)} ${s.padEnd(26)} ${e.url || ''}${st}`);
    }
  }
}

async function cmdPost({ dryRun }) {
  if (!args[0]) fail(USAGE);
  const p = resolvePiece(args[0]);
  const { ok } = await publish(p, {
    channel: opt('channel'), platform: opt('platform'), at: opt('at'), privacy: opt('privacy'), force: flag('force'), dryRun,
  }, (e) => {
    if (e.type === 'skip') console.log(`skip ${e.platform} (${e.reason})`);
    else if (e.type === 'already') console.log(`\n${p.slug} → ${e.key}\n  already posted (${e.entry.status}): ${e.entry.url}  (--force to post again)`);
    else if (e.type === 'item') {
      console.log(`\n${p.slug} → ${e.key}`);
      console.log(`  file: ${e.file}  ${mb(e.video.bytes)}, ${e.video.duration.toFixed(1)}s, ${e.video.width}x${e.video.height}`);
      if (e.publishAt) console.log(`  goes public: ${when(e.publishAt)} (${e.publishAt.toISOString()})`);
      for (const w of e.warnings) console.log(`  warning: ${w}`);
      for (const x of e.errors) console.log(`  ERROR: ${x}`);
      if (dryRun && !e.errors.length) {
        console.log(`  account: ${e.account} (${e.connected?.title || 'not signed in'})`);
        console.log(JSON.stringify(e.request, null, 2).replace(/^/gm, '  '));
      }
    }
    else if (e.type === 'log') console.log(`  ${e.message}`);
    else if (e.type === 'progress') process.stdout.write(`\r  uploading ${(100 * e.sent / e.total).toFixed(0)}%  ${mb(e.sent)}/${mb(e.total)}  ${e.mbps.toFixed(1)} MB/s   ${e.sent === e.total ? '\n' : ''}`);
    else if (e.type === 'done') {
      console.log(`  done: ${e.entry.url}  (${e.entry.status}${e.entry.publishAt ? ` until ${when(e.entry.publishAt)}` : ''})`);
      if (e.entry.warning) console.log(`  warning: ${e.entry.warning}`);
    }
    else if (e.type === 'failed') console.log(`  FAILED: ${e.error}`);
  });
  if (!ok) process.exit(1);
}

// take a post back: deletes it on the platform. Irreversible, so it needs --yes (an agent asks the user in chat first).
async function cmdUnpost() {
  const p = resolvePiece(args[0] || fail(USAGE));
  const key = opt('key') || fail('which post? --key channel/platform (see: status ' + p.slug + ')');
  const e = loadState(p).posts[key] || fail(`nothing posted as ${key}`);
  if (!flag('yes')) fail(`this deletes ${e.url || key} (${e.status}) on ${e.platform} and can't be undone. Run again with --yes once the user said yes.`);
  await unpublish(p, { key }, (ev) => { if (ev.type === 'log') console.log(`  ${ev.message}`); });
  console.log(`removed ${key}: ${e.url || e.id || ''} (kept in state.json → removed)`);
}

async function cmdStats() {
  const root = process.cwd();
  const pieces = args[0] ? [resolvePiece(args[0])] : listPieces(root);
  const rows = await refreshStats(pieces, (e) => console.log(e.error));
  for (const r of rows) console.log(`${String(r.views).padStart(8)} views ${String(r.likes).padStart(6)} likes ${String(r.comments).padStart(5)} comments  ${r.slug}  ${r.key}  "${r.title}"`);
  if (!rows.length) console.log('nothing posted yet');
}

async function cmdSetup() {
  const noWait = flag('no-wait');
  const channels = loadChannels(process.cwd());
  const yt = Object.entries(channels).filter(([, c]) => c.platforms?.youtube);
  let missing = 0;

  if (yt.length && !youtube.hasClient()) {
    let found = clientDownload();
    if (!found && noWait) { console.log('missing: the Google key (google-oauth-client.json). docs/connect-youtube.md, steps 1-3.'); missing++; }
    if (!found && !noWait) {
      console.log('Step 1 of 2: the Google key.');
      console.log('In the page that opens: create the OAuth client (type "Desktop app") and click Download JSON.');
      console.log('Leave it in Downloads; this window picks it up by itself. (Waiting up to 15 minutes.)');
      openBrowser('https://console.cloud.google.com/auth/clients');
      const start = Date.now() - 5000;
      while (!found && Date.now() - start < 15 * 60e3) {
        await new Promise(r => setTimeout(r, 2000));
        found = clientDownload(start);
      }
      if (!found) fail('no client_secret_*.json showed up in Downloads');
    }
    if (found) { youtube.importClient(found); console.log(`got the Google key (moved out of Downloads into ${path.dirname(youtube.CLIENT)})`); }
  }

  for (const [name, c] of yt) {
    const account = c.platforms.youtube.account || name;
    const who = youtube.connected(account);
    if (who) { console.log(`${name}: YouTube connected to "${who.title}"`); continue; }
    if (noWait || !youtube.hasClient()) { console.log(`missing: ${name} is not signed in to YouTube (setup signs it in)`); missing++; continue; }
    console.log(`\nStep 2 of 2: sign "${c.name || name}" in. Pick the Google account AND the channel "${c.name || name}", then Allow.`);
    const got = await youtube.auth(account);
    console.log(`${name}: YouTube connected to "${got.title}"`);
  }
  if (missing) process.exit(2);
  console.log('\nAll set. Tell Claude: "publica".');
}

// rendered, in a channel's series, and not yet on every platform of that channel that this tool can post to
function cmdNext() {
  const rows = overview(process.cwd(), { strict: true }).filter(r => r.channel && r.render && r.todo.length);
  for (const r of rows) console.log(`${r.slug.padEnd(22)} ${r.channel}  ${r.todo.join(', ')}  ${r.meta ? 'meta ok' : 'no meta yet'}  "${r.title}"`);
  if (!rows.length) console.log('nothing waiting: every rendered episode is posted');
}

try {
  if (cmd === 'setup') await cmdSetup();
  else if (cmd === 'next') cmdNext();
  else if (cmd === 'channels') cmdChannels();
  else if (cmd === 'auth') await cmdAuth();
  else if (cmd === 'status') cmdStatus();
  else if (cmd === 'check') await cmdPost({ dryRun: true });
  else if (cmd === 'post') await cmdPost({ dryRun: flag('dry-run') });
  else if (cmd === 'unpost') await cmdUnpost();
  else if (cmd === 'stats') await cmdStats();
  else fail(USAGE);
} catch (e) {
  fail(e.message);
}
