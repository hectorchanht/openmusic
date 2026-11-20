// artist-display — PURE display helpers for the artist page: which NAME to print in the
// header, and which COVER may represent the artist as the hero. Node-testable, no fetch,
// no stores — the page passes in what it already loaded.
//
// WHY THIS MODULE EXISTS (2026-11-02, Hector's sunkis report): the artist page for
// "sunkis 宋秉勤" rendered its header as just "sunkis" and its hero as the "BRAND NEW"
// album cover — a KnowKnow single sunkis merely features on. Two distinct leaks:
//
//  1. NAME — MusicBrainz's canonical name for him is the Latin-only "sunkis" (aliases
//     {zh: 宋秉勤, en: Chris Sung}); pickLocaleName() returns that canonical whenever the
//     artist-language setting is 'off'/'auto' (the default), REPLACING the credited
//     bilingual name the user arrived with. Rule (Hector): canonical forms are for
//     MATCHING and lookup, never for display replacement when they are SHORTER than the
//     credited name. fullestDisplayName() restores the fullest credited form.
//  2. HERO — the fallback hero was "the first ranked track that has a cover", with no
//     regard for whose release it is, so a collaborator's cover outranked the artist's
//     own top hit. pickHeroCover() requires the PRIMARY credit first.

import { splitArtists } from '$lib/util/artist-split';
import { canonicalKey } from '$lib/proxy/musicbrainz-shared';

/** Script runs, mirroring dedupe.ts's SCRIPT_RUNS: Han runs stay whole, non-Han runs stay
 *  whole, so "sunkis 宋秉勤" is ["sunkis", "宋秉勤"] — the unit the subset tests below
 *  compare. Runs are lowercased and stripped of punctuation/space WITHIN the run. */
const SCRIPT_RUNS = /\p{Script=Han}+|[^\p{Script=Han}]+/gu;

function nameRuns(s: string): string[] {
	return ((s ?? '').toLowerCase().match(SCRIPT_RUNS) ?? [])
		.map((r) => r.replace(/[^\p{L}\p{N}]+/gu, ''))
		.filter(Boolean);
}

function runsSubset(small: string[], big: string[]): boolean {
	return small.length > 0 && small.every((r) => big.includes(r));
}

/**
 * True when two name strings plausibly denote the SAME single artist: their script runs
 * are equal, or one is a whole-run subset of the other ("sunkis" ⊂ "sunkis 宋秉勤",
 * "宋秉勤" ⊂ "sunkis 宋秉勤"). Script-EXACT on purpose (no Traditional→Simplified fold):
 * 姜濤 and 姜涛 are different people and must never merge here, the same discipline as
 * rankByArtistExactness tier 0. Empty on either side never matches.
 */
export function sameArtistForm(a: string, b: string): boolean {
	const ra = nameRuns(a);
	const rb = nameRuns(b);
	if (!ra.length || !rb.length) return false;
	return runsSubset(ra, rb) || runsSubset(rb, ra);
}

/**
 * Split a track's raw artist string into individual credited names. splitArtists covers
 * the connector set (`,`、`/`、`&`、feat/ft、x/×); the middle dot `·` is ALSO split here
 * because several CN sources carry it as the credit joiner inside the raw string (the
 * app's own display joiner is " · ", and raw strings in the wild use it too).
 */
export function creditSegments(artist: string): string[] {
	const out: string[] = [];
	for (const part of splitArtists(artist ?? '')) {
		for (const seg of part.split('·')) {
			const s = seg.trim();
			if (s && !out.includes(s)) out.push(s);
		}
	}
	return out;
}

/** Trailing feat./ft. clause ("X (feat. Y)", "X feat Y" left unsplit by the paren form). */
const FEAT_TAIL = /\s*\(?\s*\b(?:feat|ft)\.?\b[^)]*\)?\s*$/i;

/** The PRIMARY (first-billed) credited artist of a track — who the release belongs to. */
export function primaryCredit(artist: string): string {
	const first = creditSegments(artist)[0] ?? '';
	return first.replace(FEAT_TAIL, '').trim();
}

/**
 * The name the artist page header should DISPLAY.
 *
 * `base` is today's answer (the route name, or pickLocaleName's locale/canonical pick).
 * `credited` is every credited form available — the route name first, then the individual
 * artist segments of the loaded tracks. `knownForms` is every name known to denote this
 * artist (route name + MusicBrainz canonical + aliases + base itself).
 *
 * A credited form replaces `base` ONLY when it (a) belongs to this artist (whole-run
 * match against a known form) AND (b) strictly CONTAINS base's canonical key — i.e. it
 * is the same name with MORE of the artist's name material present ("sunkis 宋秉勤" over
 * both "sunkis" and "宋秉勤"). A shorter or disjoint form never replaces the base, so
 * locale behaviour is otherwise untouched: "Chris Sung" stays for an English-setting
 * user, 陳奕迅 stays 陳奕迅, "Jay Chou" is not displaced by 周傑倫.
 */
export function fullestDisplayName(base: string, credited: string[], knownForms: string[]): string {
	const cleanBase = (base ?? '').trim();
	const baseKey = canonicalKey(cleanBase);
	if (!cleanBase || !baseKey) return cleanBase;
	const forms = [...knownForms, cleanBase];
	let best: string | null = null;
	let bestLen = baseKey.length;
	for (const raw of credited ?? []) {
		const cand = (raw ?? '').trim();
		if (!cand) continue;
		const key = canonicalKey(cand);
		// Fuller = strictly longer AND literally carrying the base name inside it.
		if (key.length <= bestLen || !key.includes(baseKey)) continue;
		if (!forms.some((f) => sameArtistForm(cand, f))) continue;
		best = cand;
		bestLen = key.length;
	}
	return best ?? cleanBase;
}

/**
 * The hero cover for the artist page: the cover of the artist's OWN release first.
 *
 * Pass 1 — the first track (the caller passes them in ranked order) whose PRIMARY credit
 * is this artist and which yields a cover via `coverOf`. A cover where the artist is
 * only a featured/secondary credit can never win this pass.
 * Pass 2 — the historic fallback: the first track yielding any cover at all, so an
 * artist with no primary-credit cover in the loaded set keeps today's behaviour.
 * Returns null when nothing yields a cover (the page renders its gradient).
 */
export function pickHeroCover<T extends { artist: string }>(
	tracks: T[],
	knownForms: string[],
	coverOf: (t: T) => string | null
): string | null {
	const forms = (knownForms ?? []).map((f) => (f ?? '').trim()).filter(Boolean);
	for (const t of tracks ?? []) {
		const primary = primaryCredit(t.artist);
		if (!primary || !forms.some((f) => sameArtistForm(primary, f))) continue;
		const cover = coverOf(t);
		if (cover) return cover;
	}
	for (const t of tracks ?? []) {
		const cover = coverOf(t);
		if (cover) return cover;
	}
	return null;
}
