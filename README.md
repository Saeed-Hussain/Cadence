# Cadence

**Natural AI voices. Offline. Private. Fast. No API bills.**

A developer-first text-to-speech engine that generates natural, human-quality speech
directly on the user's device: no cloud API, no internet connection, no per-character
fee. Built to run well on the hardware people actually own, measured on a 2014 laptop.

**Status: building the MVP.** The model is chosen by measurement and speaks in a browser
playground, streaming, with the weights cached after the first visit. M1 (a reliable
engine) is built and awaiting its numbers from the reference machine: the interface steps
aside while speech generates, streams are planned and measured for gaps, the app works
offline after one visit, and broken downloads resume. M2 (the SDK) is built: one package
for the browser and Node, typed and documented ([packages/cadence/README.md](packages/cadence/README.md)).
Not yet done: licensing. The full picture is in [docs/PROPOSAL.md](docs/PROPOSAL.md).

## MVP

| | Item | Status |
|---|---|---|
| 1 | One reliable speech model | Chosen (Piper LibriTTS-R); M1 built, to be measured on the reference machine |
| 2 | Local inference engine | Working, in a Web Worker |
| 3 | Browser playground | Working |
| 4 | Simple JavaScript SDK | Built: browser and Node, types, docs, examples |
| 5 | Streaming audio | Working |
| 6 | Reproducible benchmarks | Working, published |
| 7 | Licensing and documentation | Not done |

## Run it

```
npm install
npm run web          # http://localhost:3000
npm test             # engine tests
```

## Reliability (M1)

- **Speed in the app.** While the model generates, the drifting backdrop pauses (every frame
  it moves, every glass panel must blur again), and the player re-renders once a second
  and once a waveform bar instead of every frame.
- **No gaps.** Text is planned into pieces that grow in length (`chunks` in
  `packages/cadence/src/piper.js`), so each piece is ready before the one ahead finishes
  playing. The player counts every gap it plays; each generation records them, and
  `bench:app` prints them.
- **Offline.** A service worker (`apps/web/public/sw.js`) keeps every page, the build's
  files and the runtime, listed at build time. `npm run check:offline` visits once, stops the
  server, blocks every hostname, and generates speech.
- **Failed downloads.** A broken download resumes from the last byte with a range request,
  waits for the network if it went away, and is never cached unless it arrived whole.
  Weights that will not load are dropped and fetched again; a crashed engine fails its jobs
  and can be loaded again. Retry appears where a model failed, and failed models reload
  when the network returns.

Production only: the service worker is not registered under `npm run web`.

`npm run web` and `npm run build:web` download the fast model (79 MB) once into
`.cache/models/` and the app serves it itself from `/models/`, so the browser never fetches
it from the internet: not on a new port, not in a private window, not after clearing the
cache. After one visit the playground also works with the network off
(`npm run check:offline`, against a production build).

## Speed, measured

The reference machine is the slowest one Cadence must run on: an Intel Core i5-4310U from
2014, 2 cores / 4 threads, 8 GB. Real-time factor (RTF) is seconds of compute per second
of audio; under 1 is faster than real time, and the target is under 0.3.

| Fast model (Piper LibriTTS-R) on the i5-4310U | RTF | First audio |
|---|---|---|
| Native (onnxruntime-node) | 0.132 | 200 ms |
| Browser, standalone page | 0.448 | 1.4 s |
| Browser, inside the app | 2.96 | 16.1 s |
| Browser, inside the app, animations off | 1.02 | 3.2 s |

The last two rows are the current problem: the app costs more than the model. Every
candidate, including the losers, is in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

```
npm run bench:fetch      # download the candidates' weights (once)
npm run bench            # every candidate, natively
npm run bench:browser    # the fast model in Chrome, per thread count and WebGPU
npm run bench:app        # the fast model inside the real app (build first)
npm run bench:report     # rebuild docs/BENCHMARKS.md from docs/bench/*.json
```

**The rule:** CI cannot measure speed, because it does not run on the reference machine.
No change to the engine or its models is merged without re-running the benchmarks there
and committing the regenerated `docs/BENCHMARKS.md` with it. A slower number gets
published, not hidden.

## Layout

- `packages/cadence` (`@cadence/engine`) — the engine: load, stream, preview, cancel.
  Each model runs in its own Web Worker. Plain JavaScript; no framework.
- `packages/cadence/src/voices.js` — the voice library: 904 speakers of the fast model,
  labelled from measurements (`tools/voices/measure.js`), plus 28 higher-quality voices.
- `apps/web` (`@cadence/web`) — the Next.js playground. It imports the engine; the engine
  never imports it.
- `tools/bench` — the benchmarks. `tools/lab` — listening sets for judging quality by ear.

## Third-party components

| Component | Used for | Licence |
|---|---|---|
| Piper (code) | Fast model architecture | MIT |
| Piper LibriTTS-R medium voice | Fast model weights | Dataset CC BY 4.0 (LibriTTS-R, openslr.org/141) |
| Kokoro-82M | Higher-quality model weights | Apache-2.0 |
| ONNX Runtime Web / Node | Inference runtime | MIT |
| `phonemizer` (eSpeak NG) | Text to phonemes | Package Apache-2.0; bundles eSpeak NG, which is **GPL-3.0** — under review before any paid tier |

Cadence's own licence is not chosen yet; until it is, no licence is granted.

## Documents

- [docs/PROPOSAL.md](docs/PROPOSAL.md) — vision, product, MVP, plan, risks, decisions
- [docs/PROPOSAL.pdf](docs/PROPOSAL.pdf) — the same, printed
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) — every measurement

```
powershell -ExecutionPolicy Bypass -File docs\build.ps1
```

rebuilds the PDF from the markdown (needs Node, Python, and Chrome or Edge).
