# Cadence

A speech synthesis engine that runs anywhere — text to speech and voice cloning with
every compute kernel written by hand, running on the user's own machine. Faster than
real time on a bare CPU, faster still on the GPU. 200+ built-in male and female voices,
each with a sample you can listen to before you pick it.
No API key, no server, no inference runtime imported.

**Status: the frontend is built and runs end to end against a stub backend. The
hand-written kernels (M0–M4) are next.**

## Run it

```
npm install
npm run web          # http://localhost:3000
npm test             # engine tests
```

## Layout

- `packages/cadence` (`@cadence/engine`) is the engine interface: `createEngine()`
  with `load`, `synthesize`, `preview` and `clone`, plus the voice library as data.
  The backend today is `src/stub.js`, a small formant synthesiser. It produces the
  shape of speech (syllables, pitch, pauses, a distinct timbre per voice) and no
  real words. When the real backend replaces it, nothing above the interface changes.
- `apps/web` (`@cadence/web`) is the Next.js app: Home, Text to Speech, Voice Library,
  Voice Cloning, Studio, History, and Engine & Benchmarks. It imports the engine;
  the engine never imports it.

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
