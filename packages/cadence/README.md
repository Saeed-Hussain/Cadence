# @cadence/engine

Natural speech, made on the user's own device: no API key, no server, no per-character fee.
904 voices in one 79 MB model, faster than real time on a 2014 laptop CPU.

## In the browser

```js
import { createEngine } from '@cadence/engine';

const engine = createEngine();
const { samples, sampleRate } = await engine.synthesize({ text: 'Hello from Cadence.' });
```

Inference runs in a Web Worker, so the page never blocks. The first call downloads the
model once; after that it loads from the browser's cache. To play audio as it is made,
pass `onChunk` — each piece arrives in order and can be scheduled end to end
([examples/browser.js](examples/browser.js)).

**Your app serves two things:**

| Path | What | How |
|---|---|---|
| `/ort/` | `ort-wasm-simd-threaded.wasm` and `.mjs` from `onnxruntime-web` | copy from `node_modules/onnxruntime-web/dist/` at build time |
| `/models/` *(optional)* | `en_US-libritts_r-medium.onnx` and `.onnx.json` | served by your app, the model never comes from the internet; without them it is fetched from Hugging Face once |

For multi-threaded WebAssembly, serve the page cross-origin isolated
(`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`).
One thread is the default; on two-core machines it measured fastest.

## In Node

```js
import { createEngine } from '@cadence/engine/node';

const engine = await createEngine();
await engine.toFile('hello.wav', { text: 'Hello from Cadence.' });
```

Install `onnxruntime-node` alongside for the native runtime (3× faster than the browser
on the reference machine). Without it — or when it will not load, as on Windows without
the Visual C++ 2015–2022 redistributable — the engine runs on WebAssembly and says so in
`engine.warning`. Weights are kept in `~/.cache/cadence` (or `$CADENCE_MODELS`, or the
`dir` option) and downloaded once.

## API

Full types are in [index.d.ts](index.d.ts) and [node.d.ts](node.d.ts).

| Browser `createEngine({ wasmPaths, modelPaths })` | |
|---|---|
| `synthesize({ text, voice?, settings?: { speed }, onChunk?, signal? })` | Speech. `voice` is a `Voice`, an id or a name. Resolves `{ samples, sampleRate, stats }`, or `null` when aborted. |
| `load(model?)` | Start a model ahead of time (`'swift'` default, `'hd'` for Kokoro-82M). Safe to call again after a failure. |
| `subscribe(fn)` | Load state per model: `status`, `progress`, `phase` (`download`, `cache`, `init`), `error`. |
| `onDevice(model)` | Whether the weights are stored on this device. |
| `preview(voice)` | A voice's audition sample, rendered once and cached. |

| Node `await createEngine({ dir, threads, runtime, onProgress })` | |
|---|---|
| `synthesize({ text, voice?, speed?, onChunk?, signal? })` | Speech, as above. Swift voices. |
| `toFile(path, request)` | Speech straight to a WAV file. |
| `backend`, `warning` | `native` or `wasm`, and why when not native. |

`VOICES` lists every voice with its measured pitch, pace and labels; `encodeWav(samples,
sampleRate)` makes a WAV file.

## Streaming

Text is spoken in pieces (`chunks`): a short first piece for quick first audio, then
longer ones, sized so each is ready before the one ahead of it finishes playing.

## Licence

Not chosen yet; until it is, no licence is granted. The phonemiser bundles eSpeak NG
(GPL-3.0), under review — see the repository README.
