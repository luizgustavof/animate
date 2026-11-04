// DESEMPENHO: what each departure did after it left, best first. The numbers come from the platforms on request.
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useJobFor, useStats } from '../api/queries';
import { codeOf } from '../lib/board';
import { count, errorText, relative } from '../lib/words';
import { Flap } from '../ui/Flap';
import { Button, Lamp } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PlatformIcon } from '../ui/PlatformIcon';

export function Performance() {
  const stats = useStats();
  const qc = useQueryClient();
  const refresh = useMutation({ mutationFn: api.refreshStats, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });
  const job = useJobFor('stats', 'all');
  const busy = refresh.isPending || job?.status === 'running';
  const rows = useMemo(() => [...(stats.data ?? [])].sort((a, b) => (b.stats?.views ?? -1) - (a.stats?.views ?? -1)), [stats.data]);
  const max = Math.max(1, ...rows.map(r => r.stats?.views ?? 0));
  const last = rows.map(r => r.stats?.at).filter(Boolean).sort().at(-1);

  return (
    <section className="grid gap-8" aria-labelledby="perf-title">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="grid gap-3">
          <h1 id="perf-title" className="sr-only">Desempenho</h1>
          <Flap text="Desempenho" size="lg" />
          <p className="font-cond text-[1.05rem] tracking-[0.04em] text-ink-2">{last ? `Números de ${relative(last)}` : 'Os números chegam depois da primeira partida'}</p>
        </div>
        <Button icon="refresh" busy={busy} disabled={busy || !rows.length} onClick={() => refresh.mutate()}>Atualizar números</Button>
      </div>
      {job?.status === 'failed' ? <p className="text-red">{errorText(job.error)}</p> : null}

      {!rows.length ? (
        <div className="grid max-w-2xl gap-4 border border-rule bg-flap-2 p-8">
          <Flap text="Nada partiu" size="md" tone="dim" />
          <p className="text-[1.05rem] leading-relaxed text-ink-2">Quando um episódio for publicado, as visualizações, curtidas e comentários de cada plataforma aparecem aqui, do melhor para o pior. O Claude usa isso para escrever títulos melhores.</p>
          <div><Link to="/"><Button kind="primary" icon="arrow">Ir para as partidas</Button></Link></div>
        </div>
      ) : (
        <div className="steel-dark overflow-x-auto rounded-lg border border-rule p-2">
          <table className="w-full min-w-[720px] border-separate border-spacing-y-[3px]">
            <thead><tr className="text-left">{['Episódio', 'Onde', 'Visualizações', 'Curtidas', 'Coment.', ''].map(h => <th key={h} className="label px-3 pb-2 pt-1">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key + r.slug} className="[&>td]:flap-row">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-4">
                      <Flap text={codeOf(r.slug)} size="xs" tone="dim" />
                      <Link to={`/ep/${r.slug}`} className="font-cond text-[1.1rem] font-semibold hover:text-amber">{r.title ?? r.slug}</Link>
                    </div>
                  </td>
                  <td className="px-3 py-3"><PlatformIcon id={r.platform} size={17} className="text-ink" title={r.platform} /></td>
                  <td className="w-[34%] px-3 py-3">
                    {r.stats ? (
                      <div className="flex items-center gap-3">
                        <span className="w-16 shrink-0 text-right font-cond text-[1.15rem] font-semibold tabular-nums">{count(r.stats.views)}</span>
                        <span className="relative h-2 flex-1 bg-flap"><span className="absolute inset-y-0 left-0 bg-ink-2" style={{ width: `${(100 * r.stats.views) / max}%` }} /></span>
                      </div>
                    ) : <span className="flex items-center gap-2 font-cond text-ink-3"><Lamp tone="off" /> ainda sem números</span>}
                  </td>
                  <td className="px-3 py-3 font-cond text-[1.05rem] tabular-nums">{r.stats ? count(r.stats.likes) : '—'}</td>
                  <td className="px-3 py-3 font-cond text-[1.05rem] tabular-nums">{r.stats ? count(r.stats.comments) : '—'}</td>
                  <td className="px-3 py-3 text-right">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" aria-label="Abrir na plataforma" className="text-ink-3 hover:text-amber"><Icon name="external" /></a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
