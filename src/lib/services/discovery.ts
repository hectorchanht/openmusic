// Resolve-on-tap shim (Phase 9, D-03) — THE LOAD-BEARING transform.
//
// Discovery items are Last.fm {artist, title} stubs: they have no uid/source/audioUrl,
// so they are NOT Tracks and cannot be handed to player.play() directly the way the
// existing pages hand real Tracks. resolveStub re-searches the stub through the EXISTING
// searchAll + dedupeBest resolver (the same path picks.ts/similar.ts use) and returns
// the best playable Track, or null on a miss.
//
// Strictly LAZY / on-tap (CONTEXT discretion): resolve ONLY the tapped item — one tap →
// one searchAll — never eager-resolve a whole shelf or album (Pitfall 11 fan-out).
// Graceful degrade (D-03): null → caller shows unplayable / skips, never breaks the
// surface or the player. catalog.ts / dedupe.ts are pure reuse — NOT modified here.
import { searchAll } from '$lib/services/catalog';
import { dedupeBest, normField, preferenceOrder, cjkTitleOf } from '$lib/services/dedupe';
import { rankPool, partitionOfficial, isAutoAcceptable, isAutoAcceptableArtist } from '$lib/services/song-variant';
import { tier1Only } from '$lib/sources/registry';
import { scoreMatch } from '$lib/services/score-match';
import { foldScript, isChineseLine, ensureFoldReady, foldScriptReady } from '$lib/services/zh-convert';
import { detectLang } from '$lib/i18n/detect';
import { isStrongMatch, lookupChineseName, type ZhName } from '$lib/services/name-rescue';
import { settings } from '$lib/stores/settings.svelte';
import { isAutoResolveEligible } from '$lib/sources/registry';
import type { Track } from '$lib/sources/types';

/** quick-260926-c69: one attempt's best row per auto-resolve partition (see attempt). */
export type Bests = { eligible: Track | null; ineligible: Track | null };

/**
 * ONE search+score pass: searchAll → dedupeBest → scoreMatch stable-max. Extracted
 * (quick-260808-urx) so the t2s retry below reuses it VERBATIM instead of duplicating the
 * loop — and so the retry scores against the CONVERTED query, matching what it searched.
 *
 * SCORED (LFSRC-03 / D-02): instead of blindly taking dedupeBest[0] — which can be a
 * karaoke/cover/live/instrumental variant of the song the user tapped — re-rank the deduped
 * candidates by scoreMatch and return the top-scored one. dedupeBest still collapses same-song
 * dupes and orders by quality + preferredSource, so a STABLE max (keeping the earlier
 * dedupeBest position on equal scores) makes that ordering the FINAL tie-break among
 * similarly-scored candidates (D-02 tie-break). Throws only what searchAll throws — the
 * never-throw boundary is resolveStub's single try/catch.
 *
 * quick-260926-c69: ranks auto-resolve ELIGIBLE and INELIGIBLE rows separately (registry flag via
 * isAutoResolveEligible — no source named here) and returns both bests; preferEligible decides.
 */
