// node examples/node.js "Anything you like." out.wav
import { createEngine } from '@cadence/engine/node';

const engine = await createEngine({ onProgress: (f) => process.stdout.write(`\rDownloading the model once · ${Math.round(f * 100)}%`) });
const { stats } = await engine.toFile(process.argv[3] ?? 'cadence.wav', { text: process.argv[2] ?? 'Hello from Cadence.' });
console.log(`\n${stats.seconds.toFixed(1)} s of speech in ${Math.round(stats.elapsedMs)} ms (RTF ${stats.rtf.toFixed(3)})`);
