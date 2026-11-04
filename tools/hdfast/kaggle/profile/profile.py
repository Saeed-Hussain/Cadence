# HD-Fast week 2: where does Kokoro spend its time on a CPU? Profiles the
# same ONNX file Cadence HD runs, with 4 threads, and groups operator time and
# parameters by the model's parts: ALBERT (bert), the prosody predictor, the
# text encoder and the decoder (the waveform stage).
import glob, json, os, subprocess, sys, time, collections, urllib.request
subprocess.run(f'{sys.executable} -m pip install -q onnxruntime onnx', shell=True, check=True)
import numpy as np, onnx, onnxruntime as ort
url = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx'
urllib.request.urlretrieve(url, 'model.onnx')
voice = np.frombuffer(urllib.request.urlopen('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin').read(), dtype=np.float32).reshape(510, 256)
vocab = json.load(urllib.request.urlopen('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json'))['model']['vocab']

def part(name):
    n = name.lower()
    for key in ('bert_encoder', 'bert', 'predictor', 'text_encoder', 'decoder'):
        if f'/{key}' in n or n.startswith(key) or f'{key}.' in n: return key
    return 'other'

m = onnx.load('model.onnx')
params = collections.Counter()
for t in m.graph.initializer:
    params[part(t.name)] += int(np.prod(t.dims))
print('parameters by part (millions):', {k: round(v / 1e6, 2) for k, v in params.most_common()})

rows = [json.loads(l) for l in open(glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0])][:12]
so = ort.SessionOptions(); so.intra_op_num_threads = 4; so.enable_profiling = True
s = ort.InferenceSession('model.onnx', so, providers=['CPUExecutionProvider'])
audio = 0.0; t0 = None
for i, r in enumerate(rows):
    ids = [0] + [vocab[c] for c in r['phonemes'] if c in vocab] + [0]
    if i == 2: t0 = time.time()
    out = s.run(None, {'input_ids': np.array([ids], dtype=np.int64), 'style': voice[len(ids) - 3][None], 'speed': np.array([1.0], dtype=np.float32)})[0]
    if i >= 2: audio += out.size / 24000
el = time.time() - t0
print(f'4 CPU threads: {audio:.1f} s audio in {el:.1f} s, RTF {el / audio:.3f}')
trace = json.load(open(s.end_profiling()))
time_by = collections.Counter(); op_by = collections.Counter()
for e in trace:
    if e.get('cat') == 'Node' and e['name'].endswith('_kernel_time'):
        time_by[part(e['args'].get('node_name', e['name']))] += e['dur']
        op_by[e['args'].get('op_name', '?')] += e['dur']
tot = sum(time_by.values())
print('time by part:', {k: f'{100 * v / tot:.1f}%' for k, v in time_by.most_common()})
print('time by operator:', {k: f'{100 * v / tot:.1f}%' for k, v in op_by.most_common(12)})
names = sorted({e['args'].get('node_name', '') for e in trace if e.get('cat') == 'Node'})
print('sample node names:', names[:5], names[-5:])
