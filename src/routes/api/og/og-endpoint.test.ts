import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	OG_RESOLVE_MS,
	isOgType,
	resolveCoverTiered,
	safeItunesImageUrl,
	safeKuwoImageUrl
} from '$lib/proxy/og-cover';
import { OG_FALLBACK_BYTES, OG_FALLBACK_TYPE } from '$lib/proxy/og-fallback';
import { upgradeArtwork } from '$lib/services/itunes-cover';
import { t2sConvertLines } from '$lib/services/zh-convert';
import { GET, OPTIONS } from './+server';

// /api/og (OG-EP-01/OG-EP-02) is the carrier-free share card's cover endpoint: it resolves
// {type, artist, title} TEXT through a bounded Deezer → iTunes → kuwo chain and STREAMS the
// image bytes from our own origin, so a shared link needs no `?c=` cover carrier at all.
//
// LIVE probe facts these tests encode (research 2026-08-07, all three upstreams keyless):
//  - Deezer: GET api.deezer.com/search?q=&limit=1 → { data:[{album:{cover_big,…},artist:{…}}] };
//    no-match is a CLEAN 200 { data: [], total: 0 }. Image host *.dzcdn.net.
//  - iTunes: GET itunes.apple.com/search?term=&entity=&limit=1 → { results:[{artworkUrl100}] };
//    host *.mzstatic.com; the 100x100bb token is swapped to 600x600bb (101 KB, not 332 KB).
//  - kuwo: ONE subrequest — the SEARCH body already carries `pic` (sources/kuwo.ts:82);
//    { code: 200, data: [{ pic: 'https://img4.kuwo.cn/…/600/…' }] }. Host *.kuwo.cn.
//
// Every case runs with `platform: undefined` — that is a real assertion: all three tiers are
// keyless, so /api/og reads NO secret and needs no Env. fetch is stubbed (no live network) and
// caches.default is an in-memory stub (edgeCache() is null under vite dev by design, so the
// cache layers are unit-provable ONLY — Pitfall 8).

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const DZ_COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg';
const DZ_PICTURE = 'https://cdn-images.dzcdn.net/images/artist/def/500x500-000000-80-0-0.jpg';
const IT_ART_100 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/cc/100x100bb.jpg';
const IT_ART_600 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/cc/600x600bb.jpg';
const KW_PIC = 'https://img4.kuwo.cn/star/albumcover/600/s4s0/93/1794217775.jpg';

const DZ_HIT = JSON.stringify({
	data: [{ album: { cover_big: DZ_COVER }, artist: { picture_big: DZ_PICTURE } }],
	total: 1
});
const DZ_MISS = JSON.stringify({ data: [], total: 0 });
const IT_HIT = JSON.stringify({ results: [{ artworkUrl100: IT_ART_100 }] });
const IT_MISS = JSON.stringify({ results: [] });
const KW_HIT = JSON.stringify({ code: 200, msg: '单曲搜索成功', data: [{ rid: 440613, pic: KW_PIC }] });
const KW_MISS = JSON.stringify({ code: 200, msg: '单曲搜索成功', data: [] });

/** 'THROW' = network failure, 'NOTOK' = non-ok status; anything else is a 200 JSON body. */
type TierReply = string | 'THROW' | 'NOTOK';

/**
 * Stub global fetch per TIER and capture every upstream URL in call order — the tier-order
 * assertion is "assert the sequence AND the count" (capturedUpstream idiom,
 * deezer-endpoint.test.ts:57-63). An unspecified tier throws, so a test that expects a tier
 * NOT to be reached fails loudly rather than silently passing.
 */
function stubTiers(replies: { dz?: TierReply; it?: TierReply; kw?: TierReply }) {
	const calls: string[] = [];
	const spy = vi.fn(async (input: RequestInfo | URL) => {
		const u = String(input);
		calls.push(u);
		const reply = u.includes('api.deezer.com')
			? replies.dz
			: u.includes('itunes.apple.com')
				? replies.it
				: replies.kw;
		if (reply === undefined || reply === 'THROW') throw new Error('network down');
		if (reply === 'NOTOK') return new Response('upstream error', { status: 500 });
		return new Response(reply, { status: 200, headers: { 'content-type': 'application/json' } });
	});
	vi.stubGlobal('fetch', spy);
	return { calls, spy };
}

const fresh = () => AbortSignal.timeout(5000);

