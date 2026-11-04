"""
HD-Fast's back half as one ONNX file, for onnxruntime-web: Kokoro's front-half
outputs (asr, F0, N) and the voice's style in, a 24 kHz waveform out.

  features → MelNet (trained by ../melnet) → Vocos (charactr/vocos-mel-24khz) → inverse STFT

ONNX has no inverse STFT, so it is written out: one ConvTranspose1d whose
kernels are the windowed inverse-DFT basis does the transform and the
overlap-add together; a second, over ones, gives the window envelope it is
divided by. The export is checked against the same networks in PyTorch with
torch.istft, on Kokoro's real front-half output for held-out sentences.

Runs on CPU. Reads melnet.pt from the melnet job (kernel_sources); writes
hdfast-back.onnx and samples/*.wav to /kaggle/working.
"""
import glob, json, math, os, subprocess, sys, time, types, wave

subprocess.run(f'{sys.executable} -m pip install -q --no-deps --ignore-requires-python kokoro==0.9.4 loguru', shell=True, check=True)
subprocess.run(f'{sys.executable} -m pip install -q onnx onnxruntime', shell=True, check=True)
for name in ('misaki', 'misaki.en', 'misaki.espeak'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['misaki'].en = sys.modules['misaki.en']; sys.modules['misaki'].espeak = sys.modules['misaki.espeak']
sys.modules['misaki.en'].MToken = object
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
import onnx, onnxruntime as ort
from huggingface_hub import hf_hub_download
from kokoro import KModel

SR, MEL_HOP, MEL_FFT, N_MELS = 24000, 256, 1024, 100
K_HOP = 300
OUT = '/kaggle/working'
t_start = time.time()
def log(*a): print(f'[{(time.time() - t_start) / 60:6.1f} min]', *a, file=sys.stderr, flush=True)

# ─── The networks, as trained (see ../melnet/train.py) ─────────────────────
class AdaLN(nn.Module):
    def __init__(self, dim, cond=256):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim)); self.bias = nn.Parameter(torch.zeros(dim))
        self.scale = nn.Linear(cond, dim); self.shift = nn.Linear(cond, dim)
    def forward(self, x, s):
        x = F.layer_norm(x, self.weight.shape, eps=1e-6)  # the width as a constant, for the export
        return x * (self.weight + self.scale(s))[:, None] + (self.bias + self.shift(s))[:, None]

class Block(nn.Module):
    def __init__(self, dim, mid, dilation):
        super().__init__()
        self.dwconv = nn.Conv1d(dim, dim, 7, padding=3 * dilation, dilation=dilation, groups=dim)
        self.norm = AdaLN(dim)
        self.pwconv1 = nn.Linear(dim, mid); self.pwconv2 = nn.Linear(mid, dim)
        self.gamma = nn.Parameter(torch.full((dim,), 0.1))
    def forward(self, x, s):
        h = self.dwconv(x).transpose(1, 2)
        return x + (self.gamma * self.pwconv2(F.gelu(self.pwconv1(self.norm(h, s))))).transpose(1, 2)

class MelNet(nn.Module):
    def __init__(self, dim=384, mid=1152, layers=9, n_in=515, cond=256):
        super().__init__()
        self.embed = nn.Conv1d(n_in + cond, dim, 7, padding=3)
        self.blocks = nn.ModuleList(Block(dim, mid, (1, 2, 4)[i % 3]) for i in range(layers))
        self.norm = AdaLN(dim)
        self.head = nn.Linear(dim, N_MELS)
    def forward(self, x, s):
        h = self.embed(torch.cat([x, s[:, :, None].expand(-1, -1, x.shape[-1])], 1))
        for b in self.blocks: h = b(h, s)
        return self.head(self.norm(h.transpose(1, 2), s)).transpose(1, 2)

class VBlock(nn.Module):
    def __init__(self, dim=512, mid=1536):
        super().__init__()
        self.dwconv = nn.Conv1d(dim, dim, 7, padding=3, groups=dim); self.norm = nn.LayerNorm(dim, eps=1e-6)
        self.pwconv1 = nn.Linear(dim, mid); self.pwconv2 = nn.Linear(mid, dim); self.gamma = nn.Parameter(torch.ones(dim))
    def forward(self, x):
        h = self.dwconv(x).transpose(1, 2)
        return x + (self.gamma * self.pwconv2(F.gelu(self.pwconv1(self.norm(h))))).transpose(1, 2)

class Vocos(nn.Module):
    """Up to the spectrum: log magnitude and phase, [B, 1026, frames]."""
    def __init__(self):
        super().__init__()
        self.embed = nn.Conv1d(N_MELS, 512, 7, padding=3); self.norm = nn.LayerNorm(512, eps=1e-6)
        self.convnext = nn.ModuleList(VBlock() for _ in range(8)); self.final_layer_norm = nn.LayerNorm(512, eps=1e-6)
        self.out = nn.Linear(512, MEL_FFT + 2)
    def forward(self, mel):
        x = self.norm(self.embed(mel).transpose(1, 2)).transpose(1, 2)
        for b in self.convnext: x = b(x)
        return self.out(self.final_layer_norm(x.transpose(1, 2))).transpose(1, 2)

