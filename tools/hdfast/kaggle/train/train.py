# HD-Fast week 2: the fast decoder.
#
# Kokoro spends 94.5% of its time in its decoder, the stage that turns the
# aligned phoneme features, pitch and energy into a waveform (profile job). The
# rest (text understanding, pacing, pitch) costs 5% and is what makes it sound
# natural, so it stays. This trains a Vocos-style decoder in its place: a
# ConvNeXt stack at 80 frames a second, conditioned on the voice, predicting
# a spectrum turned into audio by an inverse STFT. It starts from the
# pretrained Vocos (MIT, trained on real speech) and learns to reproduce
# Kokoro's audio for all 28 voices, with Vocos's losses: mel L1, then multi-
# period and multi-resolution discriminators.
#
# Inputs per frame (80 a second, 300 samples each), as Kokoro's decoder gets them:
#   asr     512  text-encoder features, expanded by the phoneme durations (40/s, repeated)
#   F0      1+1  log pitch and a voiced flag
#   energy  1    Kokoro's N curve
#   style   128  the voice's decoder style vector, also through adaptive layer norms
#
# Runs on both GPUs (one process each, DistributedDataParallel), in half
# precision where it is safe, and stops itself before the session ends. A
# checkpoint from an earlier session, given as an input, is resumed.
import glob, json, math, os, random, subprocess, sys, time, types, wave

HOURS = float(os.environ.get('HDFAST_HOURS', '11.5'))  # session budget (Kaggle stops a session at 12 h)
SMOKE = HOURS < 1            # a short run that checks every code path, the discriminators included
SEG = 48                     # frames per training segment: 48 × 300 = 14,400 samples, 0.6 s
BATCH = 16                   # per GPU
MEL_ONLY_STEPS = 150 if SMOKE else 20000  # fast steps on mel loss alone before the discriminators start
RESERVE = 120 if SMOKE else 1200          # seconds kept for saving and samples at the end
LOG_EVERY = 50 if SMOKE else 500
SAVE_EVERY = 5000
LR = 2e-4
HOP, NFFT, SR = 300, 1024, 24000
OUT = '/kaggle/working'

if '--worker' not in sys.argv:
    # The launcher: install, then one training process per GPU.
    subprocess.run(f'{sys.executable} -m pip install -q --no-deps --ignore-requires-python kokoro==0.9.4 loguru', shell=True, check=True)
    import torch
    n = max(1, torch.cuda.device_count())
    code = subprocess.run([sys.executable, '-m', 'torch.distributed.run', f'--nproc_per_node={n}', os.path.abspath(__file__), '--worker']).returncode
    sys.exit(code)