/**
 * Read a raster's format from its MAGIC BYTES — the only assertion that proves the fallback body
 * really is the image its content-type claims (a stale/mis-decoded base64 constant would slip past
 * a header-only check). `89 50 4E 47` = PNG, `FF D8` = JPEG.
 */
function magicOf(bytes: Uint8Array): string | null {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
		return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
	return null;
}

describe('og-cover — tier order (Deezer → iTunes → kuwo, sequential)', () => {
	it('a Deezer hit costs exactly ONE subrequest and never reaches iTunes/kuwo', async () => {
		const { calls } = stubTiers({ dz: DZ_HIT });
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', fresh());
		expect(out).toBe(DZ_COVER);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('https://api.deezer.com/search');
		expect(calls[0]).toContain(encodeURIComponent('Nirvana Come As You Are'));
	});

	it('falls through to iTunes when Deezer cleanly misses', async () => {
		const { calls } = stubTiers({ dz: DZ_MISS, it: IT_HIT });
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', fresh());
		expect(out).toBe(IT_ART_600);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toContain('https://itunes.apple.com/search');
		expect(calls[1]).toContain('entity=song');
	});

	it('falls through to kuwo LAST, as one search subrequest reading `pic`', async () => {
		const { calls } = stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: KW_HIT });
		const out = await resolveCoverTiered('song', '周杰倫', '稻香', fresh());
		expect(out).toBe(KW_PIC);
		expect(calls).toHaveLength(3);
		expect(calls[2]).toContain('kw-api.cenguigui.cn');
		expect(calls[2]).toContain('limit=1');
		// kuwo is ONE subrequest — no /detail follow-up (the search body already carries `pic`).
		expect(calls.filter((c) => c.includes('type=song'))).toHaveLength(0);
	});

	it('never fans out via searchAll — the CN tier is kuwo ONLY (≤5 resolve subrequests)', async () => {
		const { calls } = stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		const out = await resolveCoverTiered('song', 'Nobody', 'Nothing', fresh());
		expect(out).toBeNull();
		// 3 tiers + Fallback B (title-only). Fallback A is SKIPPED — a non-Chinese query is never
		// substituted, so the original terms are byte-identical to the primary query.
		expect(calls).toHaveLength(4);
		expect(calls[3]).toContain('https://api.deezer.com/search');
		expect(calls[3]).toContain(encodeURIComponent('Nothing'));
		expect(calls[3]).not.toContain(encodeURIComponent('Nobody'));
	});

	it('uses the ALBUM entity for type=album and the artistTerm album proxy for type=artist', async () => {
		const albumCalls = stubTiers({ dz: DZ_MISS, it: IT_HIT }).calls;
		await resolveCoverTiered('album', 'Nirvana', 'Nevermind', fresh());
		expect(albumCalls[1]).toContain('entity=album');
		expect(albumCalls[1]).not.toContain('attribute=artistTerm');

		vi.unstubAllGlobals();
		const artistCalls = stubTiers({ dz: DZ_MISS, it: IT_HIT }).calls;
		await resolveCoverTiered('artist', 'Nirvana', '', fresh());
		// musicArtist carries no artwork — the top ALBUM cover is the artist-image proxy.
		expect(artistCalls[1]).toContain('entity=album');
		expect(artistCalls[1]).toContain('attribute=artistTerm');
	});

	it('type=artist reads the Deezer artist PICTURE, not the album cover', async () => {
		stubTiers({ dz: DZ_HIT });
		const out = await resolveCoverTiered('artist', 'Nirvana', '', fresh());
		expect(out).toBe(DZ_PICTURE);
	});
});

