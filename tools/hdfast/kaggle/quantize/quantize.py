"""
HD-Fast in 8-bit: matrix multiplications quantized (dynamic int8, weights per
channel), which WebAssembly runs faster than float32. Checked against float32
on held-out sentences: the mel distance of each half's output, and WAV files
to listen to.

Result: the back half in 8 bits is 0.118 from float32 (Vocos copy-synthesis
is 0.141), sounded the same, and runs 1.55× faster in WebAssembly; the app
uses it. The front half does not survive it, not even ALBERT alone (3.2):
it stays float32.

  front: cut from Kokoro's ONNX at its decoder inputs (as the app does)
  back:  hdfast-back.onnx from the export job (kernel_sources)

Runs on CPU. Writes kokoro-front-q8.onnx, hdfast-back-q8.onnx, samples/.
"""
import glob, json, os, subprocess, sys, time, wave

subprocess.run(f'{sys.executable} -m pip install -q onnx onnxruntime', shell=True, check=True)
import numpy as np, onnx, onnx.utils, onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from huggingface_hub import hf_hub_download

OUT = '/kaggle/working'
SR = 24000
t_start = time.time()
def log(*a): print(f'[{(time.time() - t_start) / 60:6.1f} min]', *a, file=sys.stderr, flush=True)

# ─── The front half, cut as in the app ──────────────────────────────────────
whole = hf_hub_download('onnx-community/Kokoro-82M-v1.0-ONNX', 'onnx/model.onnx')
front = f'{OUT}/kokoro-front.onnx'
outs = {'/encoder/MatMul_1_output_0': 'asr', '/encoder/Reshape_output_0': 'f0', '/encoder/Reshape_1_output_0': 'n'}
onnx.utils.extract_model(whole, front, ['input_ids', 'style', 'speed'], list(outs))
m = onnx.load(front)
for n in m.graph.node: n.output[:] = [outs.get(x, x) for x in n.output]
for o in m.graph.output: o.name = outs[o.name]
onnx.save(m, front)
# The quantizer writes beside its input, and /kaggle/input is read-only.
back = f'{OUT}/hdfast-back.onnx'
subprocess.run(['cp', glob.glob('/kaggle/input/**/hdfast-back.onnx', recursive=True)[0], back], check=True)
log(f'front {os.path.getsize(front) / 1e6:.1f} MB, back {os.path.getsize(back) / 1e6:.1f} MB')

# ─── Quantize ───────────────────────────────────────────────────────────────
# In the front half only ALBERT is quantized: with the duration and pitch
# predictors in 8 bits too, the durations changed and the speech with them
# (mel distance 2.7 to float32, against 0.12 for the back half).
bert = [n.name for n in onnx.load(front, load_external_data=False).graph.node if n.op_type == 'MatMul' and n.name.startswith('/encoder/bert/')]
log(f'{len(bert)} ALBERT MatMuls in the front half')
q = {}
for name, src in (('front', front), ('back', back)):
    dst = f"{OUT}/{'kokoro-front' if name == 'front' else 'hdfast-back'}-q8.onnx"
    quantize_dynamic(src, dst, op_types_to_quantize=['MatMul'], weight_type=QuantType.QInt8, per_channel=True,
                     nodes_to_quantize=bert if name == 'front' else None)
    q[name] = dst
    log(f'{name}: {os.path.getsize(src) / 1e6:.1f} MB → {os.path.getsize(dst) / 1e6:.1f} MB')

# ─── Check against float32 ──────────────────────────────────────────────────
vocab = json.load(open(hf_hub_download('hexgrad/Kokoro-82M', 'config.json')))['vocab']
so = ort.SessionOptions(); so.intra_op_num_threads = 4
S = {k: ort.InferenceSession(p, so) for k, p in (('front', front), ('back', back), ('front8', q['front']), ('back8', q['back']))}

def logmel(y, n_fft=1024, hop=256, n_mels=80):
    f = np.lib.stride_tricks.sliding_window_view(np.pad(y, n_fft // 2), n_fft)[::hop] * np.hanning(n_fft)
    spec = np.abs(np.fft.rfft(f, axis=1))
    mel = lambda x: 2595 * np.log10(1 + x / 700); hz = lambda x: 700 * (10 ** (x / 2595) - 1)
    pts = hz(np.linspace(0, mel(SR / 2), n_mels + 2)); bins = np.linspace(0, SR / 2, n_fft // 2 + 1)
    fb = np.array([np.clip(np.minimum((bins - pts[i]) / (pts[i + 1] - pts[i]), (pts[i + 2] - bins) / (pts[i + 2] - pts[i + 1])), 0, None) for i in range(n_mels)])
    return np.log(np.clip(spec @ fb.T, 1e-5, None))
def dist(a, b):
    n = min(len(a), len(b)); return float(np.abs(logmel(a[:n]) - logmel(b[:n])).mean())
def write_wav(path, a):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())

os.makedirs(f'{OUT}/samples', exist_ok=True)
test = [json.loads(l) for l in open(glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0])][:8]
packs = {}
rows = []
timing = {k: 0.0 for k in ('f32', 'q8')}; seconds = 0.0
for r in test:
    ids = [0] + [vocab[c] for c in r['phonemes'] if c in vocab] + [0]
    if r['voice'] not in packs:
        packs[r['voice']] = np.fromfile(hf_hub_download('onnx-community/Kokoro-82M-v1.0-ONNX', f"voices/{r['voice']}.bin"), dtype=np.float32).reshape(-1, 256)
    style = packs[r['voice']][len(ids) - 3][None]
    x = {'input_ids': np.array([ids], np.int64), 'style': style, 'speed': np.ones(1, np.float32)}
    def speak(fk, bk):
        t = time.time()
        a, f0, n = S[fk].run(None, x)
        y = S[bk].run(None, {'asr': a, 'f0': f0, 'n': n, 'style': style})[0][0]
        return y, time.time() - t
    ref, t32 = speak('front', 'back'); timing['f32'] += t32; seconds += len(ref) / SR
    y8f, _ = speak('front8', 'back')
    y8b, _ = speak('front', 'back8')
    y8, t8 = speak('front8', 'back8'); timing['q8'] += t8
    rows.append((dist(ref, y8f), dist(ref, y8b), dist(ref, y8)))
    if len(y8f) != len(ref): log(f"{r['id']}: front q8 changed the length, {len(ref)} → {len(y8f)} samples")
    write_wav(f"{OUT}/samples/{r['id']}-f32.wav", ref); write_wav(f"{OUT}/samples/{r['id']}-q8.wav", y8)
    log(f"{r['id']}: mel distance to float32 — front q8 {rows[-1][0]:.3f}, back q8 {rows[-1][1]:.3f}, both {rows[-1][2]:.3f}")
d = np.array(rows).mean(0)
log(f'mean mel distance to float32: front q8 {d[0]:.3f}, back q8 {d[1]:.3f}, both {d[2]:.3f} (for scale: Vocos copy-synthesis 0.141)')
log(f"speed on 4 CPU threads: float32 {timing['f32'] / seconds:.3f}, q8 {timing['q8'] / seconds:.3f} of real time")
for f in glob.glob(f'{OUT}/*.onnx'):
    if not f.endswith('-q8.onnx'): os.remove(f)
log('done')
