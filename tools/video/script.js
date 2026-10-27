/**
 * The promo film's narration, scene by scene. One source for the voiceover
 * (spoken by Cadence HD), the captions, and the timeline.
 *
 * `pad` is silence after the line, in seconds, for the picture to breathe.
 */

export const NARRATOR = 'af_heart';

export const SCENES = [
  { id: 'hook', pad: 2.4, text: 'Still paying for ElevenLabs?' },
  { id: 'pain', pad: 0.5, text: 'Every character you generate costs you money. Every request leaves your machine. And when the internet drops, your voice goes silent.' },
  { id: 'turn', pad: 0.3, text: 'There is a better way.' },
  { id: 'logo', pad: 0.4, text: 'Meet Cadence. Natural AI voices that run entirely on your own device.' },
  { id: 'pillars', pad: 0.5, text: 'Offline. Private. Fast. And no API bill, ever.' },
  { id: 'demo', pad: 0.6, text: 'Type anything, press generate, and Cadence starts speaking in under half a second. No server. No waiting.' },
  { id: 'stream', pad: 0.5, text: 'Long scripts stream sentence by sentence, so playback begins while the rest is still being made, without a single gap.' },
  { id: 'voices', pad: 0.5, text: 'Pick from more than nine hundred voices, each one measured for pitch and pace. Warm, bright, calm, or deep. Preview any of them instantly.' },
  { id: 'hd', pad: 0.5, text: 'Need studio quality? Switch to Cadence HD for the most natural voices, like the one you are hearing right now.' },
  { id: 'speed', pad: 0.5, text: 'And it is fast. On an everyday laptop, Cadence speaks more than ten times faster than real time. Even a laptop from 2014 keeps up.' },
  { id: 'offline', pad: 0.5, text: 'Load it once, and it keeps working with the internet switched off. The model lives on your device, so nothing you type ever leaves it.' },
  { id: 'code', pad: 0.6, text: 'For developers, it takes three lines of JavaScript. Create an engine, call synthesize, and play. In the browser, or in Node.' },
  { id: 'compare', pad: 0.6, text: 'No per-character pricing. No quotas. No API keys to leak. No round trip to a server.' },
  { id: 'open', pad: 0.5, text: 'Cadence is open source, under the Apache 2 licence. Free for personal and commercial projects.' },
  { id: 'credit', pad: 0.5, text: 'Every word of this video was spoken by Cadence, running on a laptop, without the cloud.' },
  { id: 'cta', pad: 2.6, text: 'Stop paying per character. Start building with Cadence.' },
];

/** What the demo shot types into the real app. */
export const DEMO_TEXT = 'Hello! This voice was made entirely on your own computer, with no internet and no server.';