async function attempt(
	artist: string,
	title: string,
	accept?: (t: Track) => boolean
): Promise<Bests> {
	// quick-261020-speed: TIERED SEARCH. Tier-1 (qq/joox/kuwo/netease/suyin) covers ~95% of
	// plays; searching only those 5 first cuts the fan-out from 14 sources to 5 (~5s → ~2s).
	// Only when tier-1 yields NO official version do we expand to the full set (for
	// obscure/long-tail songs the tail sources cover).
	const query = { artist, title };
	// quick-261102-sdm: the artist gate + ranking below compare folded keys — warm the fold
	// first, or a cold dict keys 周傑倫 ≠ 周杰伦 and rejects the official row (the brief's
	// "cold dictionary got official versions rejected" incident).
	await foldScriptReady(`${artist} ${title}`);
	const tier1 = await searchAll(`${artist} ${title}`, 1, tier1Only());
	// quick-261102-sy0: only ACCEPTABLE rows can satisfy tier-1 — a plain-titled cover by another
	// artist used to count as "official", suppress the full fan-out, then get filtered out of the
	// pick, so kugou/migu were never searched and the song came back null.
	const { official } = partitionOfficial(
		tier1.interleaved.filter((t) => isAutoAcceptable(query, t)),
		title
	);
	const useFull = official.length === 0;
	const r = useFull ? await searchAll(`${artist} ${title}`, 1) : tier1;
	const pick = (rows: Track[]): Track | null => {
		// quick-261102-sy0 (DECISIONS.md §3): THE auto-play acceptance predicate gates the pool
		// BEFORE ranking — same song (identity or duet credit), same kind of recording, same
		// artist (quick-261102-cov1: a covers-only pool — netease's 10 fan covers of
		// 周杰倫《說了再見》 — returns null instead of 阿傑's cover).
		let candidates = rows.filter((t) => isAutoAcceptable(query, t));
		// quick-260925-wa7: the name rescue ranks only the rows it would accept (see rescueLatin).
		if (accept) candidates = candidates.filter(accept);
		if (candidates.length === 0) return null;
		// quick-261020-off1: rankPool (quick-261102-t7i) ranks the OFFICIAL pool first. quick-261102-sy0: the
		// tie-break order is preferenceOrder (quality → preferred source → PLAYBACK_ORDER) WITHOUT
		// dedupeBest's collapse — that collapse merged 偏偏喜歡你 into its 320K 鈴聲 copy before
		// the partition ran, so the 48-second ringtone was the only row left to pick.
		return (
			rankPool(preferenceOrder(candidates, settings.preferredSource), title, {
				score: (c) => scoreMatch(query, c)
			})[0] ?? null
		);
	};
	// quick-260926-c69: partition BEFORE dedupeBest. Its same-key collapse is decided by quality →
	// settings.preferredSource → SOURCE_RANK, so a user-preferred ineligible source could otherwise
	// swallow its eligible same-song sibling and leave the eligible partition empty.
	return {
		eligible: pick(r.interleaved.filter((t) => isAutoResolveEligible(t.source))),
		ineligible: pick(r.interleaved.filter((t) => !isAutoResolveEligible(t.source)))
	};
}

/**
 * quick-260926-c69 — isStrongMatch with Traditional/Simplified folded on BOTH sides. isStrongMatch
 * compares through the identity field normalizer (dedupe normField, script-folded since
 * quick-261102-sjg), so this only guarantees the fold is warm when a string carries Chinese —
 * Latin/JA/KO paths never load the dict. Never throws.
 */
async function strongFolded(query: ZhName, cand: ZhName): Promise<boolean> {
	if ([query.artist, query.title, cand.artist, cand.title].some(isChineseLine)) await ensureFoldReady();
	return isStrongMatch(query, cand);
}

/**
 * quick-260926-c69 — the selection rule. An eligible row wins only when it genuinely (strongly)
 * matches; a strong ineligible (ytmusic) row beats a weak/wrong eligible one — never play a wrong
 * song; with nothing strong, today's result: the best eligible weak row, else the best ineligible
 * one, else null. The `?? ineligible` tail is what keeps ytmusic the LAST RESORT — do not remove it.
 *
 * quick-261102-cov1: the weak fallback is additionally ARTIST-gated (see the check in the
 * body). wrong1 verified only the title; the 2026-11-02 incident is the other half of
 * "wrong song" — the RIGHT title by the WRONG artist （阿傑's cover of 說了再見 for a
 * 周杰倫 tap). A different-artist weak row now returns null like a wrong-title one.
 */
