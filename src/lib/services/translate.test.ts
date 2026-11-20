import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Poison-resistant caching contract for translate.ts (WR / debug:dashboard-liked-not-translated).
// During the /api/translate echo-mode bug the endpoint returned ORIGINALS as a "success" and the
// client persisted them as final translations → liked/library names stuck Simplified forever.
// These tests pin the fix: (a) only fully-translated batches are persisted; (b) the cache key
// carries a version segment so pre-version (poisoned) entries are abandoned + purged.
//
// Runs under the node project: flip `browser` ON (so persist() runs) and back it with a minimal
// in-memory localStorage, mirroring stores/player.svelte.test.ts.
//
// DETERMINISM (flake fix, mirroring stores/names.test.ts's import-phase doctrine): this file
// used to `vi.resetModules()` in a global beforeEach and dynamic-import './translate' INSIDE
// every test body (~20 sites). A re-import's real duration is wall-clock luck, so under CPU
// contention a body could exhaust the 5000ms testTimeout mid-import; Vitest then abandons the
// body, but its late-resolving import kept executing as a ZOMBIE against the NEXT test's
// shared fixtures (fetchMock config, memStore) — e.g. an abandoned "persists a fully-translated
// batch" body landing its localStorage write during the "does NOT persist" test, which then
// saw 1 lyrics key where 0 belonged. So ALL module setup now lives in the one phase with no
// timeout — this file's import phase: the GEN block below pre-makes one translate generation
// per test (translate.ts has no production reset — its mem/lineMem caches ARE the per-test
// state — so isolation is one generation per test, never shared), and each test consumes a
// ready instance. Bodies perform no module imports and no dict builds, so no verdict in this
// file reads real elapsed time.
//
// translate.ts's ONE call-time dynamic link is './zh-convert' (the offline converter is
// lazy-imported per call, by production design). Two vitest binding facts shape this
// file's design (both empirically verified with probe files): (1) a dynamic import
// resolves through the mock-factory binding CURRENT at call time — a later vi.doMock
// rebinds what earlier-created generations resolve to; (2) a module's factory runs at
// most once per worker — once './zh-convert' has loaded, every later import returns
// that first instance and no factory (real or mock) ever runs for it again. So the
// import phase loads exactly one converter instance — the resident, fully warmed below
// (both tongwen dicts) — and the chunk premise test REBINDS './zh-convert' for the
// duration of its own call (fact 1), which is the only moment its generation resolves
// the converter. The tests whose SUBJECT is that link:
//  - the 'ja' test: the vi.doMock spy on './zh-convert' fires iff a zh-convert load
//    happens while its test runs (beforeEach clears it per test; the resident warm fired
//    it once during setup); its read generation was created after the registration, so
//    even a static-import regression in translate.ts would trip it during setup.
//  - the chunk-failure test: its heal must meet the converter's not-ready state (the
//    state a failed s2t chunk load leaves behind: warmScript resolves, the sync handle
//    answers null — the converter's documented contract). A broken-dict INSTANCE cannot
//    be produced inside this worker (binding fact 2 above: the first-loaded instance is
//    returned forever, factories never re-run), so the test injects the state instead:
//    it rebinds './zh-convert' to a not-ready double (real module, only warmScript +
//    s2tConvertLineSync replaced) for the duration of its read call — dynamic imports
//    resolve through the binding current at call time (binding fact 1) — and restores
//    the real binding in a finally. The heal code under test (keep the cached value when
//    the sync converter answers null) is the production code path verbatim.
vi.mock('$app/environment', () => ({ browser: true }));

const fetchMock = vi.fn();
vi.mock('./api-base', () => ({ apiFetch: (...a: unknown[]) => fetchMock(...a) }));

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);

function jsonRes(body: unknown) {
	return { json: async () => body } as Response;
}
const lsKeys = () => Array.from(memStore.keys());

// Fires iff a './zh-convert' module load goes through the spy factory registered in the GEN
// block below. Only the kvz 'ja' test asserts on it; beforeEach clears it per test so the
// setup load (the resident warm, which goes through the factory exactly once) and other
// tests' loads never leak into that assertion.
const zhLoaded = vi.fn();

