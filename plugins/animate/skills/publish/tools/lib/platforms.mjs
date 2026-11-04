// The platforms this tool can post to. A platform is one module in ../platforms/ (see docs/architecture.md → "Adding a platform").
import * as youtube from '../platforms/youtube.mjs';

export const PLATFORMS = { youtube };
export const PLANNED = new Set(['tiktok', 'instagram']);
export const LABELS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

// 'ready' (built), 'planned' (known, not built yet) or 'unknown'
export const platformState = (name) => PLATFORMS[name] ? 'ready' : PLANNED.has(name) ? 'planned' : 'unknown';
