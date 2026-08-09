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
import { dedupeBest } from '$lib/services/dedupe';
import { scoreMatch } from '$lib/services/score-match';
import { isChineseLine, t2sConvertLines } from '$lib/services/zh-convert';
import { settings } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/sources/types';

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
 */
async function attempt(artist: string, title: string): Promise<Track | null> {
	const r = await searchAll(`${artist} ${title}`, 1);
	// dedupeBest = the deduped, quality/preferredSource-ordered candidate list (FINAL
	// tie-break). Re-rank IT by scoreMatch with a stable max: only replace the current
	// best on a STRICTLY higher score, so equal scores keep the earlier dedupeBest slot.
	const candidates = dedupeBest(r.interleaved, settings.preferredSource);
	if (candidates.length === 0) return null;
	const query = { artist, title };
	let best = candidates[0];
	let bestScore = scoreMatch(query, best);
	for (let i = 1; i < candidates.length; i++) {
		const s = scoreMatch(query, candidates[i]);
		if (s > bestScore) {
			best = candidates[i];
			bestScore = s;
		}
	}
	return best;
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
 */
export async function resolveStub(artist: string, title: string): Promise<Track | null> {
	try {
		const hit = await attempt(artist, title);
		if (hit) return hit;
		// GATE 1 — script. Per-field, so a mixed Latin-artist / Chinese-title stub still qualifies.
		// isChineseLine rides the kana/hangul-FIRST classifier, so JA/KO lines return false and a
		// Japanese title is never wrongly Simplified-ified (D-04).
		if (!isChineseLine(artist) && !isChineseLine(title)) return null;
		const [a2, t2] = await t2sConvertLines([artist, title]);
		// GATE 2 — identity. The input was already Simplified (or the converter degraded to its
		// never-throw identity fallback): there is nothing new to search, so do not spend a call.
		if (a2 === artist && t2 === title) return null;
		return await attempt(a2, t2);
	} catch {
		return null;
	}
}

// ---- Curated discovery sets (Phase 9, D-02 / CONTEXT discretion) ------------------
// The DISCOVERY_TAGS / DISCOVERY_COUNTRIES pools moved to the PURE home-layout module
// (quick-260606-w87) to break a circular import: settings.svelte.ts needs the pools for
// its default subsets but discovery.ts imports settings (inside resolveStub above). We
// RE-EXPORT them here so every existing consumer (and discovery.test.ts) keeps importing
// from `$lib/services/discovery` unchanged. Edit the pools in home-layout.ts.
export { DISCOVERY_TAGS, DISCOVERY_COUNTRIES } from '$lib/services/home-layout';

// ---- Randomize variation primitives (VX2) ----------------------------------------
// Two PURE helpers used by the home page's 隨機推薦 / Randomize button to genuinely VARY
// the discovery surface on every press WITHOUT touching the never-throws builders, the
// caching robustness, or the edge security boundary:
//   - shuffle()        varies tile order (within each shelf) AND shelf order.
//   - pickRandomPage() varies WHICH Last.fm chart/tag/geo page is fetched.
// Neither pulls in a dependency and neither adds seeding — they use the same plain
// Math.random Fisher-Yates as picks.ts `sample()` (the established pattern in this repo).

/**
 * Return a NEW array that is a uniformly-shuffled permutation of `arr` (copy-then-
 * Fisher-Yates — identical algorithm to picks.ts `sample()` but keeping the FULL
 * permutation instead of slicing). MUST NOT mutate the input. `[]` → `[]`, `[x]` → `[x]`.
 * Used to reshuffle within-shelf tile order AND the order of the tag/country shelves so
 * Randomize is visibly different even when a fetched page returns overlapping tracks.
 */
export function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

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