// ── Module generations, created ONCE in this file's import phase ─────────────────────────
// The import phase is the one place Vitest imposes NO timeout (testTimeout governs bodies,
// hookTimeout governs hooks), so every expensive setup step lives here. Each generation is
// a fresh module registry (vi.resetModules + import) captured by reference; tests consume
// the instance, never the registry. The kvz seed/read pairs exist because those tests'
// SUBJECT is a cold in-memory cache reading localStorage: the seed generation writes the
// real key, the read generation (whose mem/lineMem are empty) is the "next session".
type TranslateModule = typeof import('./translate');
type ZhModule = typeof import('./zh-convert');

async function freshGeneration(): Promise<TranslateModule> {
	vi.resetModules();
	return await import('./translate');
}

async function freshPair(): Promise<{ seed: TranslateModule; read: TranslateModule }> {
	const seed = await freshGeneration();
	const read = await freshGeneration();
	return { seed, read };
}

const GEN = {
	fallback: [
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration(),
		await freshGeneration()
	],
	resilience: [await freshGeneration(), await freshGeneration(), await freshGeneration(), await freshGeneration()],
	routing: [await freshGeneration(), await freshGeneration(), await freshGeneration(), await freshGeneration()],
	kvzHeal: await freshPair(),
	kvzClean: await freshPair(),
	jaSeed: await freshGeneration(),
	kvzChunkSeed: await freshGeneration(),
	lineToggle: await freshGeneration(),
	lineSurvive: await freshPair(),
	lineEcho: await freshGeneration(),
	lineChinese: await freshGeneration()
};

// Spy on the zh-convert load (see zhLoaded above), registered BEFORE anything loads the
// converter: the worker-wide module map returns the first-loaded instance to every later
// import, so the factory must be in place before the first load or it never runs at all.
// The factory returns the real module — the spy only observes the one load.
vi.doMock('./zh-convert', async (orig) => {
	zhLoaded();
	return await orig();
});

// Dedicated read generations for the two converter-link premise tests ('ja' read +
// chunk read), created after the spy registration. Their translate instances hold no
// zh-convert of their own — the 'ja' read must prove its call loads none, and the chunk
// read resolves the converter only during its own call (where its test has rebound it).
const GEN_JA_READ = await freshGeneration();
const GEN_CHUNK_READ = await freshGeneration();

// The resident converter: the ONE zh-convert instance this worker will ever hold.
// Fully warmed here (both tongwen dicts) so no test body ever builds a dict; every
// generation's call-time dynamic import resolves to this instance. The load goes
// through the spy factory exactly once (zhLoaded fires during setup); beforeEach
// clears the spy per test, which is what keeps that out of the 'ja' test's assertion.
vi.resetModules();
const zhResident = await import('./zh-convert');
await zhResident.warmScript('zh-Hant');

