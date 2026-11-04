// A compact menu select (listbox pattern): a trigger that shows the choice, a popover list with a check on the current one.
// Keyboard: ↑/↓ move, Enter/Space pick, Esc or a click outside closes, Home/End jump. Listeners live only while open.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Icon } from './Icon';

export interface Option<T extends string> { value: T; label: string; hint?: ReactNode }

export function Select<T extends string>({ value, options, onChange, label, className = '' }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find(o => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    list.current?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); button.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
  };

  return (
    <div ref={root} className={`relative ${className}`}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
        className={`flex h-10 w-full items-center gap-3 rounded-md border bg-flap-2 pl-3 pr-2.5 text-left transition-colors ${open ? 'border-steel-3' : 'border-rule hover:border-steel-3'}`}>
        <span className="text-[0.75rem] font-medium text-ink-3">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[0.9rem] font-medium text-ink">{current?.label}</span>
        {current?.hint !== undefined ? <span className="rounded bg-white/[0.06] px-1.5 py-px text-[0.75rem] tabular-nums text-ink-2">{current.hint}</span> : null}
        <svg aria-hidden width="14" height="14" viewBox="0 0 20 20" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M5.5 8 10 12.5 14.5 8" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      </button>
      <AnimatePresence>
        {open ? (
          <m.ul key="list" ref={list} id={id} role="listbox" tabIndex={-1} aria-label={label}
            aria-activedescendant={`${id}-${active}`} onKeyDown={onKey}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 grid min-w-full origin-top gap-0.5 rounded-lg border border-rule bg-[#18181c] p-1 shadow-[0_12px_32px_rgb(0_0_0/0.55)] outline-none">
            {options.map((o, i) => {
              const on = o.value === value;
              return (
                <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={on}
                  onPointerEnter={() => setActive(i)} onClick={() => pick(i)}
                  className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-[0.9rem] transition-colors ${i === active ? 'bg-white/[0.06]' : ''} ${on ? 'text-ink' : 'text-ink-2'}`}>
                  <span className={`grid size-4 shrink-0 place-items-center ${on ? 'text-amber' : 'text-transparent'}`}><Icon name="check" size={14} /></span>
                  <span className="flex-1 font-medium">{o.label}</span>
                  {o.hint !== undefined ? <span className="pl-4 text-[0.78rem] tabular-nums text-ink-3">{o.hint}</span> : null}
                </li>
              );
            })}
          </m.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
