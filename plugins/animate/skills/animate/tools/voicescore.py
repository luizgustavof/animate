#!/usr/bin/env python3
"""How good the takes of a voice folder sound, measured without a reference: SQUIM (PESQ / STOI estimates) and Whisper's
language guess (the accent check: a pt-br take heard as Portuguese with probability >= 0.93).
   usage: python tools/voicescore.py <voice folder | take.wav ...> [--lang pt] [--model small] [--no-lang] [--long]
   prints one row per take, then the averages; --json prints JSON instead

Memory: SQUIM's attention grows with the square of the clip's length (the 86 s voice.wav of a whole episode filled 32 GB).
So every clip is scored in windows of at most 15 s (the score is the length-weighted mean), takes over 15 s are skipped
unless --long is given (the mixed voice.wav is never a take: score the lines), and the two models never sit in memory
together: SQUIM scores every file, is freed, then Whisper listens.
tts.py's "takes" use squim() from here, with the same windows."""
import gc
import json
import os
import subprocess
import sys

WINDOW_S = 15.0      # SQUIM never sees more than this at once
MIN_TAIL_S = 3.0     # a last window shorter than this joins the one before (a 1 s window scores badly on its own)
MAX_TAKE_S = 15.0    # longer files are skipped without --long

_squim = None


def windows(n, sr):
    """[start, end) sample ranges of at most WINDOW_S each, the short tail merged into the last full window"""
    w, tail = int(WINDOW_S * sr), int(MIN_TAIL_S * sr)
    cuts = list(range(0, n, w)) + [n]
    if len(cuts) > 2 and cuts[-1] - cuts[-2] < tail:
        del cuts[-2]
    return list(zip(cuts[:-1], cuts[1:]))


def squim(audio, sr):
    """(pesq, stoi) for a mono float array, scored window by window; the model stays loaded until free_squim()"""
    global _squim
    import numpy as np
    import torch
    import torchaudio
    if _squim is None:
        _squim = torchaudio.pipelines.SQUIM_OBJECTIVE.get_model()
    x = torchaudio.functional.resample(torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None], sr, 16000)
    tot, p_sum, s_sum = 0, 0.0, 0.0
    with torch.no_grad():
        for a, b in windows(x.shape[1], 16000):
            stoi, pesq, _ = _squim(x[:, a:b])
            p_sum += pesq.item() * (b - a); s_sum += stoi.item() * (b - a); tot += b - a
    return (p_sum / tot, s_sum / tot) if tot else (0.0, 0.0)


def free_squim():
    global _squim
    _squim = None
    gc.collect()


def load(path, sr=16000):
    import numpy as np
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy()   # writable: torch.from_numpy warns on a read-only buffer


def main():
    args = sys.argv[1:]

    def opt(k, d=None):
        if k in args:
            i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
        return d

    lang, model = opt('--lang', 'pt'), opt('--model', 'small')
    flags = {a for a in args if a.startswith('--')}
    paths = [a for a in args if not a.startswith('--')]
    if not paths:
        print(__doc__); sys.exit(2)
    files = []
    for p in paths:
        if os.path.isdir(p):
            files += sorted(os.path.join(p, n) for n in os.listdir(p) if n.endswith('.wav') and n != 'voice.wav')
        else:
            files.append(p)
    rows = []
    for f in files:
        audio = load(f)
        dur = len(audio) / 16000
        if dur > MAX_TAKE_S and '--long' not in flags:
            print(f'skip {os.path.basename(f)}: {dur:.1f}s (> {MAX_TAKE_S:.0f}s; --long scores it in {WINDOW_S:.0f}s windows)', file=sys.stderr)
            continue
        pesq, stoi = squim(audio, 16000)
        rows.append({'file': os.path.basename(f), 'path': f, 'dur': round(dur, 2), 'pesq': round(pesq, 3), 'stoi': round(stoi, 3)})
        del audio
    free_squim()   # one model at a time
    if rows and '--no-lang' not in flags:
        from faster_whisper import WhisperModel
        m = WhisperModel(model, device='cpu', compute_type='int8')
        for r in rows:
            _, info = m.transcribe(load(r['path']), beam_size=1, without_timestamps=True)
            r['lang'] = info.language
            r['lang_p'] = round(info.language_probability, 3)
            r['accent_ok'] = info.language == lang and info.language_probability >= 0.93
        del m
        gc.collect()
    for r in rows:
        del r['path']
    if '--json' in flags:
        print(json.dumps(rows, ensure_ascii=False, indent=1)); return
    for r in rows:
        extra = f"  {r['lang']} {r['lang_p']:.2f}{'' if r['accent_ok'] else '  <- accent'}" if 'lang' in r else ''
        print(f"{r['file']:16} {r['dur']:6.2f}s  PESQ {r['pesq']:.2f}  STOI {r['stoi']:.3f}{extra}")
    if rows:
        print(f"{'mean':16} {sum(r['dur'] for r in rows):6.1f}s  PESQ {sum(r['pesq'] for r in rows) / len(rows):.2f}  STOI {sum(r['stoi'] for r in rows) / len(rows):.3f}")


if __name__ == '__main__':
    main()