beforeEach(() => {
	fetchMock.mockReset();
	memStore.clear();
	zhLoaded.mockClear();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('translateLinesEx — fallback signal + poison-resistant cache', () => {
	it('persists a fully-translated batch (all flags true)', async () => {
		const { translateLinesEx } = GEN.fallback[0];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['杜國華', '周杰倫'], flags: [true, true] }));
		const r = await translateLinesEx(['杜国华', '周杰伦'], 'zh-Hant');
		expect(r.out).toEqual(['杜國華', '周杰倫']);
		expect(r.complete).toBe(true);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v3:')).length).toBe(1);
	});

	it('does NOT persist when any non-blank line fell back (echo / failure)', async () => {
		const { translateLinesEx } = GEN.fallback[1];
		// Kana lines are API-bound under zh-Hant (D-04 — offline branch skips them), so this still
		// exercises the API echo/fallback cache gate (Chinese lines would now convert offline).
		fetchMock.mockResolvedValue(jsonRes({ translated: ['さくら', '飛舞飄散'], flags: [false, true] }));
		const r = await translateLinesEx(['さくら', '舞い散る'], 'zh-Hant');
		expect(r.complete).toBe(false);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:')).length).toBe(0);
	});

	it('treats blank lines as not blocking persistence', async () => {
		const { translateLinesEx } = GEN.fallback[2];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['', '歌詞', ''], flags: [false, true, false] }));
		const r = await translateLinesEx(['', '歌词', ''], 'zh-Hant');
		expect(r.complete).toBe(true);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v3:')).length).toBe(1);
	});

	it('infers per-line flags when the server omits them (output differs from input)', async () => {
		const { translateLinesEx } = GEN.fallback[3];
		// Kana lines are API-bound under zh-Hant; the server omits flags so translate.ts infers them.
		fetchMock.mockResolvedValue(jsonRes({ translated: ['櫻花', 'まだ'] })); // no flags
		const r = await translateLinesEx(['さくら', 'まだ'], 'zh-Hant');
		expect(r.flags).toEqual([true, false]); // line 2 unchanged → fallback
		expect(r.complete).toBe(false);
	});

	it('serves a versioned cache hit without re-requesting', async () => {
		const { translateLinesEx } = GEN.fallback[4];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['簡體'], flags: [true] }));
		await translateLinesEx(['简体'], 'zh-Hant');
		const calls = fetchMock.mock.calls.length;
		const again = await translateLinesEx(['简体'], 'zh-Hant');
		expect(again.out).toEqual(['簡體']);
		expect(fetchMock.mock.calls.length).toBe(calls); // no new request
	});

	it('purges pre-version (poisoned) lyrics keys on first call', async () => {
		memStore.set('openmusic:lyrics-tr:zh-Hant:abc123', JSON.stringify(['杜国华']));
		const { translateLinesEx } = GEN.fallback[5];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['簡體'], flags: [true] }));
		await translateLinesEx(['简体'], 'zh-Hant');
		expect(memStore.get('openmusic:lyrics-tr:zh-Hant:abc123')).toBeUndefined();
	});

	it('translateLines wrapper preserves the string[] contract', async () => {
		const { translateLines } = GEN.fallback[6];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['a', 'b'], flags: [true, true] }));
		const out = await translateLines(['x', 'y'], 'zh-Hant');
		expect(out).toEqual(['a', 'b']);
	});

	it('off / empty are identity pass-throughs', async () => {
		const { translateLinesEx } = GEN.fallback[7];
		expect((await translateLinesEx(['x'], 'off')).out).toEqual(['x']);
		expect((await translateLinesEx([], 'zh-Hant')).out).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// REGRESSION (WR / debug:lyric-tr-not-shown-hide-paren): a flaky upstream made /api/translate
// return the ORIGINALS as a fake HTTP-200 success (flags=false). translateLines() returned those
// originals with length === lines.length, so NowPlaying's showTr stayed TRUE and the lyrics block
// silently rendered untranslated originals ("translation shown nowhere"), recurring every render
// (incomplete batches are never cached). These tests pin the resilience fix: an incomplete soft-fail
// (or a thrown transport failure) is retried with backoff so a transient blip self-heals, and the
// BEST result across attempts is returned so a partial recovery still surfaces. Fake timers keep the
// backoff instant for the suite.
describe('translateLinesEx — transient-failure resilience (retry + best-result)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	// Drive a translateLinesEx() call to completion while flushing the retry backoff timers.
	async function runWithRetries<T>(p: Promise<T>): Promise<T> {
		let settled = false;
		const wrapped = p.then((v) => {
			settled = true;
			return v;
		});
		// Each await yields to the microtask queue (resolving the in-flight fetch/json) before we
		// advance the fake backoff timer; loop until the call resolves.
		while (!settled) {
			await Promise.resolve();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(2000);
		}
		return wrapped;
	}

	it('retries an INCOMPLETE soft-fail (echoed originals) and recovers on a later attempt', async () => {
		const { translateLinesEx } = GEN.resilience[0];
		// Attempt 1: transient soft-fail — server echoed the originals (all flags false).
		// Attempt 2: upstream recovered — genuine translation.
		fetchMock
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', '舞い散る'], flags: [false, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花', '飛舞飄散'], flags: [true, true] }));
		const r = await runWithRetries(translateLinesEx(['さくら', '舞い散る'], 'zh-Hant'));
		expect(fetchMock.mock.calls.length).toBe(2); // retried after the soft-fail
		expect(r.out).toEqual(['櫻花', '飛舞飄散']); // recovered translation surfaces
		expect(r.complete).toBe(true);
		// A recovered, complete batch is cached so the next session is instant.
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v3:')).length).toBe(1);
	});

	it('retries a THROWN transport failure and recovers', async () => {
		const { translateLinesEx } = GEN.resilience[1];
		fetchMock
			.mockRejectedValueOnce(new Error('ETIMEDOUT'))
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花'], flags: [true] }));
		const r = await runWithRetries(translateLinesEx(['さくら'], 'zh-Hant'));
		expect(fetchMock.mock.calls.length).toBe(2);
		expect(r.out).toEqual(['櫻花']);
		expect(r.complete).toBe(true);
	});

	it('returns the BEST partial result across attempts when none is fully complete', async () => {
		const { translateLinesEx } = GEN.resilience[2];
		// Attempt 1: line 1 translated, line 2 echoed. Attempt 2: line 1 echoed, line 2 translated.
		// Neither attempt is complete, but the best-per-attempt should keep the most translated lines.
		fetchMock
			.mockResolvedValueOnce(jsonRes({ translated: ['櫻花', 'まだ'], flags: [true, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', 'まだ'], flags: [false, false] }))
			.mockResolvedValueOnce(jsonRes({ translated: ['さくら', 'まだ'], flags: [false, false] }));
		const r = await runWithRetries(translateLinesEx(['さくら', 'まだ'], 'zh-Hant'));
		// Best attempt (1 line translated) is retained even though later attempts regressed.
		expect(r.flags.filter(Boolean).length).toBe(1);
		expect(r.out[0]).toBe('櫻花');
		expect(r.complete).toBe(false);
		// An incomplete batch is NEVER cached (no poison).
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:')).length).toBe(0);
	});

	it('gives up after the bounded retries and returns the (incomplete) best, never blanking length', async () => {
		const { translateLinesEx } = GEN.resilience[3];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['さくら', '舞い散る'], flags: [false, false] }));
		const r = await runWithRetries(translateLinesEx(['さくら', '舞い散る'], 'zh-Hant'));
		// 1 initial + 2 retries = 3 attempts, then settles with the originals (length preserved so the
		// UI never breaks alignment) but complete=false (so it stays retryable / uncached).
		expect(fetchMock.mock.calls.length).toBe(3);
		expect(r.out.length).toBe(2);
		expect(r.complete).toBe(false);
	});
});

