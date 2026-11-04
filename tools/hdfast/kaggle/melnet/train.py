# HD-Fast, stage 1: Kokoro's features to Kokoro's spectrogram.
#
# Kokoro spends 94.5% of its time in its decoder. The pretrained Vocos
# (charactr/vocos-mel-24khz, MIT) turns Kokoro's own mel spectrograms back into
# audio a listener cannot tell from Kokoro's (copysynth job), about 20× faster.
# So HD-Fast is: Kokoro's front half (unchanged: text, pacing, pitch) → this
# small network (features to mel) → Vocos.
#
# The first attempt, a Vocos-style network producing audio straight from the
# features, sounded robotic and buzzy: it had to invent the harmonic structure
# a mel spectrogram already carries. Predicting the mel is an easier task, and
# Kokoro is deterministic, so every target is sharp and consistent; plain L1
# on the log mel needs no discriminators.
#
# Inputs, resampled to the mel's 93.75 frames a second (hop 256):
#   asr     512  text-encoder features expanded by the durations (nearest)
#   F0      1+1  log pitch and a voiced flag (linear)
#   energy  1    Kokoro's N curve (linear)
#   style   256  the voice's whole style vector, also through adaptive layer norms
import glob, json, math, os, random, subprocess, sys, threading, time, types, wave

HOURS = float(os.environ.get('HDFAST_HOURS', '4'))
SMOKE = HOURS < 1
SEG = 128                    # mel frames per training segment: 128 × 256 = 32,768 samples, 1.4 s
BATCH = 32                   # per GPU
RESERVE = 150 if SMOKE else 900
LOG_EVERY = 100 if SMOKE else 500
SAVE_EVERY = 1000 if SMOKE else 5000
LR = 5e-4
SR, MEL_HOP, MEL_FFT, N_MELS = 24000, 256, 1024, 100
K_HOP = 300                  # Kokoro's F0 frames: 80 a second
OUT = '/kaggle/working'

if '--worker' not in sys.argv:
    subprocess.run(f'{sys.executable} -m pip install -q --no-deps --ignore-requires-python kokoro==0.9.4 loguru', shell=True, check=True)
    import torch
    n = max(1, torch.cuda.device_count())
    sys.exit(subprocess.run([sys.executable, '-m', 'torch.distributed.run', f'--nproc_per_node={n}', os.path.abspath(__file__), '--worker']).returncode)

