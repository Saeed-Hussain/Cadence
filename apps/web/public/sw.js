/**
 * The offline shell. Keeps the app's pages, code and inference runtime, so
 * once the model's weights are in cache (the engine keeps those itself) the
 * playground works with the network off.
 *
 * Pages: the network first, so a new build shows up at once; the kept copy
 * when the network fails. Hashed build files and the runtime never change
 * under one URL, so they come from the cache first.
 * Cross-origin requests (the weights) are left alone.
 */

const SHELL = 'cadence-shell-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/sw-manifest.json', { cache: 'no-store' });
    const { version, urls } = await res.json();
    const cache = await caches.open(SHELL + version);
    // One by one, so a single missing file does not lose the rest.
    await Promise.all(urls.map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (r.ok) await cache.put(url, r);
      } catch { /* kept the next time it is fetched */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = await currentShell();
    for (const key of await caches.keys()) {
      if (key.startsWith(SHELL) && key !== current) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** The newest shell cache, by the manifest the worker installed with. */
async function currentShell() {
  const keys = (await caches.keys()).filter((k) => k.startsWith(SHELL));
  return keys.at(-1) ?? `${SHELL}none`;
}

self.addEventListener('message', (event) => {
  // URLs the page loaded before this worker controlled it.
  if (event.data?.type !== 'keep') return;
  event.waitUntil((async () => {
    const cache = await caches.open(await currentShell());
    for (const url of event.data.urls) {
      if (await cache.match(url, { ignoreSearch: true })) continue;
      try {
        const r = await fetch(url);
        if (r.ok) await cache.put(url, r);
      } catch { /* not kept */ }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // React Server Component payloads: when they fail, Next falls back to a
  // full page load, which this worker can answer from cache.
  if (req.headers.get('RSC')) return;
  if (url.pathname === '/sw.js' || url.pathname === '/sw-manifest.json') return;
  // The weights are kept by the engine's own cache; a second copy here would double 79 MB.
  if (url.pathname.startsWith('/models/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, url.pathname));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/ort/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req, req));
});

/** @param {Request} req @param {Request | string} key */
async function networkFirst(req, key) {
  const cache = await caches.open(await currentShell());
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = (await cache.match(key, { ignoreSearch: true }))
      ?? (req.mode === 'navigate' ? await cache.match('/text-to-speech') : undefined);
    if (hit) return hit;
    throw e;
  }
}

/** @param {Request} req */
async function cacheFirst(req) {
  const cache = await caches.open(await currentShell());
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}
