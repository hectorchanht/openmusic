import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No-latch / no-storm / no-poison contract for the names store (WR / debug:translation-regression).
// The attempt-latch regression: the store incremented the per-(lang,name) retry counter at QUEUE
// time and cleared `pending` at flush START (before the ~200-800ms API round-trip resolved). A
// re-render during that in-flight window re-queued the name (cache miss) and burned a SECOND
// attempt — so attempts>=MAX_ATTEMPTS(2) latched the name to its ORIGINAL for the session even
// though the API would translate it (artist names + bio "stopped translating"). These tests pin
// the fix: an in-flight name is not re-queued / burns no extra attempt; an attempt is counted ONLY
// on a genuine-identity result in the flush handler; a transport failure burns no attempt; a later
// genuine success after an earlier miss still sticks.
//
// Runs under the node project (the sveltekit Vite plugin transforms `$state` runes). browser ON +
// a minimal in-memory localStorage, mirroring translate.test.ts / player.svelte.test.ts.
vi.mock('$app/environment', () => ({ browser: true }));

// translateLinesEx is the single API the store calls. We control its resolution per test.
const translateMock = vi.fn();
vi.mock('$lib/services/translate', () => ({
	translateLinesEx: (...a: unknown[]) => translateMock(...a)
}));

// Decision layer: always request translation (the store's resolve() gates on this; we exercise
// the queue/flush/attempt machinery, not detection).
//
// quick-260808-urx: keep the REST of the module real (spread importOriginal) instead of replacing
// it wholesale. `detectLang` is the kana/hangul-first classifier behind zh-convert's
// isChineseLine, which names.svelte.ts calls on the zh-Hant sync path — a bare
// `{ shouldTranslate }` factory left it undefined and that path threw.
vi.mock('$lib/i18n/detect', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n/detect')>()),
	shouldTranslate: () => true
}));

// Fixed per-part target so dnArtist/dnBio both resolve to the same lang. quick-260712-et3: the
// target is a NON-offline language ('ja', which goes through the API queue) on purpose — the
// zh-Hant path now short-circuits to the synchronous offline s2t converter (no queue), so
// routing these async queue/flush/attempt-machinery assertions through zh-Hant would either
// skip the machinery entirely or race the lazy dict load. The zh-Hant no-flash sync path is
// covered in services/zh-convert.test.ts. effectiveTarget echoes its argument.
//
// quick-260808-urx: the object is now MUTABLE and hoisted, so the share-link composition block
// below can flip the target to 'zh-Hant' for its own tests. beforeEach restores 'ja', so every
// pre-existing assertion in this file keeps running against exactly the old fixture.
const settingsMock = vi.hoisted(() => ({
	artistLang: 'ja',
	titleLang: 'ja',
	lastfmLang: 'ja',
	bioLang: 'ja',
	artistSkip: [] as string[],
	titleSkip: [] as string[],
	lastfmSkip: [] as string[]
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: settingsMock,
	effectiveTarget: (t: string) => t
}));

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

