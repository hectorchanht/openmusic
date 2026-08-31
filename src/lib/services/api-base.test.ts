import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	apiUrl,
	apiFetch,
	MAX_CONCURRENT_REQUESTS,
	CIRCUIT_FAILURE_THRESHOLD,
	CIRCUIT_COOLDOWN_MS,
	__resetGovernor
} from './api-base';
import { netease } from '../sources/netease';
import type { Track } from '../sources/types';

// api-base.ts (D-03) is the single fetch seam: apiUrl() prefixes own-origin /api/* paths with
// VITE_API_BASE (empty on web → same-origin relative; the deployed Pages origin on native).
// These tests pin the two apiUrl branches, the single-fetch apiFetch funnel, and — the
// Pitfall-3 correctness proof — that a resolved Netease track.audioUrl is ABSOLUTE when a base
// is set (the URL is consumed directly by <audio>.src, so a relative URL would 404 in the APK).
// All node-runnable via vi.stubEnv / vi.stubGlobal — NO live network.

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	// The governor + circuit breaker hold module-level state (concurrency slots, in-flight dedupe,
	// failure history, open-until). Reset it so a tripped breaker in one test can never leak into the
	// next (debug-nowbar-frozen-audius-spam round 2).
	__resetGovernor();
});

describe('apiUrl — VITE_API_BASE branch', () => {
	it('returns the path unchanged when VITE_API_BASE is unset/empty (web: same-origin relative)', () => {
		vi.stubEnv('VITE_API_BASE', '');
		expect(apiUrl('/api/x')).toBe('/api/x');
	});

	it('prepends the base when VITE_API_BASE is set (native: absolute cross-origin)', () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		expect(apiUrl('/api/x')).toBe('https://base.example/api/x');
	});

	// 32-D-13: the third branch. A direct upstream call (32-D-12 routes the hot qq DETAIL call
	// straight at tang, skipping the proxy hop) passes an ALREADY-ABSOLUTE url. On web this was
	// harmless — BASE is '' so the concat was a no-op — but on the NATIVE build BASE is set, and
	// 'https://base.example' + 'https://tang…' yields 'https://base.examplehttps://tang…', where the
	// authority parses as `base.examplehttps:` with `//tang…` as its port: not a parseable URL, so
	// fetch throws a hard TypeError. The guard lives in apiUrl rather than at the qq call site so
	// EVERY present and future absolute-URL caller is covered by one check (root-cause placement).
	it('returns an ABSOLUTE url untouched even when VITE_API_BASE is set (32-D-13, the native break)', () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		const direct = 'https://tang.api.s01s.cn/music_open_api.php?type=json&mid=003aAYrm3GE0Ac';
		expect(apiUrl(direct)).toBe(direct);
		// http:// and a capitalized scheme are the same case — the guard must not be https-only or
		// case-sensitive, or a caller hits the concat path and the same TypeError comes back.
		expect(apiUrl('http://tang.api.s01s.cn/x')).toBe('http://tang.api.s01s.cn/x');
		expect(apiUrl('HTTPS://tang.api.s01s.cn/x')).toBe('HTTPS://tang.api.s01s.cn/x');
	});
});

describe('apiFetch — single fetch funnel through apiUrl', () => {
	it('calls global fetch once with the apiUrl()-prefixed URL, preserving the passed init (+ governor signal)', async () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		const spy = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 })
		);
		vi.stubGlobal('fetch', spy);

		// A POST is NOT deduped (side-effecting) — it goes straight through the governor.
		const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' } };
		await apiFetch('/api/x', init);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('https://base.example/api/x');
		// The governor now merges a timeout AbortSignal, so init is spread (not passed by reference) —
		// but method + headers are preserved verbatim and a signal is always attached.
		const passedInit = spy.mock.calls[0][1]!;
		expect(passedInit.method).toBe('POST');
		expect(passedInit.headers).toEqual({ 'content-type': 'application/json' });
		expect(passedInit.signal).toBeInstanceOf(AbortSignal);
	});

	it('uses the same-origin relative URL when the base is empty', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		const spy = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 })
		);
		vi.stubGlobal('fetch', spy);

		await apiFetch('/api/x', { method: 'POST' });

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('/api/x');
	});
});

