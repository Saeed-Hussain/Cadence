# HD-Fast

The goal: a voice model that sounds **better than Cadence HD** (Kokoro-82M) and
runs at about **Swift's speed** in the browser. It is trained for free on Kaggle's
GPUs and published under a permissive licence.

## How

A small student model (about 10–20M parameters) learns two things from two sources.

- **What to say, and how: Kokoro.** For every sentence, Kokoro gives the phoneme
  durations (pacing) and the pitch and loudness curves (intonation) it chose.
  Kokoro's weights are Apache-2.0, so learning from what it produces is allowed.
- **How it sounds: real people.** The stage that turns acoustic features into a
  waveform is trained on human recordings. It follows Vocos, whose pretrained
  24 kHz weights are MIT-licensed. Kokoro's own waveform stage is the slowest part
  of it, and the noisiest in small students.

The student runs in Swift's worker pool (see `swiftPool` in the engine).

## Data

| Source | Licence | Used for |
|---|---|---|
| 26 Project Gutenberg books | Public domain | Sentences |
| Generated modern sentences, the project's own prose | Ours | Sentences: numbers, dates, money, technology |
| Kokoro-82M, all 28 English voices | Apache-2.0 | Audio, durations, pitch and loudness for every sentence |
| LJSpeech | Public domain | Real speech for the waveform stage |
| LibriTTS-R | CC BY 4.0 | Real speech, many speakers |
| Hi-Fi TTS | CC BY 4.0 | Studio-quality real speech |

## Steps

1. `node tools/hdfast/corpus.js` builds `.cache/hdfast/dataset/`:
   - 23,764 training sentences, about 39 hours of speech;
   - 300 held-out sentences, kept for the final comparison;
   - every sentence phonemised by Cadence's own front end, with one of the 28
     voices assigned in turn.

   The dataset is uploaded as the private Kaggle dataset `cadence-hdfast-text`.
2. `kaggle/teacher/gen.py` (Kaggle, two T4 GPUs) has Kokoro read every sentence,
   and writes shards of audio, durations, pitch and loudness. It also writes the
   held-out sentences as WAV files. On a T4, Kokoro runs at 0.05 of real time
   (`kaggle/probe/probe.py`).
3. Training. Kokoro's front half (everything before its decoder) is kept
   frozen. `kaggle/melnet/train.py` trains MelNet, a 12.1M ConvNeXt, to predict
   Kokoro's spectrogram from the front half's outputs. The pretrained Vocos
   (charactr/vocos-mel-24khz) then turns that spectrogram into sound.
   - Training took 4 h on two T4s and reached a validation mel L1 of 0.326.
   - `kaggle/vocoscheck` and `kaggle/copysynth` check that Vocos reproduces
     Kokoro faithfully.
   - `kaggle/train` is the first design, a direct waveform decoder. It was
     dropped because it sounded robotic.
4. `kaggle/export/export.py` exports the back half to ONNX. The back half is
   the features, MelNet, Vocos and an inverse STFT written out in the graph.
   It is checked against PyTorch. The front half is cut from Kokoro's ONNX at
   its decoder inputs (asr, F0 and N).
5. `kaggle/quantize/quantize.py` quantizes the back half to 8 bits: 38 MB,
   1.55× faster in WebAssembly, and it sounds the same. The front half breaks
   in 8 bits, even with only ALBERT quantized, so it stays float32.
6. `node tools/hdfast/bench.js` compares the result with Kokoro whole on this
   machine: 8× faster on a Ryzen 5 7430U.
   - In the app, HD runs as HD-Fast when `public/models/hdfast/` holds both
     files (`apps/web/scripts/fetch-model.js` copies them in). Otherwise it
     runs as Kokoro whole, as it also does with `?hd=whole`.
   - The two halves run on separate threads, so consecutive pieces overlap.
   - A 100-sentence paragraph takes 36–40 s once warm.
   - A pool of whole HD-Fast workers was slower in the app; see `speakPool`.
   - Still to do: public hosting and the blind A/B test against Cadence HD.

Run a job with `python -m kaggle kernels push -p tools/hdfast/kaggle/<job>`. This
needs a Kaggle API token in `~/.kaggle/access_token`.
