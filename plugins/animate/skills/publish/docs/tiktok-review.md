# TikTok app review (Direct Post)

Until TikTok audits the app, a direct post can only go to a TikTok account that is **private** at posting time and the video
is visible only to its owner (`SELF_ONLY`); at most 5 users can post in 24 hours. Drafts (inbox) work without the audit. The
review is what lets the Estúdio post public videos with the caption, no app step.

What's built (`platforms/tiktok.mjs`, studio `screens/TikTokPost.tsx`), matching TikTok's Direct Post UX rules:
creator info fetched fresh on the post screen (nickname and avatar shown), privacy from `privacy_level_options` with nothing
preselected, Comment/Duet/Stitch off by default and greyed when the account turned them off, the commercial-content toggle with
"Your brand" / "Branded content" and their labels, branded content never private, the Music Usage Confirmation (plus Branded
Content Policy) line before the button, the max-duration check, nothing sent before the user presses Publicar, then status
polling with the "may take a few minutes" note. The editable caption is `meta.tiktok.caption`.

## Before recording (the user does this, once)

1. developers.tiktok.com → the app → **Sandbox**: Content Posting API with **Direct Post on**; scopes `user.info.basic`,
   `video.upload`, `video.publish`; Apply changes.
2. In the TikTok app on the phone: **Settings → Privacy → Private account: on** (unaudited apps can only post to private
   accounts). Turn it back off after the recording.
3. Estúdio → Canais → TikTok → **Reconectar** (the old sign-in has no `video.publish`). Allow every permission.

## Demo video (screen recording, 1–3 min, mp4, under 50 MB)

Record the whole screen with Windows' Snipping Tool (Win+Shift+R) or OBS. No cuts in the middle of the flow.

1. The Estúdio open in the browser at Canais: show the TikTok row, press **Reconectar**, the TikTok authorize page with the
   three permissions, **Authorize**, back in the Estúdio showing the connected account.
2. Partidas → an episode → **Partida**: the video preview on the left, the caption on the Texto tab (edit a word to show it
   is editable).
3. TikTok box: pick **Postar direto**. Show the account nickname, open **Quem pode ver** (no option preselected) and pick
   **Só eu**; show Comentários/Dueto/Costura off; turn **Divulgar conteúdo comercial** on and off; point at the consent line.
4. Press **Publicar agora**. Show the progress and the "Pronto" line.
5. Switch to the phone (or tiktok.com in the browser): the video on the profile with the caption, visible only to you.

## Form text (App review → "Explain how each product and scope works", ≤ 1000 characters)

```
Estúdio is a desktop tool I run on my own computer to publish the short videos I make myself to my own TikTok account.

Login Kit (user.info.basic): I sign in with TikTok; the app shows the connected account's display name and avatar so I always see which account receives the video, and stores the open_id to refuse uploads to any other account.

Content Posting API, video.upload: sends a finished video to my TikTok inbox as a draft that I finish in the TikTok app.

Content Posting API, video.publish (Direct Post): on the post screen the app queries creator_info, shows my nickname, lets me pick who can see the video (no default), turn comments/duet/stitch on (all off by default), disclose commercial content, and shows the Music Usage Confirmation. Only after I press Publish it uploads the file (FILE_UPLOAD) and polls the status until the post is live.

No other users, no server: tokens stay on my computer. Terms and privacy: https://luizgustavof.github.io/animate/
```

## After approval

Switch the TikTok account back to public. Nothing else changes in the Estúdio: "Postar direto" then offers "Todo mundo".
If TikTok asks for changes, they arrive by e-mail and in the developer portal; paste them in chat.
