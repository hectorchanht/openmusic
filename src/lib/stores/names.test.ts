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
	lastfmSkip: [] as string[],
	// quick-260919-2jo: the script lock. 'off' is the D-1 default and a byte-for-byte no-op, so
	// every PRE-EXISTING test in this file runs against exactly the old behaviour.
	zhScript: 'off' as string
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
	settingsMock.zhScript = 'off'; // quick-260919-2jo — the lock is opt-in per test
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
			[/names\.dnTitle\(track\.title, track\.artist\)/, /names\.dnArtist\(track\.artist\)/],
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


// quick-260919-2jo — the Chinese script lock at the one display seam.
describe('names — Chinese script lock (quick-260919-2jo)', () => {
	/** Warm one direction's dict on the SAME module instance the freshly-reset names store has. */
	async function warmLock(target: 'zh-Hant' | 'zh-Hans'): Promise<void> {
		const zh = await import('$lib/services/zh-convert');
		await zh.warmScript(target);
	}

	it("'off' is byte-for-byte identical (D-1 — the no-surprise default)", async () => {
		settingsMock.titleLang = 'off';
		settingsMock.artistLang = 'off';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.dnTitle('过一招')).toBe('过一招');
		expect(names.dnArtist('邓紫棋')).toBe('邓紫棋');
	});

	it("'zh-Hant' re-scripts Chinese names with translation OFF (no API involved)", async () => {
		settingsMock.titleLang = 'off';
		settingsMock.artistLang = 'off';
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.dnTitle('过一招')).toBe('過一招');
		expect(names.dnArtist('邓紫棋')).toBe('鄧紫棋');
		expect(translateMock).not.toHaveBeenCalled(); // offline conversion, never the API path
	});

	it("'zh-Hans' mirrors it", async () => {
		settingsMock.titleLang = 'off';
		settingsMock.artistLang = 'off';
		settingsMock.zhScript = 'zh-Hans';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hans');
		expect(names.dnTitle('過一招')).toBe('过一招');
		expect(names.dnArtist('鄧紫棋')).toBe('邓紫棋');
		expect(translateMock).not.toHaveBeenCalled();
	});

	it('leaves English and kana-bearing Japanese untouched under BOTH settings', async () => {
		settingsMock.titleLang = 'off';
		for (const lock of ['zh-Hant', 'zh-Hans'] as const) {
			vi.resetModules();
			settingsMock.zhScript = lock;
			const { names } = await import('./names.svelte');
			await warmLock(lock);
			expect(names.dnTitle('Man I Need')).toBe('Man I Need');
			expect(names.dnTitle('さくらの唄')).toBe('さくらの唄'); // kana ⇒ ja ⇒ never converted
		}
	});

	it('zhLock is the same lock without the translation layer, and makes NO network call', async () => {
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.zhLock('过一招 (feat. 拉天糖)')).toBe('過一招 (feat. 拉天糖)');
		expect(names.zhLock('Beauty Behind the Madness')).toBe('Beauty Behind the Madness');
		expect(translateMock).not.toHaveBeenCalled();
	});

	it('zhLock is a no-op while the lock is off', async () => {
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.zhLock('过一招')).toBe('过一招');
	});

	it('does NOT pollute the translation cache — the persisted map keeps the RAW pair', async () => {
		// The lock is applied AFTER the cache read, so the cache stays keyed on originals and
		// holds the API's own output. Flipping the lock therefore needs no cache flush.
		settingsMock.artistLang = 'ja';
		settingsMock.zhScript = 'zh-Hant';
		translateMock.mockResolvedValue({ out: ['过一招'], flags: [true] });
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		names.dnArtist('ORIG');
		await flush();
		expect(names.dnArtist('ORIG')).toBe('過一招'); // displayed: translated THEN locked (D-6)
		const persisted = JSON.parse(memStore.get('openmusic:name-tr:v2:ja') as string);
		expect(persisted).toEqual({ ORIG: '过一招' }); // stored: the API's own output, unlocked
	});
});

