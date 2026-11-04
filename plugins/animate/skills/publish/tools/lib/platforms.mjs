// The platforms this tool can post to. A platform is one module in ../platforms/ (see docs/architecture.md → "Adding a platform").
import * as youtube from '../platforms/youtube.mjs';
import * as tiktok from '../platforms/tiktok.mjs';

export const PLATFORMS = { youtube, tiktok };
export const PLANNED = new Set(['instagram']);
export const LABELS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

// 'ready' (built), 'planned' (known, not built yet) or 'unknown'
export const platformState = (name) => PLATFORMS[name] ? 'ready' : PLANNED.has(name) ? 'planned' : 'unknown';