def features(asr, f0, n):
    """asr [512, T40], f0 and n [T80] → [515, frames] on the mel's time grid (as in training)."""
    frames = 1 + asr.shape[1] * 2 * K_HOP // MEL_HOP
    t = torch.arange(frames, dtype=torch.float32) * MEL_HOP
    i40 = (t / (2 * K_HOP)).long().clamp(max=asr.shape[1] - 1)
    pos = (t - K_HOP / 2) / K_HOP
    lo = pos.floor().long().clamp(0, f0.shape[0] - 1); hi = (lo + 1).clamp(max=f0.shape[0] - 1)
    w = (pos - pos.floor()).clamp(0, 1)
    lerp = lambda c: c[lo] * (1 - w) + c[hi] * w
    f = lerp(f0); voiced = (f > 40).float()
    return torch.cat([asr[:, i40], (torch.log(f.clamp(min=1.0)) / 6.0 * voiced)[None], voiced[None], (lerp(n) / 4.0)[None]], 0)

class ISTFT(nn.Module):
    """torch.istft(center=True, hann window) for a real signal, from ONNX-friendly ops."""
    def __init__(self, n_fft=MEL_FFT, hop=MEL_HOP):
        super().__init__()
        self.n_fft, self.hop = n_fft, hop
        win = torch.hann_window(n_fft, dtype=torch.float64)
        k = torch.arange(n_fft // 2 + 1, dtype=torch.float64)[:, None]; t = torch.arange(n_fft, dtype=torch.float64)[None]
        # irfft: DC and Nyquist once, the other bins twice; their imaginary parts are ignored.
        weight = torch.full_like(k, 2.0); weight[0] = weight[-1] = 1.0
        angle = 2 * math.pi * k * t / n_fft
        cos = weight * torch.cos(angle) / n_fft; sin = -weight * torch.sin(angle) / n_fft
        sin[0] = 0; sin[-1] = 0
        self.register_buffer('basis', (torch.cat([cos, sin], 0) * win)[:, None].float())   # [1026, 1, n_fft]
        self.register_buffer('win2', (win ** 2)[None, None].float())                     # [1, 1, n_fft]
    def forward(self, re, im):  # [B, 513, frames] each → [B, (frames - 1) × hop]
        y = F.conv_transpose1d(torch.cat([re, im], 1), self.basis, stride=self.hop)
        env = F.conv_transpose1d(torch.ones_like(re[:, :1]), self.win2, stride=self.hop)
        half = self.n_fft // 2
        return (y / env.clamp(min=1e-11))[:, 0, half:y.shape[-1] - half]

class Back(nn.Module):
    def __init__(self, melnet, vocos):
        super().__init__()
        self.melnet, self.vocos, self.istft = melnet, vocos, ISTFT()
    @staticmethod
    def features(asr, f0, n):
        """features() without clamps to the input's length, which tracing would fix as constants:
        the last frame is repeated instead, the only one an index past the end can reach."""
        frames = 1 + asr.shape[2] * 2 * K_HOP // MEL_HOP
        t = torch.arange(frames, dtype=torch.float32) * MEL_HOP
        i40 = (t / (2 * K_HOP)).long()
        pos = (t - K_HOP / 2) / K_HOP
        lo = pos.floor().long().clamp(min=0); hi = lo + 1
        w = (pos - pos.floor()).clamp(0, 1)
        asr = F.pad(asr, (0, 1), mode='replicate')[0]
        curves = F.pad(torch.stack([f0, n], 1), (0, 1), mode='replicate')[0]   # [2, T80 + 1]
        c = curves[:, lo] * (1 - w) + curves[:, hi] * w
        f = c[0]; voiced = (f > 40).float()
        return torch.cat([asr[:, i40], (torch.log(f.clamp(min=1.0)) / 6.0 * voiced)[None], voiced[None], (c[1] / 4.0)[None]], 0)[None]
    def forward(self, asr, f0, n, style):  # [1, 512, T40], [1, T80], [1, T80], [1, 256] → [1, samples]
        mel = self.melnet(self.features(asr, f0, n), style)
        mag, p = self.vocos(mel).chunk(2, dim=1)
        mag = torch.exp(mag).clamp(max=1e2)
        return self.istft(mag * torch.cos(p), mag * torch.sin(p))

# ─── Load ───────────────────────────────────────────────────────────────────
ck = torch.load(glob.glob('/kaggle/input/**/melnet.pt', recursive=True)[0], map_location='cpu', weights_only=False)
melnet = MelNet(**ck['config']).eval(); melnet.load_state_dict(ck['net'])
log(f"melnet from step {ck['step']}: {sum(p.numel() for p in melnet.parameters()) / 1e6:.1f} M parameters")
vocos = Vocos().eval()
sd = torch.load(hf_hub_download('charactr/vocos-mel-24khz', 'pytorch_model.bin'), map_location='cpu', weights_only=True)
r = vocos.load_state_dict({k.replace('backbone.', '').replace('head.out.', 'out.'): v for k, v in sd.items() if k.startswith(('backbone.', 'head.out.'))}, strict=False)
log(f'vocos: missing {len(r.missing_keys)}, unexpected {len(r.unexpected_keys)}')
back = Back(melnet, vocos).eval()

kokoro = KModel(repo_id='hexgrad/Kokoro-82M').eval()
vocab = kokoro.vocab
@torch.no_grad()
def front(ps, voice):
    """Kokoro up to its decoder, exactly as in the ONNX model's front half."""
    ids = [0] + [vocab[c] for c in ps if c in vocab] + [0]
    ref_s = torch.load(hf_hub_download('hexgrad/Kokoro-82M', f'voices/{voice}.pt'), weights_only=True)[len(ids) - 3]
    m = kokoro
    x = torch.LongTensor([ids]); lengths = torch.full((1,), len(ids), dtype=torch.long); mask = torch.zeros((1, len(ids)), dtype=torch.bool)
    d_en = m.bert_encoder(m.bert(x, attention_mask=(~mask).int())).transpose(-1, -2)
    s = ref_s[:, 128:]
    d = m.predictor.text_encoder(d_en, s, lengths, mask)
    h, _ = m.predictor.lstm(d)
    dur = torch.round(torch.sigmoid(m.predictor.duration_proj(h)).sum(axis=-1)).clamp(min=1).long().squeeze(0)
    idx = torch.repeat_interleave(torch.arange(len(ids)), dur)
    aln = torch.zeros((len(ids), idx.shape[0])); aln[idx, torch.arange(idx.shape[0])] = 1
    F0, N = m.predictor.F0Ntrain(d.transpose(-1, -2) @ aln[None], s)
    asr = m.text_encoder(x, lengths, mask) @ aln[None]
    return asr, F0, N, ref_s

def write_wav(path, a):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())

