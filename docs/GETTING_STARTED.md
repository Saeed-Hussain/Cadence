# Getting started with Cadence

Natural speech made on the user's own device. This guide gets you from nothing to speech
in a few minutes, in the browser or in Node.

## 1. Try the playground

```
git clone https://github.com/Saeed-Hussain/Cadence.git
cd Cadence
npm install
npm run web
```

Open the address it prints (http://localhost:3000, or the next free port). The first run
downloads the fast model (79 MB) once, into `.cache/models/`; after that it is served by
the app itself and nothing is fetched from the internet. Type something and press
**Generate speech**, or Ctrl + Enter.

For the fastest version, run the production build instead:

```
npm run build:web
npm run start --workspace @cadence/web
```

It also works offline: after one visit, switch the network off and it keeps speaking.

## 2. Speech in your own web app

```
npm install @cadence/engine
```

```js
import { createEngine } from '@cadence/engine';

const engine = createEngine();
const { samples, sampleRate } = await engine.synthesize({ text: 'Hello from Cadence.' });
```

Your app must serve two folders:

- **`/ort/`** — `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.mjs`, copied from
  `node_modules/onnxruntime-web/dist/`. See `apps/web/scripts/copy-runtime.js`.
- **`/models/`** (recommended) — `en_US-libritts_r-medium.onnx` and `.onnx.json`. Without
  them each new visitor downloads the model from Hugging Face once. See
  `apps/web/scripts/fetch-model.js`, which does this at build time.

For speed on machines with many cores, serve your pages cross-origin isolated:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

To play speech while the rest is still being made, use `onChunk` — see
`packages/cadence/examples/browser.js`.

## 3. Speech in Node

```js
import { createEngine } from '@cadence/engine/node';

const engine = await createEngine();
await engine.toFile('hello.wav', { text: 'Hello from Cadence.' });
```

For full speed, also `npm install onnxruntime-node`. Without it the engine runs on
WebAssembly and tells you so in `engine.warning`. On Windows, the native runtime needs
the Microsoft Visual C++ 2015–2022 x64 redistributable.

## 4. Choosing a voice

```js
import { VOICES } from '@cadence/engine';

const calm = VOICES.find((v) => v.model === 'swift' && v.gender === 'female' && v.tags.includes('calm'));
await engine.synthesize({ text: 'Good evening.', voice: calm });
```

There are 904 fast (Swift) voices, each labelled from measurements of pitch and pace, and
28 HD voices (Kokoro-82M, a 326 MB download, slower than real time on older machines).
A voice can also be given by id or name: `voice: 'Reader 3922'`.

## 5. What it handles

Text is cleaned up before it is spoken: numbers (`1,250`), money (`$3.50`), times (`7:45`),
dates and years (`March 3rd, 2026`), percentages, common abbreviations (`Dr.`, `e.g.`) and
acronyms (`API` is spelled out). Pronunciation comes from a 126,000-word dictionary, with
rules for words it has never seen.

## 6. Licence

Cadence is Apache-2.0: free to use in any project, commercial or not, as long as you keep
the copyright and licence notices. Nothing it ships is copyleft. See `LICENSE`, `NOTICE`
and `THIRD_PARTY_NOTICES.md`; the model weights are downloaded under their own licences,
listed there.
