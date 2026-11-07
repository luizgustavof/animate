# Find a reference video's shot changes with TransNetV2 (a small 3D-conv network, ~30 MB of weights, trained on cuts and
# gradual transitions): hard cuts, and the gradual ones a frame-difference threshold misses (dissolves, wipes, morphs).
# shotlog.py stays the tool for motion, stepping on 2s and sound per second; this one answers "where does the shot change,
# and how" — the cut rhythm in new-style.md step 2.
#   install: pip install torch transnetv2-pytorch   (the weights ship inside the package: no download at run time)
#   usage:   python cuts.py references/<look>/ref.mp4 [more videos] [--threshold 0.4] [--device auto|cpu|cuda] [--json]
# Prints each transition (frame, time, hard cut or gradual and its length), the shots' lengths and the rhythm.
# A morph between scenes reads as gradual; a held whip-pan can too. Read the list with the contact sheet open.
import json, subprocess, sys, time
import numpy as np


def fps_of(v):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', v], capture_output=True, text=True).stdout.strip()
    a, b = (r.split('/') + ['1'])[:2]
    return float(a) / float(b or 1) if a else 24.0


def frames(v):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', v, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '48x27', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 27, 48, 3)


def runs(mask):
    out, s = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and s is None: s = i
        if not m and s is not None: out.append((s, i - 1)); s = None
    return out


def events(single, many, hi=0.4, lo=0.02, dip=0.05):
    """transitions from the two per-frame outputs, with hysteresis: a run of frames above `lo` that peaks above `hi` is one
    transition (a morph's shrink, morph and grow phases make several peaks: one event), split where the signal dips
    under `dip` between two cut peaks (two hard cuts 0.4 s apart stay two). Tuned on a 60 s cut-paper piece (13 morphs,
    1 hard cut: 14/14 found, 0 extra) and a 31 s reel of 36 hard cuts 0.33-1.5 s apart (35/36, 0 extra)."""
    s = np.maximum(single, many); out = []
    for a, b in runs(s > lo):
        if s[a:b + 1].max() <= hi: continue
        pk = [i for i in range(a, b + 1) if single[i] > hi and single[i] >= single[max(a, i - 1)] and single[i] >= single[min(b, i + 1)]]
        at = [a]
        for p, q in zip(pk, pk[1:]):
            if q - p >= 4 and s[p + 1:q].min() < dip: at.append(p + 1 + int(np.argmin(s[p + 1:q])))
        at.append(b + 1)
        out += [(at[i], at[i + 1] - 1) for i in range(len(at) - 1)]
    return out


def detect(model, v, thr):
    import torch
    fps = fps_of(v); F = frames(v)
    t = time.time()
    x = torch.from_numpy(F.copy()).to(model.device)
    with torch.no_grad():
        single, many = model.predict_frames(x, quiet=True)
    single, many = single.float().cpu().numpy(), many.float().cpu().numpy()
    took = time.time() - t
    tr = []
    for a, b in events(single, many, hi=thr):
        n = b - a + 1
        # where the picture changes: the strongest single-frame peak; for a long transition with no clear peak, its middle
        peak = a + int(np.argmax(single[a:b + 1])) if single[a:b + 1].max() > thr else (a + b) // 2
        tr.append({'frame': peak, 't': round(peak / fps, 3), 'from': a, 'to': b, 'frames': n,
                   # by how long the network sees "in transition": our morphs ran 0.8-1.0 s (one 0.33 s), hard cuts at most 0.58 s
                   # (motion around a cut keeps the signal up a few frames). A pixel jump does not separate them: a morph
                   # snaps too, at its tightest frame.
                   'kind': 'gradual' if n / fps >= 0.65 else 'cut', 'p': round(float(max(single[a:b + 1].max(), many[a:b + 1].max())), 3)})
    bounds = [0] + [r['frame'] for r in tr] + [len(F)]
    shots = [round((bounds[i + 1] - bounds[i]) / fps, 3) for i in range(len(bounds) - 1)]
    return {'video': v, 'fps': fps, 'frames': len(F), 'seconds': round(len(F) / fps, 2), 'transitions': tr, 'shots': shots,
            'infer_seconds': round(took, 2), 'single': single, 'many': many}


def main():
    a = sys.argv[1:]
    def opt(k, d):
        if k in a: i = a.index(k); v = a[i + 1]; del a[i:i + 2]; return v
        return d
    thr = float(opt('--threshold', '0.4')); dev = opt('--device', 'auto'); as_json = '--json' in a
    a = [x for x in a if x != '--json']
    if not a: print(open(__file__).read().split('import json')[0]); sys.exit(2)
    import torch
    from transnetv2_pytorch import TransNetV2
    if dev == 'auto': dev = 'cuda' if torch.cuda.is_available() else 'cpu'   # not MPS: the package warns its results differ there
    model = TransNetV2(device=dev).eval()
    print(f'# TransNetV2 on {dev}', file=sys.stderr)
    out = []
    for v in a:
        r = detect(model, v, thr)
        r.pop('single'); r.pop('many'); out.append(r)
        if as_json: continue
        cuts = [t for t in r['transitions'] if t['kind'] == 'cut']; grad = [t for t in r['transitions'] if t['kind'] == 'gradual']
        print(f"\n=== {v}: {r['frames']} frames @ {r['fps']:.3g}fps ({r['seconds']}s) — {len(cuts)} hard cuts, {len(grad)} gradual (inference {r['infer_seconds']}s)")
        for t in r['transitions']:
            span = '' if t['kind'] == 'cut' else f"  frames {t['from']}-{t['to']} ({t['frames'] / r['fps']:.2f}s)"
            print(f"  {t['t']:7.2f}s  f{t['frame']:<6d} {t['kind']:8s} p={t['p']:.2f}{span}")
        s = np.array(r['shots'])
        print(f"shots: {len(s)}, median {np.median(s):.2f}s, shortest {s.min():.2f}s, longest {s.max():.2f}s; "
              f"{len(r['transitions']) / r['seconds'] * 10:.1f} changes per 10s")
        print('shot lengths: ' + ' '.join(f'{x:.2f}' for x in s))
    if as_json: print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
