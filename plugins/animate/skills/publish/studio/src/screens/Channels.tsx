// CANAIS: one plate per channel — its code, where it's connected, when it departs, who it talks to.
import { useEffect, useState } from 'react';
import { useCancel, useConnect, useJobFor, useRefreshProfiles, useSaveTikTokApp, useStudio } from '../api/queries';
import type { Channel, PlatformId } from '../api/types';
import { channelCode } from '../lib/board';
import { errorText } from '../lib/words';
import { Flap } from '../ui/Flap';
import { Button, Field, Lamp, inputClass } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PlatformIcon } from '../ui/PlatformIcon';

export function Channels() {
  const { data, isLoading } = useStudio();
  const { mutate: refresh } = useRefreshProfiles();
  useEffect(() => { refresh(); }, [refresh]);
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

// waiting on the browser: the page may have been closed, so it can be opened again or given up
function SigningIn({ job, text }: { job: ReturnType<typeof useJobFor>; text: string }) {
  const cancel = useCancel();
  let url: string | null = null;
  for (const e of job?.events ?? []) if (e.type === 'signin-url' && typeof e.url === 'string') url = e.url;
  return (
    <div className="grid gap-2">
      <p className="text-[0.92rem] text-amber">{text}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.92rem]">
        <span className="text-ink-3">Fechou a página?</span>
        {url ? <a className="font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-amber" href={url} target="_blank" rel="noreferrer">Abrir de novo</a> : null}
        {job ? <button type="button" className="font-semibold text-ink-2 underline decoration-ink-3 underline-offset-4 hover:text-ink disabled:opacity-50"
          disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>Cancelar</button> : null}
      </div>
    </div>
  );
}

function PlatformRow({ channel, id, p, googleKey }: { channel: Channel; id: PlatformId; p: NonNullable<Channel['platforms'][PlatformId]>; googleKey: boolean }) {
  const connect = useConnect();
  const job = useJobFor('connect', `${channel.id}/${id}`);
  const busy = job?.status === 'running' || connect.isPending;
  const wrong = p.needs.includes('wrong-channel');
  const needsApp = p.needs.includes('tiktok-app');
  const [rekey, setRekey] = useState(false);
  const tone = p.state !== 'ready' ? 'off' : wrong ? 'red' : p.connected ? 'green' : 'amber';
  return (
    <li className="flap-row grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <Lamp tone={tone} blink={busy} />
        <PlatformIcon id={id} size={17} title={p.label} className={p.state === 'ready' ? 'text-ink' : 'text-ink-3/50'} />
        {p.connected?.avatar && p.state === 'ready' ? <img src={p.connected.avatar} alt="" width={22} height={22} referrerPolicy="no-referrer" loading="lazy" className="size-[22px] rounded-full object-cover" /> : null}
        <span className="font-cond text-[0.95rem] text-ink-3">
          {p.state !== 'ready' ? 'em breve' : wrong ? 'conectado ao canal errado' : p.connected ? `${p.connected.title}${id === 'tiktok' ? ' · envia como rascunho' : ''}` : needsApp ? 'falta configurar (uma vez)' : 'não conectado'}
        </span>
        {p.state === 'ready' && !needsApp ? (
          <Button className="ml-auto" size="sm" kind={p.connected && !wrong ? 'quiet' : 'primary'} busy={busy} disabled={busy}
            onClick={() => connect.mutate({ channel: channel.id, platform: id })}>
            {p.connected ? 'Reconectar' : 'Conectar'}
          </Button>
        ) : null}
      </div>
      {busy ? <SigningIn job={job} text={id === 'tiktok' ? `Abrimos o TikTok no seu navegador. Entre na conta do canal ${channel.name} e toque em Autorizar.` : `Abrimos o login no seu navegador. Escolha a conta e o canal ${channel.name} e clique em Permitir.`} /> : null}
      {id === 'tiktok' && !needsApp && !p.connected && !busy && !rekey ? (
        <button type="button" onClick={() => setRekey(true)} className="justify-self-start text-[0.88rem] text-ink-3 underline decoration-ink-3/60 underline-offset-4 hover:text-ink">O TikTok disse "client_key"? Trocar as chaves do app</button>
      ) : null}
      {needsApp || rekey ? <TikTokSetup onSaved={() => setRekey(false)} /> : null}
      {id === 'youtube' && !googleKey && !p.connected ? <p className="text-[0.92rem] text-ink-3">Antes, a chave do Google precisa estar na pasta Downloads (o passo a passo está no guia de conexão do YouTube).</p> : null}
      {job?.status === 'failed' ? <p className="text-[0.92rem] text-red">{errorText(job.error)}</p> : null}
      {id === 'youtube' && p.madeForKids === null && p.state === 'ready' ? <p className="text-[0.92rem] text-amber">Falta declarar se o canal é feito para crianças.</p> : null}
    </li>
  );
}

