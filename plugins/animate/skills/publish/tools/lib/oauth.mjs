// OAuth sign-in for a desktop tool: a one-shot server on 127.0.0.1 receives the code (loopback redirect, PKCE, state check).
// The user signs in once per account in their own browser; nothing here ever sees a password.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

// options for providers that differ from RFC 8252 defaults (TikTok: client_key, comma scopes, a hex challenge, a /callback/ path)
export async function authorizeLoopback({
  authEndpoint, clientId, scopes, extra = {}, timeoutMs = 5 * 60e3,
  clientParam = 'client_id', scopeSep = ' ', challengeEncoding = 'base64url', callbackPath = '',
}) {
  const verifier = b64url(crypto.randomBytes(48));
  const digest = crypto.createHash('sha256').update(verifier).digest();
  const challenge = challengeEncoding === 'hex' ? digest.toString('hex') : b64url(digest);
  const state = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`;

  const url = new URL(authEndpoint);
  const params = {
    [clientParam]: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(scopeSep),
    state, code_challenge: challenge, code_challenge_method: 'S256', ...extra,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  console.log(`\nSign in with the account that owns the channel (opening your browser):\n${url.href}\n`);
  openBrowser(url.href);

  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sign-in timed out after 5 minutes')), timeoutMs);
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirectUri).searchParams;
        if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }   // the favicon, a stray request
        const ok = q.get('state') === state && q.get('code');
        const why = q.get('error') || 'state mismatch';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(ok ? '<h2>Signed in. You can close this tab.</h2>' : `<h2>Sign-in failed: ${esc(why)}</h2>`);
        clearTimeout(timer);
        if (ok) resolve(q.get('code')); else reject(new Error(`sign-in failed: ${why}`));
      });
    });
    return { code, redirectUri, verifier };
  } finally {
    server.close();
  }
}