for name in ('misaki', 'misaki.en', 'misaki.espeak'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['misaki'].en = sys.modules['misaki.en']; sys.modules['misaki'].espeak = sys.modules['misaki.espeak']
sys.modules['misaki.en'].MToken = object
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.nn.utils import weight_norm
from huggingface_hub import hf_hub_download
from kokoro import KModel

rank = int(os.environ.get('LOCAL_RANK', 0)); world = int(os.environ.get('WORLD_SIZE', 1))
dist.init_process_group('nccl')
torch.cuda.set_device(rank)
dev = f'cuda:{rank}'
main = rank == 0
torch.manual_seed(rank); random.seed(1000 + rank); np.random.seed(rank)
t_start = time.time()
# Progress goes to stderr: under torch.distributed.run, Kaggle's live log
# shows the workers' stderr as it happens but their stdout only at the end.
def log(*a):
    if main: print(f'[{(time.time() - t_start) / 60:6.1f} min]', *a, file=sys.stderr, flush=True)
log(f'{world} worker(s) started')

# A heartbeat every minute, and a watchdog: if training makes no progress for
# ten minutes, stop the job instead of letting it hold the GPUs until the
# session limit.
import threading
stage = 'loading'
step = 0
def heartbeat():
    last, since = -1, time.time()
    while True:
        time.sleep(60)
        if step != last: last, since = step, time.time()
        log(f'heartbeat: {stage}, step {step}')
        if stage == 'training' and time.time() - since > 600:
            log(f'no progress for 10 minutes at step {step}: stopping')
            os._exit(3)
if main: threading.Thread(target=heartbeat, daemon=True).start()

# ─── Teacher: Kokoro's front half (frozen) ──────────────────────────────────
kokoro = KModel(repo_id='hexgrad/Kokoro-82M').to(dev).eval()
for p in kokoro.parameters(): p.requires_grad_(False)
vocab = kokoro.vocab
packs = {}
def pack(v):
    if v not in packs:
        packs[v] = torch.load(hf_hub_download('hexgrad/Kokoro-82M', f'voices/{v}.pt'), weights_only=True).to(dev)
    return packs[v]
def ids_of(ps): return [0] + [vocab[c] for c in ps if c in vocab] + [0]
def style_of(voice, ids): return pack(voice)[len(ids) - 3][:, :128]  # [1, 128], the decoder's half

def tokens(ids):
    x = torch.LongTensor([ids]).to(dev)
    return x, torch.full((1,), len(ids), device=dev, dtype=torch.long), torch.zeros((1, len(ids)), dtype=torch.bool, device=dev)

@torch.no_grad()
def front(ps, voice):
    """Everything Kokoro computes before its decoder, for a sentence not in the teacher data."""
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
    return asr, F0[0], N[0], ref_s[:, :128]

def features(asr, f0, n):
    """[512, T40], [T80], [T80] → [515, T80]: the decoder's input frames."""
    a = asr.repeat_interleave(2, dim=-1)
    voiced = (f0 > 40).float()
    lf0 = torch.log(f0.clamp(min=1.0)) / 6.0 * voiced
    return torch.cat([a, lf0[None], voiced[None], n[None] / 4.0], dim=0)

# ─── Data: the teacher shards ───────────────────────────────────────────────
shards = sorted(glob.glob('/kaggle/input/**/teacher/shard_*.npz', recursive=True))
assert shards, 'no teacher shards found'
data = []
for path in shards:
    z = np.load(path)
    audio, ao = z['audio'], z['audio_off']
    dur, do = z['dur'], z['dur_off']
    f0, en, co = z['f0'], z['energy'], z['curve_off']
    for i in range(len(z['ids'])):
        data.append({
            'voice': str(z['voices'][i]), 'ps': str(z['phonemes'][i]),
            'audio': audio[ao[i]:ao[i + 1]], 'dur': dur[do[i]:do[i + 1]].astype(np.int64),
            'f0': f0[co[i]:co[i + 1]], 'energy': en[co[i]:co[i + 1]],
        })
log(f'{len(data)} sentences from {len(shards)} shards, {sum(len(d["audio"]) for d in data) / SR / 3600:.1f} h, {world} GPUs')
random.Random(0).shuffle(data)  # the same split on every GPU
long_enough = lambda d: 2 * int(d['dur'].sum()) >= SEG + 2
val, train = [d for d in data[:64] if long_enough(d)], [d for d in data[64:] if long_enough(d)]

@torch.no_grad()
def segment(d):
    # The text encoder runs on the whole sentence (it reads in both directions), then a window is cut.
    x, lengths, mask = tokens(ids_of(d['ps']))
    t_en = kokoro.text_encoder(x, lengths, mask)[0]
    asr = torch.repeat_interleave(t_en, torch.from_numpy(d['dur']).to(dev), dim=1)  # [512, T40]
    s80 = 2 * random.randint(0, (2 * asr.shape[1] - SEG) // 2)
    x = features(asr[:, s80 // 2:(s80 + SEG) // 2],
                 torch.from_numpy(d['f0'][s80:s80 + SEG].astype(np.float32)).to(dev),
                 torch.from_numpy(d['energy'][s80:s80 + SEG].astype(np.float32)).to(dev))
    y = torch.from_numpy(d['audio'][s80 * HOP:(s80 + SEG) * HOP].astype(np.float32) / 32768).to(dev)
    return x, style_of(d['voice'], ids_of(d['ps']))[0], y

def batch(pool, n=BATCH):
    got = [segment(random.choice(pool)) for _ in range(n)]
    return tuple(torch.stack([g[i] for g in got]) for i in range(3))

# ─── The decoder ────────────────────────────────────────────────────────────
class AdaLN(nn.Module):
    """LayerNorm whose scale and shift follow the voice (starts as a plain LayerNorm)."""
    def __init__(self, dim, cond=128):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim)); self.bias = nn.Parameter(torch.zeros(dim))
        self.scale = nn.Linear(cond, dim); self.shift = nn.Linear(cond, dim)
        for l in (self.scale, self.shift): nn.init.zeros_(l.weight); nn.init.zeros_(l.bias)
    def forward(self, x, s):  # x [B, T, C]
        x = F.layer_norm(x, x.shape[-1:], eps=1e-6)
        return x * (self.weight + self.scale(s))[:, None] + (self.bias + self.shift(s))[:, None]

class Block(nn.Module):
    def __init__(self, dim, mid):
        super().__init__()
        self.dwconv = nn.Conv1d(dim, dim, 7, padding=3, groups=dim)
        self.norm = AdaLN(dim)
        self.pwconv1 = nn.Linear(dim, mid); self.pwconv2 = nn.Linear(mid, dim)
        self.gamma = nn.Parameter(torch.full((dim,), 1e-6))
    def forward(self, x, s):  # x [B, C, T]
        h = self.dwconv(x).transpose(1, 2)
        h = self.pwconv2(F.gelu(self.pwconv1(self.norm(h, s))))
        return x + (self.gamma * h).transpose(1, 2)

class Decoder(nn.Module):
    def __init__(self, dim=512, mid=1536, layers=8, n_in=515, cond=128):
        super().__init__()
        self.embed = nn.Conv1d(n_in + cond, dim, 7, padding=3)
        self.in_norm = AdaLN(dim)
        self.blocks = nn.ModuleList(Block(dim, mid) for _ in range(layers))
        self.final_norm = AdaLN(dim)
        self.head = nn.Linear(dim, NFFT + 2)
        self.register_buffer('window', torch.hann_window(NFFT), persistent=False)
    def spectrum(self, x, s):  # → log-magnitude and phase, [B, 513, T] each
        h = self.embed(torch.cat([x, s[:, :, None].expand(-1, -1, x.shape[-1])], 1))
        h = self.in_norm(h.transpose(1, 2), s).transpose(1, 2)
        for b in self.blocks: h = b(h, s)
        h = self.head(self.final_norm(h.transpose(1, 2), s)).transpose(1, 2)
        return h.float().chunk(2, dim=1)
    def forward(self, x, s):
        mag, p = self.spectrum(x, s)
        with torch.autocast('cuda', enabled=False):
            S = torch.exp(mag).clamp(max=1e2) * torch.exp(1j * p)
            return torch.istft(S, NFFT, HOP, NFFT, self.window, center=True, length=x.shape[-1] * HOP)

G = Decoder().to(dev)
sd = torch.load(hf_hub_download('charactr/vocos-mel-24khz', 'pytorch_model.bin'), map_location='cpu', weights_only=True)
mine = G.state_dict(); loaded = 0
for k, v in sd.items():
    t = (k.replace('backbone.convnext.', 'blocks.').replace('backbone.final_layer_norm.', 'final_norm.')
          .replace('backbone.norm.', 'in_norm.').replace('head.out.', 'head.'))
    if t in mine and mine[t].shape == v.shape:
        mine[t] = v; loaded += 1
G.load_state_dict(mine)
log(f'decoder: {sum(p.numel() for p in G.parameters()) / 1e6:.1f} M parameters, {loaded} tensors from pretrained Vocos')

# ─── Discriminators (HiFi-GAN periods, UnivNet resolutions), as in Vocos ───
class DiscP(nn.Module):
    def __init__(self, period):
        super().__init__()
        self.period = period
        ch = [1, 32, 128, 512, 1024]
        self.convs = nn.ModuleList([weight_norm(nn.Conv2d(ch[i], ch[i + 1], (5, 1), (3, 1), padding=(2, 0))) for i in range(4)]
                                   + [weight_norm(nn.Conv2d(1024, 1024, (5, 1), 1, padding=(2, 0)))])
        self.post = weight_norm(nn.Conv2d(1024, 1, (3, 1), 1, padding=(1, 0)))
    def forward(self, y):
        b, t = y.shape
        if t % self.period: y = F.pad(y, (0, self.period - t % self.period), 'reflect'); t = y.shape[1]
        x = y.view(b, 1, t // self.period, self.period)
        fm = []
        for c in self.convs: x = F.leaky_relu(c(x), 0.1); fm.append(x)
        x = self.post(x); fm.append(x)
        return x.flatten(1), fm

class DiscR(nn.Module):
    def __init__(self, n_fft, hop):
        super().__init__()
        self.n_fft, self.hop = n_fft, hop
        self.register_buffer('window', torch.hann_window(n_fft), persistent=False)
        self.convs = nn.ModuleList([weight_norm(nn.Conv2d(1, 32, (3, 9), padding=(1, 4)))]
                                   + [weight_norm(nn.Conv2d(32, 32, (3, 9), stride=(1, 2), padding=(1, 4))) for _ in range(3)]
                                   + [weight_norm(nn.Conv2d(32, 32, (3, 3), padding=(1, 1)))])
        self.post = weight_norm(nn.Conv2d(32, 1, (3, 3), padding=(1, 1)))
    def forward(self, y):
        with torch.autocast('cuda', enabled=False):
            x = torch.stft(y.float(), self.n_fft, self.hop, self.n_fft, self.window, return_complex=True).abs()[:, None].transpose(2, 3)
        fm = []
        for c in self.convs: x = F.leaky_relu(c(x), 0.1); fm.append(x)
        x = self.post(x); fm.append(x)
        return x.flatten(1), fm

class Discriminators(nn.Module):
    def __init__(self):
        super().__init__()
        self.all = nn.ModuleList([DiscP(p) for p in (2, 3, 5, 7, 11)] + [DiscR(n, h) for n, h in ((512, 128), (1024, 256), (2048, 512))])
    def forward(self, y):  # one pass over real and generated audio together
        outs, fms = [], []
        for d in self.all:
            o, fm = d(y); outs.append(o); fms.append(fm)
        return outs, fms

D = Discriminators().to(dev)

# ─── Losses ─────────────────────────────────────────────────────────────────
def mel_basis(n_mels=100, n_fft=1024, sr=SR):
    hz = lambda m: 700 * (10 ** (m / 2595) - 1); mel = lambda f: 2595 * math.log10(1 + f / 700)
    pts = torch.tensor([hz(m) for m in np.linspace(mel(0), mel(sr / 2), n_mels + 2)])
    bins = torch.linspace(0, sr / 2, n_fft // 2 + 1)
    fb = torch.zeros(n_mels, n_fft // 2 + 1)
    for i in range(n_mels):
        lo, c, hi = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = torch.clamp(torch.minimum((bins - lo) / (c - lo), (hi - bins) / (hi - c)), min=0)
    return fb
MEL = {n: (mel_basis(n_fft=n).to(dev), torch.hann_window(n).to(dev)) for n in (512, 1024, 2048)}
def logmel(y, n_fft=1024):
    fb, w = MEL[n_fft]
    spec = torch.stft(y.float(), n_fft, n_fft // 4, n_fft, w, return_complex=True).abs()
    return torch.log((fb @ spec).clamp(min=1e-5))
def mel_loss(y_hat, y):  # three resolutions, so neither timing nor pitch detail is favoured
    with torch.autocast('cuda', enabled=False):
        return sum(F.l1_loss(logmel(y_hat, n), logmel(y, n)) for n in (512, 1024, 2048)) / 3

opt_g = torch.optim.AdamW(G.parameters(), LR, betas=(0.8, 0.99))
opt_d = torch.optim.AdamW(D.parameters(), LR, betas=(0.8, 0.99))
scaler_g = torch.amp.GradScaler('cuda'); scaler_d = torch.amp.GradScaler('cuda')
prev = sorted(glob.glob('/kaggle/input/**/hdfast-ckpt.pt', recursive=True))
if prev:
    ck = torch.load(prev[-1], map_location=dev, weights_only=False)
    G.load_state_dict(ck['G']); D.load_state_dict(ck['D'])
    opt_g.load_state_dict(ck['opt_g']); opt_d.load_state_dict(ck['opt_d']); step = ck['step']
    log(f'resumed at step {step} from {prev[-1]}')
Gd = DDP(G, device_ids=[rank]); Dd = DDP(D, device_ids=[rank])

def save():
    if not main: return
    torch.save({'G': G.state_dict(), 'D': D.state_dict(), 'opt_g': opt_g.state_dict(), 'opt_d': opt_d.state_dict(), 'step': step},
               f'{OUT}/hdfast-ckpt.pt')
    torch.save({'G': G.state_dict(), 'step': step, 'config': {'dim': 512, 'mid': 1536, 'layers': 8, 'hop': HOP, 'n_fft': NFFT}},
               f'{OUT}/hdfast-decoder.pt')

def write_wav(path, a):
    a = (np.clip(a, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(a.tobytes())

test = [json.loads(l) for l in open(glob.glob('/kaggle/input/**/test.jsonl', recursive=True)[0])][:6]
@torch.no_grad()
def samples():
    if not main: return 0.0
    G.eval()
    os.makedirs(f'{OUT}/samples', exist_ok=True)
    for r in test:
        asr, f0, n, s = front(r['phonemes'], r['voice'])
        y = G(features(asr, f0, n)[None], s)[0].float().cpu().numpy()
        write_wav(f"{OUT}/samples/{r['id']}-student.wav", y)
    state = random.getstate(); random.seed(7)
    x, s, y = batch(val, 32)
    random.setstate(state)
    v = mel_loss(G(x, s), y).item()
    G.train()
    return v

log(f'training for {HOURS} h from step {step}: {world} × batch {BATCH} × {SEG * HOP} samples')
t_last = time.time(); acc = {}; n_acc = 0
stage = 'training'
while True:
    if step % 50 == 0:
        # Every GPU stops at the same step.
        flag = torch.tensor([float(time.time() - t_start > HOURS * 3600 - RESERVE)], device=dev)
        dist.all_reduce(flag, op=dist.ReduceOp.MAX)
        if flag.item(): break
    x, s, y = batch(train)
    gan = step >= MEL_ONLY_STEPS
    with torch.autocast('cuda', dtype=torch.float16):
        y_hat = Gd(x, s)
    if gan:
        opt_d.zero_grad(set_to_none=True)
        with torch.autocast('cuda', dtype=torch.float16):
            outs, _ = Dd(torch.cat([y, y_hat.detach()]))
            loss_d = sum(F.relu(1 - o[:BATCH].float()).mean() + F.relu(1 + o[BATCH:].float()).mean() for o in outs)
        scaler_d.scale(loss_d).backward(); scaler_d.step(opt_d); scaler_d.update()
        acc['d'] = acc.get('d', 0) + loss_d.item()
    opt_g.zero_grad(set_to_none=True)
    lm = mel_loss(y_hat, y)
    loss_g = 45 * lm
    if gan:
        with torch.autocast('cuda', dtype=torch.float16):
            outs, fms = Dd(torch.cat([y, y_hat]))
            adv = sum(F.relu(1 - o[BATCH:].float()).mean() for o in outs)
            fm = sum(F.l1_loss(f[BATCH:].float(), f[:BATCH].detach().float()) for fs in fms for f in fs)
        loss_g = loss_g + adv + 2 * fm
        acc['adv'] = acc.get('adv', 0) + adv.item(); acc['fm'] = acc.get('fm', 0) + fm.item()
    scaler_g.scale(loss_g).backward(); scaler_g.step(opt_g); scaler_g.update()
    acc['mel'] = acc.get('mel', 0) + lm.item(); n_acc += 1
    step += 1
    if step % LOG_EVERY == 0:
        el = time.time() - t_last; t_last = time.time()
        log(f'step {step}: ' + ' '.join(f'{k} {v / n_acc:.3f}' for k, v in acc.items()) + f' · {n_acc / el:.2f} it/s')
        acc = {}; n_acc = 0
    if step % SAVE_EVERY == 0:
        save()
        log(f'step {step}: validation mel {samples():.4f}, saved')
        dist.barrier()

stage = 'finishing'
save()
log(f'finished at step {step}: validation mel {samples():.4f}')
if main:
    # The teacher's audio for the same test sentences, to listen side by side.
    for r in test:
        src = glob.glob(f"/kaggle/input/**/teacher/test/{r['id']}.wav", recursive=True)
        if src: subprocess.run(['cp', src[0], f"{OUT}/samples/{r['id']}-teacher.wav"])
    log('done')
dist.barrier()
dist.destroy_process_group()
