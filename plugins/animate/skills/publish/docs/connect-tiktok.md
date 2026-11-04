# Connect TikTok (draft mode)

What the user gets: the episode goes to their **TikTok inbox as a draft**; they open TikTok, tap the notification, paste the
caption (the studio has a Copy button) and press Post. No audit needed for that. Posting straight to the profile ("direct
post") needs TikTok's app audit, and an unaudited app can only post private videos, so drafts are the mode we use.

The studio walks the user through this in **Canais → TikTok → Conectar** (the steps below, in Portuguese, with links). Use this
page when helping in chat or when something goes wrong.

## Once: the developer app (≈10 minutes, the user does it, in their own browser)

1. **developers.tiktok.com** → Log in with the TikTok account that will post (or any account; the posting account is added
   as a target user in step 5) → accept the developer terms.
2. **Manage apps → Connect an app** (individual developer is fine). Name it e.g. "Estúdio <channel>". App type: **Other** ("Outro"; not Minigame or Drama, and it can't be changed later). Category: Entertainment.
   Description: "Uploads my own videos to my TikTok inbox as drafts". The icon can be the channel avatar.
   The form asks for an icon (`publish/channels/<channel>/tiktok-icon.png`, 1024×1024 cut from an episode frame), a
   description, platform **Desktop**, and Terms/Privacy URLs: use
   `https://luizgustavof.github.io/animate/termos/` and `https://luizgustavof.github.io/animate/privacidade/`
   (`docs/legal-page.md`).
3. Switch the toggle next to the app name to **Sandbox** → **Create Sandbox** → any name → Confirm. A sandbox needs no review,
   no website, no privacy policy.
4. In the sandbox, **Add products**:
   - **Login Kit** → Redirect URI, tab **Web**: `https://luizgustavof.github.io/animate/tiktok/callback/`. TikTok only takes
     https redirects here (the Desktop tab stays locked unless Web is configured), so that static page on the fork's GitHub
     Pages forwards `code` + `state` to the local sign-in server: `state` starts with the loopback port (`<port>.<random>`).
     PKCE and the client secret make a code seen in transit useless. Platforms: **Web**, Web URL
     `https://luizgustavof.github.io/animate/`. Another fork: copy `tiktok/callback/` to its own Pages and set `"redirect"` in
     `~/.animate/tiktok-app.json`.
   - **Content Posting API** (upload). Turn **Direct Post** on (scope `video.publish`, used by "Postar direto"; posts stay private until the audit, `docs/tiktok-review.md`). **Verify domains** is not needed (we push the file).
   - Scopes: `user.info.basic`, `video.upload` and `video.publish`. A sign-in made before `video.publish` was added must
     be redone (Reconectar) before "Postar direto" works.
   - **Apply changes**.
5. **Sandbox settings → Target users → Add account** → log in with the TikTok account of the channel. Up to 10 accounts, each
   one the user owns; it can take up to an hour to appear.
6. With the toggle on **Sandbox**, **App details** shows the sandbox's own **Client key** and **Client secret** (the key starts
   with `sb`; the production app's keys are different and fail with a TikTok page that only says "client_key" until the app
   passes review). The user pastes both into the studio form
   (Canais → TikTok). They are stored in `~/.animate/tiktok-app.json` and never shown again or sent to the browser.
   **Never read, copy or ask for the secret in chat**: the user pastes it into the form themselves.

## Per channel: sign in

Studio: **Conectar** on the TikTok row. CLI: `node tools/publish.mjs auth <channel> tiktok`. The browser opens TikTok's
authorize page; the user logs in with the channel's account and taps **Authorize**. The token lands in
`~/.animate/tokens/<account>.tiktok.json`. Refresh tokens last 180 days and rotate on every use (the tool saves the new one each
time); after 180 days, or if the user removes the app in TikTok's settings, connect again.

To pin the account (refuse uploads to any other), put `"openId"` in the channel's `tiktok` block; `channels` prints it.

## Posting

`post <ep> --platform tiktok` (or the studio's Partida tab with TikTok checked). The tool uploads the render in 50 MB chunks,
then waits until TikTok reports `SEND_TO_USER_INBOX`. `state.json` gets `status: "draft"` with the `publish_id`. There's no
scheduling through the API: the draft goes now and the user posts (or schedules) it in the app.

## Drafts after upload

The draft has no link: TikTok returns only a `publish_id` (`v_inbox_file~…`) and status `SEND_TO_USER_INBOX`; it opens from
the app's inbox notification (or Perfil → Rascunhos). The studio shows the caption with Copy and a QR code to the caption page
(`docs/legal-page.md`). When the Board or an episode opens (at most once a minute) the studio asks TikTok for each draft's
status; once the creator posts it, it turns `PUBLISH_COMPLETE` and the entry becomes `public`, with the post link when TikTok
gives the id (public posts only).

## Traps

- **`spam_risk_too_many_pending_share`**: at most 5 drafts can wait in the inbox. Post or delete some in the app, then send
  again.

- **TikTok page "… non_sandbox_target"**: the account signed in on tiktok.com is not a sandbox target user. Add it in
  Sandbox settings → Target users (it can take up to an hour), or log out of tiktok.com and sign in with the account that is.

- **TikTok page "Ocorreu um erro … client_key"**: the production keys were pasted. Paste the sandbox's (starts with `sb`):
  Canais → TikTok → "Trocar as chaves do app".

- **`scope_not_authorized`**: the user unticked a permission on the authorize page. Connect again, allow both.
- **`unaudited_client_can_only_post_to_private_accounts`** or nothing arrives: the posting account isn't a sandbox target user
  (step 5), or it was added less than an hour ago.
- **`spam_risk_too_many_posts` / pending drafts**: TikTok limits API uploads per account per day and how many drafts can wait
  unfinished. Post or delete the old drafts in the app.
- **`rate_limit_exceeded`**: 6 uploads a minute per account. Wait a minute.
- **The redirect is refused** ("redirect_uri mismatch"): the Login Kit Web URI must be exactly
  `https://luizgustavof.github.io/animate/tiktok/callback/` with the trailing slash.
- **"Não deu para voltar ao Estúdio"** on the relay page: the sign-in was started elsewhere or `state` lost its port; press
  Conectar again.
- **Deleting**: TikTok has no API to delete drafts or posts. `unpost` only forgets it locally and says to delete it in the app.
- **Direct posting** ("Postar direto" in the studio's Partida tab): built, with TikTok's required post screen. Until the app
  audit passes it only works while the TikTok account is private, and posts are visible to the owner only. The audit kit
  (demo script, form text) is `docs/tiktok-review.md`.