// quick-260925-x8o — wa7-verified English→Chinese pairs DISPLAY through the seam while the lock is on.
describe('names — rescued Chinese name aliases (quick-260925-x8o)', () => {
	const RESCUE_KEY = 'openmusic:name-rescue:v1';
	const DAY = 24 * 60 * 60 * 1000;

	/** warmScript('zh-Hant') now warms both dicts itself (quick-260926-bxg) — one call is enough. */
	async function warmLock(target: 'zh-Hant' | 'zh-Hans'): Promise<void> {
		const zh = await import('$lib/services/zh-convert');
		await zh.warmScript(target);
	}

	function seed(): void {
		const now = Date.now();
		memStore.set(
			RESCUE_KEY,
			JSON.stringify({
				// 40 d old — past the 30 d lookup TTL (HIT_TTL_MS); display must still use it.
				'jaychou|coralsea': { a: '周杰倫', t: '珊瑚海', at: now - 40 * DAY },
				'lullaboy|someonelikeu': { miss: true, at: now },
				'jokerxue|theactor': { a: '薛之謙, 阿蘭, 劉宇寧, 白舉綱 & 袁成傑', t: '演員', at: now }
			})
		);
	}

	it("'off' is byte-for-byte unchanged — no alias", async () => {
		seed();
		const { names } = await import('./names.svelte');
		expect(names.dnTitle('Coral Sea', 'Jay Chou')).toBe('Coral Sea');
		expect(names.dnArtist('Jay Chou')).toBe('Jay Chou');
	});

	it("'zh-Hant' shows the verified pair and never sends it to /api/translate", async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		translateMock.mockResolvedValue({ out: [], flags: [] });
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		// the pair is 40 days old (past HIT_TTL) — a verified pair is a fact for display
		expect(names.dnTitle('Coral Sea', 'Jay Chou')).toBe('珊瑚海');
		// 周杰倫, not 周傑倫: a raw s2t of the Traditional alias over-converts 杰; the zh-Hant merge in
		// lockScriptSync keeps it (quick-260926-bxg)
		expect(names.dnArtist('Jay Chou')).toBe('周杰倫');
		await flush();
		expect(translateMock).not.toHaveBeenCalled();
	});

	it("'zh-Hans' renders the alias in the selected script", async () => {
		seed();
		settingsMock.zhScript = 'zh-Hans';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hans');
		expect(names.dnArtist('Jay Chou')).toBe('周杰伦');
		expect(names.dnTitle('Coral Sea', 'Jay Chou')).toBe('珊瑚海');
	});

	it('the title alias is keyed by the PAIR — no artist or another artist never aliases', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.dnTitle('Coral Sea')).toBe('Coral Sea');
		expect(names.dnTitle('Coral Sea', 'Black Pearl')).toBe('Coral Sea');
		expect(names.dnTitle('Coral Sea (Chillout Mix)', 'Black Pearl')).toBe('Coral Sea (Chillout Mix)');
	});

	it('a cached miss never aliases', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.dnTitle('someone like u', 'lullaboy')).toBe('someone like u');
	});

	it('a multi-performer zh credit aliases the title but never the lone raw artist', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.dnTitle('The Actor', 'Joker Xue')).toBe('演員');
		expect(names.dnArtist('Joker Xue')).toBe('Joker Xue');
	});

	it('a new rescue write repaints live (rev bump) without a reload', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		const { writeRescueCache } = await import('$lib/services/name-rescue');
		await warmLock('zh-Hant');
		expect(names.dnTitle('Zai Ai Ni', 'Eric Chou')).toBe('Zai Ai Ni');
		const before = names.rev;
		writeRescueCache('Eric Chou', 'Zai Ai Ni', { artist: '周興哲', title: '再愛你' });
		expect(names.rev).toBeGreaterThan(before);
		expect(names.dnTitle('Zai Ai Ni', 'Eric Chou')).toBe('再愛你');
		expect(names.dnArtist('Eric Chou')).toBe('周興哲');
	});

	it('a malformed rescue store returns originals and never throws', async () => {
		settingsMock.zhScript = 'zh-Hant';
		for (const raw of ['{not json', JSON.stringify({ 'x|y': 'str', 'a|b': { a: 1, t: 2 } })]) {
			vi.resetModules();
			memStore.set(RESCUE_KEY, raw);
			const { names } = await import('./names.svelte');
			await warmLock('zh-Hant');
			expect(names.dnTitle('y', 'x')).toBe('y');
			expect(names.dnTitle('b', 'a')).toBe('b');
			expect(names.dnArtist('a')).toBe('a');
		}
	});

	it('hydrates the alias map with ONE localStorage read per session', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const spy = vi.spyOn(localStorageMock, 'getItem');
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		for (let i = 0; i < 25; i++) {
			names.dnTitle(i % 2 ? 'Coral Sea' : 'Other ' + i, 'Jay Chou');
			names.dnArtist(i % 2 ? 'Jay Chou' : 'Someone ' + i);
		}
		expect(spy.mock.calls.filter((c) => c[0] === RESCUE_KEY)).toHaveLength(1);
	});

	// A song title passes its OWN artist; `artist` is optional, so svelte-check cannot catch a dropped
	// edit. `absent` is the load-bearing half: one edited site satisfies `present`, but any bare form
	// left in a multi-site file fails `absent`.
	it.each([
		['src/lib/components/SongRow.svelte', [/dnTitle\(track\.title, track\.artist\)/], [/dnTitle\(track\.title\)/]],
		['src/lib/components/NpUpNext.svelte', [/dnTitle\(track\.title, track\.artist\)/], [/dnTitle\(track\.title\)/]],
		['src/lib/components/NpRelated.svelte', [/dnTitle\(track\.title, track\.artist\)/], [/dnTitle\(track\.title\)/]],
		['src/lib/components/Nowbar.svelte', [/dnTitle\(np\?\.title \?\? "", np\?\.artist \?\? ""\)/], [/dnTitle\(np\?\.title \?\? ""\)/]],
		[
			'src/lib/components/NowPlaying.svelte',
			[/dnTitle\(player\.current\.title, player\.current\.artist\)/],
			[/dnTitle\(player\.current\.title\)/]
		],
		['src/lib/components/VersionPicker.svelte', [/dnTitle\(v\.title, v\.artist\)/, /dnTitle\(v\.album\)/], [/dnTitle\(v\.title\)/]],
		[
			'src/lib/components/TrackMenu.svelte',
			[/dnTitle\(track\.title, track\.artist\)/, /dnTitle\(detailTrack\.title, detailTrack\.artist\)/, /dnTitle\(detailTrack\.album\)/],
			[/dnTitle\(track\.title\)/, /dnTitle\(detailTrack\.title\)/]
		],
		[
			'src/routes/(app)/+page.svelte',
			[/dnTitle\(track\.title, track\.artist\)/, /dnTitle\(item\.title, item\.artist\)/, /dnTitle\(a\.name\)/],
			[/dnTitle\(track\.title\)/, /dnTitle\(item\.title\)/]
		],
		[
			'src/routes/(app)/search/+page.svelte',
			[/dnTitle\(s\.title, s\.kind === 'song' \? s\.artist : undefined\)/],
			[/dnTitle\(s\.title\)/]
		],
		['src/routes/(app)/settings/downloads/+page.svelte', [/dnTitle\(d\.title, d\.artist\)/], [/dnTitle\(d\.title\)/]],
		['src/routes/+layout.svelte', [/dnTitle\(cur\.title, cur\.artist\)/], [/dnTitle\(cur\.title\)/]],
		[
			'src/lib/stores/player.svelte.ts',
			[
				/dnTitle\(own\.title, own\.artist\)/,
				/dnTitle\(cur\.title, cur\.artist\)/,
				/dnTitle\(track\.title, track\.artist\)/,
				/dnTitle\(resolved\.title, resolved\.artist\)/
			],
			[/dnTitle\((own|cur|track|resolved)\.title\)/]
		],
		['src/lib/services/download-track.ts', [/dnTitle\(r\.title, r\.artist\)/], [/dnTitle\(r\.title\)/]],
		// the metadata editor shows the user's RAW editable value — deliberately no alias
		['src/lib/components/MetadataEditor.svelte', [/names\.dnTitle\(tr\.title\)/], [/dnTitle\(tr\.title, /]]
	])('%s passes the sibling artist to every song-title dnTitle', async (file, present, absent) => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(file, 'utf8');
		for (const re of present) expect(src).toMatch(re);
		for (const re of absent) expect(src).not.toMatch(re);
	});

	it('zhLock takes no artist and never aliases', async () => {
		seed();
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.zhLock('Coral Sea')).toBe('Coral Sea');
		expect(names.zhLock('Jay Chou')).toBe('Jay Chou');
	});
});

