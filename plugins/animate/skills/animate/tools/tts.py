#!/usr/bin/env python3
"""Text-to-speech for a piece's voice-over: one take per line of <piece>/voice/script.json. Local and free by default
(Kokoro, Chatterbox, Piper); ElevenLabs through its API when a voice asks for it.
   usage: python tools/tts.py <piece> [--only id1,id2] [--models DIR] [--force] [--dry-run]
          python tools/tts.py --voices          (the ElevenLabs voices on your account, with their voice_id)
   --dry-run lists the takes that would be made (the rest are unchanged) and the characters ElevenLabs would bill; makes nothing
Then:  node tools/voice.mjs <piece>   (places the takes, times every word with faster-whisper, writes voice.json)

script.json gains a "voices" table; each line names one with "voice" (and may override "speed", "exaggeration", "fx"):
  "voices": {
    "narrator": { "engine": "kokoro", "voice": "pm_alex", "lang": "pt-br", "speed": 0.95, "fx": "<ffmpeg -af chain>" },
    "host":     { "engine": "chatterbox", "lang": "pt", "ref": "refs/host.wav", "exaggeration": 0.7, "cfg": 0.4 },
    "robot":    { "engine": "piper", "model": "pt_BR-faber-medium", "length": 1.1, "fx": "asetrate=22050*0.8,..." },
    "guest":    { "engine": "elevenlabs", "voice_id": "<from --voices>", "model": "eleven_multilingual_v2", "stability": 0.5,
                  "similarity": 0.75, "style": 0, "speed": 1.0, "seed": 42 }
  }
Each voice picks its own engine, so one script can mix them. Engines that run on your machine (no API, no credits):
  kokoro      Kokoro-82M (Apache-2.0) via kokoro-onnx: natural, fast on CPU. Voices: af_*/am_* (en-us), bf_*/bm_* (en-gb),
              pf_dora/pm_alex/pm_santa (pt-br; "voice" may be a blend, { "pm_alex": 0.5, "pm_santa": 0.5 }), ef_dora/em_alex (es), ff_siwis (fr), if_sara/im_nicola (it), jf_*/jm_* (ja) ...
              pip install kokoro-onnx soundfile   (model files download once from Hugging Face)
  chatterbox  Chatterbox Multilingual (MIT): the most expressive; "exaggeration" 0.25 (flat) .. 1.0 (theatrical), "cfg" pace;
              "ref" = a few seconds of a voice to speak in (a voice you own or have the right to use). Slow on CPU, fast on a GPU.
              pip install chatterbox-tts
  piper       Piper (MIT): small and very fast, a bit robotic — good for machines and as a fallback. pip install piper-tts
  file        an existing take, "src" (relative to the voice folder): the same audio another piece used, with this voice's fx
              (a callback that must be the very same recording, not a new synthesis of the same words)
And one that does not (paid, needs ELEVENLABS_API_KEY in the environment; no pip install, the request uses the stdlib):
  elevenlabs  ElevenLabs text-to-speech: "voice_id" (python tools/tts.py --voices), "model" (eleven_multilingual_v2 by
              default; eleven_v3 the most expressive, eleven_flash_v2_5 / eleven_turbo_v2_5 fast and half the credits),
              "stability" 0..1 (low = more varied and emotional), "similarity" 0..1, "style" 0..1, "speaker_boost",
              "speed" 0.7..1.2, "seed" (the same seed makes the same take again), "lang" (forced only on the v2.5 models).
              A line may override "stability", "similarity", "style", "seed" and "speed". The neighbouring lines of the
              same voice go along as context, so the intonation runs on between takes (they are not in the hash: editing
              a neighbour does not re-bill this line). Every take is billed by its characters, so: a take whose text,
              voice and settings are unchanged is never requested again, "takes" is ignored, and --dry-run shows the
              bill first. No key, no credits or an unknown voice stops the run and keeps the takes already made.
              The take comes as PCM 24 kHz (lossless); a plan without PCM falls back to mp3. The key is never written
              to a file or printed. ELEVENLABS_API_BASE points the requests elsewhere (a proxy, a test server).
"fx" is an ffmpeg audio filter chain applied after synthesis (tape, phone, radio, monster ...). Takes are skipped when the
text, voice and settings are unchanged (a hash in <id>.wav.json); --force remakes them.
"lufs" (on the script, or per voice / line) sets every take of that voice to the same loudness after its fx, so lines sit
level with each other in the mix (a whisper voice gets a lower target, not a lower fx volume). The take is synthesised in
float and resampled to 48 kHz with soxr.
Kokoro, measured with a no-reference speech-quality model (SQUIM: PESQ / STOI estimates) and Whisper (word error, language):
  - blend the pt-br voice with an English one of the top grade: { "pm_santa": 0.7, "am_michael": 0.3 } lifts PESQ ~2.6 -> ~3.3
    with the same words understood and still heard as Portuguese (the phonemes come from the pt-br text, the timbre from the blend)
  - "takes": N (on the script, a voice or a line) synthesises N variants (the speed nudged around the one asked) and keeps the
    one SQUIM scores best (needs torch + torchaudio); a line's choice is printed with its score
  - pitch a natural voice with asetrate={sr}*1.09,aresample={sr}:resampler=soxr,atempo=1/1.09, never rubberband (PESQ -0.8)
Sounding less like a machine (a voice or a line may set them; a script without them makes the same takes as before):
  "pause": [0.45, 0.8]  Kokoro runs sentences together (80-120 ms between "Isso é o palco. Ontem à noite."); with "pause" the
                        gap after every full stop inside the line is opened up to a pause picked in that range (seconds, fixed
                        by the words: the same take every run); the line is still synthesised whole, so its prosody is Kokoro's.
                        Never a rule for every line: a line that must run fast sets its own ("pause": [0.08, 0.15]) or
                        "pause": null (the whole line in one synthesis, Kokoro's own short gaps)
  "room": { "rt": 0.35, "wet": 0.12 }   the room the voice was spoken in, convolved before the fx (early reflections and a tail
                        whose highs die first) — in place of aecho, whose one short tap combs the voice into a metallic ring
  "wow": 0.15           tape speed drift on playback, after the fx: wow at 0.6 Hz with this peak pitch deviation (percent) and
                        flutter at 6.5 Hz at a quarter of it — for a voice that is on a tape, not one recorded today"""
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