describe('og-cover — CONVERT-FIRST t2s primary query + two Deezer fallbacks (quick-260807-vl1)', () => {
	// The production repro: `artist=周傑倫&title=止戰之殤` (Traditional) missed every tier 3/3, while
	// the t2s output hit 4/4 — the catalogs index the SIMPLIFIED name. So the Simplified terms are
	// the PRIMARY query, not a retry: converting first costs zero added latency on the slowest
	// (CJK, measured 4.12 s cold) query class, where a retry-after design would have doubled it.
	const TRAD_ARTIST = '周傑倫';
	const TRAD_TITLE = '止戰之殤';

	/** The expected Simplified forms are computed BY THE CONVERTER — never a hardcoded guess. */
	async function simplified(): Promise<[string, string]> {
		const [a, t] = await t2sConvertLines([TRAD_ARTIST, TRAD_TITLE]);
		return [a, t];
	}

	const missByHost = (u: string): TierReply =>
		u.includes('api.deezer.com') ? DZ_MISS : u.includes('itunes.apple.com') ? IT_MISS : KW_MISS;

	/**
	 * stubTiers keys on HOST only, so a form-discriminating case needs its own stub: `decide`
	 * inspects the outgoing URL's query (Simplified-form vs original-form vs title-only), which is
	 * exactly the upstream behaviour the probe observed.
	 */
	function stubBy(decide: (url: string) => TierReply) {
		const calls: string[] = [];
		const spy = vi.fn(async (input: RequestInfo | URL) => {
			const u = String(input);
			calls.push(u);
			const reply = decide(u);
			if (reply === 'THROW') throw new Error('network down');
			if (reply === 'NOTOK') return new Response('upstream error', { status: 500 });
			return new Response(reply, { status: 200, headers: { 'content-type': 'application/json' } });
		});
		vi.stubGlobal('fetch', spy);
		return { calls, spy };
	}

	it('(a) the FIRST outgoing query already carries the SIMPLIFIED terms, and a hit costs 1 call', async () => {
		const [sArtist, sTitle] = await simplified();
		// Sanity-check the converter itself before asserting on it.
		expect(sArtist).toContain('杰');
		expect(sArtist).toContain('伦');
		expect(sArtist).not.toContain('傑');
		expect(sArtist).not.toContain('倫');

		const { calls } = stubBy((u) =>
			u.includes('api.deezer.com') && u.includes(encodeURIComponent(sArtist))
				? DZ_HIT
				: missByHost(u)
		);
		const out = await resolveCoverTiered('song', TRAD_ARTIST, TRAD_TITLE, fresh());
		expect(out).toBe(DZ_COVER);
		// The headline structural assertion: the corrected query is the FIRST thing tried.
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('https://api.deezer.com/search');
		expect(calls[0]).toContain(encodeURIComponent(sArtist));
		expect(calls[0]).toContain(encodeURIComponent(sTitle));
		expect(calls[0]).not.toContain(encodeURIComponent(TRAD_ARTIST));
		expect(calls[0]).not.toContain(encodeURIComponent(TRAD_TITLE));
	});

	it('(b) ZERO-COST: a non-Chinese query is never converted and never gets Fallback A', async () => {
		const { calls } = stubBy(missByHost);
		expect(await resolveCoverTiered('song', 'Nobody', 'Nothing', fresh())).toBeNull();
		// 3 tiers + Fallback B only — Fallback A would be a byte-identical duplicate, so it is skipped.
		expect(calls).toHaveLength(4);
		expect(calls[0]).toContain(encodeURIComponent('Nobody Nothing'));
	});

	it('(b) ZERO-COST: an already-Simplified query gets no substitution and no extra subrequest', async () => {
		const { calls } = stubBy(missByHost);
		expect(await resolveCoverTiered('song', '周杰伦', '止战之殇', fresh())).toBeNull();
		expect(calls).toHaveLength(4); // same 4 as the non-Chinese case — no Fallback A
		// Every outgoing URL carries the INPUT form; nothing was rewritten.
		for (const c of calls.slice(0, 3)) {
			expect(c).toContain(encodeURIComponent('周杰伦'));
			expect(c).toContain(encodeURIComponent('止战之殇'));
		}
		expect(calls[3]).toContain(encodeURIComponent('止战之殇'));
		expect(calls[3]).not.toContain(encodeURIComponent('周杰伦'));
	});

	it('(c) the Simplified chain missing all 3 tiers → Fallback A retries the ORIGINAL terms', async () => {
		const [sArtist] = await simplified();
		const { calls } = stubBy((u) =>
			u.includes('api.deezer.com') && u.includes(encodeURIComponent(TRAD_ARTIST))
				? DZ_HIT
				: missByHost(u)
		);
		const out = await resolveCoverTiered('song', TRAD_ARTIST, TRAD_TITLE, fresh());
		expect(out).toBe(DZ_COVER);
		expect(calls).toHaveLength(4);
		// Call order: 3 tiers on the Simplified form, THEN Deezer on the original form.
		for (const c of calls.slice(0, 3)) {
			expect(c).toContain(encodeURIComponent(sArtist));
			expect(c).not.toContain(encodeURIComponent(TRAD_ARTIST));
		}
		expect(calls[3]).toContain('https://api.deezer.com/search');
		expect(calls[3]).toContain(encodeURIComponent(TRAD_ARTIST));
		expect(calls[3]).toContain(encodeURIComponent(TRAD_TITLE));
	});

	it('(d) Fallback A missing too → Fallback B (title-only, ORIGINAL title) hits', async () => {
		const { calls } = stubBy((u) =>
			u.includes('api.deezer.com') &&
			u.includes(encodeURIComponent(TRAD_TITLE)) &&
			!u.includes(encodeURIComponent(TRAD_ARTIST))
				? DZ_HIT
				: missByHost(u)
		);
		const out = await resolveCoverTiered('song', TRAD_ARTIST, TRAD_TITLE, fresh());
		expect(out).toBe(DZ_COVER);
		expect(calls).toHaveLength(5); // 3 tiers + A + B — the documented worst case
		expect(calls[4]).toContain('https://api.deezer.com/search');
		expect(calls[4]).toContain(encodeURIComponent(TRAD_TITLE));
		expect(calls[4]).not.toContain(encodeURIComponent(TRAD_ARTIST));
	});

	it('(e) everything missing stays a cacheable negative (null) at exactly 5 resolve calls', async () => {
		const { calls } = stubBy(missByHost);
		expect(await resolveCoverTiered('song', TRAD_ARTIST, TRAD_TITLE, fresh())).toBeNull();
		expect(calls).toHaveLength(5);
	});

	it('a fallback that FAULTS yields ERROR (never negative-cached)', async () => {
		stubBy((u) =>
			u.includes('api.deezer.com') && !u.includes(encodeURIComponent(TRAD_ARTIST))
				? 'THROW'
				: missByHost(u)
		);
		expect(await resolveCoverTiered('song', TRAD_ARTIST, TRAD_TITLE, fresh())).toBe('ERROR');
	});

	it('type=artist never issues Fallback B (an artist card has no title)', async () => {
		const { calls } = stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		expect(await resolveCoverTiered('artist', 'Nobody', '', fresh())).toBeNull();
		expect(calls).toHaveLength(3);
	});

	it('an empty artist never issues Fallback B (it would repeat the query just run)', async () => {
		const { calls } = stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		expect(await resolveCoverTiered('song', '', 'Nothing', fresh())).toBeNull();
		expect(calls).toHaveLength(3);
	});

	it('the route still answers 200 + the branded card when every fallback misses', async () => {
		const { calls } = stubRoute({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
		// Non-Chinese input: 3 tiers + Fallback B, 0 image. The Traditional worst case is 5 + 1.
		expect(calls).toHaveLength(4);
	});
});

describe('og-cover — miss vs error (only a clean miss is cacheable)', () => {
	it('returns null when every tier cleanly misses (cacheable negative)', async () => {
		stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		const out = await resolveCoverTiered('song', 'No', 'Match', fresh());
		expect(out).toBeNull();
	});

	it("returns 'ERROR' when a tier faults and no tier hits (never negative-cached)", async () => {
		stubTiers({ dz: 'THROW', it: IT_MISS, kw: KW_MISS });
		const out = await resolveCoverTiered('song', 'No', 'Match', fresh());
		expect(out).toBe('ERROR');
	});

	it("treats a non-ok upstream as an ERROR, not a miss", async () => {
		stubTiers({ dz: DZ_MISS, it: 'NOTOK', kw: KW_MISS });
		const out = await resolveCoverTiered('song', 'No', 'Match', fresh());
		expect(out).toBe('ERROR');
	});

	it('treats kuwo contract drift (code !== 200 / non-array data) as an ERROR', async () => {
		stubTiers({ dz: DZ_MISS, it: IT_MISS, kw: JSON.stringify({ code: 500, data: null }) });
		const out = await resolveCoverTiered('song', 'No', 'Match', fresh());
		expect(out).toBe('ERROR');
	});

	it('an earlier fault never suppresses a later tier hit', async () => {
		const { calls } = stubTiers({ dz: 'NOTOK', it: IT_HIT });
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', fresh());
		expect(out).toBe(IT_ART_600);
		expect(calls).toHaveLength(2);
	});

	it('malformed JSON from a tier is an ERROR, never a throw out of resolveCoverTiered', async () => {
		stubTiers({ dz: '{ not json', it: '<html>', kw: 'nope' });
		const out = await resolveCoverTiered('song', 'A', 'B', fresh());
		expect(out).toBe('ERROR');
	});
});

describe('og-cover — the overall deadline is the hard ceiling', () => {
	it('a pre-aborted deadline resolves with ZERO fetch calls', async () => {
		const { calls } = stubTiers({ dz: DZ_HIT, it: IT_HIT, kw: KW_HIT });
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', AbortSignal.abort());
		expect(calls).toHaveLength(0);
		expect(out).toBeNull();
	});

	it('stops entering further tiers once the deadline aborts mid-chain', async () => {
		const ctl = new AbortController();
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				calls.push(String(input));
				ctl.abort(); // the OG_RESOLVE_MS deadline expires while tier 1 is in flight
				return new Response(DZ_MISS, { status: 200 });
			})
		);
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', ctl.signal);
		// An expired budget skips the remaining tiers AND BOTH quick-260807-vl1 fallbacks.
		expect(calls).toHaveLength(1);
		expect(out).toBeNull();
	});

	it('OG_RESOLVE_MS is 5000 — the measured 4.12s CJK cold resolve + headroom (quick-260807-vl1)', () => {
		// Derived, not arbitrary: Latin cold resolves measured 0.66–0.84s but CJK 4.12s, and
		// 30-RESEARCH.md §D puts crawler fetch budgets at 3–10s, so 5000 stays in tolerance.
		expect(OG_RESOLVE_MS).toBe(5000);
	});

	it('an empty artist AND title resolves with ZERO fetch calls (T-og-01)', async () => {
		const { calls } = stubTiers({ dz: DZ_HIT, it: IT_HIT, kw: KW_HIT });
		const out = await resolveCoverTiered('song', '  ', '  ', fresh());
		expect(calls).toHaveLength(0);
		expect(out).toBeNull();
	});
});