// quick-260926-hl9 — every in-app artist route goes through names.artistHref: the script lock
// ONLY (zhLock), never the translation layer, encoded exactly once.
describe('names.artistHref — artist routes follow the script lock (quick-260926-hl9)', () => {
	/** warmScript('zh-Hant') warms both dicts itself (quick-260926-bxg). */
	async function warmLock(target: 'zh-Hant' | 'zh-Hans'): Promise<void> {
		const zh = await import('$lib/services/zh-convert');
		await zh.warmScript(target);
	}
	const href = (n: string) => '/artist/' + encodeURIComponent(n);

	it('zh-Hant: Simplified AND Traditional input land on the same Traditional route', async () => {
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.artistHref('周杰伦')).toBe(href('周杰倫'));
		expect(names.artistHref('周杰倫')).toBe(href('周杰倫')); // idempotent (quick-260926-bxg)
	});

	it('zh-Hans: Traditional input lands on the Simplified route', async () => {
		settingsMock.zhScript = 'zh-Hans';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hans');
		expect(names.artistHref('周杰倫')).toBe(href('周杰伦'));
	});

	it("'off' is byte-identical to the old '/artist/' + encodeURIComponent builders", async () => {
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.artistHref('周杰伦')).toBe(href('周杰伦'));
		expect(names.artistHref('周杰倫')).toBe(href('周杰倫'));
	});

	it('leaves non-Chinese names untouched and keeps a slash inside the segment (T-hl9-01)', async () => {
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.artistHref('Coldplay')).toBe('/artist/Coldplay');
		expect(names.artistHref('AC/DC')).toBe('/artist/AC%2FDC');
	});

	it('never translates the route, even with an artist translation target set (T-hl9-02)', async () => {
		settingsMock.zhScript = 'zh-Hant'; // artistLang stays 'ja' from beforeEach
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		const out = names.artistHref('邓紫棋');
		await flush();
		expect(translateMock).not.toHaveBeenCalled();
		expect(out).toBe(href('鄧紫棋'));
	});
});