args = sys.argv[1:]


def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d


def flag(k):
    if k in args:
        args.remove(k); return True
    return False


only = opt('--only')
force = flag('--force')
dry = flag('--dry-run')
voices = flag('--voices')
models = os.path.expanduser(opt('--models', os.environ.get('TTS_MODELS', '~/.cache/animate-tts')))
if not args and not voices:
    print(__doc__); sys.exit(2)
piece = args[0] if args else None
vdir = os.path.join(piece, 'voice') if piece else None
S = json.load(open(os.path.join(vdir, 'script.json'), encoding='utf-8')) if piece else None
_engines = {}


def hf(repo, filename):
    p = os.path.join(models, repo.replace('/', '__'), filename)
    if not os.path.exists(p):
        from huggingface_hub import hf_hub_download
        hf_hub_download(repo, filename, local_dir=os.path.dirname(p))
        got = os.path.join(os.path.dirname(p), filename)
        if got != p:
            os.makedirs(os.path.dirname(p), exist_ok=True); os.replace(got, p)
    return p


def kokoro(text, V, out):
    if 'kokoro' not in _engines:
        from kokoro_onnx import Kokoro
        _engines['kokoro'] = Kokoro(hf('fastrtc/kokoro-onnx', 'kokoro-v1.0.onnx'), hf('fastrtc/kokoro-onnx', 'voices-v1.0.bin'))
    import soundfile as sf
    voice = V.get('voice', 'pm_alex')
    if isinstance(voice, dict):   # a blend makes a voice of its own: { "pm_alex": 0.5, "pm_santa": 0.5 }
        voice = sum(_engines['kokoro'].get_voice_style(n) * w for n, w in voice.items())
    sp, n = float(V.get('speed', 1.0)), int(V.get('takes', 1))
    best = None
    for i in range(n):
        s_i = sp * (1 + (i - (n - 1) / 2) * 0.03) if n > 1 else sp   # 0.97x, 1x, 1.03x ... around the speed asked
        audio, sr = _engines['kokoro'].create(text, voice=voice, speed=s_i, lang=V.get('lang', 'en-us'))
        q = quality(audio, sr) if n > 1 else 0
        if best is None or q > best[0]:
            best = (q, audio, sr, s_i)
    q, audio, sr, s_i = best
    if n > 1:
        V['_chosen'] = f'speed {s_i:.3f}, quality {q:.2f}'
    if V.get('pause'):
        audio, got = widen(audio, sr, text, *V['pause'])
        if got:
            V['_chosen'] = V.get('_chosen', '') + f"{', ' if n > 1 else ''}pauses {' '.join(f'{p:.2f}' for p in got)}s"
    sf.write(out, audio, sr, subtype='FLOAT')   # no 16-bit rounding before the fx chain


