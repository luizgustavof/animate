// Board controls: buttons as framed caps panels (amber = the one thing to do), lamps, the poster frame.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { m } from 'motion/react';
import { media } from '../api/client';
import { Icon, type IconName } from './Icon';

type Kind = 'primary' | 'frame' | 'quiet' | 'danger';
const KIND: Record<Kind, string> = {
  primary: 'bg-amber text-amber-ink border-amber hover:bg-[#ffc533] active:bg-[#e6a200] disabled:bg-steel-3 disabled:border-steel-3 disabled:text-ink-3',
  frame: 'bg-flap text-ink border-steel-3 hover:border-ink-2 hover:bg-flap-2 active:border-amber active:text-amber disabled:text-ink-3 disabled:border-rule',
  quiet: 'bg-transparent text-ink-2 border-transparent hover:text-ink hover:bg-flap-2 disabled:text-ink-3',
  danger: 'bg-flap text-red border-[#5a2422] hover:border-red disabled:opacity-50',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { kind?: Kind; icon?: IconName; size?: 'sm' | 'md' | 'lg'; busy?: boolean; children: ReactNode }>(
  function Button({ kind = 'frame', icon, size = 'md', busy, children, className = '', ...rest }, ref) {
    const pad = size === 'lg' ? 'h-14 px-6 text-[1.05rem] gap-3' : size === 'sm' ? 'h-8 px-3 text-[0.78rem] gap-2' : 'h-10 px-4 text-[0.88rem] gap-2.5';
    return (
      <button
        ref={ref}
        {...rest}
        aria-busy={busy || undefined}
        className={`inline-flex shrink-0 items-center justify-center rounded-md border font-cond font-semibold transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed ${pad} ${KIND[kind]} ${className}`}
      >
        {busy ? <span className="lamp-blink size-2 bg-current" aria-hidden /> : null}
        <span>{children}</span>
        {icon && !busy ? <Icon name={icon} size={size === 'lg' ? 20 : 16} /> : null}
      </button>
    );
  },
);

export function Lamp({ tone, blink, title }: { tone: 'amber' | 'red' | 'ink' | 'off' | 'green'; blink?: boolean; title?: string }) {
  const color = { amber: 'bg-amber', red: 'bg-red', ink: 'bg-ink', off: 'bg-steel-3', green: 'bg-[#5fd17a]' }[tone];
  return (
    <span title={title} role={title ? 'img' : undefined} aria-label={title}
      className={`inline-block size-2.5 rounded-full ${color} ${blink ? 'lamp-blink' : ''} shadow-[inset_0_-1px_1px_rgb(0_0_0/0.45),inset_0_1px_1px_rgb(255_255_255/0.35)]`} />
  );
}

// the episode's own frame, 9:16, framed like a platform number cell. layoutId lets it fly between the board and the episode.
export function Poster({ slug, w = 120, className = '', layout = true }: { slug: string; w?: number; className?: string; layout?: boolean }) {
  return (
    <m.div layoutId={layout ? `poster-${slug}` : undefined} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className={`relative overflow-hidden bg-flap-2 ring-1 ring-rule ${className}`} style={{ aspectRatio: '9 / 16' }}>
      <img src={media.poster(slug, w * 2)} alt="" loading="lazy" decoding="async" draggable={false}
        className="absolute inset-0 size-full object-cover" />
    </m.div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={htmlFor} className="label">{label}</label>
        {hint ? <span className="font-cond text-[0.8rem] text-ink-3">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export const inputClass = 'w-full rounded-md bg-flap border border-rule px-3 py-2.5 text-ink placeholder:text-ink-3 outline-none transition-colors duration-150 hover:border-steel-3 focus:border-amber';
