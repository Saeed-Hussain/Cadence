/**
 * Where the fast model's weights come from, shared by the worker that
 * downloads them, the engine that reports whether they are on the device,
 * and the Node path that keeps them on disk.
 */

export const SWIFT_NAME = 'en_US-libritts_r-medium';
export const SWIFT_BASE = `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/${SWIFT_NAME}`;
export const SWIFT_FILES = [`${SWIFT_BASE}.onnx`, `${SWIFT_BASE}.onnx.json`];
export const SWIFT_BYTES = 78_580_914;

/** HD: Kokoro-82M in full precision (Apache-2.0). */
export const HD_MODEL = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx';
export const HD_BYTES = 325_532_232;
