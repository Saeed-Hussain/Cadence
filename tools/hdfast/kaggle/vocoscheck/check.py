# HD-Fast: does the training script's own Vocos and mel (copied below,
# verbatim) reproduce the official vocos package? Same input, both ways. CPU.
import glob, os, subprocess, sys, wave
subprocess.run(f'{sys.executable} -m pip install -q vocos', shell=True)
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from huggingface_hub import hf_hub_download
from vocos import Vocos as PackageVocos
SR, MEL_HOP, MEL_FFT, N_MELS = 24000, 256, 1024, 100
dev = 'cpu'
main = False  # the training script's copy check needs its data; not here
def log(*a): print(*a, flush=True)
# Vocos's mel (torchaudio's MelSpectrogram: HTK scale, no norm, power 1, centred, reflect padding), then log.
def mel_basis():
    mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0); hz = lambda m: 700.0 * (10 ** (m / 2595.0) - 1.0)
    f_pts = hz(np.linspace(mel(0.0), mel(SR / 2), N_MELS + 2))
    freqs = np.linspace(0, SR // 2, MEL_FFT // 2 + 1)
    f_diff = f_pts[1:] - f_pts[:-1]
    slopes = f_pts[None, :] - freqs[:, None]
    down = -slopes[:, :-2] / f_diff[:-1]; up = slopes[:, 2:] / f_diff[1:]
    return torch.tensor(np.maximum(0, np.minimum(down, up)).T, dtype=torch.float32)  # [100, 513]
FB = mel_basis().to(dev); WIN = torch.hann_window(MEL_FFT).to(dev)
def logmel(y):  # y [B, samples] → [B, 100, frames]
    spec = torch.stft(y, MEL_FFT, MEL_HOP, MEL_FFT, WIN, center=True, pad_mode='reflect', return_complex=True).abs()
    return torch.log((FB @ spec).clamp(min=1e-7))

class VBlock(nn.Module):
    def __init__(self, dim=512, mid=1536):
        super().__init__()
        self.dwconv = nn.Conv1d(dim, dim, 7, padding=3, groups=dim); self.norm = nn.LayerNorm(dim, eps=1e-6)
        self.pwconv1 = nn.Linear(dim, mid); self.pwconv2 = nn.Linear(mid, dim); self.gamma = nn.Parameter(torch.ones(dim))
    def forward(self, x):
        h = self.dwconv(x).transpose(1, 2)
        return x + (self.gamma * self.pwconv2(F.gelu(self.pwconv1(self.norm(h))))).transpose(1, 2)
class Vocos(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Conv1d(N_MELS, 512, 7, padding=3); self.norm = nn.LayerNorm(512, eps=1e-6)
        self.convnext = nn.ModuleList(VBlock() for _ in range(8)); self.final_layer_norm = nn.LayerNorm(512, eps=1e-6)
        self.out = nn.Linear(512, MEL_FFT + 2)
        self.register_buffer('window', torch.hann_window(MEL_FFT), persistent=False)
    def forward(self, mel):  # [B, 100, T] → [B, samples]; the "same" padding inverse STFT Vocos uses
        x = self.norm(self.embed(mel).transpose(1, 2)).transpose(1, 2)
        for b in self.convnext: x = b(x)
        x = self.out(self.final_layer_norm(x.transpose(1, 2))).transpose(1, 2)
        mag, p = x.chunk(2, dim=1)
        S = torch.exp(mag).clamp(max=1e2) * (torch.cos(p) + 1j * torch.sin(p))
        T = S.shape[-1]; pad = (MEL_FFT - MEL_HOP) // 2
        frames = torch.fft.irfft(S, MEL_FFT, dim=1, norm='backward') * self.window[None, :, None]
        size = (T - 1) * MEL_HOP + MEL_FFT
        y = F.fold(frames, (1, size), (1, MEL_FFT), stride=(1, MEL_HOP))[:, 0, 0, pad:-pad]
        env = F.fold(self.window.square().expand(1, T, -1).transpose(1, 2), (1, size), (1, MEL_FFT), stride=(1, MEL_HOP)).squeeze()[pad:-pad]
        return y / env
vocos = Vocos().to(dev).eval()
sd = torch.load(hf_hub_download('charactr/vocos-mel-24khz', 'pytorch_model.bin'), map_location='cpu', weights_only=True)
vs = {k.replace('backbone.', '').replace('head.out.', 'out.'): v for k, v in sd.items() if k.startswith(('backbone.', 'head.out.'))}
missing = vocos.load_state_dict(vs, strict=False)
log(f'vocos loaded; missing {len(missing.missing_keys)}, unexpected {len(missing.unexpected_keys)}')
if main:
    # This Vocos and this mel must reproduce what the vocos package did (copysynth job: L1 about 0.14).
    with torch.no_grad():
        y = torch.from_numpy(train[0]['audio'].astype(np.float32) / 32768).to(dev)[None]
        y_hat = vocos(logmel(y))
        n = min(y.shape[1], y_hat.shape[1])
        log(f'copy check: mel L1 between Kokoro and Vocos(Kokoro mel) {F.l1_loss(logmel(y_hat[:, :n]), logmel(y[:, :n])).item():.3f}')


def load(p):
    w = wave.open(p); return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
def save(p, a):
    with wave.open(p, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
pkg = PackageVocos.from_pretrained('charactr/vocos-mel-24khz').eval()
os.makedirs('/kaggle/working/check', exist_ok=True)
for f in sorted(glob.glob('/kaggle/input/**/teacher/test/*.wav', recursive=True))[:6]:
    y = torch.from_numpy(load(f))[None]
    with torch.no_grad():
        m_pkg = pkg.feature_extractor(y); m_mine = logmel(y)
        a_pkg = pkg.decode(m_pkg)[0]; a_mine = vocos(m_mine)[0]; a_cross = vocos(m_pkg)[0]
    n = min(len(a_pkg), len(a_mine))
    log(f"{os.path.basename(f)}: mel frames {m_pkg.shape[-1]} vs {m_mine.shape[-1]}, mel max diff {(m_pkg - m_mine).abs().max():.5f}; "
        f"audio length {len(a_pkg)} vs {len(a_mine)}, audio max diff {(a_pkg[:n] - a_mine[:n]).abs().max():.5f}, "
        f"same mel through both networks {(a_pkg[:n] - a_cross[:n]).abs().max():.5f}")
    save(f"/kaggle/working/check/{os.path.basename(f)[:-4]}-mine.wav", a_mine.numpy())
log('package config:', open(hf_hub_download('charactr/vocos-mel-24khz', 'config.yaml')).read())
