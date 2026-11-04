# Architecture (for agents changing the publish skill)

Read this before editing anything under `plugins/animate/skills/publish/`. The rule that shapes it: **one flow, two faces.**
The CLI (`tools/publish.mjs`, used by agents in chat) and the studio (`tools/studio.mjs` + `studio/`, the user's panel) call the
same library; neither has publishing logic of its own.

## Layers

```
studio/ (React UI, compiled to studio/dist)      tools/publish.mjs (CLI)
        │  HTTP + SSE on 127.0.0.1                         │
        ▼                                                  │
tools/studio.mjs (server: routes, token, jobs)             │
        └───────────────┬──────────────────────────────────┘
                        ▼
lib/publisher.mjs   overview · nextSlot · parseAt · publish (events) · unpublish · refreshStats
lib/setup.mjs       connections (what each channel still needs) · the Google key from Downloads
lib/writer.mjs      titles, descriptions, hashtags via `claude -p` (no API key)
lib/thumbs.mjs      candidate frames + text templates → cover 9:16 and thumbnail 16:9
lib/jobs.mjs        long work (upload, render, AI) with progress events and cancel
lib/store.mjs       paths, channels.json, meta.json, state.json, probe (cached), the per-piece lock
lib/platforms.mjs   the registry: PLATFORMS (built), PLANNED, LABELS
lib/oauth.mjs       loopback OAuth with PKCE (desktop sign-in, no secrets in the browser)
tools/platforms/    one module per platform (youtube.mjs today)
```

Node built-ins only in `tools/` (fetch, http, crypto, child_process). The studio UI is the one place with npm dependencies, and
only to build it; `studio.mjs` serves `studio/dist/` and builds it once if it's missing.

## Data

| file | written by | what |
|---|---|---|
| `<project>/publish/channels.json` | user / studio | channels: profile (audience, voice, hashtags, schedule), one block per platform |
| `<project>/publish/channels/<name>/` | studio | avatar, banner, the chosen thumbnail template |
| `pieces/<ep>/publish/meta.json` | agent / studio (writer) | the words per platform, 5 candidates and why |
| `pieces/<ep>/publish/state.json` | publisher only | per `channel/platform`: status, id, url, publishAt, stats, an `uploading` session to resume; `removed`: posts taken back |
| `pieces/<ep>/publish/thumbs/` | thumbs | candidates and the chosen cover/thumbnail |
| `~/.animate/` | setup / platforms | secrets: OAuth clients and tokens. Never in the project (it may sync to a cloud drive), never to the browser |

`state.json` is the truth about what was posted: never post twice, never edit a posted entry by hand.

## A platform module

`tools/platforms/<name>.mjs` exports:
- `auth(account)` → `{ id, title }`: interactive sign-in, saves the token to `~/.animate/tokens/<account>.<name>.json`.
- `connected(account)` → `{ id, title } | null`, from the saved token, no network.
- `validate({ meta, cfg, channel, video, publishAt, privacy })` → `{ errors, warnings, request, ... }`: pure, no network. The
  studio calls it on every keystroke for the live counters, so keep it fast.
- `post({ account, cfg, request, file, resume, onSession, log, onProgress, signal })` → `{ id, url, privacy, publishAt, warning }`.
  Resumable when the platform allows it: report the session through `onSession` (it lands in `state.json`) and accept it back as
  `resume`. Stop between chunks when `signal.aborted`.
- optional: `stats(account, ids)`, `remove(account, id, { log })` → `{ gone, already }` (delete a post; a 404 counts as
  already gone; YouTube needs the full `youtube` scope, so a sign-in saved before it asks once more), `setThumbnail(...)`,
  `updateChannel(...)`.
- `unpublish(p, { key })` (publisher) calls `remove`, then moves the entry from `posts` to `removed` (with `removedAt`): history is
  kept, and the piece counts as not posted there. The studio route `POST /api/pieces/:slug/unpublish` needs
  `{ key, confirm: <slug> }`; the CLI `unpost` needs `--yes`. Both are irreversible on the platform: always ask the user first.

Then add it to `PLATFORMS` in `lib/platforms.mjs` (and remove it from `PLANNED`), write `docs/connect-<name>.md`, and add its
character limits to the studio's previews. Test against a fake `fetch` first (see "Testing").

## The studio

- **Server** (`tools/studio.mjs`): `127.0.0.1` only. A random token is in the URL it opens; every request must carry it
  (`x-studio-token` header, or `?t=` for media), or it gets 403. No secrets ever reach the browser: only "connected as X".
- **API**: JSON under `/api/…`; long work starts a job and returns its id; progress arrives on the one SSE stream `/api/events`.
- **UI** (`studio/src/`): React + TypeScript + Tailwind v4 + Motion + React Router + TanStack Query. One screen per route,
  lazy-loaded. Server state only through TanStack Query (no copies in component state); the single `EventSource` lives in one
  provider and writes job progress into the query cache. Every effect cleans up (abort fetches, close streams, revoke object URLs,
  release `<video>` sources). The design rules are in `studio/DESIGN.md` (the split-flap departure board world) and the product
  record in `studio/PRODUCT.md`; read both before touching the UI. Dev: `node tools/studio.mjs --dev --port 4747` + `npm run dev`
  in `studio/` (Vite proxies `/api` and `/media`). Build: `npm run build` in `studio/` (the server serves `studio/dist/`).

## Testing

- CLI regression: `setup --no-wait`, `next`, `channels`, `status`, `check <ep> --at next`.
- Uploads against a fake YouTube: stub `globalThis.fetch` and `ANIMATE_SECRETS` to a temp dir, then call the platform's `post()`
  directly: partial ranges (308), a 503, a dropped connection, resume from the saved session (one init only), bytes identical,
  the `channelId` pin refusing.
- Studio: `.claude/launch.json` → "studio" → drive it in the built-in browser; the memory check (navigate 50×, heap back to
  baseline, one `EventSource`).
