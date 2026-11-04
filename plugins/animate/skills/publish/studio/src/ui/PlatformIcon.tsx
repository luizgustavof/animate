// The platforms' own marks, monochrome (currentColor), so a destination reads at a glance.
// YouTube and TikTok glyphs follow Simple Icons (CC0); the Instagram mark is drawn from primitives.
import type { PlatformId } from '../api/types';

const YT = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z';
const TT = 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

export const PLATFORM_NAME: Record<PlatformId, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

export function PlatformIcon({ id, size = 16, className = '', title }: { id: PlatformId | string; size?: number; className?: string; title?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', className, role: title ? 'img' : undefined, 'aria-hidden': title ? undefined : true, focusable: 'false' as const };
  const label = title ? <title>{title}</title> : null;
  if (id === 'youtube') return <svg {...common}>{label}<path d={YT} fill="currentColor" /></svg>;
  if (id === 'tiktok') return <svg {...common}>{label}<path d={TT} fill="currentColor" /></svg>;
  if (id === 'instagram') return (
    <svg {...common}>{label}
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="17.6" cy="6.4" r="1.35" fill="currentColor" />
    </svg>
  );
  return <svg {...common}>{label}<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
