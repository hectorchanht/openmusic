// Random discovery dive (quick-261116-dtap, Car Mode plan Phase 3, Q3/Q6) — the service
// behind the cover double-tap. One call: play ONE track that is deliberately NOT what the
// user has been listening to — outside the current track's genre and outside the recent
// artists/genres from play history — through the NORMAL play path, so every existing gate
// (original-artist rule, quality adoption, the tap-to-Generate/Preserve setting) applies
// unchanged. Discovery never means a cover or a different-artist substitute: chart items
// are {artist, title} stubs resolved by player.tapStub, whose resolve chain enforces the
// artist gate exactly as a home discovery tap does.
//
// GENRE MODEL: the app has no per-track genre field; its genre vocabulary is the chart
// pool (CHART_GENRE_IDS in home-layout.ts) and its per-track genre signal is Last.fm tags
// (lastfm.ts enrichTrack / enrichArtist, 6h-cached, never-throw). So the dive:
//   1. reads the current track's tags + the tags of the RECENT_GENRE_ARTISTS most recent
//      distinct history artists, and maps them onto chart genres to BLOCK (alias table
//      below — a tag names the genre the user is already in);
//   2. draws a random UNBLOCKED chart genre and plays a random track from its pool
//      (genreChart — the same pools the home genre shelves read), skipping recent
//      artists and already-heard songs;
//   3. falls back to buildDiversePicks (the home top-picks / queue-grow grab-bag) when
//      every genre pool comes up dry, and to null when nothing resolves — the caller
//      toasts the same unplayable message a home discovery tap shows. Never silent.
// During a Never-Stop interlude (Phase 1) the sources are marked down, so the dive draws
// a random track from the LOCAL pool instead (player.playRandomPoolTrack) and reports
// kind 'local'; in the zero-asset retrying state the only honest move is an immediate
// revival probe (player.next()) and no result.
//
// The pure helpers (blockedGenres / filterCandidates / pickOne) are exported for the
// node test project; the orchestration is a thin store/service wiring over them.
import { player } from '$lib/stores/player.svelte';
import { history } from '$lib/stores/history.svelte';
import { logAction } from '$lib/stores/actionLog.svelte';
import { genreChart } from '$lib/services/charts';
import { enrichArtist, enrichTrack, type DiscoveryTrack } from '$lib/services/lastfm';
import { buildDiversePicks } from '$lib/services/picks';
import { matchKey, normField } from '$lib/services/dedupe';
import { shuffle } from '$lib/services/shuffle';
import { CHART_GENRE_IDS, type ChartGenre } from '$lib/services/home-layout';
import type { Track } from '$lib/sources/types';

/** What a dive landed on — the caller toasts by kind (genre name / local / any). */
export type RandomDiscoveryResult =
	| { kind: 'genre'; genre: ChartGenre }
	| { kind: 'any' }
	| { kind: 'local' };

/** Recent-history window for artist/song exclusion (entries, most-recent-first). */
export const RECENT_WINDOW = 20;
/** How many recent distinct artists contribute their Last.fm tags to the genre blocklist. */
export const RECENT_GENRE_ARTISTS = 5;
/** Genre pools tried per dive before the diverse-picks fallback. */
const GENRES_PER_DIVE = 3;
/** Resolutions attempted per genre pool (a dry/unresolvable pick tries the next item). */
const ITEMS_PER_GENRE = 3;

// ─── Pure: Last.fm tag → chart genre blocklist ────────────────────────────────────────
//
// Last.fm tags are free text ("hip-hop", "Hip Hop", "rap", "r&b", "K-Pop", "cantonese").
// The alias map is deliberately SMALL and exact-after-normalization: a tag blocks a genre
// only when it clearly NAMES that genre. A bare "pop" / "chinese" tag blocks nothing by
// itself ("chinese" is a language, not one chart genre — the specific cantonese/mandarin
// tags below carry that signal). The regional pop genres also block 'asian': Deezer's
// Asian pool overlaps all four, so a dive out of Cantopop must not land back in it.
const TAG_ALIASES: Record<string, ChartGenre[]> = {
	cantopop: ['cantopop', 'asian'],
	'cantonese pop': ['cantopop', 'asian'],
	cantonese: ['cantopop', 'asian'],
	mandopop: ['mandopop', 'asian'],
	'mandarin pop': ['mandopop', 'asian'],
	'k-pop': ['kpop', 'asian'],
	kpop: ['kpop', 'asian'],
	korean: ['kpop', 'asian'],
	'j-pop': ['jpop', 'asian'],
	jpop: ['jpop', 'asian'],
	japanese: ['jpop', 'asian'],
	'hip-hop': ['hiphop'],
	'hip hop': ['hiphop'],
	rap: ['hiphop'],
	rock: ['rock'],
	'alternative rock': ['alternative', 'rock'],
	alternative: ['alternative'],
	indie: ['alternative'],
	dance: ['dance'],
	electronic: ['electronic'],
	electronica: ['electronic'],
	edm: ['electronic'],
	'r&b': ['rnb'],
	rnb: ['rnb'],
	'rhythm and blues': ['rnb'],
	soul: ['rnb']
};

