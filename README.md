# Cadence

A speech synthesis engine that runs anywhere — text to speech and voice cloning with
every compute kernel written by hand, running on the user's own machine. Faster than
real time on a bare CPU, faster still on the GPU. 200+ built-in male and female voices,
each with a sample you can listen to before you pick it.
No API key, no server, no inference runtime imported.

**Status: the product works end to end with human-quality speech, on the Kokoro-82M
reference weights (Apache-2.0) running in the browser through ONNX Runtime Web. The
hand-written kernels (M0–M4) replace that runtime next; nothing above the engine
interface changes when they do.**

## Run it

```
npm install
npm run web          # http://localhost:3000
npm test             # engine tests
```

The first visit downloads the weights (~92 MB, 8-bit) once; the browser caches them.

## Layout

- `packages/cadence` (`@cadence/engine`) is the engine: `createEngine()` with `load`,
  streaming `synthesize`, `preview` and `clone`. Inference runs in a Web Worker
  (`src/worker.js` → `src/kokoro.js`) so the page never stutters.
- The voice library (`src/voices.js`) is 28 original voices plus blends of their style
  embeddings, 223 in all. A voice is a vector, not a model (proposal §4.1); a blend is a
  weighted average of vectors and belongs to no real person.
- Cloning is not real yet: a recording is matched by measured pitch to the nearest
  blend, and labelled as matched. True cloning needs the cloning-path model.
- `apps/web` (`@cadence/web`) is the Next.js app. It imports the engine; the engine
  never imports it.

## Speed, measured

The target machine is the slowest one Cadence has to run on: an Intel Core i5-4310U from
2014, 2 cores / 4 threads, 8 GB. If it is fast there, it is fast everywhere.

| On the i5-4310U | Real-time factor | First audio |
|---|---|---|
| Fast path, Piper LibriTTS-R, native | 0.132 | 200 ms |
| Fast path, Piper LibriTTS-R, in Chrome | 0.448 | 1.4 s |
| HD path, Kokoro-82M fp32, native | 1.43 | 3.1 s |

Under 1 is faster than real time; the target is under 0.3. Every candidate, including the
losers, is in [docs/BENCHMARKS.md](docs/BENCHMARKS.md). Closing the browser gap is what
the M2 kernels are for: 82% of the browser's time is convolution.

```
npm run bench:fetch      # download the candidates' weights (once)
npm run bench            # every candidate, natively
npm run bench:browser    # the fast path in Chrome, per thread count and WebGPU
npm run bench:report     # rebuild docs/BENCHMARKS.md from docs/bench/*.json
```

Weights live in `.cache/models/`, which is not committed.

**The rule:** CI cannot measure speed, because it does not run on the target. So no
change to the engine or its models is merged without re-running the benchmarks on the
target machine and committing the regenerated `docs/BENCHMARKS.md` with it. A slower
number gets published, not hidden.

## Start here

- [docs/PROPOSAL.md](docs/PROPOSAL.md) — the full proposal: constraint, trade-off,
  architecture, scope, schedule, metrics and risks
- [docs/PROPOSAL.pdf](docs/PROPOSAL.pdf) — the same document, printed
- `../PROJECTS-ROADMAP.md` — entry #16, where this came from

## Rebuilding the documents

```
powershell -ExecutionPolicy Bypass -File docs\build.ps1
```

Regenerates the SVG diagrams from `docs/build-diagrams.py`, renders `docs/PROPOSAL.md`
through `docs/_template.html`, and prints `docs/PROPOSAL.pdf`. Needs Node, Python, and
Chrome or Edge.