// OFFLINE zh-Hant ROUTING (Phase 25 / D-02 / D-04): when to === 'zh-Hant', Chinese-detected lines
// are converted CLIENT-SIDE (zero network) by the s2t converter (Plan 01) and ONLY the non-Chinese
// remainder is sent to /api/translate. zh-convert is PURE, so we let the REAL converter run (no
// mock) and assert on fetchMock's call count + request body to prove the routing + the D-04 JA-kana
// guard + the preserved positional-alignment contract (out.length === lines.length).
describe('translateLinesEx — zh-Hant offline s2t routing (D-02 / D-04)', () => {
	// Parse the JSON body the client POSTed to /api/translate on a given call.
	const sentLines = (call: number): string[] =>
		JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body).lines;

	it('all-Chinese zh-Hant batch is converted offline with ZERO API calls + cached (v3)', async () => {
		const { translateLinesEx } = GEN.routing[0];
		const r = await translateLinesEx(['简体', '中文'], 'zh-Hant');
		expect(fetchMock).not.toHaveBeenCalled(); // no line reached the API
		expect(r.out).toEqual(['簡體', '中文']); // real s2t Traditional output
		expect(r.complete).toBe(true);
		expect(lsKeys().filter((k) => k.startsWith('openmusic:lyrics-tr:v3:')).length).toBe(1);
	});

	it('mixed batch sends ONLY the non-Chinese line to the API; out stays aligned', async () => {
		const { translateLinesEx } = GEN.routing[1];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['HELLO'], flags: [true] }));
		const r = await translateLinesEx(['简体', 'hello'], 'zh-Hant');
		expect(fetchMock.mock.calls.length).toBe(1); // '简体' handled offline
		expect(sentLines(0)).toEqual(['hello']); // only the non-Chinese line was sent
		expect(r.out[0]).toBe('簡體'); // offline Traditional form
		expect(r.out[1]).toBe('HELLO'); // API result
		expect(r.out.length).toBe(2); // out.length === lines.length
	});

	it('a JA-kana line under zh-Hant IS sent to the API (offline branch skipped it — D-04)', async () => {
		const { translateLinesEx } = GEN.routing[2];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['桜'], flags: [true] }));
		const r = await translateLinesEx(['さくら'], 'zh-Hant');
		expect(fetchMock.mock.calls.length).toBe(1);
		expect(sentLines(0)).toEqual(['さくら']); // routed to the API, NOT offline-converted
		expect(r.out.length).toBe(1);
	});

	it('a non-zh-Hant target is unchanged: the FULL batch (incl the Chinese line) goes to the API', async () => {
		const { translateLinesEx } = GEN.routing[3];
		fetchMock.mockResolvedValue(jsonRes({ translated: ['A', 'B'], flags: [true, true] }));
		const r = await translateLinesEx(['简体', 'hello'], 'en');
		expect(fetchMock.mock.calls.length).toBe(1);
		expect(sentLines(0)).toEqual(['简体', 'hello']); // no offline branch — full lines sent
		expect(r.out).toEqual(['A', 'B']);
	});
});

