// The shapes tools/studio.mjs sends. Keep in step with rowOut / postOut / publicChannel / checks there.

export type PlatformId = 'youtube' | 'tiktok' | 'instagram';
export type PlatformState = 'ready' | 'planned' | 'unknown';

export interface ChannelPlatform {
  label: string;
  state: PlatformState;
  connected: { id: string; title: string } | null;
  needs: Array<'google-key' | 'tiktok-app' | 'sign-in' | 'wrong-channel'>;
  privacy: string | null;
  madeForKids: boolean | null;
  syntheticMedia: boolean | null;
}

export interface Channel {
  id: string;
  name: string;
  series: string | null;
  language: string | null;
  audience: string;
  voice: string;
  hashtags: { always: string[]; pool: string[] };
  schedule: string[];
  approval: 'ask' | 'auto';
  color: string | null;
  openedAt: string | null;
  platforms: Partial<Record<PlatformId, ChannelPlatform>>;
}

export type PostStatus = 'uploading' | 'scheduled' | 'public' | 'unlisted' | 'private' | 'draft';

export interface Post {
  platform: PlatformId;
  channel: string;
  status: PostStatus;
  id: string | null;
  url: string | null;
  title: string | null;
  publishAt: string | null;
  postedAt: string | null;
  warning: string | null;
  stats: { views: number; likes: number; comments: number; at: string } | null;
}

export interface Render {
  file: string;
  duration: number;
  width: number;
  height: number;
  bytes: number;
}

export interface PieceRow {
  slug: string;
  title: string;
  series: string | null;
  channel: string | null;
  meta: boolean;
  todo: PlatformId[];
  render: Render | null;
  posts: Record<string, Post>;
}

export interface Meta {
  language?: string;
  candidates?: { youtube?: string[] };
  reasons?: { youtube?: string[] };
  chosen?: number;
  why?: string;
  youtube?: { title: string; description: string; tags: string[] };
  tiktok?: { caption: string };
  instagram?: { caption: string };
  writtenAt?: string;
  editedAt?: string;
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  text: string;
  field?: string;
  value?: number;
  limit?: number;
}

export interface PlatformCheck {
  state: PlatformState;
  errors?: string[];
  warnings?: string[];
  issues?: Issue[];
  limits?: Record<string, number> | null;
  short?: boolean | null;
  publishAt?: string | null;
}

export interface Checks {
  channel: string;
  platforms: Partial<Record<PlatformId, PlatformCheck>>;
}

export interface Job {
  id: string;
  kind: 'words' | 'publish' | 'connect' | 'stats' | 'batch' | 'unpublish';
  target: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  result: unknown;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  last: JobEvent | null;
}

export interface JobEvent {
  job: string;
  kind: Job['kind'];
  target: string;
  at: number;
  type: string;   // started | finished | log | publish:item | publish:progress | publish:done | publish:failed | ...
  [k: string]: unknown;
}

export interface StudioState {
  googleKey: boolean;
  tiktokApp: boolean;
  channels: Channel[];
  pieces: PieceRow[];
  jobs: Job[];
}

export interface PieceDetail extends Omit<PieceRow, 'meta'> {
  meta: Meta | null;
  lines: Array<{ id: string; text: string }>;
  checks: Checks | null;
  jobs: Job[];
}

export interface BatchItem {
  slug: string;
  title: string;
  channel: string;
  platforms: PlatformId[];
  at: Partial<Record<PlatformId, string | null>>;
}

export interface StatRow {
  slug: string;
  title: string | null;
  key: string;
  platform: PlatformId;
  channel: string;
  url: string | null;
  postedAt: string | null;
  stats: Post['stats'];
}
