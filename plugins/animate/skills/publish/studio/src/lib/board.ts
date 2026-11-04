// How episodes line up on the departures board: what's moving first, then by departure time, then what's waiting, then what left.
import type { Channel, PieceRow, PlatformId, Post } from '../api/types';
import type { LiveJob } from '../api/events';

export type RowState = 'enviando' | 'agendado' | 'pronto' | 'sem-texto' | 'sem-video' | 'no-ar' | 'rascunho' | 'privado' | 'falhou' | 'escrevendo';

export interface BoardRow {
  row: PieceRow;
  code: string;               // EP03
  channel: Channel | null;
  state: RowState;
  at: string | null;          // departure (scheduled) or departed (posted) time
  posts: Array<Post & { key: string }>;
  progress: number | null;    // 0..1 while uploading
}

export const codeOf = (slug: string) => {
  const m = /^ep(\d+)/i.exec(slug);
  return m ? `EP${m[1]!.padStart(2, '0')}` : slug.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
};

// a channel's board code: its own `code`, else the initials of its name (FDA), never more than 4
export const channelCode = (c: Channel | null | undefined) => {
  if (!c) return '—';
  const words = c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map(w => w[0]).join('') : c.name.slice(0, 3)).slice(0, 4).toUpperCase();
};

const RANK: Record<RowState, number> = { enviando: 0, escrevendo: 1, falhou: 2, agendado: 3, pronto: 4, rascunho: 5, 'sem-texto': 6, 'sem-video': 7, privado: 8, 'no-ar': 9 };

export function boardRows(pieces: PieceRow[], channels: Channel[], jobs: Record<string, LiveJob>): BoardRow[] {
  const byId = new Map(channels.map(c => [c.id, c]));
  const running = Object.values(jobs).filter(j => j.status === 'running');
  const failed = Object.values(jobs).filter(j => j.status === 'failed' && j.kind === 'publish');
  return pieces
    .filter(p => p.channel)
    .map((row): BoardRow => {
      const posts = Object.entries(row.posts).map(([key, p]) => ({ ...p, key }));
      const up = running.find(j => (j.kind === 'publish' && j.target === row.slug) || (j.kind === 'batch' && j.events.at(-1)?.slug === row.slug));
      const writing = running.some(j => j.kind === 'words' && j.target === row.slug);
      const scheduled = posts.filter(p => p.status === 'scheduled').map(p => p.publishAt!).sort()[0] ?? null;
      const posted = posts.filter(p => p.status === 'public' || p.status === 'unlisted').map(p => p.postedAt!).sort().at(-1) ?? null;
      const privateOnly = posts.some(p => p.status === 'private') && !scheduled && !posted;
      const draftOnly = posts.some(p => p.status === 'draft') && !scheduled && !posted;
      let state: RowState;
      if (up || posts.some(p => p.status === 'uploading')) state = 'enviando';
      else if (writing) state = 'escrevendo';
      else if (failed.some(j => j.target === row.slug)) state = 'falhou';
      else if (scheduled && row.todo.length === 0) state = 'agendado';
      else if (posted && row.todo.length === 0) state = 'no-ar';
      else if (privateOnly && row.todo.length === 0) state = 'privado';
      else if (draftOnly && row.todo.length === 0) state = 'rascunho';
      else if (!row.render) state = 'sem-video';
      else state = row.meta ? 'pronto' : 'sem-texto';
      const at = state === 'agendado' ? scheduled : state === 'no-ar' || state === 'privado' || state === 'rascunho' ? (posted ?? posts[0]?.postedAt ?? null) : null;
      const progress = up?.progress ? up.progress.sent / Math.max(1, up.progress.total) : null;
      return { row, code: codeOf(row.slug), channel: byId.get(row.channel!) ?? null, state, at, posts, progress };
    })
    .sort((a, b) => {
      if (RANK[a.state] !== RANK[b.state]) return RANK[a.state] - RANK[b.state];
      if (a.state === 'agendado') return (a.at ?? '').localeCompare(b.at ?? '');
      if (a.state === 'no-ar' || a.state === 'privado') return (b.at ?? '').localeCompare(a.at ?? '');
      return a.row.slug.localeCompare(b.row.slug);
    });
}

export const STATE_WORD: Record<RowState, string> = {
  enviando: 'Enviando', escrevendo: 'Escrevendo', falhou: 'Falhou', agendado: 'Agendado', pronto: 'Pronto',
  'sem-texto': 'Sem texto', 'sem-video': 'Sem vídeo', privado: 'Privado', 'no-ar': 'No ar', rascunho: 'Rascunho',
};
export const STATE_TONE: Record<RowState, 'ink' | 'amber' | 'red' | 'dim'> = {
  enviando: 'amber', escrevendo: 'amber', falhou: 'red', agendado: 'amber', pronto: 'ink', 'sem-texto': 'dim', 'sem-video': 'dim', privado: 'ink', 'no-ar': 'ink', rascunho: 'ink',
};

export const PLATFORM_CODE: Record<PlatformId, string> = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' };
