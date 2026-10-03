# Benchmarks

Measured with `npm run bench`, natively (onnxruntime-node), on named hardware. Every
candidate is shown, including the ones that lose. Regenerated from `docs/bench/*.json`;
do not edit by hand.

**RTF** is real-time factor: seconds of compute per second of audio. Under 1 is faster
than real time. The proposal's target is under 0.3. **First audio** is the time until
the first sentence of the short passage is ready.

Text: short "Hello, and welcome to Cadence." · medium, two sentences · long, four sentences.
Median of five runs after one warm-up.

## Intel Core i5-4310U · 4 threads · 8 GB RAM

Windows_NT 10.0.22631 · Node v22.17.1

| Model | Params | RTF long | RTF short | First audio | Load | Peak memory |
|---|---|---|---|---|---|---|
| Piper · Lessac · low | ~5M | **0.098** ✅ | 0.105 | 193 ms | 2.3 s | 376 MB |
| Piper · Lessac · medium | ~15M | **0.126** ✅ | 0.129 | 246 ms | 2.3 s | 429 MB |
| Piper · LibriTTS-R · medium (904 speakers) | ~15M | **0.132** ✅ | 0.142 | 200 ms | 3.2 s | 450 MB |
| Piper · Lessac · high | ~28M | **0.910** ✔︎ | 0.773 | 1570 ms | 3.2 s | 570 MB |
| Kokoro-82M · fp32 | 82M | **1.434** ✗ | 1.475 | 3051 ms | 3.9 s | 806 MB |
| Kokoro-82M · int4 | 82M | **1.586** ✗ | 1.345 | 2753 ms | 2.4 s | 801 MB |
| Kokoro-82M · int8 | 82M | **2.873** ✗ | 2.789 | 5774 ms | 2.5 s | 479 MB |

✅ meets the target (< 0.3) · ✔︎ faster than real time · ✗ slower than real time
