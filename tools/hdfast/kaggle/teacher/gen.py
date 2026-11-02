# HD-Fast week 1: the teacher's data. Kokoro-82M (Cadence HD) reads every
# sentence of the corpus in its assigned voice, with Cadence's own phonemes,
# and we keep what a student needs to learn from it: the audio (24 kHz), how
# long each phoneme lasts, and the pitch and loudness curves it predicted.
# Both GPUs work at once, each on half the sentences.
#
# Output (/kaggle/working/teacher/): shard_<gpu>_<n>.npz, 500 sentences each:
#   ids, voices, phonemes         one per sentence
#   audio, audio_off              int16 audio, all sentences end to end, and where each starts
#   dur, dur_off                  frames per input token (BOS and EOS included)
#   f0, energy, curve_off         pitch (Hz) and loudness, two values per frame
# and test/<id>.wav: the held-out sentences, for the final listening test.
import glob, json, os, subprocess, sys, time

WORKER = r'''
import json, os, sys, time, types, wave
import numpy as np, torch
for name in ('misaki', 'misaki.en', 'misaki.espeak'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['misaki'].en = sys.modules['misaki.en']; sys.modules['misaki'].espeak = sys.modules['misaki.espeak']
sys.modules['misaki.en'].MToken = object
from kokoro import KModel
from huggingface_hub import hf_hub_download

part, parts, corpus, test, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
dev = 'cuda'
model = KModel(repo_id='hexgrad/Kokoro-82M').to(dev).eval()
vocab = model.vocab
packs = {}
def pack(v):
    if v not in packs:
        packs[v] = torch.load(hf_hub_download('hexgrad/Kokoro-82M', f'voices/{v}.pt'), weights_only=True).to(dev)
    return packs[v]

@torch.no_grad()
def speak(ps, voice):
    ids = [0] + [vocab[c] for c in ps if c in vocab] + [0]
    ref_s = pack(voice)[len(ids) - 3]
    m = model
    input_ids = torch.LongTensor([ids]).to(dev)
    lengths = torch.full((1,), len(ids), device=dev, dtype=torch.long)
    mask = torch.zeros((1, len(ids)), dtype=torch.bool, device=dev)
    bert = m.bert(input_ids, attention_mask=(~mask).int())
    d_en = m.bert_encoder(bert).transpose(-1, -2)
    s = ref_s[:, 128:]
    d = m.predictor.text_encoder(d_en, s, lengths, mask)
    x, _ = m.predictor.lstm(d)
    duration = torch.sigmoid(m.predictor.duration_proj(x)).sum(axis=-1)
    pred_dur = torch.round(duration).clamp(min=1).long().squeeze(0)
    idx = torch.repeat_interleave(torch.arange(len(ids), device=dev), pred_dur)
    aln = torch.zeros((len(ids), idx.shape[0]), device=dev)
    aln[idx, torch.arange(idx.shape[0])] = 1
    aln = aln.unsqueeze(0)
    en = d.transpose(-1, -2) @ aln
    F0, N = m.predictor.F0Ntrain(en, s)
    t_en = m.text_encoder(input_ids, lengths, mask)
    audio = m.decoder(t_en @ aln, F0, N, ref_s[:, :128]).squeeze()
    return audio.float().cpu().numpy(), pred_dur.cpu().numpy(), F0.squeeze().float().cpu().numpy(), N.squeeze().float().cpu().numpy()

def pcm(a):
    return (np.clip(a, -1, 1) * 32767).astype(np.int16)

rows = [json.loads(l) for l in open(corpus)][part::parts]
os.makedirs(out, exist_ok=True)
t0 = time.time(); audio_s = 0.0
for n in range(0, len(rows), 500):
    path = f'{out}/shard_{part}_{n // 500:03d}.npz'
    if os.path.exists(path): continue
    batch = rows[n:n + 500]
    A, D, F, E = [], [], [], []
    for r in batch:
        a, d, f, e = speak(r['phonemes'], r['voice'])
        A.append(pcm(a)); D.append(d.astype(np.int16)); F.append(f.astype(np.float16)); E.append(e.astype(np.float16))
        audio_s += len(a) / 24000
    off = lambda xs: np.cumsum([0] + [len(x) for x in xs]).astype(np.int64)
    np.savez(path, ids=np.array([r['id'] for r in batch]), voices=np.array([r['voice'] for r in batch]),
             phonemes=np.array([r['phonemes'] for r in batch]),
             audio=np.concatenate(A), audio_off=off(A), dur=np.concatenate(D), dur_off=off(D),
             f0=np.concatenate(F), energy=np.concatenate(E), curve_off=off(F))
    el = time.time() - t0
    print(f'gpu {part}: {n + len(batch)}/{len(rows)} sentences, {audio_s / 3600:.2f} h audio, {el / 60:.1f} min, RTF {el / audio_s:.3f}', flush=True)

if part == 0:
    os.makedirs(f'{out}/test', exist_ok=True)
    for r in (json.loads(l) for l in open(test)):
        a = pcm(speak(r['phonemes'], r['voice'])[0])
        with wave.open(f"{out}/test/{r['id']}.wav", 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(a.tobytes())
    print('test set written', flush=True)
'''

subprocess.run(f'{sys.executable} -m pip install -q --no-deps --ignore-requires-python kokoro==0.9.4 loguru', shell=True, check=True)
corpus = glob.glob('/kaggle/input/**/corpus.jsonl', recursive=True)[0]
test = glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0]
open('/kaggle/working/worker.py', 'w').write(WORKER)
out = '/kaggle/working/teacher'
gpus = int(subprocess.run('nvidia-smi -L | wc -l', shell=True, capture_output=True, text=True).stdout.strip() or 1)
print(f'{gpus} GPUs; corpus {corpus}', flush=True)
procs = [subprocess.Popen([sys.executable, '/kaggle/working/worker.py', str(g), str(gpus), corpus, test, out],
                         env={**os.environ, 'CUDA_VISIBLE_DEVICES': str(g)}) for g in range(gpus)]
codes = [p.wait() for p in procs]
os.remove('/kaggle/working/worker.py')
shards = sorted(glob.glob(f'{out}/shard_*.npz'))
size = sum(os.path.getsize(s) for s in shards) / 1e9
print(f'done: exit codes {codes}, {len(shards)} shards, {size:.2f} GB, {len(glob.glob(out + "/test/*.wav"))} test files')
