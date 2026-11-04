---
name: publish
description: Post a finished piece (pieces/<name>/renders/) to the user's channels — YouTube Shorts today, TikTok and Instagram Reels planned — with titles, descriptions, captions and hashtags written for each platform from the piece's script and the channel's profile, scheduled into the channel's posting slots, never posted twice, and with views pulled back to learn which titles work. Handles several channels (one sign-in each). Use when the user asks to publish, post, upload or schedule a video, asks what has been posted, or asks how the videos are doing.
argument-hint: "[piece] [channel] [when]"
---

# Publish

You take a piece that `tools/export.mjs` already rendered and put it on the user's channels. The tool (`tools/publish.mjs`) does the
uploads; **you write the words** (title, description, caption, hashtags) into the piece's `publish/meta.json`, because you have read
the script and know the channel. The user never has to point at a file: a piece is `pieces/<name>/`, its video is
`renders/final.mp4` (the master; `renders/share.mp4` when a platform's block says `"file": "share"`).

All paths below are relative to this skill's base directory, except `pieces/`, `series/` and `publish/`, which are in the user's project.

**Requirements:** Node 18+, ffprobe on PATH (comes with ffmpeg). No npm packages.

## The user only talks

**The user never types a command, opens a file or picks a path.** You run everything and answer in their language, in one
or two lines plus one question with buttons (AskUserQuestion). What they say and what you do:

| they say | you do |
|---|---|
| "publica" / "posta o próximo" | `next` → the first one → write its words → `check` → show title + time → on yes, `post <it> --at next` |
| "publica o ep4" / "agora" / "amanhã 19h" | the same for that piece; "agora" = no `--at`; a time = `--at "YYYY-MM-DD HH:MM"` |
| "publica todos" | one question with every title and slot listed, then post each with `--at next` (they fill the slots in order) |
| "como tão os vídeos?" | `stats` → the top 3 and the worst in a short table, and one line on what the best titles share |
| "o que já saiu?" | `status` → posted / scheduled, with links |
| "cancela o agendado do ep3" / "apaga esse vídeo" | `status <it>` → say which video (link, scheduled time) will be deleted and that YouTube can't undo it → on yes, `unpost <it> --key <channel/platform> --yes`. The first delete asks for one new YouTube sign-in (permission to manage videos). The episode goes back to ready; the old entry stays in `state.json → removed`. |
| "abre o estúdio" / "quero ver os canais" | run `node tools/studio.mjs` in the background from the project folder (it opens the browser; the desktop shortcut `Estúdio.cmd` does the same). The studio is the graphical way to do everything above; it shares every file with this flow. |

What you show before posting is short: the title, the hashtags, the day and time, the channel. Buttons: **Posta** / **Muda o título** / **Outro horário**. Never show JSON, file paths or tool output unless asked.

**First time (or `setup --no-wait` exits 2):** the channel isn't connected. Say it takes about 5 minutes, once, and offer to
do the Google Cloud part yourself in the built-in browser: the user signs in to their Google account there, and you do the
clicks of "Connect YouTube" steps 1-3 (ask before each step that creates something or accepts terms; never type their
password). When the client JSON is downloaded, run `setup` in the background: it moves the key out of Downloads by itself
and opens the channel sign-in, where the user picks the channel and clicks Allow. Then say: "Pronto. Daqui pra frente é só falar *publica*."

## Files

| file | who writes it | what |
|---|---|---|
| `<project>/publish/channels.json` | the user, with you | the channels: profile, hashtags, posting slots, one block per platform. Start from [channels.example.json](channels.example.json). Local only (`/publish/` is in `.gitignore`). |
| `pieces/<name>/publish/meta.json` | **you** | the words per platform (below) |
| `pieces/<name>/publish/state.json` | the tool | per `channel/platform`: status, id, link, publish time, stats. **Read it before posting; never edit a posted entry by hand.** |
| `~/.animate/google-oauth-client.json` | the user, once | the Google OAuth client (see Connect YouTube) |
| `~/.animate/tokens/<account>.<platform>.json` | the tool | one sign-in per account. Secrets: never print, copy, commit or move them into the project (the project folder may be synced to a cloud drive). |

## Non-negotiables

1. **Nothing goes out without the user's yes** while the channel's `"approval"` is `"ask"` (the default): show the words, the channel and the time, then post. Only `"approval": "auto"` (the user's own choice, written in channels.json) lets you post unasked.
2. **Never post twice.** `state.json` is the record; `--force` only when the user asks for a re-post in words.
3. **Words true to the video.** No title, caption or hashtag that promises what the video doesn't show, no other franchise's or creator's name used to borrow their audience, no "part 2" that doesn't exist.
4. **Legal fields are the user's.** `madeForKids` (COPPA) and `syntheticMedia` (YouTube's disclosure for realistic altered or synthetic content) are set once per channel by the user. If one is missing, ask; never guess. Animated fiction is normally not "realistic synthetic media"; a realistic fake person or event is.
5. **Report what happened, with links:** posted / scheduled for when / failed and why, from the tool's output.

## The flow

1. **Find what's ready:** `node tools/publish.mjs setup --no-wait` (exit 2 = something to connect first: "The user only talks" → First time), then `node tools/publish.mjs next` (rendered episodes of a channel's series not posted yet, oldest first; pieces outside a series are never offered — post those by name). `status` shows everything with links.
2. **Write the words** into `pieces/<name>/publish/meta.json` (next section). Read first: the piece's `voice/script.json` lines (what is actually said), `brief.md`, the series bible if `piece.json` has `"series"`, the channel's `audience`, `voice` and `hashtags`, and the last `stats` (what worked).
3. **Check:** `node tools/publish.mjs check <name>` validates the words against each platform's limits and the video (vertical, ≤ 3 min for a Short, audio), and prints the exact request. Fix every ERROR; weigh every warning.
4. **Ask** (approval "ask"): show the title, the first lines of the description, the hashtags, the channel and the time, with AskUserQuestion: post now / schedule at the next slot / change the words.
5. **Post:** `node tools/publish.mjs post <name> --at next` (the channel's next free slot) or `--at "2026-11-05 19:00"` or no `--at` (now). A first test on a new channel: `--privacy private`. An upload that dies (network, closed laptop) resumes where it stopped when you run the same command again.
6. **Report** the links and times. Mention any warning the tool printed (above all "locked private").
7. **Learn:** `node tools/publish.mjs stats` pulls views, likes and comments into each `state.json` and prints them best first. Before writing the next piece's words, look at what the best and worst titles have in common, and say it in one line when you pick.

## Writing the words

`meta.json`:
```json
{
  "language": "pt-BR",
  "candidates": {
    "youtube": ["title 1", "title 2", "title 3", "title 4", "title 5"]
  },
  "why": "One line: why the chosen title beat the others.",
  "youtube": {
    "title": "The chosen title",
    "description": "First line: the hook, it shows under the title.\n\nOne or two lines of context.\n\n#tag1 #tag2 #tag3",
    "tags": ["keyword", "another keyword"]
  },
  "tiktok": { "caption": "The hook, then 3-5 hashtags" },
  "instagram": { "caption": "The hook, a line of context, then 3-5 hashtags" }
}
```

Write 5 title candidates per platform, then choose. A good one:
- **makes a question in the first 40 characters** that only the video answers (the Shorts feed and TikTok cut long titles);
- uses the words someone would search, in the channel's language (search reads the title, the caption, the spoken words and the on-screen text; hashtags matter less);
- sounds like the channel's `voice`, not like an ad; for a series, keeps the series' naming pattern so episodes read as one shelf;
- is true to the video (non-negotiable 3).

Per platform:
- **YouTube:** title ≤ 100 characters (aim ≤ 60); description ≤ 5,000 bytes, first line is the hook, hashtags at the end (the first 3 show above the title); 3-5 hashtags; `tags` are a weak signal, a few search phrases are enough. The channel's `tags` are added for you. No `<` or `>`.
- **TikTok** (when built): caption ≤ 2,200 characters, hook first, 3-5 hashtags.
- **Instagram** (when built): caption ≤ 2,200, at most 30 hashtags (use 3-5), hook in the first 125 characters (the rest folds).

Hashtags come from the channel's `hashtags.always` plus the best fits from `hashtags.pool` (or new ones that describe the video). Don't post the same words on every platform: each block is written for its feed.

## Connecting a platform

Step by step, with the traps we already hit: [docs/connect-youtube.md](docs/connect-youtube.md),
[docs/connect-tiktok.md](docs/connect-tiktok.md), [docs/connect-instagram.md](docs/connect-instagram.md). The user does the clicks that
touch their account or a secret (signing in, Allow, downloading a key, pasting the TikTok Client secret into the studio form);
never read a client secret off a page or ask for it in chat.
**TikTok** works in draft mode: the video lands in the creator's TikTok inbox and they press Post in the app (paste the
caption from the studio's Copy button). No scheduling through the API; `--at` only warns. One-time setup is the user's own
developer app in sandbox (studio: Canais → TikTok shows the five steps); then `auth <channel> tiktok` or Conectar.
More channels: add a block in `channels.json` (or the studio's "Novo canal") and sign each in. Several channels on one Google
account each get their own `account` name and their own sign-in.

## Scheduling

- **YouTube** schedules on its side (`publishAt`): the video uploads now, stays private, and goes public at the time. The computer can be off.
- **TikTok / Instagram** (when built): their APIs post immediately, so a scheduled post needs this computer awake at that time: a Windows scheduled task (or cron) running `node tools/publish.mjs post <name>`, or `claude -p "publish the next ready piece"` for the whole flow with the words written then.
- `--at next` takes the channel's `schedule` slots (this computer's time zone) and skips any slot within an hour of a post already on that channel and platform.

## How it's built

[docs/architecture.md](docs/architecture.md): the modules (`lib/publisher.mjs` is the flow the CLI and the studio share,
`lib/platforms.mjs` the registry, one file per platform in `tools/platforms/`), the data files, and how to add a platform or a
studio screen.

## Troubleshooting

- `invalid_grant` → the sign-in expired or was revoked: run `auth` again (and set the consent screen to In production).
- `quotaExceeded` → the project's daily quota is used up; it resets at midnight Pacific time.
- "locked private" → the project isn't audited yet (Connect YouTube, step 5).
- "is being published by another run" → another `post` on that piece is running; if it isn't, delete `pieces/<name>/publish/.lock`.
- An `uploading` entry in `state.json` is a session that can resume: run the same `post` again.