export async function preferEligible(query: ZhName, bests: Bests): Promise<Track | null> {
	const { eligible, ineligible } = bests;
	if (eligible && (await strongFolded(query, eligible))) return eligible;
	if (ineligible && (await strongFolded(query, ineligible))) return ineligible;
	const fallback = eligible ?? ineligible;
	// quick-261102-cov1: a weak row credited to a clearly DIFFERENT artist is a cover /
	// another act's song, never a stand-in for the tapped artist — veto it BEFORE the
	// title check below. (attempt's pick already filters its own bests through the same
	// gate; this is the explicit bar at the selection seam, and it covers any caller
	// that hands preferEligible bests built elsewhere.)
	if (fallback && !isAutoAcceptableArtist(query.artist, fallback.artist)) {
		return null;
	}
	// quick-261020-wrong1: NEVER return a weak match with a completely different title —
	// that plays the wrong song (e.g. 說了再見 → 擱淺). The folded titles must share
	// significant overlap, otherwise return null and let the caller handle the miss.
	if (fallback) {
		// quick-261102-sjg: the identity's field normalizer, not a local fold + lowercase copy.
		const qTitle = normField(query.title || '');
		const cTitle = normField(fallback.title || '');
		// Titles match if one contains the other, or they share >= 50% of the query's chars.
		const contains = qTitle && cTitle && (qTitle.includes(cTitle) || cTitle.includes(qTitle));
		if (!contains) {
			let overlap = 0;
			const cSet = new Set(cTitle);
			for (const ch of qTitle) if (cSet.has(ch)) overlap++;
			if (qTitle.length === 0 || overlap / qTitle.length < 0.5) return null;
		}
	}
	return fallback;
}

/**
 * Resolve a Last.fm {artist, title} stub to a playable Track via searchAll + dedupeBest, scored
 * (see attempt above).
 *
 * Returns the best cross-source match, or null ONLY when searchAll yields zero results /
 * on any failure (D-03 — no score threshold ever nulls a found result). Never throws
 * (best-effort, like buildDiversePicks / buildSimilarQueue).
 *
 * quick-260808-urx — T2S RESCUE-ON-MISS. A Chinese-script miss gets EXACTLY ONE retry with the
 * Traditional→Simplified-normalized terms, because the CN catalogs index the SIMPLIFIED name
 * (production-probed in quick-260807-vl1: 周傑倫/止戰之殤 missed 3/3, 周杰伦/止战之殇 hit 4/4).
 *
 * WHY HERE, not in player.playStub: this is the SHARED resolver every resolve path routes
 * through — playStub taps, song-share page opens, long-press menus, the album batch resolve,
 * DownloadControl (~15 call sites). One rescue here fixes all of them; a playStub-only patch
 * would leave every sibling caller Traditional-blind. And the supersedence contract is satisfied
 * BY CONSTRUCTION, so player.svelte.ts needs ZERO changes (which also avoids growing the known
 * ~3000-line god object): playStub awaits resolveStub ONCE and re-checks
 * `gen !== this.pendingGen` immediately after that await (player.svelte.ts:2421) — which
 * necessarily runs after the retry's await too. A superseded resolve is discarded regardless of
 * how many internal searches ran. Do NOT add a second generation guard in here.
 *
 * DELIBERATE ASYMMETRY vs covers: og-cover.ts converts FIRST (Traditional missed every tier
 * deterministically on production, so converting first cost nothing and fixed it); playback
 * converts ON MISS only, because Traditional playback currently WORKS — CN sources happen to
 * index enough Traditional — and converting first would change a working path for no reason.
 * Rescue-on-miss is the conservative shape. What made that incidental behaviour load-bearing is
 * Half A putting Traditional in share URLs BY DESIGN; this retry removes the dependency.
 *
 * COST: zero for the common hit path and for every non-Chinese user. The t2s dict is lazy +
 * memoized (~22 KB gzip, quick-260807-vl1) and loads only on the first Chinese-script MISS. The
 * two gates below are what make that a guarantee rather than a hope, and each is pinned by an
 * exact searchAll call-count assertion in discovery.test.ts.
 *
 * quick-260925-wa7 — ENGLISH/ROMANIZED NAME RESCUE. Shelves/radio/charts carry the label's English
 * name for many Chinese songs ("Coral Sea — Jay Chou" = 珊瑚海 — 周杰倫). Those queries do not miss:
 * the CN catalogs return junk (a piano cover, a same-title K-pop song), which the D-03 "zero results
 * only" rule used to play. So for a CJK-FREE query whose first attempt is null or WEAK
 * (`!isStrongMatch`), lookupChineseName finds the Chinese names (YTM en↔zh-TW, then iTunes HK↔US)
 * and ONE Simplified re-search runs; its row is used only if it strongly matches the Chinese names,
 * otherwise today's result (the weak hit or null) comes back — the rescue never makes a resolve
 * worse. A strong first hit, and every CJK query, costs exactly what it did before (pinned by
 * call-count tests). lookupChineseName is never-throw and cached (hit 30 d / miss 1 d), so a re-tap
 * costs zero lookups. The supersedence contract above still holds by construction — playStub still
 * awaits ONE resolveStub call; do NOT add a generation guard here either.
 *
 * quick-260926-c69 — ELIGIBLE-FIRST. resolveStub now honours SourceAdapter.autoResolveEligible (the
 * registry flag, read via isAutoResolveEligible — never a source name), like fallback.ts and
 * catalog.ts resolveNameStub already did. Four-way rule (preferEligible): strong eligible → it;
 * else strong ineligible (ytmusic) → it; else weak eligible; else weak ineligible; else null. For a
 * Latin query with no strong eligible row the wa7 rescue runs FIRST, even when a ytmusic row is
 * strong — that row is exactly what the rescue exists to replace (web googlevideo 403s the edge
 * byte fetch). Cost: strong eligible = 1 search / 0 lookups; Latin with eligible weak-or-absent +
 * ytmusic strong = +1 lookup (cached) +1 search; a CJK query never looks up.
 */
