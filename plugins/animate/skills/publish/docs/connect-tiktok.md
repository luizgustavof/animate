# Connect TikTok (draft mode)

What the user gets: the episode goes to their **TikTok inbox as a draft**; they open TikTok, tap the notification, paste the
caption (the studio has a Copy button) and press Post. No audit needed for that. Posting straight to the profile ("direct
post") needs TikTok's app audit, and an unaudited app can only post private videos, so drafts are the mode we use.

The studio walks the user through this in **Canais → TikTok → Conectar** (the steps below, in Portuguese, with links). Use this
page when helping in chat or when something goes wrong.

## Once: the developer app (≈10 minutes, the user does it, in their own browser)

1. **developers.tiktok.com** → Log in with the TikTok account that will post (or any account; the posting account is added
   as a target user in step 5) → accept the developer terms.
2. **Manage apps → Connect an app** (individual developer is fine). Name it e.g. "Estúdio <channel>". Category: Entertainment.
   Description: "Uploads my own videos to my TikTok inbox as drafts". The icon can be the channel avatar.
3. Switch the toggle next to the app name to **Sandbox** → **Create Sandbox** → any name → Confirm. A sandbox needs no review,
   no website, no privacy policy.
4. In the sandbox, **Add products**:
   - **Login Kit** → platform **Desktop** → Redirect URI: `http://127.0.0.1:*/callback/` (exactly this: the `*` lets the tool
     pick a free port; TikTok allows wildcard ports for desktop).
   - **Content Posting API** (upload). No "Direct Post" toggle needed.
   - Scopes: `user.info.basic` and `video.upload`.
   - **Apply changes**.
5. **Sandbox settings → Target users → Add account** → log in with the TikTok account of the channel. Up to 10 accounts, each
   one the user owns; it can take up to an hour to appear.
6. **App details** shows the **Client key** and **Client secret**. The user pastes both into the studio form
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

## Traps

- **`scope_not_authorized`**: the user unticked a permission on the authorize page. Connect again, allow both.
- **`unaudited_client_can_only_post_to_private_accounts`** or nothing arrives: the posting account isn't a sandbox target user
  (step 5), or it was added less than an hour ago.
- **`spam_risk_too_many_posts` / pending drafts**: TikTok limits API uploads per account per day and how many drafts can wait
  unfinished. Post or delete the old drafts in the app.
- **`rate_limit_exceeded`**: 6 uploads a minute per account. Wait a minute.
- **The redirect is refused** ("redirect_uri mismatch"): the Login Kit URI must be exactly `http://127.0.0.1:*/callback/` with
  the trailing slash, on the **Desktop** platform.
- **Deleting**: TikTok has no API to delete drafts or posts. `unpost` only forgets it locally and says to delete it in the app.
- **Going public later**: submit the app for audit (needs a website with terms and privacy policy, `docs/legal-page.md`), then
  switch `"mode"` to direct posting once it's built.
