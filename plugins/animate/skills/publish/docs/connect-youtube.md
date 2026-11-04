# Connect YouTube

Once per Google Cloud project (one project serves every channel), then once per channel. Done for real on 2026-11-03; the
traps below are the ones we hit. The user does the clicks that involve their account or a secret; the agent can drive the
rest in the built-in browser, asking before each step that creates something or accepts terms.

## 1. The project and the API
1. https://console.cloud.google.com/projectcreate → name `animate-publish`. The project **ID** follows the name you type
   (it read `astute-sky-…` until the name was typed); use the ID in URLs: `?project=animate-publish`.
2. Make sure the header's project picker shows the new project (a fresh project is not selected by itself; a URL with an
   unknown ID silently shows "Select a project").
3. APIs & Services → Library → **YouTube Data API v3** → Enable (accepts the YouTube API Services Terms: ask the user first).

## 2. The consent screen (Google Auth Platform)
`/auth/overview/create?project=…`: app name, support email → Audience **External** → contact email → agree to the Google API
Services User Data Policy (ask first) → Create.
- **Audience → Add users**: the Google account that **owns the channel** goes in as a test user.
- **Testing vs In production:** in Testing, Google drops the sign-in every **7 days**; the tool reopens the sign-in by itself
  mid-run (`platforms/youtube.mjs` → `session()`; `PUBLISH_NO_REAUTH=1` turns that off for unattended runs). "Publish app" stays
  greyed out until Branding has a public **home page** and **privacy policy** link: see [legal-page.md](legal-page.md).
- Scopes need not be declared on "Data access" for the user's own use; the sign-in asks for `youtube.upload` and
  `youtube.readonly` (and `youtube` once branding is used, see below). The consent page says "Google hasn't verified this app":
  Advanced → Go to animate-publish.

## 3. The key (OAuth client)
Clients → Create client → **App para computador / Desktop app** → Create. Leave "Use this client for an AI-powered agent"
unchecked. A dialog shows the client id and secret **once**:
- **The user clicks "Download JSON"** themselves. The client secret must never pass through the agent (reading it off the page
  is blocked, rightly). A click from automation did not save the file; the user's own click did, into `~/Downloads`.
- **Never close that dialog before the file exists.** If it's lost: open the client → Add secret → download again.
- `publish.mjs setup` (or the studio) finds `client_secret_*.json` in Downloads, checks it is a Desktop client, and moves it to
  `~/.animate/google-oauth-client.json` (out of Downloads and out of the OneDrive-synced project).

## 4. Sign each channel in
`publish.mjs setup` → the user's default browser opens → pick the account **and the channel** (brand channels are listed
separately) → Allow. The tool prints the channel it got. **Check it** (the first time we got a different channel than expected: the
user confirmed it was right) and pin it: `"channelId"` in the channel's `youtube` block; the upload refuses any other channel.

## 5. Limits that stay after connecting
- **Audit:** until the project passes the "YouTube API Services - Audit and Quota Extension" form, every API upload is locked
  **private**; the tool warns, and the user makes it public in YouTube Studio.
- **Quota:** 10,000 units/day per project; an upload costs 1,600 (≈6 a day), a stats read 1, a thumbnail set 50, a channel
  update 50. It resets at midnight Pacific time.
- **Custom thumbnails** need the channel verified by phone (youtube.com/verify); `thumbnails.set` returns 403 otherwise.

## Files
| file | what |
|---|---|
| `~/.animate/google-oauth-client.json` | the Desktop client (secret) |
| `~/.animate/tokens/<account>.youtube.json` | the refresh token + the channel id/title it belongs to (secret) |
| `publish/channels.json` → `platforms.youtube` | `account`, `channelId` pin, `privacy`, `madeForKids`, `syntheticMedia`, `categoryId`, `file`, `tags` |