export async function resolveStub(artist: string, title: string): Promise<Track | null> {
	try {
		const bests = await attempt(artist, title);
		const query = { artist, title };
		// quick-260926-c69 COMMON PATH — a strong eligible row: one searchAll, zero lookups.
		if (bests.eligible && (await strongFolded(query, bests.eligible))) return bests.eligible;
		// quick-261103-cjk (user report 2026-11-03): BILINGUAL TITLE SPLIT. A title like
		// "車匙 - Car Key" (ytmusic / label spelling) defeats the strict CN search
		// engines as written — live probe 2026-11-03: the full string returns junk or
		// nothing on kuwo / migu / netease, while the CJK half alone hits the original
		// (see dedupe.cjkTitleOf). So when the title has a CJK half and the full
		// attempt produced no strong eligible row, ONE more attempt searches the CJK
		// half alone (dedupe.cjkTitleOf). A Latin artist's CN rows are credited in
		// Chinese (陳柏宇, not Jason Chan), so the split pool's artist gate rejects
		// them all — that case bridges through the wa7 name rescue below, whose YTM
		// pairing accepts the bilingual title itself as the English-side evidence and
		// returns the Chinese credit to search with. Cost: zero on the common path
		// (strong eligible returns above); a bilingual miss pays +1 attempt, plus the
		// cached lookup when the artist is Latin.
		const cjkTitle = cjkTitleOf(title);
		if (cjkTitle) {
			// quick-261103-cjk3 (Hector): TITLE-TRUST first for a Latin artist — pure logic, NO
			// fetch. Search the CJK half ALONE; the ORIGINAL singer is the one multiple sources
			// resolve at once (Hector's rule: with a title-only search, the artist several CN
			// catalogues agree on IS the original — a cover artist sits on one source, the
			// original sits on all of them). Adopt that artist's best row when the consensus
			// is unambiguous (≥ 2 distinct sources, no tie). No name pairing is fetched — the
			// wa7/cjk2 rescue below stays as the fallback for pools with no consensus. The
			// artist-identity gate (quick-261102-cov1) is relaxed ONLY inside these fences:
			// bilingual stub + title-only pool + title EXACTLY the CJK half (a qualifier/version
			// tail fails the strict equality) + CJK credit + auto-resolve-eligible source
			// (user-upload platforms are ineligible, so a stranger's upload can never vote).
			if (detectLang(artist) === 'en') {
				const trusted = await titleTrust(cjkTitle).catch(() => null);
				if (trusted) return trusted;
				const rescued = await rescueLatin(artist, title).catch(() => null);
				if (rescued) return rescued;
			}
			const splitQuery = { artist, title: cjkTitle };
			const split = await attempt(artist, cjkTitle);
			if (split.eligible && (await strongFolded(splitQuery, split.eligible))) return split.eligible;
			// Settle from the split pool only when it produced an ELIGIBLE row — an
			// ineligible (ytmusic) split result must not pre-empt the full pool's own
			// weak eligible row in the preferEligible fall-through below.
			const settledSplit = await preferEligible(splitQuery, split);
			if (settledSplit && isAutoResolveEligible(settledSplit.source)) return settledSplit;
		}
		// quick-260925-wa7 GATE A — Latin: NO kana/hangul/Han in either field ('en' is detectLang's
		// "no CJK at all" verdict; isChineseLine alone would let JA/KO through).
		const latin = detectLang(artist) === 'en' && detectLang(title) === 'en';
		// GATE B (generalised, quick-260926-c69) — a Latin query with NO strong ELIGIBLE row runs the
		// rescue first, even when a ytmusic row is strong: that row is precisely what the rescue exists
		// to replace (live: the CN 再爱你/周兴哲 row is found via the YTM en↔zh-TW pair + one Simplified
		// re-search). On a miss the strong ytmusic row (or today's weak result) comes back. A thrown
		// re-search must not turn a hit into null (never worse).
		if (latin) {
			return (await rescueLatin(artist, title).catch(() => null)) ?? (await preferEligible(query, bests));
		}
		// quick-260926-c69: a CJK query with any candidate settles here (strong ytmusic beats weak
		// eligible; weak eligible beats weak ytmusic; ineligible-only returns the ytmusic row as today).
		// quick-261102-sdm: no Simplified re-search on a miss any more — searchAll folds every
		// keyword to Simplified before the fan-out, so the first attempt already WAS that search.
		return await preferEligible(query, bests);
	} catch {
		return null;
	}
}

