// One drawn set, one stroke: 1.75 on a 20 grid, square caps like painted board arrows.
import type { SVGProps } from 'react';

const PATHS = {
  arrow: 'M4 10h11M11 5.5 15.5 10 11 14.5',
  back: 'M16 10H5M9 5.5 4.5 10 9 14.5',
  play: 'M7 5v10l8-5z',
  check: 'M4.5 10.5 8.5 14.5 15.5 6',
  x: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  plus: 'M10 4.5v11M4.5 10h11',
  clock: 'M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.5V10l2.5 2',
  refresh: 'M15.5 8A6 6 0 1 0 16 12M15.5 4v4h-4',
  spark: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.3 5.3l2.2 2.2M12.5 12.5l2.2 2.2M14.7 5.3l-2.2 2.2M7.5 12.5l-2.2 2.2',
  external: 'M8 5H5v10h10v-3M11 4h5v5M16 4l-7 7',
  stop: 'M6 6h8v8H6z',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.75 8.75v4.5M11.25 8.75v4.5',
  link: 'M8.5 11.5l3-3M7 9.5 5.5 11a2.5 2.5 0 0 0 3.5 3.5l1.5-1.5M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden focusable="false" {...rest}>
      <path d={PATHS[name]} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.75} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
