/// <reference types="@sveltejs/kit" />
//
// THIN WRAPPER (OFFL-01). This service worker is the runtime shell over the
// node-tested pure core in `src/lib/services/sw-cache.ts` — the same wrapper /
// pure-core seam as `sleepTimer.svelte.ts` wrapping `sleep-timer.ts`. All the
// branchy, security-load-bearing bypass logic (what must NEVER be cached:
// `/api/*` live metadata, cross-origin audio CDN bytes, 206 range streams,
// non-GET) lives in `shouldBypass`; this file does NOT reimplement it.
import { build, files, version } from '$service-worker';
import { shouldBypass, cacheNameFor } from '$lib/services/sw-cache';

const sw = globalThis.self as unknown as ServiceWorkerGlobalScope;

const CACHE = cacheNameFor(version); // `cache-${version}` — rotates per deploy (T-24-02)
const ASSETS = [...build, ...files]; // app bundle + static/ files

// install — precache the app shell into the version-keyed cache.
sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
		})()
	);
});

// activate — OFFL-01 stale-shell eviction: delete every cache whose name is
// not the current version cache, so a new deploy cannot serve a stale shell.
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
		})()
	);
});

// fetch — delegate the bypass decision to the pure, unit-tested `shouldBypass`.
// A single early return is the entire contract (T-24-01); no inline bypass branches.
sw.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (shouldBypass(url, event.request, sw.location.origin)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// cache-first for known shell assets
			if (ASSETS.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}
			// otherwise network, caching successful (200) same-origin responses
			try {
				const res = await fetch(event.request);
				// Only cache basic, non-redirected, same-origin 200 responses. `Cache.put()`
				// THROWS a TypeError on a redirect-followed response (`res.redirected === true`)
				// or a non-basic response — a 3xx trailing-slash/SSR/edge redirect resolves to a
				// 200 with `redirected === true`, and putting it would reject `respondWith` and
				// surface a network error on the primary app-shell path (CR-01). Guard the type +
				// redirect flag, and `.catch()` the put so a cache-write failure can never reject
				// the response we return.
				if (res.status === 200 && res.type === 'basic' && !res.redirected) {
					const copy = res.clone();
					void cache.put(event.request, copy).catch(() => {});
				}
				return res;
			} catch {
				const hit = await cache.match(event.request);
				if (hit) return hit;
				throw new Error('offline and not cached');
			}
		})()
	);
});
