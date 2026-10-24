# Third-party notices

Cadence is licensed under Apache-2.0 (see `LICENSE`). It uses the components below. None
is under a copyleft licence: an app that ships Cadence carries no obligation to publish
its own source.

## Shipped with Cadence

| Component | Used for | Licence |
|---|---|---|
| CMU Pronouncing Dictionary | The pronunciation lexicon (`packages/cadence/src/data/lexicon.bin`, derived) | BSD 2-clause, reproduced below |
| ONNX Runtime Web (`onnxruntime-web`) | Running the models in the browser | MIT |
| Transformers.js (`@huggingface/transformers`) | Running the HD model | Apache-2.0 |
| ONNX Runtime Node (`onnxruntime-node`), optional | Running the fast model natively in Node | MIT |

## Downloaded at run time, not shipped

| Component | Used for | Licence |
|---|---|---|
| Piper LibriTTS-R medium voice (rhasspy/piper-voices) | Swift model weights | Trained on LibriTTS-R, CC BY 4.0 (openslr.org/141). Attribution: the LibriTTS-R corpus, Koizumi et al., 2023 |
| Kokoro-82M (onnx-community/Kokoro-82M-v1.0-ONNX) | HD model weights and voice embeddings | Apache-2.0 |

## Used only in development, never shipped

| Component | Used for | Licence |
|---|---|---|
| `phonemizer` (bundles eSpeak NG) | Reference for measuring Cadence's own phonemiser (`tools/g2p/compare.js`) | Package Apache-2.0; eSpeak NG is GPL-3.0. Not a dependency of `@cadence/engine` and not in the app bundle |
| Next.js, React | The playground app | MIT |
| Puppeteer | Benchmarks | Apache-2.0 |

## CMU Pronouncing Dictionary

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
