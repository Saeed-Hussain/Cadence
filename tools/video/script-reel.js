/**
 * The vertical reel (TikTok, Instagram Reels, YouTube Shorts): the same story,
 * cut to under a minute. Every number is one Cadence measured itself:
 * 451 ms to first audio and 10.7× faster than real time are from the
 * playground on a Ryzen 5 7430U; 904 Swift voices; Apache-2.0.
 */

export const NARRATOR = 'af_heart';

export const SCENES = [
  { id: 'hook', pad: 1.6, text: 'Still paying for ElevenLabs?' },
  { id: 'pain', pad: 0.4, text: 'Every character costs you money, and every word leaves your device.' },
  { id: 'logo', pad: 0.4, text: 'Meet Cadence. Natural AI voices that run on your own device, for free.' },
  { id: 'demo', pad: 0.5, text: 'Type anything, tap generate, and it starts speaking in under half a second.' },
  { id: 'voices', pad: 0.4, text: 'Nine hundred voices. Warm, bright, calm, or deep.' },
  { id: 'offline', pad: 0.4, text: 'No internet? It still works, and nothing you type leaves your device.' },
  { id: 'speed', pad: 0.4, text: 'It speaks more than ten times faster than real time, right in your browser.' },
  { id: 'code', pad: 0.4, text: 'Developers, it is three lines of JavaScript.' },
  { id: 'open', pad: 0.4, text: 'Open source, Apache 2. Free for commercial use.' },
  { id: 'credit', pad: 0.4, text: 'And this whole voiceover? Made by Cadence.' },
  { id: 'cta', pad: 2.4, text: 'Stop paying per character. Try Cadence today.' },
];

export const DEMO_TEXT = 'Hello! This voice was made entirely on your own device, with no internet and no server.';