// quick-260926-hze — names.lockUrl: the script lock applied to a whole same-app entity href
// (album title + ?artist=), never translation. 'off' hands back the input itself.
describe('names.lockUrl (quick-260926-hze)', () => {
	async function warmLock(target: 'zh-Hant' | 'zh-Hans'): Promise<void> {
		const zh = await import('$lib/services/zh-convert');
		await zh.warmScript(target);
	}
	const enc = encodeURIComponent;
	// 十一月的萧邦 converts both ways; 范 has no zh-Hant form in tongwen (see entity-href.test.ts).
	const simp = '/album/' + enc('十一月的萧邦') + '?artist=' + enc('周杰伦') + '&dzid=1';

	it('zh-Hant: locks the album title AND the artist param, keeps dzid', async () => {
		settingsMock.zhScript = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.lockUrl(simp)).toBe('/album/' + enc('十一月的蕭邦') + '?artist=' + enc('周杰倫') + '&dzid=1');
	});

	it("'off' returns the same string", async () => {
		const { names } = await import('./names.svelte');
		await warmLock('zh-Hant');
		expect(names.lockUrl(simp)).toBe(simp);
	});
});

// quick-260926-kvz — the zh-Hant TRANSLATION layer (not the lock) ran raw s2t, so a JOOX/HK 周杰倫
// became 周傑倫 while a CN 周杰伦 became 周杰倫 — and the no-flash fast path PERSISTED the bad
// result into openmusic:name-tr:v2:zh-Hant, where the cache hit (which ran first) served it forever.
describe('names — zh-Hant translation is idempotent and self-heals (quick-260926-kvz)', () => {
	const KEY = 'openmusic:name-tr:v2:zh-Hant';
	const persisted = (): Record<string, string> => JSON.parse(memStore.get(KEY) ?? '{}');
	/** Warm both dicts on the SAME module instance the freshly-reset names store imported. */
	async function warmHant(): Promise<void> {
		await (await import('$lib/services/zh-convert')).warmScript('zh-Hant');
	}
	function poison(): void {
		memStore.set(KEY, JSON.stringify({ 周杰倫: '周傑倫', 'Coral Sea': '珊瑚海' }));
	}

	it('Traditional and Simplified input render the same Traditional name, offline', async () => {
		settingsMock.artistLang = 'zh-Hant';
		const { names } = await import('./names.svelte');
		await warmHant();
		expect(names.dnArtist('周杰倫')).toBe('周杰倫'); // was 周傑倫
		expect(names.dnArtist('周杰伦')).toBe('周杰倫');
		expect(translateMock).not.toHaveBeenCalled();
	});

	it('heals a poisoned persisted entry and leaves English-keyed API translations alone', async () => {
		settingsMock.artistLang = 'zh-Hant';
		settingsMock.titleLang = 'zh-Hant';
		poison(); // seeded BEFORE the first dn* call — the zh-Hant map hydrates lazily
		const { names } = await import('./names.svelte');
		await warmHant();
		expect(names.dnArtist('周杰倫')).toBe('周杰倫');
		expect(persisted()).not.toHaveProperty('周杰倫');
		expect(persisted()['Coral Sea']).toBe('珊瑚海');
		expect(names.dnTitle('Coral Sea')).toBe('珊瑚海');
		expect(translateMock).not.toHaveBeenCalled();
	});

	it('COLD dicts: the latched warm bumps rev, then the next render heals the entry', async () => {
		settingsMock.artistLang = 'zh-Hant';
		settingsMock.titleLang = 'zh-Hant';
		poison();
		translateMock.mockReturnValue(new Promise(() => {})); // a flush can never bump rev
		const { names } = await import('./names.svelte');
		const before = names.rev;
		names.dnArtist('周杰倫'); // cold: one stale render is the accepted ceiling
		await vi.waitFor(() => expect(names.rev).toBeGreaterThan(before));
		expect(names.dnArtist('周杰倫')).toBe('周杰倫');
		expect(persisted()).not.toHaveProperty('周杰倫');
	});

	it('warm() with a zh-Hant translation target (lock off) warms BOTH dicts', async () => {
		settingsMock.artistLang = 'zh-Hant';
		const { names } = await import('./names.svelte');
		const zh = await import('$lib/services/zh-convert');
		names.warm();
		await vi.waitFor(() => expect(zh.t2sConvertLineSync('繁體')).toBe('繁体'));
	});
});