for name in ('misaki', 'misaki.en', 'misaki.espeak'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['misaki'].en = sys.modules['misaki.en']; sys.modules['misaki'].espeak = sys.modules['misaki.espeak']
sys.modules['misaki.en'].MToken = object
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from huggingface_hub import hf_hub_download
from kokoro import KModel

rank = int(os.environ.get('LOCAL_RANK', 0)); world = int(os.environ.get('WORLD_SIZE', 1))
dist.init_process_group('nccl')
torch.cuda.set_device(rank)
dev = f'cuda:{rank}'
main = rank == 0
torch.manual_seed(rank); random.seed(1000 + rank)
t_start = time.time()
def log(*a):  # stderr: Kaggle's live log shows the workers' stderr as it happens
    if main: print(f'[{(time.time() - t_start) / 60:6.1f} min]', *a, file=sys.stderr, flush=True)
stage, step = 'loading', 0
def heartbeat():  # and stops the job if training stalls for ten minutes
    last, since = -1, time.time()
    while True:
        time.sleep(60)
        if step != last: last, since = step, time.time()
        log(f'heartbeat: {stage}, step {step}')
        if stage == 'training' and time.time() - since > 600:
            log(f'no progress for 10 minutes at step {step}: stopping'); os._exit(3)
if main: threading.Thread(target=heartbeat, daemon=True).start()
log(f'{world} worker(s) started')

# ─── Kokoro's front half (frozen) ───────────────────────────────────────────
kokoro = KModel(repo_id='hexgrad/Kokoro-82M').to(dev).eval()
for p in kokoro.parameters(): p.requires_grad_(False)
vocab = kokoro.vocab
packs = {}
def pack(v):
    if v not in packs:
        packs[v] = torch.load(hf_hub_download('hexgrad/Kokoro-82M', f'voices/{v}.pt'), weights_only=True).to(dev)
    return packs[v]
def ids_of(ps): return [0] + [vocab[c] for c in ps if c in vocab] + [0]
def tokens(ids):
    return (torch.LongTensor([ids]).to(dev), torch.full((1,), len(ids), device=dev, dtype=torch.long),
            torch.zeros((1, len(ids)), dtype=torch.bool, device=dev))

@torch.no_grad()
def front(ps, voice):
    """Kokoro up to its decoder, for a sentence outside the teacher data."""
    ids = ids_of(ps); ref_s = pack(voice)[len(ids) - 3]
    m = kokoro
    x, lengths, mask = tokens(ids)
    d_en = m.bert_encoder(m.bert(x, attention_mask=(~mask).int())).transpose(-1, -2)
    s = ref_s[:, 128:]
    d = m.predictor.text_encoder(d_en, s, lengths, mask)
    h, _ = m.predictor.lstm(d)
    dur = torch.round(torch.sigmoid(m.predictor.duration_proj(h)).sum(axis=-1)).clamp(min=1).long().squeeze(0)
    idx = torch.repeat_interleave(torch.arange(len(ids), device=dev), dur)
    aln = torch.zeros((len(ids), idx.shape[0]), device=dev); aln[idx, torch.arange(idx.shape[0])] = 1
    F0, N = m.predictor.F0Ntrain(d.transpose(-1, -2) @ aln[None], s)
    asr = (m.text_encoder(x, lengths, mask) @ aln[None])[0]
    return asr, F0[0], N[0], ref_s[0]

def mel_frames(n_samples): return 1 + n_samples // MEL_HOP  # center=True

def features(asr, f0, n, frames):
    """asr [512, T40], f0 and n [T80] → [515, frames] on the mel's time grid."""
    t = torch.arange(frames, device=asr.device, dtype=torch.float32) * MEL_HOP   # each mel frame's centre, in samples
    i40 = (t / (2 * K_HOP)).long().clamp(max=asr.shape[1] - 1)                   # the phoneme frame it falls in
    pos = (t - K_HOP / 2) / K_HOP                                                 # between F0 frame centres
    lo = pos.floor().long().clamp(0, f0.shape[0] - 1); hi = (lo + 1).clamp(max=f0.shape[0] - 1)
    w = (pos - pos.floor()).clamp(0, 1)
    lerp = lambda c: c[lo] * (1 - w) + c[hi] * w
    f = lerp(f0); voiced = (f > 40).float()
    return torch.cat([asr[:, i40], (torch.log(f.clamp(min=1.0)) / 6.0 * voiced)[None], voiced[None], (lerp(n) / 4.0)[None]], 0)

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

# ─── Data ───────────────────────────────────────────────────────────────────
shards = sorted(glob.glob('/kaggle/input/**/teacher/shard_*.npz', recursive=True))
assert shards, 'no teacher shards found'
data = []
for path in shards:
    z = np.load(path)
    audio, ao, dur, do, f0, en, co = z['audio'], z['audio_off'], z['dur'], z['dur_off'], z['f0'], z['energy'], z['curve_off']
    for i in range(len(z['ids'])):
        data.append({'voice': str(z['voices'][i]), 'ps': str(z['phonemes'][i]), 'audio': audio[ao[i]:ao[i + 1]],
                     'dur': dur[do[i]:do[i + 1]].astype(np.int64), 'f0': f0[co[i]:co[i + 1]], 'energy': en[co[i]:co[i + 1]]})
log(f'{len(data)} sentences from {len(shards)} shards, {sum(len(d["audio"]) for d in data) / SR / 3600:.1f} h, {world} GPUs')
random.Random(0).shuffle(data)
long_enough = lambda d: mel_frames(len(d['audio'])) >= SEG + 2
val, train = [d for d in data[:64] if long_enough(d)], [d for d in data[64:] if long_enough(d)]

@torch.no_grad()
def example(d, crop=True):
    x, lengths, mask = tokens(ids_of(d['ps']))
    asr = torch.repeat_interleave(kokoro.text_encoder(x, lengths, mask)[0], torch.from_numpy(d['dur']).to(dev), dim=1)
    y = torch.from_numpy(d['audio'].astype(np.float32) / 32768).to(dev)
    target = logmel(y[None])[0]                                         # [100, frames]
    feats = features(asr, torch.from_numpy(d['f0'].astype(np.float32)).to(dev),
                     torch.from_numpy(d['energy'].astype(np.float32)).to(dev), target.shape[1])
    style = pack(d['voice'])[len(ids_of(d['ps'])) - 3][0]
    if crop:
        s = random.randint(0, target.shape[1] - SEG)
        feats, target = feats[:, s:s + SEG], target[:, s:s + SEG]
    return feats, style, target

def batch(pool, n=BATCH):
    got = [example(random.choice(pool)) for _ in range(n)]
    return tuple(torch.stack([g[i] for g in got]) for i in range(3))

def mel_loss(pred, y):
    # L1 alone lets the network blur harmonics into each other, which a vocoder
    # turns into buzz. The differences along time and along frequency must
    # match as well: that keeps onsets sharp and each harmonic its own peak.
    dt = lambda m: m[..., 1:] - m[..., :-1]
    df = lambda m: m[:, 1:] - m[:, :-1]
    return F.l1_loss(pred, y) + 0.5 * F.l1_loss(dt(pred), dt(y)) + 0.5 * F.l1_loss(df(pred), df(y))

# ─── The network ────────────────────────────────────────────────────────────
class AdaLN(nn.Module):
    def __init__(self, dim, cond=256):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim)); self.bias = nn.Parameter(torch.zeros(dim))
        self.scale = nn.Linear(cond, dim); self.shift = nn.Linear(cond, dim)
        for l in (self.scale, self.shift): nn.init.zeros_(l.weight); nn.init.zeros_(l.bias)
    def forward(self, x, s):
        x = F.layer_norm(x, x.shape[-1:], eps=1e-6)
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
    """ConvNeXt blocks with dilations 1, 2, 4 repeating: about 0.9 s of context each side."""
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

