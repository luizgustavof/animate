# Score a look with SigLIP (an image-text model, ~200-375M parameters): how close our frames are to the references,
# and whether a drawn character still reads as its reference (red curly hair, round glasses; a grey tabby, green eyes).
# Optional, like faster-whisper: without it the procedure in new-style.md works as before (by eye + compare.mjs).
#   install: pip install torch transformers sentencepiece protobuf   (the model downloads once from Hugging Face, ~0.8-1.5 GB)
#
#   python look.py style <refs dir | images...> --ours <images...> [--whole]
#       image to image: each of our frames against each reference (cosine), its mean and best. By default on texture:
#       16 random 96px crops per picture, embedded and averaged, so the score follows line, grain and print, not what is
#       drawn. Tested on our 7 styles' demos (3 frames each, nearest other frame): texture 16/21 right (the misses were
#       crosshatch / cut paper / sketchbook among themselves: warm paper and pencil), whole pictures 10/21 (they match
#       the subject, not the look). --whole compares whole pictures: composition, what is in the frame.
#   python look.py attrs <image[@x,y,w,h]>... --set person|cat|medium|<file.json>
#       a zero-shot profile: for each group of mutually exclusive attributes, the probability of each (softmax in the group).
#   python look.py match <reference[@crop]> <ours[@crop]>... --set cat
#       profile the reference, then each of ours: per group, does ours read as the reference's top attribute?
#       The number to raise while redrawing a character: "groups agreeing" and "mean p(ref's attribute)".
#       --truth "group=attribute" (repeatable, or "truth": {...} in a set file): what YOU know about the subject, used
#       in place of the model's reading of the reference. The models misread fine traits on photos: on our test photo
#       all three models read hair that is straight on top and curly at the ends as curly from the roots (0.52-0.64).
#   options: --model auto (default): google/siglip-so400m-patch14-384 (878M, 384px) on a GPU, google/siglip-base-patch16-224
#            (203M) on a CPU. The big one read subtle colour better (dark roots fading into red: 1.00 vs 0.89) and was
#            the only one to read our redrawn hair as straight on top, curly at the ends; ~6x slower on a CPU (20 s for 7
#            pictures x 7 groups on 4 cores). google/siglip2-base-patch16-224 is also accepted.
#            --device auto|cpu|cuda|mps (auto: an NVIDIA GPU if torch sees one, then Apple's, then the CPU)  --json
#   crop: file.png@x,y,w,h in that image's pixels (the character, not the whole frame: the set describes one subject).
#   a set file: {"groups": {"hair": ["red hair", "black hair"], ...}, "subject": "a woman"} -> "a woman with red hair".
#   Word the attributes as something a drawing can carry: "round wire glasses" scored 0.92 on the photo but 0.31 on a
#   drawing with plain round frames; "round eyeglasses" vs "bare eyes without eyeglasses" scored 0.94 and 0.89.
#   Read the reference's profile first: a group the model gets wrong on the photo itself (SigLIP 2 read our test photo's
#   curly hair as straight, 0.82) is a target to drop, not to chase.
import json, os, sys, time
from pathlib import Path

SETS = {
    'person': {'subject': 'a person', 'groups': {
        'hair colour': ['red hair', 'black hair', 'brown hair', 'blonde hair', 'grey hair'],
        'hair texture': ['curly hair', 'straight hair'],
        'hair shape': ['hair that is straight on top and curly at the ends', 'hair that is curly from the roots to the ends', 'hair that is straight from the roots to the ends'],
        'roots': ['dark roots fading into coloured hair', 'one colour from the roots to the ends'],
        'fringe': ['a fringe of bangs over the forehead', 'a bare forehead with no bangs'],
        'glasses': ['round eyeglasses', 'bare eyes without eyeglasses'],
        'top': ['a black t-shirt', 'a white t-shirt', 'a colourful patterned shirt'],
    }},
    'cat': {'subject': 'a cat', 'groups': {
        'coat': ['grey tabby fur with dark stripes', 'orange fur', 'solid black fur', 'white fur', 'calico fur', 'black and white tuxedo fur', 'siamese colouring'],
        'eyes': ['green eyes', 'yellow eyes', 'blue eyes'],
        'stripes': ['a striped coat', 'a plain coat with no stripes'],
        'forehead': ['an M-shaped stripe mark on the forehead', 'a plain forehead'],
    }},
    'medium': {'subject': None, 'groups': {
        'medium': ['a photograph', 'a cut paper collage', 'a pencil sketch on a sketchbook page', 'an ink crosshatch drawing',
                   'a risograph print', 'pixel art', 'an isometric line drawing', 'a math diagram on a black background',
                   'a 3D render', 'a watercolor painting', 'a flat vector illustration'],
    }},
}
TEMPLATES = ['a photo of {}.', 'a drawing of {}.', 'an illustration of {}.']   # averaged: the attribute, whatever the medium


