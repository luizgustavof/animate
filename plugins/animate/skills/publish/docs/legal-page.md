# Legal page (terms of use + privacy policy)

TikTok's developer app (even the sandbox) and Google's OAuth "In production" switch need public Terms of Service and Privacy
Policy URLs. They live on GitHub Pages of the user's fork, on an orphan **`gh-pages`** branch that holds only the static site
(never the repo's code, `series/`, `pieces/` or `publish/`).

Live (published 2026-11-04 with the user's yes):

- https://luizgustavof.github.io/animate/ (what the Estúdio is)
- https://luizgustavof.github.io/animate/termos/
- https://luizgustavof.github.io/animate/privacidade/
- https://luizgustavof.github.io/animate/legenda/ (caption page for the phone: the studio's QR code opens it with the caption
  base64url-encoded after `#c=`, optional `&v=<post url>`; the fragment never reaches a server; Copy + Open TikTok)
- https://luizgustavof.github.io/animate/tiktok/callback/ (TikTok sign-in relay: a script that forwards `code` + `state` to
  `http://127.0.0.1:<port>/callback/`, the port read from the front of `state`; it stores and sends nothing else)

What they say: the tool runs only on the user's computer, has no server, collects and shares nothing; tokens stay local; scopes
used (`user.info.basic`, `video.upload`, YouTube upload/readonly/manage) and why; the Google API Services User Data Policy line;
how to revoke and delete. Contact is the repo's issues page (no email published).

## Changing them

The pages are public: change them only with the user's yes. Check out the branch elsewhere (not in this working tree):

```
git clone --branch gh-pages --single-branch https://github.com/luizgustavof/animate.git <scratch>/site
```

Edit `index.html`, `termos/index.html`, `privacidade/index.html`, `style.css`; update the "Última atualização" date; commit and
push `gh-pages`. Pages rebuilds in about a minute (`gh api repos/luizgustavof/animate/pages --jq .status` → `built`).

When a platform or scope is added (Instagram), add it to the privacy page before connecting it.
