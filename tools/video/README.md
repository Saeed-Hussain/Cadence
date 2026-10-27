# The Cadence promo film

A 1080p promo, narrated by Cadence itself (HD, voice Heart), in the playground's light theme.

```
npm run build:web
npm run video:prepare   # narration spoken by Cadence + screenshots of the real app
npm run video           # renders video/Cadence - Still paying for ElevenLabs.mp4
```

- `script.js` — the narration, scene by scene. Edit a line, run both steps again.
- `film.html`, `film.css`, `film.js` — the film: sixteen scenes timed to the narration,
  captions, and a synthesized music bed that ducks under the voice.
- `export.js` — headless: renders the soundtrack offline, captures every painted frame,
  encodes H.264 with WebCodecs, and muxes a fast-start MP4 (`mp4.js`).
- `verify.js`, `frames.js` — checks on the finished file.

Output goes to `video/` (git-ignored).