def load(model_id, device):
    import torch
    from transformers import AutoModel, AutoProcessor
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'mps' if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available() else 'cpu'
    dtype = torch.float16 if device == 'cuda' else torch.float32
    t = time.time()
    m = AutoModel.from_pretrained(model_id, torch_dtype=dtype).to(device).eval()
    p = AutoProcessor.from_pretrained(model_id)
    print(f'# {model_id} on {device} ({sum(x.numel() for x in m.parameters()) / 1e6:.0f}M params, loaded in {time.time() - t:.1f}s)', file=sys.stderr)
    return m, p, device, dtype


def open_img(spec):
    from PIL import Image
    path, _, crop = spec.partition('@')
    im = Image.open(path).convert('RGB')
    if crop:
        x, y, w, h = (int(float(v)) for v in crop.split(','))
        im = im.crop((x, y, x + w, y + h))
    return im


def images_of(args):
    out = []
    for a in args:
        p = Path(a.partition('@')[0])
        if p.is_dir():
            out += [str(f) for f in sorted(p.iterdir()) if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp') and '.trim.' not in f.name]
        else:
            out.append(a)
    return out


def _embed(M, ims):
    import torch
    m, p, dev, dt = M
    with torch.no_grad():
        x = p(images=ims, return_tensors='pt')['pixel_values'].to(dev, dt)
        e = m.get_image_features(pixel_values=x)
        e = getattr(e, 'pooler_output', e)
    return torch.nn.functional.normalize(e.float(), dim=-1)


def img_emb(M, specs):
    import torch
    return torch.cat([_embed(M, [open_img(s)]) for s in specs])


def patches(im, n=16, size=96, seed=0):
    """n crops of size px (in a picture scaled to 540 px on its short side), skipping flat ground: texture, not subject"""
    import random
    import numpy as np
    k = 540 / min(im.size)
    im = im.resize((max(size, round(im.width * k)), max(size, round(im.height * k))))
    R, out, tries = random.Random(seed), [], 0
    while len(out) < n and tries < 400:
        tries += 1
        x, y = R.randint(0, im.width - size), R.randint(0, im.height - size)
        c = im.crop((x, y, x + size, y + size))
        if np.asarray(c).std() > 12 or tries > 300: out.append(c)
    return out


def tex_emb(M, specs):
    import torch
    return torch.stack([torch.nn.functional.normalize(_embed(M, patches(open_img(s))).mean(0), dim=-1) for s in specs])


def txt_emb(M, texts):
    import torch
    m, p, dev, _ = M
    with torch.no_grad():
        tok = p(text=texts, padding='max_length', max_length=64, truncation=True, return_tensors='pt').to(dev)
        e = m.get_text_features(**tok)
        e = getattr(e, 'pooler_output', e)
    return torch.nn.functional.normalize(e.float(), dim=-1)


def phrase(subject, attr):
    return f'{subject} with {attr}' if subject else attr


def profile(M, specs, S):
    """per image: {group: {attribute: p}} (softmax over the group of SigLIP's logits, prompts averaged over TEMPLATES)"""
    import torch
    m = M[0]
    I = img_emb(M, specs)
    scale = m.logit_scale.exp().float().item()
    out = [{} for _ in specs]
    for g, attrs in S['groups'].items():
        T = torch.stack([torch.nn.functional.normalize(txt_emb(M, [t.format(phrase(S['subject'], a)) for t in TEMPLATES]).mean(0), dim=-1) for a in attrs])
        P = torch.softmax(I @ T.T * scale, dim=-1)
        for i in range(len(specs)):
            out[i][g] = {a: round(P[i, j].item(), 3) for j, a in enumerate(attrs)}
    return out


def get_set(name):
    if name in SETS: return SETS[name]
    return json.loads(Path(name).read_text())


def main():
    a = sys.argv[1:]
    if not a or a[0] not in ('style', 'attrs', 'match'):
        print(__doc__ or open(__file__).read().split('import json')[0]); sys.exit(2)
    def opt(k, d=None):
        if k in a: i = a.index(k); v = a[i + 1]; del a[i:i + 2]; return v
        return d
    def flag(k):
        if k in a: a.remove(k); return True
        return False
    model = opt('--model', 'auto'); device = opt('--device', 'auto'); as_json = flag('--json')
    truth = {}
    while '--truth' in a:
        g, _, v = opt('--truth').partition('='); truth[g.strip()] = v.strip()
    if model == 'auto':
        import torch
        model = 'google/siglip-so400m-patch14-384' if torch.cuda.is_available() else 'google/siglip-base-patch16-224'
    mode = a.pop(0)
    M = load(model, device)
    t0 = time.time()
    if mode == 'style':
        whole = flag('--whole'); i = a.index('--ours'); refs, ours = images_of(a[:i]), images_of(a[i + 1:])
        emb = img_emb if whole else tex_emb
        R, O = emb(M, refs), emb(M, ours)
        C = O @ R.T
        res = [{'ours': o, 'mean': round(C[k].mean().item(), 3), 'best': round(C[k].max().item(), 3), 'nearest': refs[C[k].argmax().item()]} for k, o in enumerate(ours)]
        if as_json: print(json.dumps(res, indent=1))
        else:
            for r in res: print(f"{r['mean']:.3f} mean  {r['best']:.3f} best  {r['ours']}  (nearest: {os.path.basename(r['nearest'])})")
    elif mode == 'attrs':
        S = get_set(opt('--set', 'person')); specs = images_of(a)
        res = profile(M, specs, S)
        if as_json: print(json.dumps(dict(zip(specs, res)), indent=1))
        else:
            for s, pr in zip(specs, res):
                print(f'\n{s}')
                for g, d in pr.items():
                    print(f'  {g:13s} ' + '  '.join(f'{k} {v:.2f}' for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:3]))
    else:
        S = get_set(opt('--set', 'person')); specs = a
        res = profile(M, specs, S)
        ref = res[0]; top = {g: max(d, key=d.get) for g, d in ref.items()}
        for g, v in {**S.get('truth', {}), **truth}.items():
            if g not in top or v not in ref[g]: sys.exit(f'--truth {g}={v}: no such group/attribute in the set')
            if top[g] != v: print(f'# truth: {g} = {v} (the model read the reference as {top[g]}, {ref[g][top[g]]:.2f})', file=sys.stderr)
            top[g] = v
        rows = []
        for s, pr in zip(specs[1:], res[1:]):
            per = {g: {'ref': top[g], 'p_ref_attr': pr[g][top[g]], 'ours_top': max(pr[g], key=pr[g].get)} for g in pr}
            agree = sum(v['ours_top'] == v['ref'] for v in per.values())
            rows.append({'ours': s, 'agree': agree, 'groups': len(per), 'mean_p': round(sum(v['p_ref_attr'] for v in per.values()) / len(per), 3), 'per_group': per})
        if as_json: print(json.dumps({'reference': specs[0], 'reference_profile': ref, 'ours': rows}, indent=1))
        else:
            print(f'reference {specs[0]}: ' + ', '.join(f'{g}: {t} ({ref[g][t]:.2f})' for g, t in top.items()))
            for r in rows:
                print(f"\n{r['ours']}: {r['agree']}/{r['groups']} groups agree, mean p(ref's attribute) {r['mean_p']:.2f}")
                for g, v in r['per_group'].items():
                    print(f"  {'ok ' if v['ours_top'] == v['ref'] else 'NO '} {g:13s} p({v['ref']}) = {v['p_ref_attr']:.2f}" + ('' if v['ours_top'] == v['ref'] else f"   reads as: {v['ours_top']}"))
    print(f'# scored in {time.time() - t0:.1f}s', file=sys.stderr)


if __name__ == '__main__':
    main()
