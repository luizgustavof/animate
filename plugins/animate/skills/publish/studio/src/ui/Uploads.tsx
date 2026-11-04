// Upload progress, one row per platform: waiting its turn, sending (percent, MB, speed, time left), processing on the
// platform's side, done or failed. Fed only by the job stream (api/events.tsx); no timers of its own.
import { memo } from 'react';
import type { Upload } from '../api/events';
import { errorText } from '../lib/words';
import { PLATFORM_NAME, PlatformIcon } from './PlatformIcon';

const mb = (b: number) => `${Math.round(b / 2 ** 20)} MB`;

function left(u: Upload) {
  if (!u.mbps || !u.total) return null;
  const s = (u.total - u.sent) / (u.mbps * 2 ** 20);
  if (!Number.isFinite(s) || s <= 0) return null;
  return s < 60 ? `falta ${Math.max(1, Math.round(s))} s` : `falta ${Math.round(s / 60)} min`;
}

const PROCESSING: Record<string, string> = {
  youtube: 'O YouTube está recebendo o vídeo…',
  tiktok: 'O TikTok está processando o vídeo…',
};

export const UploadRow = memo(function UploadRow({ platform, u }: { platform: string; u: Upload | null }) {
  const name = PLATFORM_NAME[platform as keyof typeof PLATFORM_NAME] ?? platform;
  const pct = !u ? 0 : u.phase === 'done' || u.phase === 'processing' ? 100 : Math.floor((100 * u.sent) / Math.max(1, u.total));
  const tone = !u ? 'bg-steel-3/40' : u.phase === 'failed' ? 'bg-red' : u.phase === 'done' ? 'bg-green' : 'bg-amber';
  const status = !u ? 'Na fila'
    : u.phase === 'failed' ? 'Falhou'
    : u.phase === 'done' ? 'Pronto'
    : u.phase === 'processing' ? 'Processando'
    : u.total ? `${pct}%` : 'Começando';
  const detail = !u ? 'espera a plataforma anterior terminar'
    : u.phase === 'failed' ? errorText(u.error ?? '')
    : u.phase === 'done' ? (u.entry?.status === 'draft' ? 'rascunho na caixa de entrada do TikTok' : u.entry?.status === 'scheduled' ? 'agendado' : 'enviado')
    : u.phase === 'processing' ? (PROCESSING[platform] ?? 'Processando…')
    : u.total ? [`${mb(u.sent)} de ${mb(u.total)}`, u.mbps ? `${u.mbps.toFixed(1)} MB/s` : null, left(u)].filter(Boolean).join(' · ')
    : 'preparando o arquivo…';
  return (
    <li className="grid gap-2">
      <div className="flex items-center gap-3">
        <PlatformIcon id={platform} size={16} className={u ? 'text-ink' : 'text-ink-3'} title={name} />
        <span className={`w-[5.5rem] shrink-0 text-[0.95rem] font-semibold tabular-nums ${!u ? 'text-ink-3' : u.phase === 'failed' ? 'text-red' : u.phase === 'done' ? 'text-green' : 'text-amber'}`}>{status}</span>
        <span className={`min-w-0 truncate text-[0.9rem] ${u?.phase === 'failed' ? 'text-red' : 'text-ink-3'}`} title={detail}>{detail}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-flap" role="progressbar" aria-label={`Envio para o ${name}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className={`absolute inset-y-0 left-0 rounded-full ${tone} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
        {u?.phase === 'processing' ? <span className="absolute inset-0 animate-pulse bg-white/10" /> : null}
      </div>
    </li>
  );
});

// the platforms of one episode, in the order they go out
export function UploadBars({ slug, platforms, uploads }: { slug: string; platforms: string[]; uploads: Record<string, Upload> }) {
  const seen = Object.values(uploads).filter(u => u.slug === slug).map(u => u.platform);
  const order = [...new Set([...seen, ...platforms])];
  return (
    <ul className="grid gap-4" aria-live="polite">
      {order.map(p => <UploadRow key={p} platform={p} u={uploads[`${slug}:${p}`] ?? null} />)}
    </ul>
  );
}