net = MelNet().to(dev)
log(f'mel network: {sum(p.numel() for p in net.parameters()) / 1e6:.1f} M parameters')

# ─── Vocos, for listening (the same network as the vocos package) ──────────
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
    def forward(self, mel):  # [B, 100, T] → [B, samples]: a centred inverse STFT, as charactr/vocos-mel-24khz's config says
        x = self.norm(self.embed(mel).transpose(1, 2)).transpose(1, 2)
        for b in self.convnext: x = b(x)
        x = self.out(self.final_layer_norm(x.transpose(1, 2))).transpose(1, 2)
        mag, p = x.float().chunk(2, dim=1)
        S = torch.exp(mag).clamp(max=1e2) * (torch.cos(p) + 1j * torch.sin(p))
        return torch.istft(S, MEL_FFT, MEL_HOP, MEL_FFT, self.window, center=True)
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

def write_wav(path, a):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())

# ─── Training ───────────────────────────────────────────────────────────────
opt = torch.optim.AdamW(net.parameters(), LR, betas=(0.9, 0.98), weight_decay=0.01)
scaler = torch.amp.GradScaler('cuda')
prev = sorted(glob.glob('/kaggle/input/**/melnet-ckpt.pt', recursive=True))
if prev:
    ck = torch.load(prev[-1], map_location=dev, weights_only=False)
    net.load_state_dict(ck['net']); opt.load_state_dict(ck['opt']); step = ck['step']
    log(f'resumed at step {step}')
netd = DDP(net, device_ids=[rank])
# Warm up, then a cosine down to a tenth, over the steps this session should manage (about 3.9 a second).
first_step = step
total_steps_guess = int(HOURS * 3600 * 3.9)
sched = lambda s: min(1.0, (s - first_step + 1) / 1000) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1.0, (s - first_step) / max(1, total_steps_guess)))))

test = [json.loads(l) for l in open(glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0])][:6]
@torch.no_grad()
def evaluate(final=False):
    if not main: return 0.0
    net.eval()
    os.makedirs(f'{OUT}/samples', exist_ok=True)
    for r in test:
        asr, f0, n, s = front(r['phonemes'], r['voice'])
        frames = mel_frames(asr.shape[1] * 2 * K_HOP)
        mel = net(features(asr, f0, n, frames)[None], s[None])
        write_wav(f"{OUT}/samples/{r['id']}-fast.wav", vocos(mel)[0].float().cpu().numpy())
        if final:
            src = glob.glob(f"/kaggle/input/**/teacher/test/{r['id']}.wav", recursive=True)
            if src: subprocess.run(['cp', src[0], f"{OUT}/samples/{r['id']}-teacher.wav"])
    state = random.getstate(); random.seed(7)
    x, s, y = batch(val, 32)
    random.setstate(state)
    v = F.l1_loss(net(x, s), y).item()  # plain L1, comparable across runs
    net.train()
    return v

def save():
    if main:
        torch.save({'net': net.state_dict(), 'opt': opt.state_dict(), 'step': step}, f'{OUT}/melnet-ckpt.pt')
        torch.save({'net': net.state_dict(), 'step': step, 'config': {'dim': 384, 'mid': 1152, 'layers': 9}}, f'{OUT}/melnet.pt')

log(f'training for {HOURS} h from step {step}: {world} × batch {BATCH} × {SEG} mel frames')
stage = 'training'
t_last = time.time(); acc = 0.0; n_acc = 0
while True:
    if step % 50 == 0:
        flag = torch.tensor([float(time.time() - t_start > HOURS * 3600 - RESERVE)], device=dev)
        dist.all_reduce(flag, op=dist.ReduceOp.MAX)
        if flag.item(): break
    for g in opt.param_groups: g['lr'] = LR * sched(step)
    x, s, y = batch(train)
    with torch.autocast('cuda', dtype=torch.float16):
        pred = netd(x, s)
    loss = mel_loss(pred.float(), y)
    opt.zero_grad(set_to_none=True)
    scaler.scale(loss).backward()
    scaler.unscale_(opt)
    torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
    scaler.step(opt); scaler.update()
    acc += loss.item(); n_acc += 1; step += 1
    if step % LOG_EVERY == 0:
        el = time.time() - t_last; t_last = time.time()
        log(f'step {step}: mel L1 {acc / n_acc:.4f} · lr {LR * sched(step):.2e} · {n_acc / el:.2f} it/s')
        acc = 0.0; n_acc = 0
    if step % SAVE_EVERY == 0:
        save(); log(f'step {step}: validation mel L1 {evaluate():.4f}, saved'); dist.barrier()

stage = 'finishing'
save()
log(f'finished at step {step}: validation mel L1 {evaluate(final=True):.4f}')
dist.barrier()
dist.destroy_process_group()
