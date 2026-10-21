import { test } from 'node:test';
import assert from 'node:assert/strict';
import { download } from '../src/download.js';

const FILE = Uint8Array.from({ length: 10_000 }, (_, i) => i % 251);

/** A host that drops the connection part way through, `drops` times, and honours ranges. */
function flaky(drops, { ranges = true } = {}) {
  const calls = [];
  const get = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const range = init?.headers?.Range;
    calls.push(range ?? 'full');
    const from = ranges && range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
    const body = FILE.subarray(from);
    const cut = drops-- > 0 ? Math.floor(body.length / 2) : body.length;
    let sent = false;
    const stream = new ReadableStream({
      pull(c) {
        if (!sent) { sent = true; c.enqueue(body.slice(0, cut)); return; }
        if (cut < body.length) c.error(new Error('connection reset'));
        else c.close();
      },
    });
    return new Response(stream, { status: from ? 206 : 200, headers: { 'content-length': String(body.length) } });
  };
  return { get, calls };
}

test('a broken download resumes from the last byte, not from zero', async () => {
  const { get, calls } = flaky(2);
  const got = await download('https://x/model', { fetch: get, retryDelayMs: 1 });
  assert.deepEqual(got, FILE);
  assert.equal(calls[0], 'full');
  assert.match(calls[1], /^bytes=5000-$/);
  assert.equal(calls.length, 3);
});

test('a host that ignores ranges starts over and still gets the whole file', async () => {
  const { get } = flaky(1, { ranges: false });
  assert.deepEqual(await download('https://x/model', { fetch: get, retryDelayMs: 1 }), FILE);
});

test('a short file is an error, never a result', async () => {
  const truncated = async () => new Response(new ReadableStream({ start(c) { c.enqueue(FILE.slice(0, 100)); c.close(); } }), { headers: { 'content-length': String(FILE.length) } });
  await assert.rejects(download('https://x/model', { fetch: truncated, tries: 2, retryDelayMs: 1 }), /closed at 100 of 10000/);
});

test('it gives up after the last try', async () => {
  let n = 0;
  const get = async () => { n++; throw new TypeError('offline'); };
  await assert.rejects(download('https://x/model', { fetch: get, tries: 3, retryDelayMs: 1 }), /offline/);
  assert.equal(n, 3);
});

test('a local copy is used first, and its absence costs no try', async () => {
  const asked = [];
  const local = async (/** @type {string} */ u) => {
    asked.push(u);
    return u.startsWith('http://app/') ? new Response(FILE) : new Response(null, { status: 500 });
  };
  assert.deepEqual(await download('https://hf/model', { fetch: local, mirror: 'http://app/model', tries: 1 }), FILE);
  assert.deepEqual(asked, ['http://app/model']);

  asked.length = 0;
  const missing = async (/** @type {string} */ u) => {
    asked.push(u);
    return u.startsWith('http://app/') ? new Response('not found', { status: 404 }) : new Response(FILE);
  };
  assert.deepEqual(await download('https://hf/model', { fetch: missing, mirror: 'http://app/model', tries: 1 }), FILE);
  assert.deepEqual(asked, ['http://app/model', 'https://hf/model']);
});
