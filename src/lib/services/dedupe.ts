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
 * A normalized version-tag enum (Phase 26-08, Gap 5). Parsed from a title's parenthetical
 * marker so the version picker can show a DISTINGUISHING label instead of N identical rows.
 */
export type VersionTag = 'live' | 'acoustic' | 'demo' | 'cover' | 'remix' | 'instrumental' | 'remaster';

// EN + CN marker → enum. Ordered array (first match wins); every pattern is case-insensitive.
// Reuses the same intent as key()'s bracket-marker stripping, but here we KEEP the marker as a
// label rather than dropping it. `inst` is a common shorthand for instrumental in CN releases.
const TAG_PATTERNS: ReadonlyArray<readonly [VersionTag, RegExp]> = [
	['live', /live|现场|現場|演唱会|演唱會/i],
	['acoustic', /acoustic|不插电|不插電/i],
	['demo', /demo/i],
	['cover', /cover|翻唱/i],
	['remix', /remix|混音/i],
	['instrumental', /instrumental|\binst\b|纯音乐|純音樂|伴奏|karaoke/i],
	['remaster', /remaster(ed)?|重制|重製|重录|重錄/i]
];

/**
 * Parse the FIRST bracketed/parenthetical marker from a title and normalize it to a VersionTag.
 * Returns `{ key, text }` when a non-empty marker is present (`text` = the raw matched marker,
 * a faithful fallback when `key` is null), or `null` when the title has no marker. A marker that
 * matches no known pattern (e.g. "(Radio Edit)") yields `{ key: null, text: "Radio Edit" }`.
 * Uses the SAME bracket family key() strips (`（(【[ … )）]】`). Pure / never-throw.
 */
export function variantTag(title: string): { key: VersionTag | null; text: string } | null {
	const m = (title || '').match(/[（(【\[](.*?)[)）\]】]/);
	const text = (m?.[1] ?? '').trim();
	if (!text) return null; // no marker (or an empty "()") → no distinguishing tag
	for (const [tag, re] of TAG_PATTERNS) {
		if (re.test(text)) return { key: tag, text };
	}
	return { key: null, text }; // an unrecognized marker — surface its raw text verbatim
}

/** Normalize an album for bucketing: lowercase, strip all punctuation/space (blank → ''). */
function normAlbum(album: string | null | undefined): string {
	return (album || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '')
		.trim();
}

/**
 * Collapse truly-indistinguishable variants WITHIN a source (Phase 26-08, Gap 5). Buckets by
 * `source | normalized-album | version-tag` and keeps the BEST-quality member per bucket (reuses
 * the private better()), in first-appearance order. Because the bucket key includes `source`,
 * cross-source variants ALWAYS land in different buckets — they are a real choice and are NEVER
 * collapsed. This is applied at RENDER time inside VersionPicker so every picker mount is fixed
 * with NO edit to the search page and NO change to groupVariants' uid→group contract.
 * Pure / never-throw / order-preserving.
 */
export function collapseVariants(tracks: Track[]): Track[] {
	const order: string[] = [];
	const winner = new Map<string, Track>();
	for (const t of tracks) {
		const tag = variantTag(t.title);
		// tag component: the normalized enum key, else the raw marker text, else '' (no marker).
		const tagPart = (tag?.key ?? tag?.text ?? '').toLowerCase();
		const bucket = `${t.source}|${normAlbum(t.album)}|${tagPart}`;
		if (!winner.has(bucket)) {
			order.push(bucket);
			winner.set(bucket, t);
		} else {
			winner.set(bucket, better(winner.get(bucket)!, t));
		}
	}
	return order.map((k) => winner.get(k)!).filter(Boolean);
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