describe('og-cover — per-tier host allow-lists (T-wv8-05, one per tier)', () => {
	it('safeItunesImageUrl allows only https *.mzstatic.com', () => {
		expect(safeItunesImageUrl(IT_ART_600)).toBe(IT_ART_600);
		expect(safeItunesImageUrl(IT_ART_600.replace('https:', 'http:'))).toBeNull();
		// a Deezer/kuwo host must NOT pass the iTunes allow-list
		expect(safeItunesImageUrl(DZ_COVER)).toBeNull();
		expect(safeItunesImageUrl(KW_PIC)).toBeNull();
		expect(safeItunesImageUrl('https://evil-mzstatic.com/x.jpg')).toBeNull();
	});

	it('safeKuwoImageUrl allows only https *.kuwo.cn', () => {
		expect(safeKuwoImageUrl(KW_PIC)).toBe(KW_PIC);
		expect(safeKuwoImageUrl(KW_PIC.replace('https:', 'http:'))).toBeNull();
		expect(safeKuwoImageUrl(DZ_COVER)).toBeNull();
		expect(safeKuwoImageUrl(IT_ART_600)).toBeNull();
		expect(safeKuwoImageUrl('https://kuwo.cn.evil.example/x.jpg')).toBeNull();
	});

	it('both reject CSS/attribute breakers and never throw on null/empty/unparseable', () => {
		for (const bad of ['(', ')', ' ', '"', "'", '\\']) {
			expect(safeItunesImageUrl(`https://is1-ssl.mzstatic.com/a${bad}b.jpg`)).toBeNull();
			expect(safeKuwoImageUrl(`https://img4.kuwo.cn/a${bad}b.jpg`)).toBeNull();
		}
		expect(safeItunesImageUrl(null)).toBeNull();
		expect(safeKuwoImageUrl(undefined)).toBeNull();
		expect(safeItunesImageUrl('')).toBeNull();
		expect(safeKuwoImageUrl('not-a-url')).toBeNull();
	});

	it('a tier smuggling ANOTHER tier’s host is rejected by its own allow-list and falls through', async () => {
		// Deezer JSON naming an mzstatic cover → rejected → iTunes answers instead.
		const { calls } = stubTiers({
			dz: JSON.stringify({ data: [{ album: { cover_big: IT_ART_600 } }], total: 1 }),
			it: IT_HIT
		});
		const out = await resolveCoverTiered('song', 'Nirvana', 'Come As You Are', fresh());
		expect(out).toBe(IT_ART_600); // via the iTunes tier, whose allow-list DOES cover mzstatic
		expect(calls).toHaveLength(2);
	});

	it('an iTunes body naming a kuwo host is rejected and falls through to kuwo', async () => {
		const { calls } = stubTiers({
			dz: DZ_MISS,
			it: JSON.stringify({ results: [{ artworkUrl100: KW_PIC }] }),
			kw: KW_HIT
		});
		const out = await resolveCoverTiered('song', 'A', 'B', fresh());
		expect(out).toBe(KW_PIC);
		expect(calls).toHaveLength(3);
	});
});

