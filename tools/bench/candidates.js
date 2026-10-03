/**
 * Everything M0 measures, and the text it measures with.
 *
 * The same three passages for every candidate: one short sentence (what time
 * to first audio feels like), two sentences, and a paragraph (what sustained
 * speed feels like).
 */

export const CORPUS = {
  short: 'Hello, and welcome to Cadence.',
  medium: 'The lighthouse keeper had not seen a ship in eleven years. So when the lamp caught a sail on the horizon, she did not believe it.',
  long:
    'Speech synthesis has always lived on a server, because that is where the computers were fast. ' +
    'But the laptop on your desk is faster than the servers that first made it possible. ' +
    'Cadence runs the whole model here, on your own machine, with nothing sent anywhere. ' +
    'If it is fast on the slowest computer we can find, it will be fast on yours.',
};

export const MODELS_DIR = new URL('../../.cache/models/', import.meta.url);

/**
 * @typedef {{id: string, family: 'kokoro' | 'piper', label: string, dtype?: string, file?: string, params: string}} Candidate
 * @type {Candidate[]}
 */
export const CANDIDATES = [
  { id: 'piper-lessac-low', family: 'piper', label: 'Piper · Lessac · low', file: 'en_US-lessac-low', params: '~5M' },
  { id: 'piper-lessac-medium', family: 'piper', label: 'Piper · Lessac · medium', file: 'en_US-lessac-medium', params: '~15M' },
  { id: 'piper-libritts_r-medium', family: 'piper', label: 'Piper · LibriTTS-R · medium (904 speakers)', file: 'en_US-libritts_r-medium', params: '~15M' },
  { id: 'piper-lessac-high', family: 'piper', label: 'Piper · Lessac · high', file: 'en_US-lessac-high', params: '~28M' },
  { id: 'kokoro-q8', family: 'kokoro', label: 'Kokoro-82M · int8', dtype: 'q8', params: '82M' },
  { id: 'kokoro-q4', family: 'kokoro', label: 'Kokoro-82M · int4', dtype: 'q4', params: '82M' },
  { id: 'kokoro-fp32', family: 'kokoro', label: 'Kokoro-82M · fp32', dtype: 'fp32', params: '82M' },
];
