import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolveEntry } from '$lib/proxy/resolve-cache';

// The client MUST route every call through the apiFetch governor (a raw /api/* fetch is the named
// `api-fetch-flood-freeze` root cause), so mocking that ONE seam gives full control of every
// failure mode the 31-D-08 posture has to swallow. vi.hoisted so the spy exists before vi.mock's
// hoisted factory runs.
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('$lib/services/api-base', () => ({ apiFetch }));

import {
	readResolveCache,
	reportDeadUrl,
	__resetResolveCacheClient
} from './resolve-cache-client';

const ENTRY: ResolveEntry = {
	source: 'kuwo',
	songid: '123',
	url: 'https://cdn.example/song-123.mp3',
	avail: { kuwo: 'ok' }
};

const jsonRes = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	apiFetch.mockReset();
	__resetResolveCacheClient();
});

describe('readResolveCache (31-D-08 — advisory, never authoritative)', () => {
	it('returns the entry on a { hit: true, entry } response', async () => {
		apiFetch.mockResolvedValue(jsonRes({ hit: true, entry: ENTRY }));

		const got = await readResolveCache('Nirvana', 'Come As You Are');

		expect(got).toEqual(ENTRY);
		expect(apiFetch).toHaveBeenCalledTimes(1);
		const [path, init] = apiFetch.mock.calls[0];
		// Own-origin PATH (never an absolute URL — apiFetch's contract), both terms encoded.
		expect(path).toBe('/api/resolve?a=Nirvana&t=Come%20As%20You%20Are');
		// Bounded: a caller-signal + timeout combination is always threaded.
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('returns the entry even when it is a cached known-none (url null, avail dry)', async () => {
		// D-06(c): a clean "kuwo is dry" negative is the POINT of the avail layer — it must reach the
		// caller so the source walk can skip that source, NOT be flattened to a miss.
		const dry: ResolveEntry = { source: null, songid: null, url: null, avail: { kuwo: 'dry' } };
		apiFetch.mockResolvedValue(jsonRes({ hit: true, entry: dry }));

		await expect(readResolveCache('a', 't')).resolves.toEqual(dry);
	});

	it('returns null on { hit: false }', async () => {
		apiFetch.mockResolvedValue(jsonRes({ hit: false }));

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null on a 404 (an APK pointing at a deploy without the route)', async () => {
		apiFetch.mockResolvedValue(jsonRes({ error: 'not found' }, 404));

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null on a 500', async () => {
		apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 500));

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null on malformed JSON', async () => {
		apiFetch.mockResolvedValue(new Response('not json{', { status: 200 }));

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null when apiFetch rejects mid-flight (caller abort / own timeout)', async () => {
		apiFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null when the circuit breaker is OPEN (fast-reject AbortError)', async () => {
		apiFetch.mockRejectedValue(
			new DOMException('api-base: circuit open — upstream failing, backing off', 'AbortError')
		);

		await expect(readResolveCache('a', 't')).resolves.toBeNull();
	});

	it('returns null with ZERO fetches when the caller signal is already aborted', async () => {
		const ac = new AbortController();
		ac.abort();

		await expect(readResolveCache('a', 't', ac.signal)).resolves.toBeNull();
		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('returns null with ZERO fetches when artist and title are both blank', async () => {
		await expect(readResolveCache('   ', '')).resolves.toBeNull();
		expect(apiFetch).not.toHaveBeenCalled();
	});
});

describe('reportDeadUrl (31-D-09 / 31-D-11 — self-gating bust)', () => {
	it('is a silent no-op for a URL the cache never served', () => {
		reportDeadUrl('https://never-served.example/x.mp3');

		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('POSTs the served terms exactly once, however many times it is called', async () => {
		apiFetch.mockResolvedValue(jsonRes({ hit: true, entry: ENTRY }));
		await readResolveCache('Nirvana', 'Come As You Are');
		apiFetch.mockReset();
		apiFetch.mockResolvedValue(jsonRes({ busted: true }));

		reportDeadUrl(ENTRY.url as string);
		reportDeadUrl(ENTRY.url as string);
		reportDeadUrl(ENTRY.url as string);

		expect(apiFetch).toHaveBeenCalledTimes(1);
		const [path, init] = apiFetch.mock.calls[0];
		expect(path).toBe('/api/resolve');
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
		expect(JSON.parse(init.body)).toEqual({ a: 'Nirvana', t: 'Come As You Are' });
	});

	it('never throws and returns void when the POST rejects', async () => {
		apiFetch.mockResolvedValue(jsonRes({ hit: true, entry: ENTRY }));
		await readResolveCache('Nirvana', 'Come As You Are');
		apiFetch.mockReset();
		apiFetch.mockRejectedValue(new Error('network down'));

		expect(reportDeadUrl(ENTRY.url as string)).toBeUndefined();
		expect(apiFetch).toHaveBeenCalledTimes(1);
		// let the rejected fire-and-forget settle — an unhandled rejection would fail the run
		await Promise.resolve();
	});

	it('does not register a URL from a miss, so a later error for it reports nothing', async () => {
		apiFetch.mockResolvedValue(jsonRes({ hit: false }));
		await readResolveCache('Nirvana', 'Come As You Are');
		apiFetch.mockReset();

		reportDeadUrl(ENTRY.url as string);

		expect(apiFetch).not.toHaveBeenCalled();
	});
});
