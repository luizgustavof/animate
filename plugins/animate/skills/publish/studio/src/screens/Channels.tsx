// CANAIS: one plate per channel — its code, where it's connected, when it departs, who it talks to.
import { useConnect, useJobFor, useStudio } from '../api/queries';
import type { Channel, PlatformId } from '../api/types';
import { channelCode } from '../lib/board';
import { errorText } from '../lib/words';
import { Flap } from '../ui/Flap';
import { Button, Lamp } from '../ui/controls';
import { PlatformIcon } from '../ui/PlatformIcon';

export function Channels() {
  const { data, isLoading } = useStudio();
  return (
    <section className="grid gap-8" aria-labelledby="ch-title">
      <div className="grid gap-3">
        <h1 id="ch-title" className="sr-only">Canais</h1>
        <Flap text="Canais" size="lg" />
        <p className="font-cond text-[1.05rem] tracking-[0.04em] text-ink-2">
          {data ? `${data.channels.length} canal${data.channels.length === 1 ? '' : 'is'} na programação` : ' '}
        </p>
      </div>
      {isLoading || !data ? <div className="flap-row h-56 opacity-60" aria-busy="true" /> : (
        <div className="grid gap-6">
          {data.channels.map(c => <Plate key={c.id} c={c} googleKey={data.googleKey} />)}
        </div>
      )}
    </section>
  );
}

function Plate({ c, googleKey }: { c: Channel; googleKey: boolean }) {
  const platforms = Object.entries(c.platforms) as Array<[PlatformId, NonNullable<Channel['platforms'][PlatformId]>]>;
  return (
    <article className="steel-dark grid gap-px rounded-lg border border-rule lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" aria-label={c.name}>
      <div className="grid content-start gap-5 bg-flap-2 p-6">
        <div className="flex items-center gap-4">
          <Flap text={channelCode(c)} size="md" />
          <div className="grid gap-0.5">
            <h2 className="font-cond text-[1.6rem] font-semibold leading-none">{c.name}</h2>
            <span className="font-cond text-[0.92rem] text-ink-3">{[c.language, c.series?.split('/').at(-1)].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        {c.audience ? <p className="max-w-[62ch] text-[0.98rem] leading-relaxed text-ink-2"><span className="label mr-2">Público</span>{c.audience}</p> : null}
        {c.voice ? <p className="max-w-[62ch] text-[0.98rem] leading-relaxed text-ink-2"><span className="label mr-2">Tom</span>{c.voice}</p> : null}
        {c.hashtags.always.length + c.hashtags.pool.length ? (
          <div className="flex flex-wrap gap-1.5">
            {c.hashtags.always.map(h => <span key={h} className="border border-steel-3 px-2 py-0.5 font-cond text-[0.9rem] text-ink">{h}</span>)}
            {c.hashtags.pool.map(h => <span key={h} className="border border-rule px-2 py-0.5 font-cond text-[0.9rem] text-ink-3">{h}</span>)}
          </div>
        ) : null}
      </div>
      <div className="grid content-start gap-5 bg-flap p-6">
        <div className="grid gap-2">
          <span className="label">Horários de partida</span>
          <div className="flex flex-wrap gap-5">{c.schedule.length ? c.schedule.map(s => <Flap key={s} text={s} size="sm" tone="amber" />) : <span className="text-ink-3">Nenhum horário definido</span>}</div>
        </div>
        <div className="grid gap-2">
          <span className="label">Plataformas</span>
          <ul className="grid gap-[3px]">
            {platforms.map(([id, p]) => <PlatformRow key={id} channel={c} id={id} p={p} googleKey={googleKey} />)}
          </ul>
        </div>
      </div>
    </article>
  );
}

function PlatformRow({ channel, id, p, googleKey }: { channel: Channel; id: PlatformId; p: NonNullable<Channel['platforms'][PlatformId]>; googleKey: boolean }) {
  const connect = useConnect();
  const job = useJobFor('connect', `${channel.id}/${id}`);
  const busy = job?.status === 'running' || connect.isPending;
  const wrong = p.needs.includes('wrong-channel');
  const tone = p.state !== 'ready' ? 'off' : wrong ? 'red' : p.connected ? 'green' : 'amber';
  return (
    <li className="flap-row grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <Lamp tone={tone} blink={busy} />
        <PlatformIcon id={id} size={17} className={p.state === 'ready' ? 'text-ink' : 'text-ink-3/50'} />
        <span className="font-cond text-[1.05rem] font-semibold">{p.label}</span>
        <span className="font-cond text-[0.95rem] text-ink-3">
          {p.state !== 'ready' ? 'em breve' : wrong ? 'conectado ao canal errado' : p.connected ? `conectado: ${p.connected.title}` : 'não conectado'}
        </span>
        {p.state === 'ready' ? (
          <Button className="ml-auto" size="sm" kind={p.connected && !wrong ? 'quiet' : 'primary'} busy={busy} disabled={busy}
            onClick={() => connect.mutate({ channel: channel.id, platform: id })}>
            {p.connected ? 'Reconectar' : 'Conectar'}
          </Button>
        ) : null}
      </div>
      {busy ? <p className="text-[0.92rem] text-amber">Abrimos o login no seu navegador. Escolha a conta e o canal {channel.name} e clique em Permitir.</p> : null}
      {id === 'youtube' && !googleKey && !p.connected ? <p className="text-[0.92rem] text-ink-3">Antes, a chave do Google precisa estar na pasta Downloads (o passo a passo está no guia de conexão do YouTube).</p> : null}
      {job?.status === 'failed' ? <p className="text-[0.92rem] text-red">{errorText(job.error)}</p> : null}
      {p.madeForKids === null && p.state === 'ready' ? <p className="text-[0.92rem] text-amber">Falta declarar se o canal é feito para crianças.</p> : null}
    </li>
  );
}
