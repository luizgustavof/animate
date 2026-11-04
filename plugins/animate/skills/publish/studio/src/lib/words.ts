// Every user-facing word that depends on data: dates, sizes, statuses, and the platform findings (server codes → Portuguese).
import type { Issue, PieceRow, PlatformId, Post } from '../api/types';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: tz });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
const longFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz });

export const day = (d: string | Date) => dayFmt.format(new Date(d)).replace('.', '');
export const time = (d: string | Date) => timeFmt.format(new Date(d));
export const when = (d: string | Date) => `${day(d)} · ${time(d)}`;
export const whenLong = (d: string | Date) => longFmt.format(new Date(d));

export function relative(d: string | Date): string {
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms), past = ms < 0;
  const m = Math.round(abs / 60e3), h = Math.round(abs / 3600e3), dd = Math.round(abs / 86400e3);
  const s = m < 60 ? `${m} min` : h < 36 ? `${h} h` : `${dd} dias`;
  return past ? `há ${s}` : `em ${s}`;
}

export const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;
export const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}` : `${Math.round(n)} s`);
export const count = (n: number) => new Intl.NumberFormat('pt-BR', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);

export const PLATFORM: Record<PlatformId, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

// one word for where an episode stands on one platform
export type Stage = 'sem-render' | 'sem-texto' | 'pronto' | 'enviando' | 'agendado' | 'no-ar' | 'privado' | 'nao-listado';
export function stageOf(row: PieceRow, platform: PlatformId): Stage {
  const post: Post | undefined = row.channel ? row.posts[`${row.channel}/${platform}`] : undefined;
  if (post?.status === 'uploading') return 'enviando';
  if (post?.status === 'scheduled') return 'agendado';
  if (post?.status === 'public') return 'no-ar';
  if (post?.status === 'private') return 'privado';
  if (post?.status === 'unlisted') return 'nao-listado';
  if (!row.render) return 'sem-render';
  return row.meta ? 'pronto' : 'sem-texto';
}
export const STAGE: Record<Stage, string> = {
  'sem-render': 'Sem vídeo', 'sem-texto': 'Falta o texto', pronto: 'Pronto pra sair', enviando: 'Enviando',
  agendado: 'Agendado', 'no-ar': 'No ar', privado: 'Privado', 'nao-listado': 'Não listado',
};

// the platform findings in plain Portuguese, with what to do
export function issueText(i: Issue): string {
  switch (i.code) {
    case 'no-block': return 'Ainda não tem texto pra esta plataforma.';
    case 'title-empty': return 'Falta o título.';
    case 'title-long': return `O título tem ${i.value} caracteres; o máximo é ${i.limit}.`;
    case 'title-feed': return `O título tem ${i.value} caracteres: no feed do Shorts aparecem uns 40 a 70. Dá pra encurtar?`;
    case 'angle-brackets': return 'O YouTube não aceita os sinais < e >.';
    case 'description-long': return `A descrição passou do limite (${i.value} de ${i.limit}).`;
    case 'hashtags-ignored': return `São ${i.value} hashtags: acima de 60 o YouTube ignora todas.`;
    case 'hashtags-many': return `São ${i.value} hashtags; de 3 a 5 boas funcionam melhor (só as 3 primeiras aparecem sobre o título).`;
    case 'tags-long': return `As palavras-chave somam ${i.value} caracteres; o máximo é ${i.limit}.`;
    case 'made-for-kids': return 'Falta dizer se o canal é feito para crianças (declaração legal do YouTube).';
    case 'not-short': return 'O vídeo não é vertical ou passa de 3 min: vai como vídeo normal, não como Short.';
    case 'no-audio': return 'O vídeo está sem som.';
    case 'file-huge': return 'O arquivo é grande demais (mais de 256 GB).';
    case 'privacy': return 'Visibilidade inválida.';
    case 'too-soon': return 'O horário precisa ser daqui a pelo menos 15 minutos.';
    default: return i.text;
  }
}

// server errors that need a person, in words
export function errorText(msg: string | null | undefined): string {
  if (!msg) return 'Algo deu errado.';
  if (/^Deleting needs one new YouTube sign-in/.test(msg)) return 'Para excluir, o YouTube pede um login novo uma vez (com permissão de gerenciar vídeos). A página abriu no navegador: escolha a mesma conta e canal e clique em Permitir.';
  if (msg.startsWith('NEEDS_RECONNECT')) return 'Para excluir, conecte o YouTube de novo em Canais (uma vez), com permissão de gerenciar vídeos.';
  if (/already gone on the platform/.test(msg)) return 'O vídeo já não estava mais no YouTube.';
  if (/can't delete that video/.test(msg)) return 'Este login não pode excluir esse vídeo. Ele está em outro canal?';
  if (/can't delete posts from here yet/.test(msg)) return 'Essa plataforma ainda não deixa excluir por aqui. Exclua no app e tente de novo.';
  if (/studio token/i.test(msg)) return 'Abra o Estúdio pelo atalho na área de trabalho (ou peça ao Claude: "abre o estúdio").';
  if (msg.startsWith('NEEDS_LOGIN')) return 'O Claude Code está deslogado neste computador. Abra um terminal, digite claude e entre na sua conta uma vez.';
  if (msg === 'NEEDS_GOOGLE_KEY') return 'Falta a chave do Google: baixe o JSON do cliente "Desktop app" para a pasta Downloads.';
  if (/locked this upload private|not passed the YouTube API audit/i.test(msg)) return 'O YouTube deixou o vídeo privado porque o app ainda não passou pela auditoria. Torne público no YouTube Studio.';
  if (/quotaExceeded/.test(msg)) return 'A cota diária da API do YouTube acabou. Ela volta à meia-noite do horário do Pacífico (umas 5h aqui).';
  if (/sign-in expired|invalid_grant/i.test(msg)) return 'O login do YouTube venceu. Conecte de novo em Canais.';
  if (/cancelled/.test(msg)) return 'Cancelado. Se publicar de novo, o envio continua de onde parou.';
  if (/kept failing|connection/i.test(msg)) return 'A conexão caiu várias vezes. Publique de novo: o envio continua de onde parou.';
  if (/wrong channel|refusing to upload/i.test(msg)) return 'O login é de outro canal. Nada foi enviado. Conecte o canal certo em Canais.';
  return msg;
}
