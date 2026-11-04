// One episode, start to departure: its own frame and video on the left; on the right the words (written by Claude, edited
// live against each platform's limits, saved by themselves) and the departure (where, when, the upload's progress).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AnimatePresence, m } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { api, media } from '../api/client';
import { TIKTOK_START, TikTokPost, tiktokBlock, useTikTokCreator, type TikTokChoices } from './TikTokPost';
import { PhoneCaption } from '../ui/PhoneCaption';
import { useRefreshDrafts, useCancel, useJobFor, useUnpublish, useNextSlot, usePiece, usePublish, useSaveMeta, useStudio, useWriteWords } from '../api/queries';
import type { Channel, Checks, Meta, PieceDetail, PlatformId } from '../api/types';
import { channelCode, codeOf } from '../lib/board';
import { useSettled } from '../lib/hooks';
import { errorText, issueText, mb, secs, time, when, whenLong } from '../lib/words';
import { Flap } from '../ui/Flap';
import { Button, Field, Lamp, Poster, inputClass } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { PlatformIcon } from '../ui/PlatformIcon';

type Tab = 'texto' | 'partida';

export function Episode() {
  const { slug = '' } = useParams();
  const { mutate: checkDrafts } = useRefreshDrafts();
  useEffect(() => { checkDrafts(); }, [checkDrafts, slug]);
  const piece = usePiece(slug);
  const studio = useStudio();
  const [tab, setTab] = useState<Tab>('texto');
  const channel = studio.data?.channels.find(c => c.id === piece.data?.channel) ?? null;

  if (piece.error) return (
    <div className="grid gap-5 py-10">
      <Flap text="Não achei" size="lg" tone="red" />
      <p className="text-ink-2">{errorText((piece.error as Error).message)}</p>
      <Link to="/"><Button icon="back">Voltar às partidas</Button></Link>
    </div>
  );
  const d = piece.data;

  return (
    <article className="grid gap-8" aria-labelledby="ep-title">
      <header className="grid gap-3">
        <Link to="/" aria-keyshortcuts="Escape" title="Voltar às partidas (Esc)"
          className="group flex w-fit items-center gap-2 rounded-md py-1 pr-2 text-[0.85rem] font-medium text-ink-3 transition-colors hover:text-ink">
          <Icon name="back" size={15} className="transition-transform group-hover:-translate-x-0.5" />
          Partidas
          <kbd className="ml-1 rounded-[4px] border border-rule px-1.5 py-px text-[0.68rem] text-ink-3">Esc</kbd>
        </Link>
        <div className="flex basis-full flex-wrap items-center gap-5">
          <Flap text={codeOf(slug)} size="md" />
          <h1 id="ep-title" className="min-w-[12rem] flex-1 font-cond text-[2rem] font-semibold leading-none text-ink">
            {d ? (d.title.split(' — ').at(-1) ?? d.title) : ' '}
          </h1>
          {channel ? <span className="flex basis-full items-center gap-3 font-cond text-[0.95rem] text-ink-3 sm:basis-auto"><Flap text={channelCode(channel)} size="xs" />{channel.name}</span> : null}
        </div>
      </header>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <aside className="grid w-full max-w-[340px] gap-5 lg:sticky lg:top-8 lg:max-w-none">
          <Player slug={slug} />
          {d?.render ? (
            <dl className="grid grid-cols-3 gap-[3px] text-center">
              {[['Duração', secs(d.render.duration)], ['Formato', `${d.render.width}×${d.render.height}`], ['Arquivo', mb(d.render.bytes)]].map(([k, v]) => (
                <div key={k} className="flap-row grid gap-1 px-2 py-2"><dt className="label !text-[0.65rem]">{k}</dt><dd className="font-cond text-[1rem] font-semibold">{v}</dd></div>
              ))}
            </dl>
          ) : null}
          {d?.lines.length ? <Script lines={d.lines} /> : null}
        </aside>

        <section className="grid min-w-0 gap-6">
          <div role="tablist" aria-label="Etapas" className="flex border-b border-rule">
            {([['texto', 'Texto'], ['partida', 'Partida']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} id={`tab-${id}`} onClick={() => setTab(id)}
                className={`relative px-5 pb-3 pt-1 caps text-[1rem] tracking-[0.16em] transition-colors ${tab === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
                {label}
                {tab === id ? <m.span layoutId="ep-tab" className="absolute inset-x-2 -bottom-px h-[3px] bg-amber" transition={{ type: 'spring', stiffness: 520, damping: 42 }} /> : null}
              </button>
            ))}
          </div>
          {!d ? <div className="flap-row h-64 opacity-60" aria-busy="true" /> : (
            <AnimatePresence mode="wait" initial={false}>
              <m.div key={tab} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}>
                {tab === 'texto' ? <Words piece={d} channel={channel} onDone={() => setTab('partida')} /> : <Departure piece={d} channel={channel} onEdit={() => setTab('texto')} />}
              </m.div>
            </AnimatePresence>
          )}
        </section>
      </div>
    </article>
  );
}

// the frame until asked to play; the video element exists only while playing and lets go of its source when it leaves
function Player({ slug }: { slug: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    return () => { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } };
  }, [playing]);
  return (
    <div className="relative">
      <Poster slug={slug} w={340} className="w-full" />
      {playing ? (
        <video ref={ref} src={media.video(slug)} autoPlay controls playsInline preload="metadata"
          className="absolute inset-0 size-full bg-black object-contain" onEnded={() => setPlaying(false)} />
      ) : (
        <button onClick={() => setPlaying(true)} aria-label="Assistir o episódio"
          className="absolute inset-0 grid place-items-center bg-black/0 transition-colors hover:bg-black/30 focus-visible:bg-black/30">
          <span className="grid size-16 place-items-center border border-ink/70 bg-flap/80 text-ink"><Icon name="play" size={26} /></span>
        </button>
      )}
    </div>
  );
}

function Script({ lines }: { lines: PieceDetail['lines'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center justify-between label hover:text-ink-2">
        O que é falado ({lines.length} falas) <Icon name={open ? 'x' : 'plus'} size={14} />
      </button>
      {open ? <ol className="grid max-h-[40vh] gap-2 overflow-auto pr-2 text-[0.92rem] leading-snug text-ink-2">{lines.map(l => <li key={l.id}>{l.text}</li>)}</ol> : null}
    </div>
  );
}

// ---------- TEXTO ----------
const EMPTY: Required<Pick<Meta, 'youtube' | 'tiktok' | 'instagram'>> = { youtube: { title: '', description: '', tags: [] }, tiktok: { caption: '' }, instagram: { caption: '' } };

function Words({ piece, channel, onDone }: { piece: PieceDetail; channel: Channel | null; onDone: () => void }) {
  const qc = useQueryClient();
  const server = piece.meta;
  const version = server?.writtenAt ?? '';
  const [draft, setDraft] = useState<Meta>(() => ({ ...EMPTY, ...server }));
  const [dirty, setDirty] = useState(false);
  // a new generation from Claude replaces the draft (only while nothing is typed that isn't saved)
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version !== lastVersion.current) { lastVersion.current = version; setDraft({ ...EMPTY, ...server }); setDirty(false); }
  }, [version, server]);

  const write = useWriteWords(piece.slug);
  const job = useJobFor('words', piece.slug);
  const cancel = useCancel();
  const save = useSaveMeta(piece.slug);
  const writing = job?.status === 'running' || write.isPending;

  // live check against the platforms' own rules, after typing settles; the request is aborted if the draft moves on
  const settled = useSettled(draft, 350);
  const [checks, setChecks] = useState<Checks | null>(piece.checks);
  useEffect(() => {
    if (!settled.youtube) return;
    const ac = new AbortController();
    api.check(piece.slug, settled, {}, ac.signal).then(setChecks).catch(() => {});
    return () => ac.abort();
  }, [settled, piece.slug]);

  // save by itself a moment after the last keystroke
  const toSave = useSettled(dirty ? draft : null, 900);
  useEffect(() => {
    if (!toSave) return;
    save.mutate(toSave, { onSuccess: () => setDirty(false) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toSave]);

  const set = (fn: (d: Meta) => Meta) => { setDraft(d => fn(d)); setDirty(true); };
  const yt = draft.youtube ?? EMPTY.youtube;
  const ytCheck = checks?.platforms.youtube;
  const issues = ytCheck?.issues ?? [];
  const hashtags = useMemo(() => yt.description.match(/#[\p{L}\p{N}_]+/gu) ?? [], [yt.description]);
  const candidates = draft.candidates?.youtube ?? [];
  const reasons = draft.reasons?.youtube ?? [];

  if (writing) return <WritingStrip log={job?.log ?? []} onCancel={() => job && cancel.mutate(job.id)} />;

  const failed = job?.status === 'failed' ? job.error : write.error?.message;
  if (!server && !dirty) return (
    <div className="grid gap-6 border border-rule bg-flap-2 p-8">
      <div className="grid gap-2">
        <Flap text="Sem texto" size="md" tone="dim" />
        <p className="max-w-xl text-[1.05rem] leading-relaxed text-ink-2">
          O Claude lê o que é falado no episódio{channel ? ` e o perfil de ${channel.name}` : ''} e escreve 5 títulos, a descrição e as hashtags de cada plataforma. Você escolhe e ajusta.
        </p>
      </div>
      {failed ? <p className="border border-[#5a2422] bg-[#1d0f0f] px-4 py-3 text-red">{errorText(failed)}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button kind="primary" size="lg" icon="spark" onClick={() => write.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) })}>Gerar com Claude</Button>
        <Button kind="quiet" size="lg" onClick={() => { setDraft({ ...EMPTY }); setDirty(true); }}>Escrever eu mesmo</Button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-8">
      {candidates.length ? (
        <fieldset className="grid gap-3">
          <legend className="label mb-3 flex w-full items-center justify-between">
            <span>Títulos sugeridos</span>
            <Button kind="quiet" size="sm" icon="refresh" onClick={() => write.mutate()}>Gerar de novo</Button>
          </legend>
          <div className="grid gap-[3px]">
            {candidates.map((c, i) => {
              const on = yt.title === c;
              return (
                <label key={i} className={`flap-row flex cursor-pointer items-start gap-4 px-4 py-3 outline-offset-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber ${on ? 'ring-1 ring-amber' : 'hover:brightness-125'}`}>
                  <input type="radio" name="title" className="sr-only" checked={on} onChange={() => set(d => ({ ...d, youtube: { ...(d.youtube ?? EMPTY.youtube), title: c } }))} />
                  <Flap text={String(i + 1)} size="xs" tone={on ? 'amber' : 'dim'} />
                  <span className="grid gap-1">
                    <span className={`font-cond text-[1.15rem] font-semibold leading-tight ${on ? 'text-amber' : 'text-ink'}`}>{c}</span>
                    {reasons[i] ? <span className="text-[0.88rem] leading-snug text-ink-3">{reasons[i]}</span> : null}
                  </span>
                  {i === draft.chosen ? <span className="ml-auto shrink-0 label !text-ink-2">Escolha do Claude</span> : null}
                </label>
              );
            })}
          </div>
          {draft.why ? <p className="text-[0.92rem] text-ink-3">{draft.why}</p> : null}
        </fieldset>
      ) : null}

      <div className="grid gap-6">
        <Field label="Título no YouTube" htmlFor="yt-title" hint={<Counter n={yt.title.length} soft={70} hard={100} />}>
          <input id="yt-title" className={`${inputClass} font-cond text-[1.25rem] font-semibold`} value={yt.title} maxLength={140}
            onChange={e => set(d => ({ ...d, youtube: { ...(d.youtube ?? EMPTY.youtube), title: e.target.value } }))} />
        </Field>
        <Field label="Descrição" htmlFor="yt-desc" hint={hashtags.length ? `${hashtags.length} hashtag${hashtags.length > 1 ? 's' : ''}` : 'sem hashtags'}>
          <textarea id="yt-desc" rows={6} className={`${inputClass} resize-y leading-relaxed`} value={yt.description}
            onChange={e => set(d => ({ ...d, youtube: { ...(d.youtube ?? EMPTY.youtube), description: e.target.value } }))} />
          {hashtags.length ? <div className="flex flex-wrap gap-1.5">{hashtags.map((h, i) => <span key={h + i} className={`border px-2 py-0.5 font-cond text-[0.9rem] ${i < 3 ? 'border-steel-3 text-ink' : 'border-rule text-ink-3'}`}>{h}</span>)}</div> : null}
        </Field>
        <Field label="Palavras-chave (busca)" htmlFor="yt-tags" hint="separe com vírgula">
          <input id="yt-tags" className={inputClass} value={yt.tags.join(', ')}
            onChange={e => set(d => ({ ...d, youtube: { ...(d.youtube ?? EMPTY.youtube), tags: e.target.value.split(',').map(s => s.trimStart()).filter((s, i, a) => s || i === a.length - 1) } }))} />
        </Field>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Legenda do TikTok" htmlFor="tt-cap" hint={<span className="text-ink-3">vale quando o TikTok for ligado</span>}>
            <textarea id="tt-cap" rows={4} className={`${inputClass} resize-y`} value={draft.tiktok?.caption ?? ''}
              onChange={e => set(d => ({ ...d, tiktok: { caption: e.target.value } }))} />
          </Field>
          <Field label="Legenda do Instagram" htmlFor="ig-cap" hint={<span className="text-ink-3">vale quando o Instagram for ligado</span>}>
            <textarea id="ig-cap" rows={4} className={`${inputClass} resize-y`} value={draft.instagram?.caption ?? ''}
              onChange={e => set(d => ({ ...d, instagram: { caption: e.target.value } }))} />
          </Field>
        </div>
      </div>

      <Findings issues={issues} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5">
        <span className="flex items-center gap-2 font-cond text-[0.9rem] text-ink-3" aria-live="polite">
          <Lamp tone={save.isPending || dirty ? 'amber' : save.isError ? 'red' : 'off'} blink={save.isPending} />
          {save.isError ? 'Não consegui salvar' : dirty || save.isPending ? 'Salvando…' : draft.editedAt || draft.writtenAt ? `Salvo às ${time(draft.editedAt ?? draft.writtenAt!)}` : 'Salvo'}
        </span>
        <Button kind="primary" icon="arrow" disabled={issues.some(i => i.level === 'error') || !yt.title} onClick={onDone}>Seguir para a partida</Button>
      </div>
    </div>
  );
}

function Counter({ n, soft, hard }: { n: number; soft: number; hard: number }) {
  const tone = n > hard ? 'text-red' : n > soft ? 'text-amber' : 'text-ink-3';
  return <span className={`tabular-nums ${tone}`} aria-label={`${n} caracteres de no máximo ${hard}`}>{n} / {soft}</span>;
}

function Findings({ issues }: { issues: NonNullable<NonNullable<Checks['platforms']['youtube']>['issues']> }) {
  if (!issues.length) return null;
  return (
    <ul className="grid gap-[3px]" aria-label="Avisos do YouTube">
      {issues.map((i, k) => (
        <li key={i.code + k} className="flap-row flex items-center gap-4 px-4 py-2.5">
          <Flap text={i.level === 'error' ? 'Erro' : 'Aviso'} cells={5} size="xs" tone={i.level === 'error' ? 'red' : 'amber'} />
          <span className="text-[0.95rem] text-ink-2">{issueText(i)}</span>
        </li>
      ))}
    </ul>
  );
}

function WritingStrip({ log, onCancel }: { log: string[]; onCancel: () => void }) {
  return (
    <div className="grid gap-5 border border-amber/50 bg-flap-2 p-8" aria-live="polite">
      <span className="flex items-center gap-4"><Flap text="Escrevendo" size="md" tone="amber" /><Lamp tone="amber" blink /></span>
      <p className="text-[1.05rem] text-ink-2">O Claude está lendo o episódio e escrevendo os títulos. Leva uns 30 segundos.</p>
      {log.length ? <ul className="grid gap-1 font-cond text-[0.95rem] text-ink-3">{log.slice(-4).map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
      <div><Button kind="quiet" icon="x" onClick={onCancel}>Cancelar</Button></div>
    </div>
  );
}

// ---------- PARTIDA ----------
type When = 'next' | 'choose' | 'now';

// one thing already sent, with the way to take it back. Deleting asks first, in words, because the platform can't undo it.
function PostedItem({ slug, postKey, post: p, label, caption }: { slug: string; postKey: string; post: PieceDetail['posts'][string]; label: string; caption: string }) {
  const [asking, setAsking] = useState(false);
  const unpublish = useUnpublish(slug);
  const job = useJobFor('unpublish', `${slug}:${postKey}`);
  const busy = unpublish.isPending || job?.status === 'running';
  const failed = unpublish.error?.message ?? (job?.status === 'failed' ? job.error : null);
  const lastLog = job?.status === 'running' ? job.events.filter(e => e.type === 'unpublish:log').at(-1)?.message : null;
  const what = p.platform === 'tiktok' ? 'O Estúdio esquece este envio e o episódio volta a ficar pronto para o TikTok. O TikTok não deixa apagar por aqui: apague o rascunho (ou o post) no app.'
    : p.status === 'scheduled' ? `O vídeo agendado para ${p.publishAt ? whenLong(p.publishAt) : 'depois'} some do canal e não vai ao ar.`
    : p.status === 'uploading' ? 'O envio interrompido é esquecido; o episódio volta a ficar pronto.'
    : 'O vídeo sai do canal, com as visualizações e os comentários.';
  return (
    <li className="flap-row grid gap-3 rounded-md px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <PlatformIcon id={p.platform} size={17} className="text-ink" />
        <Flap text={p.status === 'scheduled' ? 'Agendado' : p.status === 'public' ? 'No ar' : p.status === 'draft' ? 'Rascunho' : p.status === 'uploading' ? 'Parado' : 'Privado'} cells={8} size="xs" tone={p.status === 'scheduled' ? 'amber' : 'ink'} />
        <span className="text-[0.95rem] text-ink-2">{p.status === 'draft' ? `na caixa de entrada do TikTok desde ${when(p.postedAt!)}: poste pelo app` : p.publishAt ? `sai ${when(p.publishAt)}` : p.postedAt ? `enviado ${when(p.postedAt)}` : 'envio interrompido: publique de novo para continuar'}</span>
        <span className="ml-auto flex items-center gap-4">
          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[0.85rem] font-medium text-amber hover:underline">Abrir <Icon name="external" size={14} /></a> : null}
          {!asking && !busy ? (
            <button onClick={() => setAsking(true)} className="flex items-center gap-1.5 text-[0.85rem] font-medium text-ink-3 transition-colors hover:text-red">
              <Icon name="trash" size={15} /> Excluir
            </button>
          ) : null}
        </span>
      </div>
      {p.status === 'draft' ? <div className="grid gap-3"><div><CopyCaption text={caption} /></div><PhoneCaption caption={caption} /></div> : null}
      {p.warning ? <span className="text-[0.9rem] text-ink-3">{errorText(p.warning)}</span> : null}
      <AnimatePresence initial={false}>
        {asking || busy ? (
          <m.div key="ask" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div role="alertdialog" aria-label={`Excluir do ${label}`} className="grid gap-3 rounded-md border border-red/40 bg-red/[0.06] p-4">
              <p className="text-[0.95rem] text-ink"><strong className="font-semibold">{p.platform === 'tiktok' ? 'Esquecer este envio?' : `Excluir do ${label}?`}</strong> {what}{p.platform === 'tiktok' ? '' : ' Isso não dá para desfazer.'}</p>
              {lastLog ? <p className="text-[0.88rem] text-ink-2">{errorText(String(lastLog))}</p> : null}
              {failed ? <p className="text-[0.9rem] text-red">{errorText(failed)}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button kind="danger" size="sm" icon="trash" busy={busy} disabled={busy} onClick={() => unpublish.mutate(postKey)}>{p.platform === 'tiktok' ? 'Esquecer envio' : 'Excluir de vez'}</Button>
                {!busy ? <Button kind="quiet" size="sm" onClick={() => { setAsking(false); unpublish.reset(); }}>Manter</Button> : null}
              </div>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

function Departure({ piece, channel, onEdit }: { piece: PieceDetail; channel: Channel | null; onEdit: () => void }) {
  const slot = useNextSlot(channel?.id ?? null);
  const publish = usePublish(piece.slug);
  const job = useJobFor('publish', piece.slug);
  const cancel = useCancel();
  const platforms = Object.entries(channel?.platforms ?? {}) as Array<[PlatformId, NonNullable<Channel['platforms'][PlatformId]>]>;
  const usable = platforms.filter(([id, p]) => p.state === 'ready' && p.connected && !piece.posts[`${channel!.id}/${id}`]?.id).map(([id]) => id);
  const [picked, setPicked] = useState<PlatformId[]>(usable);
  const usableKey = usable.join(',');
  // the channel can arrive after the episode: start with every platform it can post to, once
  useEffect(() => { setPicked(p => (p.length ? p.filter(x => usable.includes(x)) : usable)); }, [usableKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [whenMode, setWhen] = useState<When>('next');
  const [chosen, setChosen] = useState('');
  const [testPrivate, setTestPrivate] = useState(false);
  const [tt, setTt] = useState<TikTokChoices>(TIKTOK_START);
  const ttOn = picked.includes('tiktok');
  const ttInfo = useTikTokCreator(channel?.id ?? '', ttOn && tt.mode === 'direct' && !!channel);
  const ttBlock = ttOn ? tiktokBlock(tt, ttInfo.data, null) : null;

  const at = whenMode === 'next' ? (slot.data?.[picked[0] ?? 'youtube'] ?? null) : whenMode === 'choose' && chosen ? new Date(chosen).toISOString() : null;
  const errors = Object.entries(piece.checks?.platforms ?? {}).flatMap(([id, c]) => picked.includes(id as PlatformId) ? (c?.issues ?? []).filter(i => i.level === 'error') : []);
  const posted = Object.entries(piece.posts);
  const running = job?.status === 'running' || publish.isPending;

  if (!piece.meta?.youtube?.title) return (
    <div className="grid gap-4 border border-rule bg-flap-2 p-8">
      <Flap text="Falta o texto" size="md" tone="dim" />
      <p className="text-ink-2">Antes de partir, o episódio precisa de título e descrição.</p>
      <div><Button kind="primary" icon="back" onClick={onEdit}>Escrever o texto</Button></div>
    </div>
  );

  if (running || (job && job.status !== 'running' && job.events.some(e => e.type === 'publish:done' || e.type === 'publish:failed'))) {
    return <Progress job={job} onCancel={() => job && cancel.mutate(job.id)} caption={piece.meta?.tiktok?.caption ?? ''} />;
  }

  const summary = picked.length
    ? `${picked.map(p => channel?.platforms[p]?.label).join(' e ')}${channel ? `, no canal ${channel.platforms[picked[0]!]?.connected?.title ?? channel.name}` : ''}, ${testPrivate ? 'como privado (teste)' : 'público'}, ${at ? whenLong(at) : 'agora'}.`
    : 'Escolha pelo menos um destino.';
  const tiktokNote = !ttOn ? '' : tt.mode === 'direct'
    ? ` O TikTok posta agora, direto no perfil${tt.privacy === 'SELF_ONLY' ? ', só para você' : ''}.`
    : (picked.length > 1 ? ' O TikTok recebe como rascunho agora; você posta pelo app.' : ' Vai como rascunho para a caixa de entrada do TikTok; você posta pelo app.');

  return (
    <div className="grid gap-8">
      {posted.length ? (
        <ul className="grid gap-[3px]" aria-label="Já partiu">
          {posted.map(([key, p]) => <PostedItem key={key} slug={piece.slug} postKey={key} post={p} label={channel?.platforms[p.platform]?.label ?? p.platform} caption={piece.meta?.tiktok?.caption ?? ''} />)}
        </ul>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="label mb-3">Destino</legend>
        <div className="grid gap-[3px]">
          {platforms.map(([id, p]) => {
            const done = piece.posts[`${channel!.id}/${id}`]?.id;
            const can = p.state === 'ready' && !!p.connected && !done;
            const on = picked.includes(id);
            return (
              <label key={id} className={`flap-row flex items-center gap-4 px-4 py-3 ${can ? 'cursor-pointer hover:brightness-125' : 'opacity-60'} ${on && can ? 'ring-1 ring-amber' : ''} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber`}>
                <input type="checkbox" className="sr-only" disabled={!can} checked={on && can} onChange={() => setPicked(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])} />
                <span className={`grid size-5 place-items-center border ${on && can ? 'border-amber bg-amber text-amber-ink' : 'border-steel-3'}`}>{on && can ? <Icon name="check" size={14} /> : null}</span>
                <PlatformIcon id={id} size={17} className={can ? 'text-ink' : 'text-ink-3/50'} />
                <span className="font-cond text-[1.05rem] font-semibold">{p.label}</span>
                <span className="ml-auto font-cond text-[0.92rem] text-ink-3">
                  {p.state !== 'ready' ? 'em breve' : done ? 'já enviado' : p.connected ? p.connected.title : <Link to="/canais" className="text-amber hover:underline">conectar em Canais</Link>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="label mb-3">Quando</legend>
        <div className="grid gap-[3px] md:grid-cols-3">
          {([['next', 'Próximo horário', slot.data && picked[0] && slot.data[picked[0]] ? when(slot.data[picked[0]]!) : '…'], ['choose', 'Escolher', chosen ? when(chosen) : 'dia e hora'], ['now', 'Agora', 'assim que enviar']] as const).map(([id, label, sub]) => (
            <label key={id} className={`flap-row grid cursor-pointer gap-1 px-4 py-3 hover:brightness-125 ${whenMode === id ? 'ring-1 ring-amber' : ''} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber`}>
              <input type="radio" name="when" className="sr-only" checked={whenMode === id} onChange={() => setWhen(id)} />
              <span className={`caps text-[0.95rem] ${whenMode === id ? 'text-amber' : 'text-ink'}`}>{label}</span>
              <span className="font-cond text-[0.95rem] text-ink-3">{sub}</span>
            </label>
          ))}
        </div>
        {whenMode === 'choose' ? (
          <input type="datetime-local" aria-label="Dia e hora da partida" className={`${inputClass} max-w-xs font-cond text-[1.05rem]`} value={chosen}
            min={new Date(Date.now() + 20 * 60e3 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16)} onChange={e => setChosen(e.target.value)} />
        ) : null}
        <label className="mt-2 flex cursor-pointer items-center gap-3 font-cond text-[0.95rem] text-ink-2">
          <input type="checkbox" checked={testPrivate} onChange={e => setTestPrivate(e.target.checked)} className="size-4 accent-[var(--color-amber)]" />
          Enviar como privado, para testar antes
        </label>
      </fieldset>

      {ttOn && channel ? <TikTokPost channel={channel.id} value={tt} onChange={setTt} seconds={null} /> : null}

      {errors.length ? <Findings issues={errors} /> : null}
      {publish.error ? <p className="border border-[#5a2422] bg-[#1d0f0f] px-4 py-3 text-red">{errorText(publish.error.message)}</p> : null}

      <div className="grid gap-4 border-t border-rule pt-6">
        <p className="text-[1.05rem] text-ink-2"><span className="text-ink">Vai para </span>{summary}{tiktokNote}</p>
        <div>
          <Button kind="primary" size="lg" icon="arrow" disabled={!picked.length || errors.length > 0 || !!ttBlock || (whenMode === 'choose' && !chosen) || (whenMode === 'next' && !at)}
            title={ttBlock ?? undefined}
            onClick={() => publish.mutate({ platforms: picked, at: whenMode === 'now' ? null : at, privacy: testPrivate ? 'private' : undefined, tiktok: ttOn ? tt : undefined })}>
            {whenMode === 'now' ? 'Publicar agora' : at ? `Agendar para ${when(at)}` : 'Agendar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

type DoneEntry = { platform?: string; url?: string; status?: string; publishAt?: string; warning?: string };

// a TikTok draft carries no caption: the creator pastes it in the app, so it's one click away here
function CopyCaption({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(false), 1800); return () => window.clearTimeout(t); }, [copied]);
  if (!text) return null;
  return <Button size="sm" kind="frame" icon={copied ? 'check' : 'link'} onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }}>{copied ? 'Legenda copiada' : 'Copiar legenda do TikTok'}</Button>;
}

function DoneLine({ e, caption }: { e: DoneEntry; caption: string }) {
  const draft = e.status === 'draft';
  return (
    <li className="grid gap-2 rounded-md bg-flap px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformIcon id={e.platform ?? ''} size={17} className="text-ink" />
        <span className={`text-[0.95rem] font-semibold ${e.status === 'scheduled' ? 'text-amber' : 'text-ink'}`}>{draft ? 'Rascunho no TikTok' : e.status === 'scheduled' ? 'Agendado' : e.status === 'public' ? 'No ar' : 'Enviado'}</span>
        <span className="text-[0.92rem] text-ink-2">{draft ? 'Abra o TikTok, toque na notificação da caixa de entrada, cole a legenda e poste.' : e.publishAt ? `vai ao ar sozinho ${whenLong(e.publishAt)}` : 'já está no canal'}</span>
        {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 text-[0.85rem] font-medium text-amber hover:underline">Abrir <Icon name="external" size={14} /></a> : null}
      </div>
      {draft ? <div className="grid gap-3"><div><CopyCaption text={caption} /></div><PhoneCaption caption={caption} /></div> : null}
      {e.warning ? <p className="text-[0.9rem] text-amber">{errorText(e.warning)}</p> : null}
    </li>
  );
}

function Progress({ job, onCancel, caption }: { job: ReturnType<typeof useJobFor>; onCancel: () => void; caption: string }) {
  const pr = job?.progress;
  const pct = pr ? Math.floor((100 * pr.sent) / Math.max(1, pr.total)) : 0;
  const dones = (job?.events ?? []).filter(e => e.type === 'publish:done').map(e => ({ platform: String(e.platform ?? ''), ...(e.entry as DoneEntry) }));
  const fails = (job?.events ?? []).filter(e => e.type === 'publish:failed');
  const jobFail = job?.status === 'failed' ? job.error : null;
  const lines = job?.events.filter(e => e.type === 'publish:log').slice(-3).map(e => String(e.message)) ?? [];
  const running = job?.status === 'running';

  if (!running && (dones.length || fails.length || jobFail)) return (
    <div className={`grid gap-5 rounded-lg border p-8 ${dones.length ? 'border-rule bg-flap-2' : 'border-[#5a2422] bg-[#140b0b]'}`} aria-live="polite">
      <Flap text={dones.length ? (fails.length ? 'Parte enviada' : 'Pronto') : 'Falhou'} size="lg" tone={dones.length ? 'ink' : 'red'} intro />
      {dones.length ? <ul className="grid gap-2">{dones.map((e, i) => <DoneLine key={i} e={e} caption={caption} />)}</ul> : null}
      {fails.map((f, i) => <p key={i} className="flex items-center gap-2 text-[0.95rem] text-red"><PlatformIcon id={String(f.platform ?? '')} size={15} /> {errorText(String(f.error ?? ''))}</p>)}
      {jobFail && !fails.length ? <p className="text-[1.05rem] text-ink-2">{errorText(jobFail)}</p> : null}
    </div>
  );
  return (
    <div className="grid gap-6 border border-amber/50 bg-flap-2 p-8" aria-live="polite">
      <div className="flex items-center gap-5">
        <Flap text={`${String(pct).padStart(3, ' ')}%`} size="xl" tone="amber" label={`${pct} por cento enviado`} />
        <div className="grid gap-1">
          <span className="flex items-center gap-2 caps text-amber"><Lamp tone="amber" blink /> Enviando</span>
          {pr ? <span className="font-cond text-[1rem] text-ink-3">{mb(pr.sent)} de {mb(pr.total)} · {pr.mbps.toFixed(1)} MB/s</span> : <span className="font-cond text-ink-3">Preparando o envio…</span>}
        </div>
      </div>
      <div className="relative h-2 bg-flap" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Envio">
        <span className="absolute inset-y-0 left-0 bg-amber transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {dones.length ? <ul className="grid gap-2">{dones.map((e, i) => <DoneLine key={i} e={e} caption={caption} />)}</ul> : null}
      {lines.length ? <ul className="grid gap-1 font-cond text-[0.92rem] text-ink-3">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
      <p className="text-[0.95rem] text-ink-3">Se a internet cair, o envio continua de onde parou na próxima vez.</p>
      <div><Button kind="quiet" icon="stop" onClick={onCancel}>Parar envio</Button></div>
    </div>
  );
}
