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

## Measured on this machine

Intel Core i5-4310U (2014, 2 cores / 4 threads), Node, 8-bit weights: real-time factor
about 3.2–3.5, i.e. slower than real time. Playback streams sentence by sentence so
audio starts before the whole text is done. Modern CPUs and WebGPU are far faster;
that gap is what the M2 SIMD kernels exist to close.

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