describe('og-cover — closed type set + branded fallback constant', () => {
	it('isOgType accepts exactly song/album/artist', () => {
		expect(isOgType('song')).toBe(true);
		expect(isOgType('album')).toBe(true);
		expect(isOgType('artist')).toBe(true);
		expect(isOgType('banana')).toBe(false);
		expect(isOgType('')).toBe(false);
	});

	it('the branded fallback is a RASTER, never an SVG (quick-260807-vl1)', () => {
		// The hard gate: no major platform renders an SVG og:image (30-RESEARCH §C.11/§D.15), which
		// is what made the user's WhatsApp card come through blank.
		expect(OG_FALLBACK_TYPE).toMatch(/^image\/(png|jpeg)$/);
		expect(OG_FALLBACK_TYPE).not.toBe('image/svg+xml');
		expect(OG_FALLBACK_BYTES.length).toBeGreaterThan(1000);
		expect(magicOf(OG_FALLBACK_BYTES)).toBe(OG_FALLBACK_TYPE);
	});
});

// ---------------------------------------------------------------------------------------------
// ROUTE LEVEL — src/routes/api/og/+server.ts (OG-EP-02)
// ---------------------------------------------------------------------------------------------

const JPEG_BODY = 'JPEG-BYTES';

type ImageReply = 'jpeg' | 'png' | 'html' | 'nolength' | 'THROW' | 'NOTOK';

