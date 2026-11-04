// The caption, on the phone: a QR code that opens the caption page (docs/legal-page.md) with the text in the part after
// "#", which no server ever sees. On the phone: Copiar legenda → Abrir o TikTok → the draft → paste → Postar.
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Icon } from './Icon';

const PAGE = 'https://luizgustavof.github.io/animate/legenda/';

function b64url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function captionLink(caption: string, videoUrl?: string | null) {
  const h = new URLSearchParams({ c: b64url(caption) });
  if (videoUrl) h.set('v', videoUrl);
  return `${PAGE}#${h.toString()}`;
}

// one SVG path for the dark modules: crisp at any size, no canvas, nothing to clean up
function qrPath(text: string) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { d, n };
}

export function PhoneCaption({ caption, videoUrl }: { caption: string; videoUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const link = useMemo(() => (caption ? captionLink(caption, videoUrl) : ''), [caption, videoUrl]);
  const qr = useMemo(() => (open && link ? qrPath(link) : null), [open, link]);
  if (!caption) return null;
  return (
    <div className="grid gap-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex items-center gap-1.5 justify-self-start text-[0.88rem] font-medium text-ink-2 underline decoration-ink-3/60 underline-offset-4 hover:text-ink">
        <Icon name="link" size={14} /> {open ? 'Esconder o QR code' : 'Levar a legenda para o celular (QR code)'}
      </button>
      {open && qr ? (
        <div className="flex flex-wrap items-center gap-5">
          <svg viewBox={`-2 -2 ${qr.n + 4} ${qr.n + 4}`} width={168} height={168} role="img" aria-label="QR code da legenda" className="rounded-md bg-white" shapeRendering="crispEdges">
            <path d={qr.d} fill="#111" />
          </svg>
          <ol className="grid max-w-xs list-decimal gap-1 pl-5 text-[0.9rem] text-ink-2">
            <li>Aponte a câmera do celular e abra o link.</li>
            <li>Toque em <b className="text-ink">Copiar legenda</b>, depois em <b className="text-ink">Abrir o TikTok</b>.</li>
            <li>Abra o rascunho (notificação ou Perfil → Rascunhos), cole e poste.</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