// quick-260926-kvz — zh-Hant batches persisted BEFORE the s2t merge served an already-Traditional
// 杰 as 傑 (周杰倫 → 周傑倫) for as long as the cache lived, and a cold names flush could copy that
// back into the name cache. The localStorage hit now re-derives the Chinese positions offline.
describe('translateLinesEx — zh-Hant lyrics cache heals pre-merge batches offline (quick-260926-kvz)', () => {
	/** Let the SEED generation write the REAL key for `lines`, then overwrite its value with
	 *  `stored`. The test then reads through its READ generation, whose in-memory cache is
	 *  empty, so the call reads localStorage — the original test's mid-test resetModules,
	 *  pre-made in the import phase. */
	async function seedBatch(
		seed: TranslateModule,
		lines: string[],
		to: string,
		api: string[],
		stored: string[]
	): Promise<string> {
		fetchMock.mockResolvedValue(jsonRes({ translated: api, flags: api.map(() => true) }));
		await seed.translateLinesEx(lines, to);
		const key = lsKeys().find((k) => k.startsWith(`openmusic:lyrics-tr:v3:${to}:`));
		expect(key).toBeDefined();
		memStore.set(key as string, JSON.stringify(stored));
		fetchMock.mockReset();
		return key as string;
	}

	it('heals a poisoned Chinese position with ZERO fetches, keeps the API line, rewrites storage', async () => {
		const key = await seedBatch(GEN.kvzHeal.seed, ['周杰倫', 'Hello'], 'zh-Hant', ['你好'], ['周傑倫', '你好']);
		const { translateLinesEx } = GEN.kvzHeal.read;
		const r = await translateLinesEx(['周杰倫', 'Hello'], 'zh-Hant');
		expect(r.out).toEqual(['周杰倫', '你好']);
		expect(r.complete).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.parse(memStore.get(key) as string)).toEqual(['周杰倫', '你好']);
	});

	it('does not rewrite a clean batch', async () => {
		await seedBatch(GEN.kvzClean.seed, ['周杰倫', 'Hello'], 'zh-Hant', ['你好'], ['周杰倫', '你好']);
		const { translateLinesEx } = GEN.kvzClean.read;
		const setItem = vi.spyOn(localStorageMock, 'setItem');
		const r = await translateLinesEx(['周杰倫', 'Hello'], 'zh-Hant');
		expect(r.out).toEqual(['周杰倫', '你好']);
		expect(setItem).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a non-zh-Hant hit is returned untouched without importing zh-convert', async () => {
		const key = await seedBatch(GEN.jaSeed, ['周杰倫'], 'ja', ['周杰倫'], ['周傑倫']);
		const { translateLinesEx } = GEN_JA_READ;
		const r = await translateLinesEx(['周杰倫'], 'ja');
		expect(r.out).toEqual(['周傑倫']);
		expect(zhLoaded).not.toHaveBeenCalled();
		expect(JSON.parse(memStore.get(key) as string)).toEqual(['周傑倫']);
	});

	it('an s2t chunk failure keeps the cached value (never downgrades to the original)', async () => {
		const key = await seedBatch(GEN.kvzChunkSeed, ['周杰伦', 'Hello'], 'zh-Hant', ['你好'], ['周傑倫', '你好']);
		// Rebind './zh-convert' to the converter's not-ready state for this call (the
		// original test's broken s2t-char chunk, one level up: a failed chunk load IS
		// the sync handle answering null — warmScript resolves, s2tConvertLineSync
		// returns null — while classification, which never depended on the dicts, stays
		// real). GEN_CHUNK_READ resolves the converter only now, through the binding
		// current at call time, so its heal meets exactly that state. No module import
		// happens in this body; the read instance was pre-made in the import phase.
		vi.doMock('./zh-convert', async (orig) => {
			const real = (await orig()) as ZhModule;
			return {
				...real,
				warmScript: async () => {},
				s2tConvertLineSync: () => null
			};
		});
		try {
			const { translateLinesEx } = GEN_CHUNK_READ;
			const r = await translateLinesEx(['周杰伦', 'Hello'], 'zh-Hant');
			expect(r.out).toEqual(['周傑倫', '你好']);
			expect(JSON.parse(memStore.get(key) as string)).toEqual(['周傑倫', '你好']);
		} finally {
			// Restore the real zh-convert binding for the describes below, as the
			// original test unmocked its chunk at its end.
			vi.doMock('./zh-convert', async (orig) => {
				zhLoaded();
				return await orig();
			});
		}
	});
});

