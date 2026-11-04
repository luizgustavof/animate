// The frame every screen hangs in: a dark column on the left, one item per screen
// (number key, name, what's on it right now) and, inside an episode, the episode's own plate under Partidas to step back from.
// Below it the screen, swapped with a short drop (the flap motion, not a slide). One EventSource lives here.
import { useEffect, useMemo } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { AnimatePresence, LazyMotion, MotionConfig, m } from 'motion/react';
import { LiveEvents } from '../api/events';
import { useJobs, useStats, useStudio } from '../api/queries';
import { boardRows, codeOf } from '../lib/board';
import { count } from '../lib/words';

const loadFeatures = () => import('./motion-features').then(r => r.default);

const TABS = [
  { to: '/', label: 'Partidas', key: '1', go: 'p' },
  { to: '/canais', label: 'Canais', key: '2', go: 'c' },
  { to: '/desempenho', label: 'Desempenho', key: '3', go: 'd' },
] as const;

const spring = { type: 'spring', stiffness: 520, damping: 42 } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// 1 / 2 / 3 (or g then p / c / d) jumps between boards; Esc steps out of an episode. Ignored while typing.
function useKeys(inEpisode: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === 'Escape' && inEpisode) { navigate('/'); return; }
      const direct = TABS.find(t => t.key === e.key);
      if (direct) { e.preventDefault(); navigate(direct.to); return; }
      if (e.key === 'g') { armed = Date.now(); return; }
      if (Date.now() - armed < 900) {
        const tab = TABS.find(t => t.go === e.key);
        if (tab) { e.preventDefault(); navigate(tab.to); }
        armed = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, inEpisode]);
}

// one line per board saying what's on it right now
function useLines() {
  const { data } = useStudio();
  const stats = useStats();
  const jobs = useJobs();
  return useMemo(() => {
    const lines: Record<string, string> = { '/': '', '/canais': '', '/desempenho': '' };
    if (data) {
      const rows = boardRows(data.pieces, data.channels, jobs);
      const n = (s: string) => rows.filter(r => r.state === s).length;
      lines['/'] = n('enviando') ? `${n('enviando')} saindo agora`
        : [n('agendado') && `${n('agendado')} agendado${n('agendado') > 1 ? 's' : ''}`, n('pronto') && plural(n('pronto'), 'pronto', 'prontos'), n('sem-texto') && `${n('sem-texto')} sem texto`]
          .filter(Boolean).join(' · ') || 'nada esperando';
      const linked = data.channels.filter(c => Object.values(c.platforms).some(p => p?.connected)).length;
      lines['/canais'] = data.channels.length ? `${plural(data.channels.length, 'canal', 'canais')} · ${linked} conectado${linked === 1 ? '' : 's'}` : 'nenhum canal';
    }
    const views = (stats.data ?? []).reduce((s, r) => s + (r.stats?.views ?? 0), 0);
    lines['/desempenho'] = stats.data?.length ? `${count(views)} visualizações` : 'nada partiu ainda';
    return lines;
  }, [data, stats.data, jobs]);
}

export function Root() {
  const location = useLocation();
  const outlet = useOutlet();
  const epSlug = location.pathname.startsWith('/ep/') ? decodeURIComponent(location.pathname.slice(4).split('/')[0] ?? '') : null;
  const section = epSlug ? '/' : (TABS.find(t => t.to !== '/' && location.pathname.startsWith(t.to))?.to ?? '/');
  const lines = useLines();
  const { data } = useStudio();
  const epTitle = epSlug ? data?.pieces.find(p => p.slug === epSlug)?.title ?? null : null;
  useKeys(!!epSlug);

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <LiveEvents />
        <div className="flex min-h-dvh">
          <aside aria-label="Quadros"
            className="sticky top-0 z-20 flex h-dvh w-[76px] shrink-0 flex-col gap-4 border-r border-rule bg-[#121215] px-2.5 py-4 lg:w-[248px] lg:px-3 lg:py-5">
            <nav className="flex flex-col gap-1">
              {TABS.map(t => {
                const on = section === t.to;
                return (
                  <div key={t.to} className="flex flex-col">
                    <NavLink to={t.to} end={t.to === '/'} aria-current={on && !epSlug ? 'page' : undefined} aria-keyshortcuts={t.key} title={t.label}
                      className={`group relative flex items-center justify-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 lg:justify-start lg:px-3 ${on ? '' : 'hover:bg-white/[0.04]'}`}>
                      {on && <m.span layoutId="plate-lit" className="absolute inset-0 rounded-md bg-flap-3" transition={spring} />}
                      {on && <m.span layoutId="plate-mark" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-amber" transition={spring} />}
                      <span className={`relative grid size-7 shrink-0 place-items-center rounded-[5px] font-display text-[0.9rem] font-semibold tabular-nums leading-none ${on ? 'bg-amber text-amber-ink' : 'bg-flap-2 text-ink-3 group-hover:text-ink'}`}>{t.key}</span>
                      <span className="relative hidden min-w-0 text-left leading-tight lg:grid">
                        <span className={`text-[0.98rem] font-semibold ${on ? 'text-ink' : 'text-ink-2'}`}>{t.label}</span>
                        <span className={`truncate text-[0.8rem] ${on ? 'text-ink-2' : 'text-ink-3'}`}>{lines[t.to] || ' '}</span>
                      </span>
                    </NavLink>
                    {t.to === '/' && (
                      <AnimatePresence initial={false}>
                        {epSlug && (
                          <m.div key="ep" className="overflow-hidden"
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                            <div aria-current="page" className="mt-1 flex justify-center lg:ml-[1.65rem] lg:justify-start lg:border-l lg:border-rule lg:py-1 lg:pl-3">
                              <div className="flex min-w-0 items-center gap-2.5 rounded-md bg-white/[0.03] px-2 py-1.5 lg:w-full">
                                <span className="shrink-0 text-[0.75rem] font-semibold tabular-nums text-amber">{codeOf(epSlug)}</span>
                                <span className="hidden min-w-0 truncate text-[0.86rem] font-medium text-ink lg:block">{epTitle?.replace(/^.*?EP\d+:\s*/i, '') ?? ''}</span>
                              </div>
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    )}
                  </div>
                );
              })}
            </nav>
            <p className="mt-auto hidden px-3 text-[0.75rem] leading-relaxed text-ink-3 lg:block">
              Teclas 1, 2 e 3 trocam a tela.<br />Esc sai do episódio.
            </p>
          </aside>

          <main className="relative min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
              <AnimatePresence mode="popLayout" initial={false}>
                <m.div key={location.pathname}
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
                  {outlet}
                </m.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