/**
 * Stub fetch for the WHOLE route: the three tier hosts plus the image-bytes fetch (any other
 * host — the cover URL always lives on a tier's own allow-listed CDN). Returns the call log so
 * "no second upstream fetch" and "≤4 subrequests" are assertable.
 */
function stubRoute(replies: { dz?: TierReply; it?: TierReply; kw?: TierReply; image?: ImageReply }) {
	const calls: string[] = [];
	const spy = vi.fn(async (input: RequestInfo | URL) => {
		const u = String(input);
		calls.push(u);
		if (u.includes('api.deezer.com') || u.includes('itunes.apple.com') || u.includes('kw-api')) {
			const reply = u.includes('api.deezer.com')
				? replies.dz
				: u.includes('itunes.apple.com')
					? replies.it
					: replies.kw;
			if (reply === undefined || reply === 'THROW') throw new Error('network down');
			if (reply === 'NOTOK') return new Response('upstream error', { status: 500 });
			return new Response(reply, { status: 200, headers: { 'content-type': 'application/json' } });
		}
		const img = replies.image ?? 'jpeg';
		if (img === 'THROW') throw new Error('cdn down');
		if (img === 'NOTOK') return new Response('gone', { status: 404 });
		if (img === 'html') {
			// A CDN error page must NEVER be relayed as the card image (T-30-04).
			return new Response('<html>nope</html>', {
				status: 200,
				headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '17' }
			});
		}
		const headers: Record<string, string> = {
			'content-type': img === 'png' ? 'image/png' : 'image/jpeg; charset=binary'
		};
		if (img !== 'nolength') headers['content-length'] = String(JPEG_BODY.length);
		return new Response(JPEG_BODY, { status: 200, headers });
	});
	vi.stubGlobal('fetch', spy);
	return { calls, spy };
}

/** In-memory caches.default (the harness at deezer-endpoint.test.ts:279-347). */
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			putKeys.push(req.url);
			store.set(req.url, res.clone());
		})
	};
	vi.stubGlobal('caches', { default: cacheStub });
	return { store, putKeys, cacheStub };
}