// quick-261116-lyrux (Task 4) — LINE-LEVEL cache. Hector's toggle scenario: the Korean
// lines are translated with English skipped; he then un-skips English, which changes
// the batch composition (and every batch-level key) — the already-translated lines
// must resolve from the per-line cache so the API only ever sees the NEW line.
describe('translateLinesEx — line-level cache (quick-261116-lyrux)', () => {
	const sentLines = (call: number): string[] =>
		JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body).lines;
	const lineKeys = () => lsKeys().filter((k) => k.startsWith('openmusic:line-tr:v3:'));

	/** The API stub translates whatever it is sent, prefixing each line. */
	function wirePrefixApi() {
		fetchMock.mockImplementation(async (_url: unknown, init: { body: string }) => {
			const body = JSON.parse(init.body) as { lines: string[] };
			return jsonRes({
				translated: body.lines.map((l) => '譯:' + l),
				flags: body.lines.map(() => true)
			});
		});
	}

	it('toggling the send set only fetches the NEW lines (KR lines served per-line)', async () => {
		const { translateLinesEx } = GEN.lineToggle;
		wirePrefixApi();
		// Round 1: the KR-only send set (English skipped upstream in NpLyrics).
		const r1 = await translateLinesEx(['사랑해', '너를 원해'], 'zh-Hant');
		expect(r1.complete).toBe(true);
		expect(r1.out).toEqual(['譯:사랑해', '譯:너를 원해']);
		expect(lineKeys().length).toBe(2); // both KR lines persisted per-line
		fetchMock.mockClear();
		// Round 2: English un-skipped — a NEW composition (batch keys all miss), with
		// the KR lines interleaved around a brand-new English line.
		const r2 = await translateLinesEx(['사랑해', 'Hello tonight', '너를 원해'], 'zh-Hant');
		expect(fetchMock.mock.calls.length).toBe(1);
		expect(sentLines(0)).toEqual(['Hello tonight']); // ONLY the new line hit the API
		expect(r2.out).toEqual(['譯:사랑해', '譯:Hello tonight', '譯:너를 원해']);
		expect(r2.flags).toEqual([true, true, true]);
		expect(r2.complete).toBe(true);
	});

	it('line entries survive a module reset via localStorage (new session, same device)', async () => {
		const { translateLinesEx } = GEN.lineSurvive.seed;
		wirePrefixApi();
		await translateLinesEx(['사랑해'], 'zh-Hant');
		// GEN.lineSurvive.read is the pre-made "new session": its in-memory line cache is
		// empty (the original test's mid-test resetModules), localStorage persists.
		fetchMock.mockClear();
		const { translateLinesEx: fresh } = GEN.lineSurvive.read;
		const r = await fresh(['사랑해', '새로운 줄'], 'zh-Hant');
		expect(sentLines(0)).toEqual(['새로운 줄']); // the known line came from storage
		expect(r.out).toEqual(['譯:사랑해', '譯:새로운 줄']);
		expect(r.complete).toBe(true);
	});

	it('echoed lines never enter the line cache (per-line poison rule)', async () => {
		const { translateLinesEx } = GEN.lineEcho;
		fetchMock.mockResolvedValue(jsonRes({ translated: ['さくら'], flags: [false] }));
		const r = await translateLinesEx(['さくら'], 'zh-Hant');
		expect(r.complete).toBe(false);
		expect(lineKeys().length).toBe(0);
	});

	it('Chinese lines under zh-Hant stay OFF the line cache (offline path untouched)', async () => {
		const { translateLinesEx } = GEN.lineChinese;
		const r = await translateLinesEx(['简体中文'], 'zh-Hant');
		expect(fetchMock).not.toHaveBeenCalled(); // converted offline as always
		expect(r.out).toEqual(['簡體中文']);
		expect(lineKeys().length).toBe(0); // not line-cached — kvz heal semantics preserved
	});
});