/** Normalize a Last.fm tag for alias lookup: lowercase, collapsed whitespace, trimmed. */
export function normalizeTag(tag: string): string {
	return (tag ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The chart genres a set of Last.fm tags says the user is already inside. Pure. */
export function blockedGenres(tags: readonly string[]): Set<ChartGenre> {
	const blocked = new Set<ChartGenre>();
	for (const raw of tags) {
		const hit = TAG_ALIASES[normalizeTag(raw)];
		if (hit) for (const g of hit) blocked.add(g);
	}
	return blocked;
}

// ─── Pure: candidate filtering ────────────────────────────────────────────────────────

/**
 * Drop chart items the dive must not land on: any item by a recent/current artist
 * (normField-folded, so 周杰伦 and 周傑倫 are the same artist) and any already-heard song
 * (matchKey identity). Pure — the caller builds the two exclusion sets from history.
 */
export function filterCandidates(
	items: readonly DiscoveryTrack[],
	excludeArtists: ReadonlySet<string>,
	excludeKeys: ReadonlySet<string>
): DiscoveryTrack[] {
	return items.filter((it) => {
		if (!it.artist?.trim() || !it.title?.trim()) return false;
		if (excludeArtists.has(normField(it.artist))) return false;
		if (excludeKeys.has(matchKey(it.artist, it.title))) return false;
		return true;
	});
}

/** One uniform pick from a non-empty list (null on empty). Pure given the rng. */
export function pickOne<T>(items: readonly T[], rng: () => number): T | null {
	if (items.length === 0) return null;
	return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

// ─── Orchestration ────────────────────────────────────────────────────────────────────

/**
 * Play one discovery track. Returns what it landed on, or null when nothing resolved
 * (the caller toasts unplayable — never a silent no-op). Never throws: every dependency
 * is never-throw by contract, and the whole body is guarded regardless, because this
 * runs off a gesture on the player surface where a throw would read as a dead tap.
 */
export async function playRandomDiscovery(
	rng: () => number = Math.random
): Promise<RandomDiscoveryResult | null> {
	try {
		// Zero-asset retrying (Q14): nothing local exists to dive into and the sources are
		// down — spend an immediate revival probe instead of pretending to pick.
		if (player.inRetrying) {
			logAction('dtap.probe', {});
			player.next();
			return null;
		}
		// Interlude (Phase 1): dive inside the local pool; the pick is pool by construction.
		if (player.inInterlude) {
			const played = player.playRandomPoolTrack(rng);
			if (played) logAction('dtap.local', { uid: played.uid });
			return played ? { kind: 'local' } : null;
		}

		const current = player.current;
		const recent = history.entries.slice(0, RECENT_WINDOW);
		const excludeArtists = new Set<string>();
		const excludeKeys = new Set<string>();
		for (const e of recent) {
			const a = normField(e.artist ?? '');
			if (a) excludeArtists.add(a);
			excludeKeys.add(matchKey(e.artist ?? '', e.title ?? ''));
		}
		if (current) {
			excludeArtists.add(normField(current.artist));
			excludeKeys.add(matchKey(current.artist, current.title));
		}

		// Genre blocklist: current track's tags + recent distinct artists' tags. All
		// enrich calls are 6h-cached and never-throw; a dry Last.fm simply blocks nothing
		// and the artist exclusion still carries the dive.
		const tagLists: Promise<string[]>[] = [];
		if (current) tagLists.push(enrichTrack(current).then((r) => r.tags));
		const seenArtists = new Set<string>();
		for (const e of recent) {
			if (seenArtists.size >= RECENT_GENRE_ARTISTS) break;
			const a = normField(e.artist ?? '');
			if (!a || seenArtists.has(a)) continue;
			seenArtists.add(a);
			tagLists.push(enrichArtist(e.artist).then((r) => r.tags));
		}
		const blocked = blockedGenres((await Promise.all(tagLists)).flat());

		const genreOrder = shuffle(
			CHART_GENRE_IDS.filter((g) => !blocked.has(g)),
			rng
		);
		for (const genre of genreOrder.slice(0, GENRES_PER_DIVE)) {
			const items = filterCandidates(await genreChart(genre), excludeArtists, excludeKeys);
			for (const item of shuffle(items, rng).slice(0, ITEMS_PER_GENRE)) {
				// The home discovery play path verbatim: tapStub resolves through the
				// original-artist gate and honours the user's tap Up-Next setting.
				const tr = await player.tapStub(item.artist, item.title, item.image ?? null, 'home-discovery');
				if (tr) {
					logAction('dtap.genre', { genre, uid: tr.uid });
					return { kind: 'genre', genre };
				}
			}
		}

		// Fallback: any resolvable random track from the diverse-picks grab-bag (still
		// preferring non-recent artists/songs; the unfiltered pool is the last resort).
		const picks = await buildDiversePicks(8);
		const fresh = picks.filter(
			(t: Track) =>
				!excludeArtists.has(normField(t.artist)) && !excludeKeys.has(matchKey(t.artist, t.title))
		);
		const pick = pickOne(fresh.length > 0 ? fresh : picks, rng);
		if (pick) {
			await player.play(pick, { fresh: true });
			logAction('dtap.any', { uid: pick.uid });
			return { kind: 'any' };
		}
		return null;
	} catch {
		return null; // never-throw boundary (see header)
	}
}
