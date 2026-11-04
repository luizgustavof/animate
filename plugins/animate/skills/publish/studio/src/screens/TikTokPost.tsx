// TikTok, per post. Draft: the video waits in the app inbox. Direct: it goes straight to the profile, and TikTok's Direct
// Post rules apply (docs/connect-tiktok.md): the account's own nickname shown, its current privacy options with none
// picked, every interaction off until the user turns it on, the commercial-content disclosure, and the consent line.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { errorText } from '../lib/words';
import { inputClass } from '../ui/controls';

export interface TikTokChoices {
  mode: 'draft' | 'direct';
  privacy: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  disclose: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  aigc: boolean;
}

export const TIKTOK_START: TikTokChoices = {
  mode: 'draft', privacy: '', allowComment: false, allowDuet: false, allowStitch: false, disclose: false, yourBrand: false, brandedContent: false, aigc: false,
};

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todo mundo',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (quem você segue e te segue)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Só eu',
};

export const useTikTokCreator = (channel: string, enabled: boolean) => useQuery({
  queryKey: ['tiktok-creator', channel], enabled, staleTime: 0, gcTime: 60_000, retry: false,
  queryFn: ({ signal }) => api.tiktokCreator(channel, signal),
});

// why the Publish button stays off (null = ready)
export function tiktokBlock(c: TikTokChoices, info: { privacy: string[]; maxSeconds: number | null } | undefined, seconds: number | null): string | null {
  if (c.mode === 'draft') return null;
  if (!info) return 'Esperando as regras do TikTok para esta conta.';
  if (!c.privacy) return 'Escolha quem pode ver o vídeo no TikTok.';
  if (c.disclose && !c.yourBrand && !c.brandedContent) return 'Você precisa indicar se o conteúdo promove você, um terceiro ou ambos.';
  if (c.disclose && c.brandedContent && c.privacy === 'SELF_ONLY') return 'Conteúdo de marca não pode ser privado.';
  if (info.maxSeconds && seconds && seconds > info.maxSeconds) return `Esta conta do TikTok posta vídeos de até ${info.maxSeconds} s; este tem ${Math.round(seconds)} s.`;
  return null;
}