describe('apiFetch — outbound governor (debug-nowbar-frozen-audius-spam)', () => {
	// A macrotask flush — lets ALL pending microtasks (the governor's await chain: acquireSlot →
	// fetch → releaseSlot → next waiter) settle before we assert, so timing is deterministic.
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('DEDUPE: identical concurrent GETs collapse to ONE upstream fetch; each caller reads its own clone', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		let resolveFetch!: (r: Response) => void;
		const spy = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				new Promise<Response>((res) => {
					resolveFetch = res;
				})
		);
		vi.stubGlobal('fetch', spy);

		// Fire three identical GETs while the fetch is still in flight — the spam shape.
		const p1 = apiFetch('/api/qq/detail?mid=001Bbywq2gicae');
		const p2 = apiFetch('/api/qq/detail?mid=001Bbywq2gicae');
		const p3 = apiFetch('/api/qq/detail?mid=001Bbywq2gicae');

		await tick();
		expect(spy).toHaveBeenCalledTimes(1); // collapsed to one network request

		resolveFetch(new Response('{"ok":true}', { status: 200 }));
		const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

		// Every caller gets an INDEPENDENT, readable body (clones — not the same locked stream).
		expect(await r1.json()).toEqual({ ok: true });
		expect(await r2.json()).toEqual({ ok: true });
		expect(await r3.json()).toEqual({ ok: true });
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('DEDUPE: a superseded caller rejects (AbortError) WITHOUT cancelling the shared fetch others await', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		let resolveFetch!: (r: Response) => void;
		const spy = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				new Promise<Response>((res) => {
					resolveFetch = res;
				})
		);
		vi.stubGlobal('fetch', spy);

		const ac = new AbortController();
		const aborted = apiFetch('/api/audius/search?query=Coldplay', { signal: ac.signal });
		const kept = apiFetch('/api/audius/search?query=Coldplay');

		await tick();
		expect(spy).toHaveBeenCalledTimes(1);

		ac.abort();
		await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

		// The shared fetch was NOT cancelled — the other caller still resolves normally.
		resolveFetch(new Response('{"data":[]}', { status: 200 }));
		const keptResp = await kept;
		expect(await keptResp.json()).toEqual({ data: [] });
	});

	it('CONCURRENCY CAP: never issues more than MAX_CONCURRENT_REQUESTS fetches at once', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		let inFlight = 0;
		let peak = 0;
		const releasers: Array<() => void> = [];
		const spy = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				new Promise<Response>((res) => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					releasers.push(() => {
						inFlight--;
						res(new Response('{}', { status: 200 }));
					});
				})
		);
		vi.stubGlobal('fetch', spy);

		// Fire well past the cap, all DISTINCT URLs (so dedupe does not mask the cap).
		const n = MAX_CONCURRENT_REQUESTS + 6;
		const calls = Array.from({ length: n }, (_, i) => apiFetch(`/api/audius/search?query=seed${i}`));

		await tick();
		// Only the cap is issued up front; the rest wait in the FIFO queue.
		expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS);
		expect(peak).toBe(MAX_CONCURRENT_REQUESTS);

		// Drain: releasing an in-flight fetch frees a slot that the next queued caller claims (which
		// pushes a fresh releaser), so keep pumping until every call has settled.
		let guard = 0;
		while (releasers.length && guard++ < n * 3) {
			releasers.shift()!();
			await tick();
		}
		await Promise.all(calls);
		expect(spy).toHaveBeenCalledTimes(n); // all eventually issued, none dropped
		expect(peak).toBe(MAX_CONCURRENT_REQUESTS); // and the cap was never exceeded while draining
	});
});

describe('Pitfall 3 — Netease audio/lrc URL is absolute when a base is set', () => {
	function stubTrack(): Track {
		return {
			uid: 'netease:509781655',
			source: 'netease',
			songid: '509781655',
			title: '想你就写信',
			artist: '周杰伦',
			album: '',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: '周杰伦',
			displayIndex: 1
		};
	}

	it('resolves track.audioUrl/lrcUrl to absolute https://base.example/api/... URLs', async () => {
		vi.stubEnv('VITE_API_BASE', 'https://base.example');
		// LRC fetch is best-effort; stub a plain-text body so resolve() completes.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('[00:01.00]line one', {
						status: 200,
						headers: { 'content-type': 'text/plain' }
					})
			)
		);

		const out = await netease.resolve(stubTrack(), new AbortController().signal);

		expect(out.audioUrl).toBe('https://base.example/api/netease/url?id=509781655');
		expect(out.lrcUrl).toBe('https://base.example/api/netease/lrc?id=509781655');
		expect(out.audioUrl!.startsWith('https://base.example')).toBe(true);
	});
});

