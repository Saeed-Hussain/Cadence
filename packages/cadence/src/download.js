/**
 * Fetch a large file once, keep it in the browser's cache, and report real
 * progress while it arrives.
 *
 * Model weights are tens of megabytes. They are downloaded on first use and
 * read from Cache Storage on every visit after, so the second load is
 * limited by the disk, not the network.
 *
 * A download that breaks part way resumes from the last byte received (an
 * HTTP range request), waits for the network if the device went offline,
 * and is never cached unless it arrived whole.
 *
 * `mirror` is a copy of the same file to try first (the app serving the
 * weights itself); the cache key is always `url`, wherever the bytes came from.
 */

export const CACHE = 'cadence-models-v1';

/**
 * @param {string} url
 * @param {{expectedBytes?: number, onProgress?: (fraction: number) => void, tries?: number,
 *   retryDelayMs?: number, fetch?: typeof fetch, mirror?: string}} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function download(url, { expectedBytes = 0, onProgress, tries = 6, retryDelayMs = 1000, fetch: get = fetch, mirror } = {}) {
  /** @type {Cache | undefined} */
  let cache;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      // A cached file of the wrong size is a leftover of an older bug; fetch it again.
      if (!expectedBytes || bytes.length === expectedBytes) {
        onProgress?.(1);
        return bytes;
      }
      await cache.delete(url);
    }
  } catch { /* no cache in this context; download every time */ }

  /** @type {Uint8Array[]} */
  let parts = [];
  let received = 0;
  let total = expectedBytes;
  let source = mirror ?? url;

  for (let attempt = 1; ; attempt++) {
    try {
      if (source === url) await online();
      const res = await get(source, received ? { headers: { Range: `bytes=${received}-` } } : undefined).catch((e) => {
        if (source !== url) return null;
        throw e;
      });
      if (source !== url && !res?.ok) {
        // No local copy: go to the origin, without spending a try.
        source = url;
        parts = [];
        received = 0;
        attempt--;
        continue;
      }
      if (!res) throw new Error(`${url}: no response`);
      if (received && res.status !== 206) {
        // The host ignored the range; start over.
        parts = [];
        received = 0;
      }
      if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
      if (!received) total = Number(res.headers.get('content-length')) || expectedBytes;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        if (total) onProgress?.(Math.min(0.99, received / total));
      }
      if (total && received !== total) throw new Error(`${url}: connection closed at ${received} of ${total} bytes`);
      const bytes = join(parts, received);
      try { await cache?.put(url, new Response(bytes.slice())); } catch { /* not cached, still usable */ }
      onProgress?.(1);
      return bytes;
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, retryDelayMs * Math.min(attempt, 5)));
    }
  }
}

/** Forget a cached file, so the next `download` fetches it again. */
export async function forget(/** @type {string} */ url) {
  try { await (await caches.open(CACHE)).delete(url); } catch { /* nothing kept */ }
}

/** Whether a file is in the cache, for showing offline readiness. */
export async function isCached(/** @type {string} */ url) {
  try { return !!(await (await caches.open(CACHE)).match(url)); } catch { return false; }
}

/** Resolves at once when online, or when the network comes back. */
function online() {
  const nav = /** @type {any} */ (globalThis).navigator;
  if (!nav || nav.onLine !== false || typeof addEventListener !== 'function') return Promise.resolve();
  return new Promise((r) => addEventListener('online', () => r(undefined), { once: true }));
}

/** @param {Uint8Array[]} parts @param {number} length */
function join(parts, length) {
  const bytes = new Uint8Array(length);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return bytes;
}