export function TikTokPost({ channel, value, onChange, seconds }: { channel: string; value: TikTokChoices; onChange: (v: TikTokChoices) => void; seconds: number | null }) {
  const direct = value.mode === 'direct';
  const info = useTikTokCreator(channel, direct);
  const set = (patch: Partial<TikTokChoices>) => onChange({ ...value, ...patch });
  const d = info.data;
  const block = tiktokBlock(value, d, seconds);
  const label = value.disclose && value.brandedContent ? 'Seu vídeo vai ter o selo "Parceria paga".' : value.disclose && value.yourBrand ? 'Seu vídeo vai ter o selo "Conteúdo promocional".' : null;

  return (
    <fieldset className="grid gap-4 rounded-md border border-rule bg-flap p-4">
      <legend className="label px-1">TikTok</legend>
      <div className="grid gap-[3px] sm:grid-cols-2" role="radiogroup" aria-label="Como enviar ao TikTok">
        {([['draft', 'Rascunho', 'cai na caixa de entrada; você posta pelo app'], ['direct', 'Postar direto', 'vai para o perfil com a legenda']] as const).map(([id, t, sub]) => (
          <label key={id} className={`flap-row grid cursor-pointer gap-0.5 px-4 py-3 hover:brightness-125 ${value.mode === id ? 'ring-1 ring-amber' : ''} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber`}>
            <input type="radio" name="tt-mode" className="sr-only" checked={value.mode === id} onChange={() => set({ mode: id })} />
            <span className={`text-[0.98rem] font-semibold ${value.mode === id ? 'text-amber' : 'text-ink'}`}>{t}</span>
            <span className="text-[0.88rem] text-ink-3">{sub}</span>
          </label>
        ))}
      </div>

      {direct ? (
        info.isLoading ? <p className="text-[0.92rem] text-ink-3">Buscando as regras do TikTok para esta conta…</p>
        : info.error ? <p className="text-[0.92rem] text-red">{errorText(info.error.message)}</p>
        : d ? (
          <div className="grid gap-4">
            <p className="flex items-center gap-2 text-[0.95rem] text-ink-2">
              {d.avatar ? <img src={d.avatar} alt="" width={22} height={22} referrerPolicy="no-referrer" className="size-[22px] rounded-full object-cover" /> : null}
              Posta na conta <b className="text-ink">{d.nickname ?? d.username}</b>{d.username ? <span className="text-ink-3">@{d.username}</span> : null}
            </p>

            <label className="grid max-w-sm gap-1.5 text-[0.92rem] text-ink-2">
              Quem pode ver
              <select className={inputClass} value={value.privacy} onChange={e => set({ privacy: e.target.value })} required>
                <option value="" disabled>Escolha</option>
                {d.privacy.map(p => (
                  <option key={p} value={p} disabled={p === 'SELF_ONLY' && value.disclose && value.brandedContent}
                    title={p === 'SELF_ONLY' && value.disclose && value.brandedContent ? 'Conteúdo de marca não pode ser privado.' : undefined}>
                    {PRIVACY_LABEL[p] ?? p}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2">
              <span className="text-[0.92rem] text-ink-2">Permitir</span>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {([['allowComment', 'Comentários', d.commentOff], ['allowDuet', 'Dueto', d.duetOff], ['allowStitch', 'Costura', d.stitchOff]] as const).map(([k, t, off]) => (
                  <label key={k} className={`flex items-center gap-2 text-[0.95rem] ${off ? 'cursor-not-allowed text-ink-3/60' : 'cursor-pointer text-ink'}`} title={off ? 'Desligado nas configurações do seu TikTok' : undefined}>
                    <input type="checkbox" className="size-4 accent-[var(--color-amber)]" disabled={off} checked={!off && value[k]} onChange={e => set({ [k]: e.target.checked } as Partial<TikTokChoices>)} />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-[0.95rem] text-ink">
                <input type="checkbox" className="size-4 accent-[var(--color-amber)]" checked={value.disclose} onChange={e => set({ disclose: e.target.checked, ...(e.target.checked ? {} : { yourBrand: false, brandedContent: false }) })} />
                Divulgar conteúdo comercial
              </label>
              {value.disclose ? (
                <div className="ml-6 grid gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[0.92rem] text-ink-2">
                    <input type="checkbox" className="size-4 accent-[var(--color-amber)]" checked={value.yourBrand} onChange={e => set({ yourBrand: e.target.checked })} />
                    Sua marca <span className="text-ink-3">(promove você ou o seu negócio)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[0.92rem] text-ink-2">
                    <input type="checkbox" className="size-4 accent-[var(--color-amber)]" checked={value.brandedContent}
                      onChange={e => set({ brandedContent: e.target.checked, ...(e.target.checked && value.privacy === 'SELF_ONLY' ? { privacy: '' } : {}) })} />
                    Conteúdo de marca <span className="text-ink-3">(promove um terceiro)</span>
                  </label>
                  {label ? <p className="text-[0.88rem] text-amber">{label}</p> : null}
                </div>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[0.95rem] text-ink">
              <input type="checkbox" className="size-4 accent-[var(--color-amber)]" checked={value.aigc} onChange={e => set({ aigc: e.target.checked })} />
              Marcar como gerado por IA
            </label>

            <p className="text-[0.88rem] text-ink-3">
              Ao postar, você concorda com a{value.disclose && value.brandedContent ? <> <a className="text-ink-2 underline underline-offset-2" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Política de Conteúdo de Marca</a> e a</> : null}{' '}
              <a className="text-ink-2 underline underline-offset-2" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Confirmação de Uso de Música</a> do TikTok.
              {' '}Depois de enviar, o TikTok pode levar alguns minutos para mostrar o vídeo no perfil.
            </p>
            {block ? <p className="text-[0.88rem] text-amber">{block}</p> : null}
          </div>
        ) : null
      ) : null}
    </fieldset>
  );
}