# ─── Check the written-out inverse STFT against torch.istft ────────────────
with torch.no_grad():
    spec = torch.randn(1, 513, 50, dtype=torch.complex64)
    ref = torch.istft(spec, MEL_FFT, MEL_HOP, MEL_FFT, torch.hann_window(MEL_FFT), center=True)
    got = ISTFT()(spec.real, spec.imag)
    log(f'inverse STFT: {tuple(got.shape)} vs {tuple(ref.shape)}, max difference {(got - ref).abs().max().item():.2e} (signal max {ref.abs().max().item():.2e})')

# ─── Export ─────────────────────────────────────────────────────────────────
test = [json.loads(l) for l in open(glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0])][:6]
asr, f0, n, style = front(test[0]['phonemes'], test[0]['voice'])
path = f'{OUT}/hdfast-back.onnx'
torch.onnx.export(back, (asr, f0, n, style), path, dynamo=False, opset_version=17,
                  input_names=['asr', 'f0', 'n', 'style'], output_names=['waveform'],
                  dynamic_axes={'asr': {2: 'frames'}, 'f0': {1: 'frames2'}, 'n': {1: 'frames2'}, 'waveform': {1: 'samples'}})
onnx.checker.check_model(onnx.load(path))
log(f'exported {os.path.getsize(path) / 1e6:.1f} MB')

# ─── Check: ONNX against PyTorch with torch.istft, on held-out sentences ───
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sess = ort.InferenceSession(path, so)
os.makedirs(f'{OUT}/samples', exist_ok=True)
seconds = took = 0.0
for r in test:
    asr, f0, n, style = front(r['phonemes'], r['voice'])
    t = time.time()
    y = sess.run(None, {'asr': asr.numpy(), 'f0': f0.numpy(), 'n': n.numpy(), 'style': style.numpy()})[0][0]
    took += time.time() - t; seconds += len(y) / SR
    with torch.no_grad():
        mel = melnet(features(asr[0], f0[0], n[0])[None], style)
        mag, p = vocos(mel).chunk(2, dim=1)
        ref = torch.istft(torch.exp(mag).clamp(max=1e2) * (torch.cos(p) + 1j * torch.sin(p)), MEL_FFT, MEL_HOP, MEL_FFT, torch.hann_window(MEL_FFT), center=True)[0].numpy()
    m = min(len(y), len(ref))
    log(f"{r['id']}: {len(y) / SR:.2f} s, ONNX vs PyTorch max difference {np.abs(y[:m] - ref[:m]).max():.2e}, length {len(y)} vs {len(ref)}")
    write_wav(f"{OUT}/samples/{r['id']}-onnx.wav", y)
log(f'ONNX on {so.intra_op_num_threads} CPU threads: {took / seconds:.3f} of real time')

# The front half's numbers, for checking the app's extracted ONNX front against.
r = test[0]; asr, f0, n, style = front(r['phonemes'], r['voice'])
np.savez(f'{OUT}/front-check.npz', phonemes=r['phonemes'], voice=r['voice'], asr=asr.numpy(), f0=f0.numpy(), n=n.numpy(), style=style.numpy())
log('done')