// Resolve the deferred translateLinesEx, then let the .then/.finally microtasks settle.
async function flush() {
	await vi.runAllTimersAsync(); // fire the 160ms schedule timer
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	translateMock.mockReset();
	memStore.clear();
	vi.resetModules();
	vi.useFakeTimers();
	// quick-260808-urx: restore the shared mutable settings fixture to the original 'ja' target
	// so the zh-Hant share-link block can flip it without leaking into the machinery tests.
	settingsMock.artistLang = 'ja';
	settingsMock.titleLang = 'ja';
	settingsMock.lastfmLang = 'ja';
	settingsMock.bioLang = 'ja';
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('names store — no-latch / no-storm / no-poison', () => {
	it('caches a genuinely-translated name and serves it without re-requesting', async () => {
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		const { names } = await import('./names.svelte');
		expect(names.dnArtist('周杰伦')).toBe('周杰伦'); // immediate original; queues
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // cache hit
		const calls = translateMock.mock.calls.length;
		names.dnArtist('周杰伦');
		expect(translateMock.mock.calls.length).toBe(calls); // no re-request
	});

	it('does NOT re-queue or burn an attempt for a name still in flight', async () => {
		// Deferred response: the name is in flight across several re-renders.
		let resolveFn!: (v: { out: string[]; flags: boolean[] }) => void;
		translateMock.mockReturnValue(new Promise((r) => (resolveFn = r)));
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦'); // queue
		await vi.advanceTimersByTimeAsync(160); // flush starts; request now in flight
		// Re-renders during the round-trip must NOT issue a second batch.
		names.dnArtist('周杰伦');
		names.dnArtist('周杰伦');
		await vi.advanceTimersByTimeAsync(500);
		expect(translateMock.mock.calls.length).toBe(1); // single in-flight request
		resolveFn({ out: ['周杰倫'], flags: [true] });
		await Promise.resolve();
		await Promise.resolve();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // lands; cached
	});

	it('a transport failure burns NO attempt — the name retries on the next view', async () => {
		translateMock.mockRejectedValueOnce(new Error('network'));
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦');
		await flush(); // first attempt: rejected, no attempt counted
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		names.dnArtist('周杰伦'); // must re-queue (not latched by the failure)
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫');
		expect(translateMock.mock.calls.length).toBe(2); // failure then success — both ran
	});

	it('caps re-requests for a genuinely-identical name and then renders the original', async () => {
		// Already-Traditional / simp==trad name: server returns it unchanged, flag false.
		translateMock.mockResolvedValue({ out: ['五月天'], flags: [false] });
		const { names } = await import('./names.svelte');
		// Each view re-queues (cache miss) until MAX_ATTEMPTS(2) genuine-identity results accrue.
		for (let i = 0; i < 6; i++) {
			names.dnArtist('五月天');
			await flush();
		}
		expect(names.dnArtist('五月天')).toBe('五月天'); // renders original (correct — it IS in target)
		expect(translateMock.mock.calls.length).toBe(2); // capped at MAX_ATTEMPTS — no storm
	});

	it('a later genuine success after an earlier miss still sticks (no permanent latch)', async () => {
		// First view: server hasn't translated yet (identity-ish miss, flag false).
		translateMock.mockResolvedValueOnce({ out: ['周杰伦'], flags: [false] });
		const { names } = await import('./names.svelte');
		names.dnArtist('周杰伦');
		await flush(); // one attempt counted (genuine-identity-shaped miss)
		// Second view: server now genuinely translates.
		translateMock.mockResolvedValue({ out: ['周杰倫'], flags: [true] });
		names.dnArtist('周杰伦'); // attempts==1 < MAX, so it re-queues
		await flush();
		expect(names.dnArtist('周杰伦')).toBe('周杰倫'); // success sticks
	});
});

// quick-260808-urx — the share link must carry the DISPLAY-language names.
//
// The user's ask: "if the user is zht for artist name and song name, it should not show in zhs
// while sharing." Simplified is an internal RESOLUTION concern; the recipient reads the link.
// share.ts stays PURE (it never imports this store — CLAUDE.md: stores never flow into a pure
// service), so the language lives in the COMPOSITION at the call site: `names.dn*` in,
// `songShareUrl` out. These tests pin exactly that composition, which is what TrackMenu /
// album / artist now do.
describe('names + songShareUrl — share links carry display-language names (quick-260808-urx)', () => {
	/** Warm the s2t dict on the SAME module instance the freshly-reset names store imported. */
	async function warmSyncS2T(): Promise<void> {
		const zh = await import('$lib/services/zh-convert');
		zh.warmS2T(); // kick the lazy load…
		await zh.s2tConvertLines(['简体']); // …then await the SAME memoized build (zh-convert.test.ts idiom)
	}

	it('resolves zh-Hant display names synchronously (no API queue, no flash)', async () => {
		settingsMock.artistLang = 'zh-Hant';
		settingsMock.titleLang = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmSyncS2T();
		expect(names.dnTitle('梦伴')).toBe('夢伴');
		expect(names.dnArtist('李悦君')).toBe('李悅君');
		expect(translateMock).not.toHaveBeenCalled(); // offline s2t — never the API path
	});

	it('composes a Traditional /song/{artist}/{title} path from Simplified catalog metadata', async () => {
		settingsMock.artistLang = 'zh-Hant';
		settingsMock.titleLang = 'zh-Hant';
		const { names } = await import('./names.svelte');
		const { songShareUrl } = await import('$lib/services/share');
		await warmSyncS2T();
		// The exact call shape of the three share call sites. `location` is undefined under node,
		// so the origin is '' and the assertion is the PATH — which is the whole point.
		const url = songShareUrl({ title: names.dnTitle('梦伴'), artist: names.dnArtist('李悦君') });
		expect(url).toBe('/song/李悅君/夢伴');
		expect(url).not.toContain('梦'); // never the Simplified source metadata
		expect(url).not.toContain('?'); // OG-ZH-01: the dn/da QUERY carriers stay dead
	});

	// The composition test above proves `dn* → songShareUrl` yields a display-language path, but it
	// cannot prove the three SHARE CALL SITES actually compose that way — they are .svelte
	// components whose doShare()/shareAlbum()/shareArtist() are not exported and cannot be
	// imported into the node project. So assert the composition structurally, at the source. This
	// is the one check that fails if a call site regresses back to raw `track.title`.
	it.each([
		[
			'src/lib/components/TrackMenu.svelte',
			[/names\.dnTitle\(track\.title\)/, /names\.dnArtist\(track\.artist\)/],
			[/songShareUrl\(\{ title: track\.title/]
		],
		[
			'src/routes/(app)/album/[name]/+page.svelte',
			[/names\.dnTitle\(name\)/, /names\.dnArtist\(albumArtist\)/],
			[/entityCardUrl\(\{ type: 'album', name, artist: albumArtist \}\)/]
		],
		[
			'src/routes/(app)/artist/[name]/+page.svelte',
			[/names\.dnArtist\(name\)/],
			[/entityCardUrl\(\{ type: 'artist', name \}\)/]
		]
	])('%s builds its share URL from names.dn* display strings', async (file, present, absent) => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(file, 'utf8');
		for (const re of present) expect(src).toMatch(re);
		// …and the raw-catalog-metadata form is GONE (this is the half that catches a revert).
		for (const re of absent) expect(src).not.toMatch(re);
	});

	it('leaves a non-Chinese name untouched (Latin share links are unaffected)', async () => {
		settingsMock.artistLang = 'zh-Hant';
		settingsMock.titleLang = 'zh-Hant';
		const { names } = await import('./names.svelte');
		const { songShareUrl } = await import('$lib/services/share');
		await warmSyncS2T();
		expect(songShareUrl({ title: names.dnTitle('Hello'), artist: names.dnArtist('Adele') })).toBe(
			'/song/Adele/Hello'
		);
	});
});