def widen(audio, sr, text, lo, hi):
    """the gap Kokoro leaves after each full stop inside a line, opened up to a pause in [lo, hi] seconds (picked from the
    words, so a re-run makes the same take). The line is still synthesised whole: sentences synthesised one by one lose their
    context — alone, "O Algodão." came out with an English accent (Whisper heard "Halgo Jones"). Each stop's gap is the quiet
    run (>= 50 ms, 35 dB down) nearest to where the stop falls in the text, longer runs preferred; the silence goes in its middle."""
    import numpy as np
    stops = [m.end() for m in re.finditer(r'[.!?…]+(?=\s+\S)', text.strip())]
    fr = int(sr * 0.01)
    e = np.sqrt((audio[:len(audio) // fr * fr].reshape(-1, fr) ** 2).mean(1))
    loud = np.nonzero(e > e.max() * 10 ** (-35 / 20))[0]
    if not stops or not len(loud):
        return audio, []
    runs, r0 = [], None
    for k in range(loud[0], loud[-1] + 2):
        quiet = k <= loud[-1] and e[k] <= e.max() * 10 ** (-35 / 20)
        if quiet and r0 is None: r0 = k
        elif not quiet and r0 is not None:
            if k - r0 >= 5: runs.append((r0, k - r0))
            r0 = None
    s0, s1, cuts = loud[0], loud[-1], []
    for i, c in enumerate(stops):
        want = s0 + (s1 - s0) * c / len(text.strip())
        free = [r for r in runs if r not in [x[0] for x in cuts]]
        if not free: break
        run = max(free, key=lambda r: r[1] / (1 + abs(r[0] + r[1] / 2 - want) / 25))   # 25 frames = 0.25 s off costs half
        u = int(hashlib.sha1(f'{text}|{i}'.encode()).hexdigest()[:8], 16) / 0xffffffff
        cuts.append((run, lo + (hi - lo) * u))
    parts, at, got = [], 0, []
    for (r, n), pause in sorted(cuts):
        mid = (r + n // 2) * fr
        parts += [audio[at:mid], np.zeros(max(0, int((pause - n * 0.01) * sr)), dtype=audio.dtype)]
        at = mid; got.append(max(pause, n * 0.01))
    return np.concatenate(parts + [audio[at:]]), got


def quality(audio, sr):
    """SQUIM's no-reference estimate of how clean a take is: PESQ (1..4.5) plus STOI (0..1), on the raw synthesis.
    Scored in windows of at most 15 s (tools/voicescore.py): SQUIM's memory grows with the square of the length."""
    from voicescore import squim   # beside this file
    pesq, stoi = squim(audio, sr)
    return pesq + stoi


def chatterbox(text, V, out):
    if 'chatterbox' not in _engines:
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        dev = 'cuda' if torch.cuda.is_available() else 'mps' if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available() else 'cpu'
        _engines['chatterbox'] = ChatterboxMultilingualTTS.from_pretrained(device=dev)
    import torchaudio
    m = _engines['chatterbox']
    ref = V.get('ref')
    kw = dict(language_id=V.get('lang', 'en'), exaggeration=float(V.get('exaggeration', 0.5)), cfg_weight=float(V.get('cfg', 0.5)))
    if ref:
        kw['audio_prompt_path'] = os.path.join(vdir, ref) if not os.path.isabs(ref) else ref
    wav = m.generate(text, **kw)
    torchaudio.save(out, wav, m.sr)


def piper(text, V, out):
    name = V.get('model', 'en_US-lessac-medium')
    lang = name.split('_')[0]; region, voice, quality = name.split('-')
    rel = f'{lang}/{region}/{voice}/{quality}/{name}.onnx'
    onnx = hf('rhasspy/piper-voices', rel); hf('rhasspy/piper-voices', rel + '.json')
    if not os.path.exists(onnx + '.json'):
        os.replace(onnx.replace('.onnx', '.onnx.json'), onnx + '.json')
    subprocess.run([sys.executable, '-m', 'piper', '-m', onnx, '-f', out, '--length-scale', str(V.get('length', 1.0))],
                   input=text.encode('utf-8'), check=True, capture_output=True, env={**os.environ, 'PYTHONUTF8': '1'})   # Windows reads stdin as cp1252 otherwise, and accents come out as symbol names


def level(wav, target):
    """the gain (dB) that brings a take to `target` LUFS, held so its peak stays under -1 dBFS; takes under 0.4s have no
    integrated loudness, so they are matched by RMS (about the same number for speech)"""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', wav, '-af', 'ebur128=peak=sample:framelog=quiet,astats=metadata=0:measure_overall=RMS_level:measure_perchannel=0', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    I = peak = rms = None
    num = lambda x: (lambda v: v if math.isfinite(v) else None)(float(x))
    for line in r.splitlines():
        t = line.strip()
        if t.startswith('I:'): I = num(t.split()[1])
        elif t.startswith('Peak:'): peak = num(t.split()[1])
        elif 'RMS level dB' in t: rms = num(t.split(':')[-1])
    now = I if I is not None and I > -69 else (rms if rms is not None else target)
    return min(target - now, -1.0 - (peak if peak is not None else -99))


def room(wav, rt=0.35, wet=0.12, seed='room'):
    """the voice in a small room: twelve soft early reflections (5-35 ms) and a diffuse tail from 12 ms on that decays 60 dB in `rt`
    seconds at the bottom and faster from 3 kHz up (the highs die first, as in a furnished room); `wet` is the reverb's energy
    against the dry voice. Replaces the file; the same seed makes the same room."""
    import numpy as np, soundfile as sf
    x, sr = sf.read(wav, dtype='float32')
    R = np.random.default_rng(int(hashlib.sha1(seed.encode()).hexdigest()[:8], 16))
    n = int(sr * rt * 1.3)
    early = np.zeros(n)
    for d, g in zip(np.sort(R.uniform(0.005, 0.035, 12)), np.linspace(0.35, 0.1, 12)):   # soft and from 5 ms on: strong early taps comb the voice
        i = int(d * sr); early[i:i + 3] += g * np.array([0.5, 0.35, 0.15]) * R.choice([-1, 1])
    hop, nfft = 128, 512
    frames = n // hop + 1
    rt_f = rt / (1 + (np.fft.rfftfreq(nfft, 1 / sr) / 3000.0) ** 1.2)
    t = (np.arange(frames) * hop / sr)[:, None]
    spec = np.exp(-6.91 * t / rt_f[None, :]) * (t >= 0.012) * np.exp(2j * np.pi * R.random((frames, nfft // 2 + 1)))
    tail, win = np.zeros(frames * hop + nfft), np.hanning(nfft)
    for k in range(frames):
        tail[k * hop:k * hop + nfft] += np.fft.irfft(spec[k], nfft) * win
    tail = tail[:n]
    ir = early + tail * np.sqrt((early ** 2).sum() / ((tail ** 2).sum() + 1e-12)) * 1.2
    ir /= np.sqrt((ir ** 2).sum()) + 1e-12
    m = len(x) + n - 1
    y = np.concatenate([x, np.zeros(n - 1)]) + np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m) * math.sqrt(wet)
    sf.write(wav, y.astype(np.float32), sr, subtype='FLOAT')


def wow(wav, pct=0.15, seed='wow'):
    """tape speed drift: the take read back at a rate that wanders by `pct` percent at 0.6 Hz (wow) and a quarter of that at
    6.5 Hz (flutter), phases fixed by the seed. Replaces the file."""
    import numpy as np, soundfile as sf
    x, sr = sf.read(wav, dtype='float32')
    R = np.random.default_rng(int(hashlib.sha1(seed.encode()).hexdigest()[:8], 16))
    t = np.arange(len(x)) / sr
    tau = t.copy()
    for fq, p in ((0.6, pct / 100), (6.5, pct / 400)):
        tau -= p / (2 * np.pi * fq) * np.cos(2 * np.pi * fq * t + R.uniform(0, 2 * np.pi))
    y = np.interp(np.clip(tau, 0, t[-1]) * sr, np.arange(len(x)), x)
    sf.write(wav, y.astype(np.float32), sr, subtype='FLOAT')


API = os.environ.get('ELEVENLABS_API_BASE', 'https://api.elevenlabs.io').rstrip('/')   # the base can point at a proxy or a test server
_spent = [0]        # characters ElevenLabs billed this run
_eleven_mp3 = []    # set once the account turned PCM down: the rest of the run asks for mp3 straight away


class ElevenError(Exception):
    """a failure the run cannot get past (no key, no credits, a voice that does not exist): stop, keep the takes already made"""


class ElevenHTTP(Exception):
    def __init__(self, code, status, msg):
        super().__init__(f'{code} {status} {msg}'.strip()); self.code, self.status, self.msg = code, status, msg


def windows_user_env(name):
    """a user variable set with setx after this process (or the app that started it) began: Windows writes it to
    HKCU\\Environment at once, but running programs only see it after a restart"""
    if os.name != 'nt':
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
            return winreg.QueryValueEx(k, name)[0] or None
    except OSError:
        return None


def eleven_call(method, path, body=None, query=None):
    """one request to the ElevenLabs API with the key from ELEVENLABS_API_KEY (never written anywhere, never printed);
    429 and 5xx are retried with backoff, honouring Retry-After"""
    import time, urllib.error, urllib.parse, urllib.request
    key = os.environ.get('ELEVENLABS_API_KEY') or windows_user_env('ELEVENLABS_API_KEY')
    if not key:
        raise ElevenError('ELEVENLABS_API_KEY is not set: create a key at elevenlabs.io (Developers -> API Keys) and set it as an environment variable'
                          + (' (setx ELEVENLABS_API_KEY "<key>")' if os.name == 'nt' else ''))
    url = API + path + ('?' + urllib.parse.urlencode(query) if query else '')
    data = json.dumps(body).encode('utf-8') if body is not None else None
    for attempt in range(4):
        req = urllib.request.Request(url, data=data, method=method, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            try:
                detail = json.loads(raw).get('detail', raw)
            except (ValueError, AttributeError):
                detail = raw
            status = str(detail.get('status', '')) if isinstance(detail, dict) else ''
            msg = str(detail.get('message', raw)) if isinstance(detail, dict) else str(detail)
            if status == 'quota_exceeded':
                raise ElevenError(f'ElevenLabs credits ran out ({msg})')
            if e.code == 401:
                raise ElevenError(f'ElevenLabs refused the key (401 {status}: {msg}) - check ELEVENLABS_API_KEY')
            if (e.code == 429 or e.code >= 500) and attempt < 3:
                try:
                    wait = float(e.headers.get('Retry-After') or 0) or 2 ** (attempt + 1)
                except ValueError:
                    wait = 2 ** (attempt + 1)
                print(f'  ElevenLabs answered {e.code}, retrying in {wait:.0f}s'); time.sleep(wait); continue
            raise ElevenHTTP(e.code, status, msg)
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1)); continue
            raise ElevenError(f'could not reach ElevenLabs ({e.reason})')


def elevenlabs(text, V, out):
    """a take from the ElevenLabs API: PCM 24 kHz (lossless) when the account allows it, mp3 otherwise. The same text,
    voice, settings and seed are not re-billed (the take's hash), and "takes" is ignored: every variant costs credits."""
    import wave
    vid = V.get('voice_id')
    if not vid:
        raise ElevenError('an "elevenlabs" voice needs a "voice_id" (python tools/tts.py --voices lists the voices on your account)')
    model = V.get('model', 'eleven_multilingual_v2')
    body = {'text': text, 'model_id': model}
    vs = {api: V[k] for k, api in (('stability', 'stability'), ('similarity', 'similarity_boost'), ('style', 'style'),
                                   ('speaker_boost', 'use_speaker_boost'), ('speed', 'speed')) if k in V}
    if vs:
        body['voice_settings'] = vs
    if 'seed' in V:
        body['seed'] = int(V['seed'])
    if V.get('lang') and model.endswith('_v2_5'):   # only the v2.5 models take a forced language; the others reject it
        body['language_code'] = str(V['lang']).split('-')[0].lower()
    for k, api in (('_prev', 'previous_text'), ('_next', 'next_text')):
        if V.get(k):
            body[api] = V[k]
    if int(V.get('takes', 1)) > 1:
        V['_chosen'] = '"takes" ignored: every ElevenLabs variant costs credits'
    for fmt in (['mp3_44100_128'] if _eleven_mp3 else ['pcm_24000', 'mp3_44100_128']):
        try:
            audio, hdr = eleven_call('POST', f'/v1/text-to-speech/{vid}', body, {'output_format': fmt})
            break
        except ElevenHTTP as e:
            if fmt.startswith('pcm') and (e.code == 403 or 'format' in f'{e.status} {e.msg}'.lower()):
                _eleven_mp3.append(1); continue   # this plan has no PCM: mp3 for the rest of the run
            raise ElevenError(f'ElevenLabs could not make the take ({e}) - voice_id "{vid}", model "{model}"')
    try:
        _spent[0] += int(hdr.get('character-cost') or len(text))
    except ValueError:
        _spent[0] += len(text)
    if fmt.startswith('pcm'):
        with wave.open(out, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(audio)
    else:
        mp3 = out + '.mp3'
        open(mp3, 'wb').write(audio)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', mp3, '-ac', '1', '-c:a', 'pcm_f32le', out], check=True)


def list_voices():
    raw, _ = eleven_call('GET', '/v1/voices')
    vs = sorted(json.loads(raw).get('voices', []), key=lambda v: (v.get('category', ''), v.get('name', '')))
    for v in vs:
        lab = v.get('labels') or {}
        about = ', '.join(str(x) for x in (lab.get('language'), lab.get('accent'), lab.get('gender'), lab.get('age'),
                                            lab.get('descriptive') or lab.get('description'), lab.get('use_case') or lab.get('use case')) if x)
        print(f"{v.get('voice_id', ''):22}  {v.get('name', '')[:30]:30}  {v.get('category', ''):12}  {about}")
    print(f'{len(vs)} voice(s); put one\'s id in a voice as "voice_id"')


def file_take(text, V, out):
    src = V['src'] if os.path.isabs(V['src']) else os.path.join(vdir, V['src'])
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-ac', '1', '-c:a', 'pcm_f32le', out], check=True)


ENGINES = {'kokoro': kokoro, 'chatterbox': chatterbox, 'piper': piper, 'elevenlabs': elevenlabs, 'file': file_take}
if voices:
    try:
        list_voices()
    except (ElevenError, ElevenHTTP) as e:
        print(f'ElevenLabs: {e}'); sys.exit(1)
    sys.exit(0)
made, todo = 0, []
for i, L in enumerate(S['lines']):
    if only and L['id'] not in only.split(','):
        continue
    V = dict(S['voices'][L['voice']])
    for k in ('lufs', 'takes'):
        if k in S and k not in V:
            V[k] = S[k]
    for k in ('speed', 'exaggeration', 'cfg', 'fx', 'length', 'lufs', 'takes', 'src', 'pause', 'room', 'wow',
              'stability', 'similarity', 'style', 'seed'):
        if k in L:
            V[k] = L[k]
    out = os.path.join(vdir, f"{L['id']}.wav")
    sig = hashlib.sha1(json.dumps([L['text'], V], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    meta = out + '.json'
    if not force and os.path.exists(out) and os.path.exists(meta) and json.load(open(meta)).get('sig') == sig:
        L['file'] = f"{L['id']}.wav"; continue
    if V.get('engine') == 'elevenlabs':   # the neighbouring lines of the same voice, so the intonation runs on between takes;
        lines = S['lines']                # outside the hash: a neighbour's edit does not re-bill this line
        if i > 0 and lines[i - 1]['voice'] == L['voice']:
            V['_prev'] = lines[i - 1]['text']
        if i + 1 < len(lines) and lines[i + 1]['voice'] == L['voice']:
            V['_next'] = lines[i + 1]['text']
    todo.append((L, V, out, sig, meta))

if dry:
    for L, V, *_ in todo:
        print(f"{L['id']:6} {L['voice']:10} {V.get('engine', 'kokoro'):10} {len(L['text']):4} chars  {L['text']}")
    ch = sum(len(L['text']) for L, V, *_ in todo if V.get('engine') == 'elevenlabs')
    print(f'{len(todo)} take(s) to make, {len(S["lines"]) - len(todo)} unchanged; ElevenLabs would bill about {ch} characters (nothing was made)')
    sys.exit(0)


def make(L, V, out, sig, meta):
    with tempfile.TemporaryDirectory() as td:
        raw = os.path.join(td, 'raw.wav')
        ENGINES[V.get('engine', 'kokoro')](L['text'], V, raw)
        # "{sr}" in an fx chain is the take's own sample rate (asetrate={sr}*0.8 pitches down by 20%, whatever the engine)
        sr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', raw], capture_output=True, text=True).stdout.strip() or '24000'
        chain = V.get('fx', 'anull').replace('{sr}', sr) + ',aresample=48000:resampler=soxr:precision=28'
        if 'room' in V:   # the room is the voice's (one room per voice), before the mic chain
            room(raw, float(V['room'].get('rt', 0.35)), float(V['room'].get('wet', 0.12)), L['voice'])
        if 'lufs' in V or 'wow' in V:
            fx = os.path.join(td, 'fx.wav')
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', chain, '-ac', '1', '-c:a', 'pcm_f32le', fx], check=True)
            if 'wow' in V:
                wow(fx, float(V['wow']), L['id'])
            gain = level(fx, float(V['lufs'])) if 'lufs' in V else 0.0
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', fx, '-af', f'volume={gain:.2f}dB', '-ac', '1', out], check=True)
        else:
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', chain, '-ac', '1', out], check=True)
    json.dump({'sig': sig, 'engine': V.get('engine', 'kokoro')}, open(meta, 'w'))
    L['file'] = f"{L['id']}.wav"
    print(f"{L['id']:6} {L['voice']:10} {V.get('engine', 'kokoro'):10} {L['text']}" + (f"   [{V['_chosen']}]" if '_chosen' in V else ''))


stopped = None
for k, job in enumerate(todo):
    try:
        make(*job); made += 1
    except ElevenError as e:   # no key, no credits, a wrong voice: stop here and keep every take already made
        stopped = f"stopped at line \"{job[0]['id']}\": {e}\n  still to make: {', '.join(j[0]['id'] for j in todo[k:])}"
        break

json.dump(S, open(os.path.join(vdir, 'script.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{made} take(s) made' + (f'; ElevenLabs billed {_spent[0]} characters' if _spent[0] else '')
      + ('' if stopped else f'; next: node tools/voice.mjs {piece}'))
if stopped:
    print(stopped); sys.exit(1)
