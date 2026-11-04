# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
React 19 + TypeScript + Tailwind v4 + Motion + React Router + TanStack Query, built with Vite and served by a zero-dependency
Node server (`tools/studio.mjs`) on 127.0.0.1. Chosen by the user ("tailwind", "react", "sem vazamentos de memória").

## Users
One creator, alone at their own desktop computer (a monitor, mouse and keyboard; never a phone), who writes, renders and
publishes every video themselves. Today one channel (an analog-horror VHS series in Brazilian Portuguese, "Festa do Algodão",
on the YouTube channel "Utinha Sz"); they plan **more than ten channels** within months, each a different niche and series.
They speak Portuguese (Brazil); the interface speaks it too. They want it "so simple it's idiot-proof": no commands, no file
paths, no settings to understand.

## Product Purpose
The Estúdio is where finished episodes leave the computer. It turns a rendered piece (`pieces/<ep>/renders/final.mp4`, made in
code by the animate skill) into a post on each of the channel's platforms: the words (title, description, hashtags) written by
Claude from the episode's own script, a thumbnail made from the episode's own frames, a time slot, the upload with progress, and
the numbers coming back. It also holds the channels themselves: creating a new one, connecting its platforms, its profile.
Success: publishing an episode is a handful of clicks, nothing is ever posted twice or to the wrong channel, and the user learns
from the numbers which titles work.

## Positioning
The videos are code, so the studio can render any instant of an episode at full resolution for a thumbnail, and the writer reads
the actual spoken script, not a guess from the picture. It runs on the user's machine with their own Claude Code; no SaaS, no
API bill, secrets never leave the computer.

## Operating Context
- Episodes come from the animate skill: `pieces/<ep>/` with `piece.json`, `voice/script.json` (the spoken lines), `brief.md`,
  `renders/final.mp4` (master, ~450 MB, 1080×1920, 120 s) and `renders/share.mp4`. Series bibles live in `series/<name>/`.
- The user also works with Claude in chat; the chat path (`tools/publish.mjs`) and the studio share the same files
  (`publish/channels.json`, `pieces/<ep>/publish/meta.json` and `state.json`), so either can pick up where the other left off.
- Platforms: YouTube (connected; API uploads locked private until Google's audit; sign-in renewed weekly while the OAuth app is in
  Testing), TikTok next (draft/inbox mode first), Instagram after.

## Capabilities and Constraints
- No platform lets a channel be created by API: "Novo canal" prepares everything, the user creates the empty channel (≈1 min),
  then the studio connects it and fills description, keywords and banner through the API.
- Sign-ins happen in the user's own browser (OAuth); the studio only shows "connected as X". It never sees passwords or tokens.
- `madeForKids` and synthetic-media disclosure are the user's legal declarations: shown, never guessed.
- Titles must be true to the video; never another franchise's name.
- Words by `claude -p` take 20–40 s; uploads of 450 MB take minutes and resume after a drop.

## Brand Commitments
No brand for the studio itself yet. Each channel brings its own identity (the Festa do Algodão series: VHS tape, OSD clock at
03:07, "Algodão nunca esquece.", text always centred). The user is sensitive to crooked or misaligned text.

## Evidence on Hand
Seven rendered pieces (ep01–ep06 of Festa do Algodão + one test), one meta.json (ep03), one connected channel, no posts and no
stats yet. Nothing to fabricate: empty states must say so plainly.

## Product Principles
1. **The episode is the hero.** Its frames, its words, its status; the chrome stays out of the way.
2. **Nothing irreversible without a clear moment.** Publishing shows exactly what goes where and when, once, then goes.
3. **One truth.** What the studio shows is what's in the files the chat agent reads too.
4. **Scales to many channels** without becoming a spreadsheet: the channel is always clear, switching is instant.
5. **Plain Portuguese.** No jargon, no file paths, no error codes without what to do next.

## Accessibility & Inclusion
WCAG AA contrast, full keyboard operation, visible focus, `prefers-reduced-motion` honoured.
