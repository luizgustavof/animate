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
    case 'caption-empty': return 'Falta a legenda do TikTok (você cola no app ao postar o rascunho).';
    case 'caption-long': return `A legenda tem ${i.value} caracteres; o TikTok aceita ${i.limit}.`;
    case 'too-long': return 'O vídeo passa de 10 minutos, o limite de envio pela API do TikTok.';
    case 'too-short': return 'O TikTok pede pelo menos 3 segundos.';
    case 'not-vertical': return 'O vídeo está deitado: no TikTok o vertical (9:16) fica melhor.';
    case 'no-schedule': return 'No TikTok o rascunho vai agora; você posta (ou agenda) pelo app.';
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
    case 'file-huge': return 'O arquivo é grande demais para essa plataforma.';
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
  if (msg.startsWith('NEEDS_TIKTOK_APP')) return 'Falta configurar o app do TikTok (uma vez): siga os passos em Canais → TikTok.';
  if (msg.startsWith('TIKTOK_APP:')) return /secret/i.test(msg) ? 'Isso não parece um Client secret do TikTok. Copie de novo em App details.' : 'Isso não parece um Client key do TikTok. Copie de novo em App details.';
  if (/scope_not_authorized/.test(msg)) return 'O TikTok não deu permissão de envio. Conecte de novo e deixe todas as permissões marcadas.';
  if (/unaudited_client_can_only_post_to_private_accounts/.test(msg)) return 'Essa conta do TikTok ainda não é usuária de teste do app. Adicione em Sandbox settings → Target users (pode levar 1 hora).';
  if (/spam_risk_too_many_posts|spam_risk_too_many_pending/.test(msg)) return 'O TikTok limitou os envios desta conta por hoje (ou há rascunhos demais esperando). Poste ou apague os rascunhos no app.';
  if (/TikTok .*rate_limit_exceeded/.test(msg)) return 'O TikTok pediu calma: no máximo 6 envios por minuto. Tente de novo em um minuto.';
  if (/TikTok refused the video: (.*)/.test(msg)) return `O TikTok recusou o vídeo (${/: (.*)$/.exec(msg)?.[1]}). Confira formato, duração e resolução.`;
  if (/TikTok is still processing the draft/.test(msg)) return 'O TikTok ainda está processando: o rascunho aparece na caixa de entrada do app em alguns minutos.';
  if (/TikTok drafts can only be deleted in the app/.test(msg)) return 'O TikTok não deixa apagar por aqui: apague o rascunho no app.';
  if (/TikTok drafts go now/.test(msg)) return 'No TikTok o rascunho vai agora; você posta (ou agenda) pelo app quando quiser.';
  if (/refusing to upload to the wrong account/.test(msg)) return 'O login do TikTok é de outra conta. Nada foi enviado. Conecte a conta certa em Canais.';
  if (/studio token/i.test(msg)) return 'Abra o Estúdio pelo atalho na área de trabalho (ou peça ao Claude: "abre o estúdio").';
  if (msg.startsWith('NEEDS_LOGIN')) return 'O Claude Code está deslogado neste computador. Abra um terminal, digite claude e entre na sua conta uma vez.';
  if (msg === 'NEEDS_GOOGLE_KEY') return 'Falta a chave do Google: baixe o JSON do cliente "Desktop app" para a pasta Downloads.';
  if (/locked this upload private|not passed the YouTube API audit/i.test(msg)) return 'O YouTube deixou o vídeo privado porque o app ainda não passou pela auditoria. Torne público no YouTube Studio.';
  if (/quotaExceeded/.test(msg)) return 'A cota diária da API do YouTube acabou. Ela volta à meia-noite do horário do Pacífico (umas 5h aqui).';
  if (/sign-in expired|invalid_grant/i.test(msg)) return 'O login do YouTube venceu. Conecte de novo em Canais.';
  if (/spam_risk_too_many_pending_share/.test(msg)) return 'O TikTok já tem 5 rascunhos esperando na sua caixa de entrada. Poste ou apague alguns no app e envie este de novo.';
  if (/NEEDS_TIKTOK_STATS/.test(msg)) return 'Os números do TikTok precisam da permissão video.list: adicione o Display API no app do TikTok e clique em Reconectar em Canais.';
  if (/^NEEDS_TIKTOK_PUBLISH/.test(msg)) return 'Para postar direto, ligue o Direct Post no app de desenvolvedor do TikTok e clique em Reconectar no TikTok (em Canais).';
  if (/unaudited_client_can_only_post_to_private_accounts/.test(msg)) return 'Até o TikTok aprovar o app, postar direto só funciona com a conta do TikTok em modo privado. Deixe a conta privada nas configurações do app ou envie como rascunho.';
  if (/privacy_level_option_mismatch/.test(msg)) return 'O TikTok não aceita essa opção de quem pode ver para esta conta agora. Escolha outra.';
  if (/reached_active_user_cap/.test(msg)) return 'O app do TikTok chegou ao limite de contas postando hoje. Tente amanhã.';
  if (/^TIKTOK_TOO_LONG/.test(msg)) return 'O vídeo é mais longo do que esta conta do TikTok pode postar.';
  if (/^SIGNIN_TIMEOUT/.test(msg)) return 'O login não voltou em 5 minutos. Clique em Conectar de novo e, na página que abrir, clique em Autorizar.';
  if (/sign-in failed: access_denied/.test(msg)) return 'O login foi recusado na página. Clique em Conectar de novo e aceite as permissões.';
  if (/sign-in failed/.test(msg)) return `O login não deu certo: ${msg.replace(/^.*sign-in failed:\s*/, '')}. Clique em Conectar de novo.`;
  if (/cancelled/.test(msg)) return 'Cancelado. Se publicar de novo, o envio continua de onde parou.';
  if (/kept failing|connection/i.test(msg)) return 'A conexão caiu várias vezes. Publique de novo: o envio continua de onde parou.';
  if (/wrong channel|refusing to upload/i.test(msg)) return 'O login é de outro canal. Nada foi enviado. Conecte o canal certo em Canais.';
  return msg;
}