const REDIRECT = 'https://luizgustavof.github.io/animate/tiktok/callback/';
const SITE = 'https://luizgustavof.github.io/animate/';

// the one-time TikTok developer app, in plain steps. The user pastes Client key + secret into this form themselves; the
// server keeps them in ~/.animate and never sends them back.
function TikTokSetup({ onSaved }: { onSaved?: () => void }) {
  const save = useSaveTikTokApp();
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(REDIRECT).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); };
  const steps: Array<[string, React.ReactNode]> = [
    ['Crie o app', <>Entre em <a href="https://developers.tiktok.com/apps/" target="_blank" rel="noreferrer" className="text-amber hover:underline">developers.tiktok.com</a> com sua conta do TikTok e clique em <b>Connect an app</b> (ou "Criar app"). Nome: "Estúdio". Tipo de app: <b>Outro</b> (não dá para trocar depois).</>],
    ['Ligue o Sandbox', <>Ao lado do nome do app, mude a chave para <b>Sandbox</b> e clique em <b>Create Sandbox</b>. Assim não precisa de aprovação nem de site.</>],
    ['Preencha o app e adicione dois produtos', <>Ícone: <b>publish/channels/festa/tiktok-icon.png</b>. Termos: <b>{SITE}termos/</b>. Privacidade: <b>{SITE}privacidade/</b>. Plataforma <b>Web</b>, com Web URL <b>{SITE}</b>.
      Produtos: <b>Login Kit</b> e <b>Content Posting API</b> (com <b>Direct Post</b> ligado; não precisa verificar domínio). No Login Kit, aba <b>Web</b>, Redirect URI:{' '}
      <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded border border-rule bg-flap px-1.5 py-0.5 font-mono text-[0.82rem] text-ink hover:border-steel-3">{REDIRECT}<Icon name={copied ? 'check' : 'link'} size={13} /></button>
      {' '}Permissões: <b>user.info.basic</b>, <b>video.upload</b> e <b>video.publish</b>. Clique em <b>Apply changes</b>.</>],
    ['Adicione a conta do canal', <>Em <b>Sandbox settings → Target users → Add account</b>, entre com a conta do TikTok que vai postar. Pode levar até 1 hora para aparecer.</>],
    ['Cole as duas chaves do Sandbox aqui', <>Com a chave do app em <b>Sandbox</b>, abra <b>App details</b> e copie o <b>Client key</b> e o <b>Client secret</b> de lá. As do Sandbox são diferentes das do app principal e o Client key começa com <b>sb</b>. Elas ficam guardadas só neste computador.</>],
  ];
  return (
    <div className="mt-1 grid gap-4 rounded-md border border-rule bg-flap p-4">
      <p className="text-[0.92rem] text-ink-2">O TikTok pede um app de desenvolvedor seu, uma vez só (uns 10 minutos). Depois disso cada episódio vai direto para a caixa de entrada do TikTok como rascunho, e você só aperta Postar no app.</p>
      <ol className="grid gap-3">
        {steps.map(([t, body], i) => (
          <li key={t} className="grid grid-cols-[1.6rem_1fr] gap-3">
            <span className="grid size-6 place-items-center rounded-[5px] bg-flap-2 text-[0.8rem] font-semibold tabular-nums text-ink-2">{i + 1}</span>
            <div className="grid gap-0.5 text-[0.9rem] leading-relaxed text-ink-2"><span className="font-semibold text-ink">{t}</span><span>{body}</span></div>
          </li>
        ))}
      </ol>
      <form className="grid gap-3 sm:grid-cols-2" autoComplete="off"
        onSubmit={e => { e.preventDefault(); save.mutate({ clientKey: key, clientSecret: secret }, { onSuccess: () => { setKey(''); setSecret(''); onSaved?.(); } }); }}>
        <Field label="Client key" htmlFor="tt-key"><input id="tt-key" className={inputClass} value={key} onChange={e => setKey(e.target.value)} spellCheck={false} autoComplete="off" /></Field>
        <Field label="Client secret" htmlFor="tt-secret"><input id="tt-secret" type="password" className={inputClass} value={secret} onChange={e => setSecret(e.target.value)} spellCheck={false} autoComplete="new-password" /></Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button kind="primary" size="sm" icon="check" type="submit" busy={save.isPending} disabled={!key.trim() || !secret.trim() || save.isPending}>Salvar e continuar</Button>
          {save.error ? <span className="text-[0.88rem] text-red">{errorText(save.error.message)}</span>
            : key.trim() && !/^sb/i.test(key.trim()) ? <span className="text-[0.88rem] text-amber">Esse Client key não começa com "sb": parece ser o do app principal, que ainda não funciona. Pegue o do Sandbox.</span>
            : <span className="text-[0.82rem] text-ink-3">Depois de salvar aparece o botão Conectar.</span>}
        </div>
      </form>
    </div>
  );
}