/** quick-261103-cjk3: fold + case + whitespace only — see titleTrust for why normField is too lax here. */
function strictTitleKey(s: string): string {
	return foldScript(s || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * quick-261103-cjk3 — the title-trust pool scan (see the resolveStub call site for the rule and
 * its fences). Tier-1 first (the ~2 s fan-out); the full fan-out only when tier-1 holds no
 * trustable row. Never throws to the caller — the call site catch-guards it like the rescue.
 */
async function titleTrust(cjkTitle: string): Promise<Track | null> {
	await foldScriptReady(cjkTitle);
	// STRICT title equality: script fold + case + whitespace ONLY. normField would also strip
	// bracketed qualifier tails, so "車匙 (2016 Version)" would pass as "車匙" — a rendition the
	// stub never named must not be trusted in; it stays the rescue's job (which gates on the
	// rescued identity, versions included deliberately there).
	const key = strictTitleKey(cjkTitle);
	const consensus = (rows: Track[]): Track | null => {
		const hits = rows.filter(
			(t) => isAutoResolveEligible(t.source) && isChineseLine(t.artist) && strictTitleKey(t.title) === key
		);
		// Cross-source consensus (Hector's rule): group the exact-title rows by artist and count
		// DISTINCT sources per artist — suyin resolves through kuwo's catalogue, so the two
		// count as ONE vote. The original is the artist the catalogues agree on.
		const byArtist = new Map<string, { rows: Track[]; votes: Set<string> }>();
		for (const t of hits) {
			const a = normField(t.artist);
			const e = byArtist.get(a) ?? { rows: [], votes: new Set<string>() };
			e.rows.push(t);
			e.votes.add(t.source === 'suyin' ? 'kuwo' : t.source);
			byArtist.set(a, e);
		}
		let winner: { rows: Track[]; votes: Set<string> } | null = null;
		let ambiguous = false;
		for (const e of byArtist.values()) {
			if (e.votes.size < 2) continue; // a single-source artist is a cover until proven original
			if (!winner || e.votes.size > winner.votes.size) {
				winner = e;
				ambiguous = false;
			} else if (e.votes.size === winner.votes.size) {
				ambiguous = true; // two artists, equal catalogues — the rescue's identity evidence decides
			}
		}
		if (!winner || ambiguous) return null;
		return preferenceOrder(winner.rows, settings.preferredSource)[0] ?? null;
	};
	const tier1 = await searchAll(cjkTitle, 1, tier1Only());
	return consensus(tier1.interleaved) ?? consensus((await searchAll(cjkTitle, 1)).interleaved);
}

/**
 * quick-260925-wa7 — look up the Chinese names of a Latin {artist, title} and re-search ONCE with
 * them. CONVERTS TO SIMPLIFIED FIRST (as every search now does, quick-261102-sdm): the
 * 2026-09-26 probe showed Traditional "周杰倫 珊瑚海" → [] on QQ while "周杰伦 珊瑚海" hit, so
 * converting first costs one search instead of two. Accepted deviation, recorded in
 * 260925-wa7-CONTEXT.md. Candidates are folded to Simplified too, so a Traditional row still
 * matches. The re-search ranks ONLY rows that strongly match the Chinese names: a live probe with
 * QQ absent had a piano cover (纪钧瀚) tie a strong 周杰倫 row on scoreMatch and win the stable max,
 * which a top-row-only check would have thrown away. Null (no lookup / no strong row) → the caller
 * keeps its original result.
 *
 * quick-260926-c69: returns ONLY the eligible partition — the ineligible one is discarded on
 * purpose; a ytmusic row here would just reproduce the row the rescue is trying to replace.
 */
async function rescueLatin(artist: string, title: string): Promise<Track | null> {
	const zh = await lookupChineseName(artist, title);
	if (!zh) return null;
	const a2 = await foldScriptReady(zh.artist);
	const t2 = await foldScriptReady(zh.title);
	return (
		await attempt(a2, t2, (c) =>
			isStrongMatch({ artist: a2, title: t2 }, c)
		)
	).eligible;
}

// ---- Curated discovery sets (Phase 9, D-02 / CONTEXT discretion) ------------------
// The DISCOVERY_TAGS / DISCOVERY_COUNTRIES pools moved to the PURE home-layout module
// (quick-260606-w87) to break a circular import: settings.svelte.ts needs the pools for
// its default subsets but discovery.ts imports settings (inside resolveStub above). We
// RE-EXPORT them here so every existing consumer (and discovery.test.ts) keeps importing
// from `$lib/services/discovery` unchanged. Edit the pools in home-layout.ts.
export { DISCOVERY_TAGS, DISCOVERY_COUNTRIES } from '$lib/services/home-layout';

// ---- Randomize variation primitives (VX2) — shuffle()'s implementation now lives in shuffle.ts (39-D-19)
// Two PURE helpers used by the home page's 隨機推薦 / Randomize button to genuinely VARY
// the discovery surface on every press WITHOUT touching the never-throws builders, the
// caching robustness, or the edge security boundary:
//   - shuffle()        varies tile order (within each shelf) AND shelf order.
//   - pickRandomPage() varies WHICH Last.fm chart/tag/geo page is fetched.
// Neither pulls in a dependency and neither adds seeding — they use the same plain
// Math.random Fisher-Yates as picks.ts `sample()` (the established pattern in this repo).
export { shuffle } from './shuffle';

/**
 * Return a random INTEGER page in `[1, max]` inclusive (Last.fm pages are 1-based).
 * `max <= 1` (or fractional/zero/negative) → always 1. Never 0, never > max, never a
 * fraction. Feeds the optional `page` arg on the discovery builders so Randomize fetches
 * a different chart/tag/geo page each press. SECURITY (T-vx2-01): the result is a BOUNDED
 * positive integer, so the value the client sends to /api/lastfm/discovery?page= is never
 * an attacker-controlled string — the edge already encodeURIComponent's it.
 */
export function pickRandomPage(max: number): number {
	const m = Math.max(1, Math.floor(max) || 1);
	return Math.floor(Math.random() * m) + 1;
}

/**
 * Map `items` through `fn` with at most `limit` calls in flight at once (a small async
 * pool), preserving input order in the returned array (per Pitfall 11 — the home tag +
 * country shelf fan-out MUST be concurrency-capped, NOT an unbounded Promise.all over
 * every shelf). Default cap 4. NEVER throws: a per-item rejection is swallowed and that
 * slot resolves to `undefined` (the caller's `fn` is expected to already degrade to a
 * safe empty value — the discovery builders return `[]` — so a thrown slot is rare).
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const cap = Math.max(1, Math.floor(limit) || 1);
	const results = new Array<R>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		// Each worker pulls the next un-started index until the list is exhausted, so at
		// most `cap` fn() calls are ever in flight; the index → results slot keeps order.
		while (next < items.length) {
			const i = next++;
			try {
				results[i] = await fn(items[i]);
			} catch {
				// Swallow — leave the slot as-is (undefined). Never reject the whole pool.
			}
		}
	}

	const workers = Array.from({ length: Math.min(cap, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}