function fakeEvent(search: Record<string, string>, origin = 'https://openmusic.lol') {
	const url = new URL('https://openmusic.lol/api/og');
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		// platform: undefined PROVES the endpoint needs no key/secret — all three tiers are keyless.
		platform: undefined,
		request: new Request(url, { headers: { origin } })
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callGET = (event: ReturnType<typeof fakeEvent>) => GET(event as any);

const SONG = { type: 'song', artist: 'Nirvana', title: 'Come As You Are' };

describe('/api/og — zero-work short-circuit + input coercion', () => {
	it('no artist and no title → 200 branded raster with ZERO subrequests (T-og-01)', async () => {
		const { calls } = stubRoute({});
		const res = await callGET(fakeEvent({ type: 'song' }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
		expect(res.headers.get('Content-Length')).toBe(String(OG_FALLBACK_BYTES.length));
		expect(calls).toHaveLength(0);
		// The body is the real raster: magic bytes must match the declared type.
		expect(magicOf(new Uint8Array(await res.arrayBuffer()))).toBe(OG_FALLBACK_TYPE);
	});

	it('a type outside the closed set is COERCED to song (never a 404/500)', async () => {
		const { calls } = stubRoute({ dz: DZ_HIT });
		const res = await callGET(fakeEvent({ ...SONG, type: 'banana' }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		// song semantics: the Deezer ALBUM cover, not the artist picture
		expect(calls.filter((c) => c.includes('cdn-images.dzcdn.net'))[0]).toBe(DZ_COVER);
	});

	it('caps pathological input length instead of building a giant upstream URL', async () => {
		const { calls } = stubRoute({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		const res = await callGET(fakeEvent({ type: 'song', artist: 'a'.repeat(5000), title: 'b' }));
		expect(res.status).toBe(200);
		expect(calls[0]).toContain(encodeURIComponent('a'.repeat(200)));
		expect(calls[0]).not.toContain(encodeURIComponent('a'.repeat(201)));
	});
});

describe('/api/og — streams image bytes (never a 30x, never a 500)', () => {
	it('a tier hit → 200 image/jpeg, immutable 24h Cache-Control, body streamed through', async () => {
		const { calls } = stubRoute({ dz: DZ_HIT });
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
		expect(await res.text()).toBe(JPEG_BODY);
		// worst case for this path: 1 resolve + 1 image = 2 subrequests
		expect(calls).toHaveLength(2);
	});

	it('an upstream image serving text/html falls back to the branded card (T-30-04)', async () => {
		stubRoute({ dz: DZ_HIT, image: 'html' });
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
		expect(magicOf(new Uint8Array(await res.arrayBuffer()))).toBe(OG_FALLBACK_TYPE);
	});

	it('a failed / non-ok image fetch falls back branded rather than 500ing', async () => {
		stubRoute({ dz: DZ_HIT, image: 'THROW' });
		const thrown = await callGET(fakeEvent(SONG));
		expect(thrown.status).toBe(200);
		expect(thrown.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);

		vi.unstubAllGlobals();
		stubRoute({ dz: DZ_HIT, image: 'NOTOK' });
		const notOk = await callGET(fakeEvent(SONG));
		expect(notOk.status).toBe(200);
		expect(notOk.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
	});

	it('every tier faulting still returns 200 + the branded card', async () => {
		stubRoute({ dz: 'THROW', it: 'THROW', kw: 'THROW' });
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
	});

	it('a throwing Cache API cannot 500 the route', async () => {
		stubRoute({ dz: DZ_HIT });
		vi.stubGlobal('caches', {
			default: {
				match: vi.fn(async () => {
					throw new Error('cache exploded');
				}),
				put: vi.fn(async () => {
					throw new Error('cache exploded');
				})
			}
		});
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
	});

	it('OPTIONS → 204 with own-origin CORS (never *)', async () => {
		const res = await OPTIONS({
			request: new Request('https://openmusic.lol/api/og', {
				headers: { origin: 'https://openmusic.lol' }
			})
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://openmusic.lol');
	});

	it('an origin outside the allow-list gets NO Access-Control-Allow-Origin', async () => {
		stubRoute({ dz: DZ_HIT });
		const res = await callGET(fakeEvent(SONG, 'https://evil.example'));
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});

describe('/api/og — two caches.default layers, both keyed own-origin', () => {
	it('serves the second identical request from the BYTES layer with no further upstream fetch', async () => {
		const { calls } = stubRoute({ dz: DZ_HIT });
		const { cacheStub } = stubCache();

		const res1 = await callGET(fakeEvent(SONG));
		expect(await res1.text()).toBe(JPEG_BODY);
		expect(calls).toHaveLength(2); // resolve + image
		expect(cacheStub.put).toHaveBeenCalledTimes(2); // resolve layer + bytes layer

		const res2 = await callGET(fakeEvent(SONG, 'http://localhost:5173'));
		expect(calls).toHaveLength(2); // NO second upstream fetch
		expect(await res2.text()).toBe(JPEG_BODY);
		expect(res2.headers.get('content-type')).toBe('image/jpeg');
		expect(res2.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable');
		// CORS re-applied for THIS request's origin (WR-01) — the stored copy is CORS-free.
		expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('both cache keys are OWN-ORIGIN, never a tier upstream URL (T-wv8-06)', async () => {
		stubRoute({ dz: DZ_HIT });
		const { putKeys } = stubCache();
		await callGET(fakeEvent(SONG));
		expect(putKeys).toHaveLength(2);
		for (const key of putKeys) {
			expect(key).toContain('openmusic.lol/api/og');
			expect(key).not.toContain('api.deezer.com');
			expect(key).not.toContain('itunes.apple.com');
			expect(key).not.toContain('kw-api');
			expect(key).not.toContain('cdn-images.dzcdn.net');
		}
	});

	it('param-order variants share ONE resolve entry (matchKey-normalized layer-1 key)', async () => {
		const { calls } = stubRoute({ dz: DZ_HIT });
		stubCache();
		await callGET(fakeEvent({ type: 'song', artist: 'Nirvana', title: 'Come As You Are' }));
		// different query serialization AND the hyphen-for-space share loss → same matchKey
		await callGET(fakeEvent({ title: 'Come-As-You Are', artist: 'Nirvana', type: 'song' }));
		const tierCalls = calls.filter((c) => c.includes('api.deezer.com'));
		expect(tierCalls).toHaveLength(1); // resolve reused
		expect(calls).toHaveLength(3); // 1 resolve + 2 image (bytes key differs by query order)
	});

	it("a clean all-miss IS negative-cached; the repeat costs ZERO subrequests", async () => {
		const { calls } = stubRoute({ dz: DZ_MISS, it: IT_MISS, kw: KW_MISS });
		const { putKeys } = stubCache();
		const res1 = await callGET(fakeEvent(SONG));
		expect(res1.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
		// 3 tiers + Fallback B (title-only). Fallback A is skipped — 'Nirvana' is not substituted.
		expect(calls).toHaveLength(4);
		expect(putKeys).toHaveLength(1); // resolve layer only — there are no bytes to store

		const res2 = await callGET(fakeEvent(SONG));
		expect(calls).toHaveLength(4); // known-none served from the resolve layer
		expect(res2.headers.get('content-type')).toBe(OG_FALLBACK_TYPE);
	});

	it("resolveCoverTiered 'ERROR' writes NOTHING to either layer", async () => {
		stubRoute({ dz: 'THROW', it: IT_MISS, kw: KW_MISS });
		const { cacheStub } = stubCache();
		const res = await callGET(fakeEvent(SONG));
		expect(res.status).toBe(200);
		expect(cacheStub.put).not.toHaveBeenCalled();
	});

	it('an image with no Content-Length still streams, but is NOT buffered into the cache (T-og-02)', async () => {
		stubRoute({ dz: DZ_HIT, image: 'nolength' });
		const { putKeys } = stubCache();
		const res = await callGET(fakeEvent(SONG));
		expect(await res.text()).toBe(JPEG_BODY);
		expect(putKeys).toHaveLength(1); // resolve layer only
	});
});

describe('itunes-cover — upgradeArtwork keeps its client default and takes an /api/og size', () => {
	it('defaults to 1200x1200bb (client tiles unchanged)', () => {
		expect(upgradeArtwork(IT_ART_100)).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/Music/aa/bb/cc/1200x1200bb.jpg'
		);
	});

	it('swaps to the requested size when one is passed (600x600bb = 101 KB, not 332 KB)', () => {
		expect(upgradeArtwork(IT_ART_100, '600x600bb')).toBe(IT_ART_600);
	});

	it('still returns unchanged/null for a URL without the token or empty input', () => {
		expect(upgradeArtwork('https://is1-ssl.mzstatic.com/image/x.jpg', '600x600bb')).toBe(
			'https://is1-ssl.mzstatic.com/image/x.jpg'
		);
		expect(upgradeArtwork('  ', '600x600bb')).toBeNull();
		expect(upgradeArtwork(null, '600x600bb')).toBeNull();
	});
});
