// What a channel still needs before it can post, and the one-time pieces of connecting: the Google key from Downloads, the sign-ins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChannels } from './store.mjs';
import { PLATFORMS, platformState } from './platforms.mjs';
import * as youtube from '../platforms/youtube.mjs';
import * as tiktok from '../platforms/tiktok.mjs';

// the newest Google client file in Downloads (Google names it client_secret_<id>.json)
export function clientDownload(since = 0) {
  const dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter(n => /^client_secret.*\.json$/i.test(n))
    .map(n => ({ f: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .filter(x => x.t >= since).sort((a, b) => b.t - a.t)[0]?.f || null;
}

// picks the key up from Downloads if it's there; true when the key is in place
export function ensureGoogleKey() {
  if (youtube.hasClient()) return true;
  const found = clientDownload();
  if (!found) return false;
  youtube.importClient(found);
  return true;
}

// per channel and platform: { state: 'ready' | 'planned' | 'unknown', connected: { id, title } | null, needs: [...] }
export function connections(root) {
  const channels = loadChannels(root);
  const googleKey = youtube.hasClient();
  const tiktokApp = tiktok.hasApp();
  const out = {};
  for (const [name, c] of Object.entries(channels)) {
    out[name] = {};
    for (const [platform, cfg] of Object.entries(c.platforms || {})) {
      const state = platformState(platform);
      const account = cfg.account || name;
      const connected = state === 'ready' ? PLATFORMS[platform].connected(account) : null;
      const needs = [];
      if (platform === 'youtube' && !googleKey) needs.push('google-key');
      if (platform === 'tiktok' && !tiktokApp) needs.push('tiktok-app');
      if (state === 'ready' && !connected) needs.push('sign-in');
      if (connected && cfg.channelId && connected.id !== cfg.channelId) needs.push('wrong-channel');
      if (connected && cfg.openId && connected.id !== cfg.openId) needs.push('wrong-channel');
      out[name][platform] = { state, account, connected, needs };
    }
  }
  return { googleKey, tiktokApp, channels: out };
}
