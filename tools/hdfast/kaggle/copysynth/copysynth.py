# HD-Fast week 2, the ceiling of the two-stage design: can the pretrained
# Vocos (charactr/vocos-mel-24khz, MIT) turn Cadence HD's own spectrograms back
# into audio that sounds like Cadence HD? If it can, a model that predicts
# those spectrograms is all HD-Fast needs. CPU only.
import glob, os, subprocess, sys, time, wave
subprocess.run(f'{sys.executable} -m pip install -q vocos', shell=True)
import numpy as np, torch
from vocos import Vocos

def load(p):
    w = wave.open(p); return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
def save(p, a):
    with wave.open(p, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())

vocos = Vocos.from_pretrained('charactr/vocos-mel-24khz').eval()
print('vocos parameters', sum(p.numel() for p in vocos.parameters()) / 1e6, 'M')
os.makedirs('/kaggle/working/copy', exist_ok=True)
files = sorted(glob.glob('/kaggle/input/**/teacher/test/*.wav', recursive=True))[:12]
torch.set_num_threads(4)
total, el = 0.0, 0.0
for f in files:
    y = torch.from_numpy(load(f))[None]
    t0 = time.time()
    with torch.no_grad():
        mel = vocos.feature_extractor(y)
        y_hat = vocos.decode(mel)[0].numpy()
    el += time.time() - t0; total += y.shape[1] / 24000
    name = os.path.basename(f)[:-4]
    save(f'/kaggle/working/copy/{name}-vocos.wav', y_hat)
    subprocess.run(['cp', f, f'/kaggle/working/copy/{name}-teacher.wav'])
print(f'{len(files)} files, {total:.1f} s of audio; Vocos on 4 CPU threads: RTF {el / total:.3f} (spectrogram included)')