describe('apiFetch — circuit breaker (debug-nowbar-frozen-audius-spam round 2)', () => {
	// Fire N failing GETs (unique URLs so dedupe never collapses them) and let them all settle.
	async function fireFailures(fetchImpl: typeof fetch, n: number): Promise<void> {
		vi.stubGlobal('fetch', fetchImpl);
		const calls = Array.from({ length: n }, (_, i) => apiFetch(`/api/x?i=${i}`).catch(() => null));
		await Promise.all(calls);
	}

	it('trips after CIRCUIT_FAILURE_THRESHOLD upstream failures and FAST-REJECTS further requests without hitting fetch', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		const netFail = vi.fn(async () => {
			throw new TypeError('network error'); // fetch reject = an upstream failure
		});
		// Exactly THRESHOLD failures → the breaker opens on the last one.
		await fireFailures(netFail as unknown as typeof fetch, CIRCUIT_FAILURE_THRESHOLD);
		const callsAtTrip = netFail.mock.calls.length;
		expect(callsAtTrip).toBe(CIRCUIT_FAILURE_THRESHOLD);

		// The breaker is OPEN: a further /api/* is fast-rejected and fetch is NOT called again.
		let rejected = false;
		await apiFetch('/api/blocked').catch(() => {
			rejected = true;
		});
		expect(rejected).toBe(true);
		expect(netFail.mock.calls.length).toBe(callsAtTrip); // no new fetch — the spam is stopped
	});

	it('does NOT trip below the threshold (a normal fan-out with a few failing sources is unaffected)', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		const netFail = vi.fn(async () => {
			throw new TypeError('network error');
		});
		await fireFailures(netFail as unknown as typeof fetch, CIRCUIT_FAILURE_THRESHOLD - 1);

		// Still CLOSED: the next request reaches fetch (not fast-rejected).
		const ok = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', ok);
		const resp = await apiFetch('/api/x?after');
		expect(resp.status).toBe(200);
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it('a caller-abort (supersede) does NOT count toward tripping the breaker', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		// POST is NOT deduped, so the governor threads the caller signal into governedFetch — this is the
		// path whose catch classifies a caller-abort as NEUTRAL (not an upstream failure). A hung fetch
		// that rejects only when its (governor timeout) signal aborts models a real in-flight supersede.
		const abortErr = () => new DOMException('Aborted', 'AbortError');
		const hung = vi.fn(
			(_url: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					const sig = init?.signal;
					if (!sig) return;
					// Real fetch rejects IMMEDIATELY when handed an already-aborted signal (a queued waiter
					// that acquires its slot after the caller aborted) — else only on a later abort event.
					if (sig.aborted) reject(abortErr());
					else sig.addEventListener('abort', () => reject(abortErr()));
				})
		);
		vi.stubGlobal('fetch', hung);

		// Fire THRESHOLD POSTs, each aborted by its OWN caller signal → all reject as caller-aborts.
		const controllers = Array.from({ length: CIRCUIT_FAILURE_THRESHOLD }, () => new AbortController());
		const calls = controllers.map((c, i) =>
			apiFetch(`/api/x?i=${i}`, { method: 'POST', signal: c.signal }).catch(() => null)
		);
		controllers.forEach((c) => c.abort());
		await Promise.all(calls);

		// Breaker must still be CLOSED — supersedes are healthy cancels, not upstream failures.
		const ok = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', ok);
		const resp = await apiFetch('/api/x?after', { method: 'POST' });
		expect(resp.status).toBe(200);
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it('recovers after the cooldown: a successful half-open probe CLOSES the breaker', async () => {
		vi.stubEnv('VITE_API_BASE', '');
		vi.useFakeTimers();
		try {
			const netFail = vi.fn(async () => {
				throw new TypeError('network error');
			});
			vi.stubGlobal('fetch', netFail as unknown as typeof fetch);
			const calls = Array.from({ length: CIRCUIT_FAILURE_THRESHOLD }, (_, i) =>
				apiFetch(`/api/x?i=${i}`).catch(() => null)
			);
			await vi.advanceTimersByTimeAsync(0); // flush the governor's await chain
			await Promise.all(calls);

			// OPEN: fast-rejected while cooling down.
			let rejected = false;
			await apiFetch('/api/still-open').catch(() => {
				rejected = true;
			});
			expect(rejected).toBe(true);

			// Advance past the cooldown → the next request is the single half-open probe.
			await vi.advanceTimersByTimeAsync(CIRCUIT_COOLDOWN_MS + 1);
			const ok = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', ok);
			const probe = apiFetch('/api/probe');
			await vi.advanceTimersByTimeAsync(0);
			expect((await probe).status).toBe(200); // probe succeeds → breaker closes

			// Closed again: subsequent requests flow normally.
			const after = apiFetch('/api/after');
			await vi.advanceTimersByTimeAsync(0);
			expect((await after).status).toBe(200);
			expect(ok).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
