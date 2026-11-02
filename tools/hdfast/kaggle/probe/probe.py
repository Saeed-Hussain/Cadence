# HD-Fast week 1, probe: can Kokoro's PyTorch code run here, how is its forward
# pass built, and how fast is it on this GPU with Cadence's phonemes?
import subprocess, sys, json, time, inspect
def sh(c): print('$', c); r = subprocess.run(c, shell=True, capture_output=True, text=True); print((r.stdout + r.stderr)[-1500:])
sh(f'{sys.executable} -m pip install -q --no-deps --ignore-requires-python kokoro==0.9.4 loguru')
# Kokoro's text front end (misaki) needs spacy, which will not build here, and
# Cadence brings its own phonemes: stand in an empty module for it.
import types
for name in ('misaki', 'misaki.en', 'misaki.espeak'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['misaki'].en = sys.modules['misaki.en']; sys.modules['misaki'].espeak = sys.modules['misaki.espeak']
sys.modules['misaki.en'].MToken = object  # named in a type hint only
sh('nvidia-smi --query-gpu=name,memory.total --format=csv')
import torch
from kokoro import KModel
print('torch', torch.__version__, 'cuda', torch.cuda.is_available())
model = KModel(repo_id='hexgrad/Kokoro-82M').to('cuda').eval()
from huggingface_hub import hf_hub_download
import glob
corpus = glob.glob('/kaggle/input/**/corpus.jsonl', recursive=True)
print('corpus at', corpus)
rows = [json.loads(l) for l in open(corpus[0])][:50]
voices = {}
total_audio, t0 = 0.0, None
for i, r in enumerate(rows):
    v = r['voice']
    if v not in voices:
        voices[v] = torch.load(hf_hub_download('hexgrad/Kokoro-82M', f'voices/{v}.pt'), weights_only=True).to('cuda')
    ps = r['phonemes']
    ref_s = voices[v][len(ps) - 1]
    if i == 1: torch.cuda.synchronize(); t0 = time.time()
    with torch.no_grad():
        out = model(ps, ref_s, 1.0, return_output=True)
    if i >= 1: total_audio += out.audio.shape[-1] / 24000
    if i == 0: print('output fields', [k for k in dir(out) if not k.startswith('_')], 'audio', tuple(out.audio.shape), 'pred_dur', tuple(out.pred_dur.shape))
torch.cuda.synchronize()
el = time.time() - t0
print(f'49 sentences: {total_audio:.1f} s audio in {el:.1f} s, RTF {el/total_audio:.4f}')
print('voice pack shape', tuple(next(iter(voices.values())).shape))
