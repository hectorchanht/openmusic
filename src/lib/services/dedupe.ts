// Presentation-layer cross-source dedupe + best-quality pick.
// NOT part of the Phase-1 data layer (catalog.ts is left untouched + its tests
// intact). Applied by the UI/picks layer to any list shown to the user so the
// same song surfaced by multiple sources collapses to one — the highest quality.
import type { SourceId, Track } from '$lib/sources/types';

// Tie-break when quality is equal/unknown. Tune freely.
// 5sing is UGC (covers / 伴奏 / 原创) — it should NEVER win a tie against a mainstream CN
// source, otherwise a Netease "Stargazing" would lose to a 5sing "Stargazing (Cover)" with
// equal quality. Rank lowest (hvu).
//
// Jamendo (ixw) is also non-mainstream — Creative-Commons indie. A Jamendo "Stargazing" is
// a DIFFERENT recording (some indie artist) than a Netease "Stargazing" (the Myles Smith
// track) — by design dedupe should NOT collapse them, but if normalization were to merge
// them, the mainstream version should win. Rank -1 so it sits below even fivesing.
//
// Audius (0zn) is likewise non-mainstream — Western/indie/UGC. Same reasoning as Jamendo:
// a DIFFERENT recording from the mainstream CN sources, so rank it at the bottom (-1) so a
// mainstream version always wins a tie if normalization ever merges them.
const SOURCE_RANK: Record<SourceId, number> = { netease: 4, qq: 3, kuwo: 2, joox: 1, fivesing: 0, jamendo: -1, audius: -1 };

/** Higher = better. Reads qualityLabel/quality strings (often null pre-resolve). */
function qualityRank(t: Track): number {
	const q = `${t.qualityLabel ?? ''} ${t.quality ?? ''}`.toLowerCase();
	if (/flac|lossless|atmos|hi-?res|\bsq\b|母带|无损/.test(q)) return 3;
	if (/320|\bhq\b|高品/.test(q)) return 2;
	if (/128|192|\baac\b|64/.test(q)) return 1;
	return 0;
}

/** Normalized identity key: title+artist, case/space/punct-insensitive, suffixes dropped. */
function key(t: Track): string {
	const norm = (s: string) =>
		(s || '')
			.toLowerCase()
			.replace(/[（(【\[].*?[)）\]】]/g, ' ') // drop (Live) / [Remaster] / 【...】
			.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ')
			.replace(/[^\p{L}\p{N}]+/gu, '') // strip all punctuation/space (keeps CJK + latin + digits)
			.trim();
	return `${norm(t.title)}|${norm(t.artist)}`;
}

/**
 * Two tracks are "the same song" iff their normalized title+artist keys match (WR-06). Reuses the
 * exact `key()` normalization dedupe applies so a cross-source fallback can verify a fuzzy upstream
 * search returned the SAME song before adopting it (a fuzzy search can return an unrelated track,
 * which would otherwise silently auto-play under the original track's identity). A blank/untitled
 * key is never considered a match (returns false) so we don't adopt garbage on a no-title stub.
 */
export function sameSongKey(a: Track, b: Track): boolean {
	const ka = key(a);
	if (!ka || ka === '|') return false;
	return ka === key(b);
}

function better(a: Track, b: Track, preferred?: SourceId): Track {
	const qa = qualityRank(a);
	const qb = qualityRank(b);
	if (qa !== qb) return qa > qb ? a : b;
	// quality tie → a user-preferred source wins, else the static source ranking
	if (preferred) {
		if (a.source === preferred && b.source !== preferred) return a;
		if (b.source === preferred && a.source !== preferred) return b;
	}
	return SOURCE_RANK[a.source] >= SOURCE_RANK[b.source] ? a : b;
}

/**
 * Group same-song-different-source variants WITHOUT collapsing them — the inverse view of
 * `dedupeBest`, used by the version picker (Phase 26-04, VERSIONS-01) to retain the pre-dedupe
 * cross-source variants the UI otherwise discards. Reuses the EXACT `key()` normalization
 * dedupeBest applies (one source of truth for identity), preserves first-appearance order within
 * each group, and mirrors the blank-key guard: an untitled stub keys by its own `uid` so two
 * blank stubs never merge into one group. Pure / never-throw / node-testable.
 *
 * For any deduped winner, `groupVariants(tracks).get(<winner key>)` contains that winner PLUS its
 * same-song cross-source siblings, so the picker can list every source variant of one displayed row.
 */
export function groupVariants(tracks: Track[]): Map<string, Track[]> {
	const groups = new Map<string, Track[]>();
	for (const t of tracks) {
		const k = key(t);
		// untitled — key by uid so distinct blank stubs stay in their own group (mirrors dedupeBest).
		const gk = !k || k === '|' ? t.uid : k;
		const existing = groups.get(gk);
		if (existing) existing.push(t);
		else groups.set(gk, [t]);
	}
	return groups;
}

/**
 * Collapse same-song-different-source duplicates, keeping the best-quality variant.
 * Order is preserved by first appearance. A blank key (no title) is never merged.
 * `preferred` (optional) wins quality ties — used for the "default source" setting.
 */
export function dedupeBest(tracks: Track[], preferred?: SourceId): Track[] {
	const order: string[] = [];
	const winner = new Map<string, Track>();
	for (const t of tracks) {
		const k = key(t);
		if (!k || k === '|') {
			// untitled — keep as-is, unique by uid
			order.push(t.uid);
			winner.set(t.uid, t);
			continue;
		}
		if (!winner.has(k)) {
			order.push(k);
			winner.set(k, t);
		} else {
			winner.set(k, better(winner.get(k)!, t, preferred));
		}
	}
	return order.map((k) => winner.get(k)!).filter(Boolean);
}
