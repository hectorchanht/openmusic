// Presentation-layer cross-source dedupe + best-quality pick.
// NOT part of the Phase-1 data layer (catalog.ts is left untouched + its tests
// intact). Applied by the UI/picks layer to any list shown to the user so the
// same song surfaced by multiple sources collapses to one — the highest quality.
import type { SourceId, Track } from '$lib/sources/types';
import { t2sConvertLineSync, warmT2S } from '$lib/services/zh-convert';

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
//
// YTMusic (Plan 27) is off the resolve floor (autoResolveEligible:false) and non-mainstream for
// tie-break purposes — rank it at the bottom (-1) alongside jamendo/audius so a mainstream CN
// version always wins a tie if normalization ever merges them. Required for this total
// Record<SourceId,number> to stay exhaustive once 'ytmusic' joined the SourceId union (27-01).
//
// 32-D-08: qq and netease SWAPPED (was `netease: 4, qq: 3`). A swap rather than a bump to 5, so the
// range and every other rank's relative meaning above stay exactly as justified. netease winning
// this tie is WHY a mid-less stub was the COMMON case rather than the rare one: at search time every
// stub is `quality: null` → qualityRank 0, so this rank is the SOLE tie-break and it decided every
// cross-source search row. A qq survivor already carries `song_mid` in the search body, so most
// FIRST plays resolve lossless with no extra lookup at all — per 32-D-10b that, not the edge mid
// cache, is the latency lever (a cached mid still costs a full upstream round trip; a mid already in
// hand costs nothing). Accepted side effect, weighed and taken: where the two sources disagree, qq's
// title/album metadata is what the user sees. Identity is unaffected — it stays uid-based
// (`makeUid`), and this rank never decides identity, only which of two same-song rows survives.
// Cross-ref: the roadmap's pending "netease upstream health-gate" item already suspected this rank-4.
const SOURCE_RANK: Record<SourceId, number> = { netease: 3, qq: 4, kuwo: 2, joox: 1, fivesing: 0, jamendo: -1, audius: -1, ytmusic: -1 };

/** Higher = better. Reads qualityLabel/quality strings (often null pre-resolve). */
function qualityRank(t: Track): number {
	const q = `${t.qualityLabel ?? ''} ${t.quality ?? ''}`.toLowerCase();
	if (/flac|lossless|atmos|hi-?res|\bsq\b|母带|无损/.test(q)) return 3;
	if (/320|\bhq\b|高品/.test(q)) return 2;
	if (/128|192|\baac\b|64/.test(q)) return 1;
	return 0;
}

const HAN = /\p{Script=Han}/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
// A leading Han run (inner spaces only BETWEEN Han chars), whitespace, then a Latin run starting
// with a letter/digit. The Han and \s classes are disjoint, so this is linear on untrusted titles.
const HAN_THEN_LATIN = /^\p{Script=Han}+(?:\s+\p{Script=Han}+)*\s+([a-z0-9][\x20-\x7e]*)$/u;
// quick-260927-2wt: split an artist key into maximal Han / non-Han runs. The two classes are
// disjoint, so the scan is linear (no backtracking) on untrusted upstream artist strings.
const SCRIPT_RUNS = /\p{Script=Han}+|[^\p{Script=Han}]+/gu;
// Tail words that name a DIFFERENT RENDITION, not a translation — a tail made only of these (or
// numbers) is never stripped, else "玻璃 - remix" / "玻璃 - part 2" would merge into "玻璃"
// (song-variant.ts exists precisely to keep renditions apart).
const QUALIFIER_WORDS = new Set([
	'live', 'demo', 'remix', 'mix', 'acoustic', 'inst', 'instrumental', 'karaoke', 'cover', 'remaster',
	'remastered', 'explicit', 'version', 'ver', 'edit', 'radio', 'extended', 'original', 'feat', 'ft',
	'part', 'pt'
]);

function isQualifierTail(tail: string): boolean {
	return tail
		.trim()
		.split(/\s+/)
		.every((w) => {
			const x = w.replace(/\.$/, '');
			return /^\d+$/.test(x) || QUALIFIER_WORDS.has(x);
		});
}

/**
 * Traditional → Simplified for a string carrying any Han char; cold dict → unchanged + warm.
 * PER CHARACTER, not per line: the t2s phrase table also swaps regional VOCABULARY
 * (緊急聯絡人 → 紧急联系人, 國際孤獨等級 → 国际孤独级别), which is a different title, not a
 * spelling fold — one char at a time can only hit the char table, so it maps script alone.
 *
 * Exported (debug album-zip-duplicate-songs) so score-match.ts folds with the SAME function key()
 * uses: ranking and identity must agree on script, or a merged group's Simplified survivor scores
 * 0 against a Traditional query and loses to junk.
 */
export function foldScript(s: string): string {
	if (!HAN.test(s)) return s; // Latin-only never touches the converter (no dict download)
	let out = '';
	for (const c of s) {
		if (!HAN.test(c)) {
			out += c;
			continue;
		}
		const f = t2sConvertLineSync(c);
		if (f === null) {
			warmT2S();
			return s;
		}
		out += f;
	}
	return out;
}

/** Title-only: drop a translated English tail so the CJK title keys alone (see key()). */
function stripTranslation(title: string): string {
	const s = title.trim();
	// ytmusic "<CJK> - <english>": key on the head.
	const cut = s.lastIndexOf(' - ');
	if (cut > 0) {
		const head = s.slice(0, cut);
		const tail = s.slice(cut + 3);
		if (HAN.test(head) && PRINTABLE_ASCII.test(tail) && !isQualifierTail(tail)) return head;
	}
	// bilingual "<Han> <Latin>": key on the Latin run (≥2 words), which is what ytmusic keeps.
	const latin = HAN_THEN_LATIN.exec(s)?.[1];
	if (latin && latin.trim().split(/\s+/).length >= 2 && !isQualifierTail(latin)) return latin;
	return s;
}

/**
 * Normalized identity key: title+artist, case/space/punct-insensitive, suffixes dropped.
 *
 * quick-260926-n0r: the same song kept showing twice in the NowPlaying Related tab and Up Next,
 * because these live-data classes (Gareth.T) keyed differently here:
 *   1. Simplified vs Traditional twins (qq 颜色 vs joox 顏色) — every string with a Han char is
 *      folded to Simplified first, char by char (see foldScript). NOT gated on detectLang /
 *      isChineseLine: "淺粉紅 pale pink" is mixed-script and may detect as 'en'. Cold t2s dict →
 *      the string is keyed unfolded (exactly the pre-fix behaviour, never a throw) and warmT2S()
 *      fires so a later call folds.
 *   2. ytmusic "<CJK> - <english>" (玻璃 - glass) — keyed on the CJK head.
 *   3. bilingual "<Han> <Latin>" whose ytmusic copy drops the Han (淺粉紅 pale pink vs pale pink) —
 *      keyed on the Latin run, which must be ≥2 words ("我的 baby" vs "你的 baby" stay apart).
 *   4. ytmusic video uploads titled "<own artist> - <title> (official video)" — the prefix is
 *      dropped only when it normalizes to THIS row's artist (found by the live Gareth.T probe).
 * 2 and 3 never strip a pure qualifier tail (remix / live / part 2 …) — that is a rendition.
 *
 * This deliberately loosens every key() consumer, all of which mean "same song": the WR-06
 * fallback/catalog verification (whose second gate, isAcceptableSubstitute, is unchanged and still
 * keeps renditions apart) and the version picker's groupVariants.
 *
 * ponytail: two DIFFERENT same-artist songs sharing an identical ≥2-word Latin tail would merge;
 * add an album/duration tiebreak if that ever shows up. A key computed cold differs from one
 * computed warm — safe only because keys are never persisted, only compared within one call.
 */
function key(t: Track): string {
	return songKey(t.artist, t.title);
}

/**
 * quick-260926-nsz: key()'s body over raw strings, exported so the comment thread key
 * (services/comments.ts) hashes the SAME script-folded identity dedupe already uses instead of a
 * second normalizer that would drift. Zero behaviour change for key(). NOTE the cold-dict caveat
 * above: a persisted caller must ensure the t2s dict is warm first (comments.ts does).
 */
export function songKey(artistIn: string, titleIn: string): string {
	const pre = (s: string) =>
		foldScript(s || '')
			.toLowerCase()
			.replace(/[（(【\[].*?[)）\]】]/g, ' ') // drop (Live) / [Remaster] / 【...】
			.replace(/\s*-\s*(remaster|live|acoustic|explicit|feat\.?|ft\.?).*$/i, ' ');
	const strip = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').trim(); // strip all punctuation/space (keeps CJK + latin + digits)
	const artist = strip(pre(artistIn));
	let title = pre(titleIn);
	// "<own artist> - <title>" (ytmusic video uploads): drop the prefix only when it IS this row's artist.
	const dash = title.indexOf(' - ');
	if (artist && dash > 0 && strip(title.slice(0, dash)) === artist && title.slice(dash + 3).trim()) {
		title = title.slice(dash + 3);
	}
	return `${strip(stripTranslation(title))}|${artist}`;
}

/**
 * quick-260927-2wt: two already-stripped, lowercased artist key halves name the same act when one
 * side's script runs are ALL present in the other's (`[gem]` ⊂ `[gem, 邓紫棋]`, `[邓紫棋]` ⊂ `[gem, 邓紫棋]`).
 * Runs compare WHOLE (array includes, never substring), so `a` vs `alin` and `jay` vs `jaychou`
 * stay apart, and `gem某` vs `gem另` fail on the Han run. A blank side never matches.
 */
function aliasArtist(x: string, y: string): boolean {
	if (!x || !y) return false;
	const rx: string[] = x.match(SCRIPT_RUNS) ?? [];
	const ry: string[] = y.match(SCRIPT_RUNS) ?? [];
	const [small, big] = rx.length <= ry.length ? [rx, ry] : [ry, rx];
	return small.length > 0 && small.every((r) => big.includes(r));
}

/**
 * Two tracks are "the same song" iff their normalized title+artist keys match (WR-06) — script-,
 * ytmusic-suffix- and bilingual-insensitive since quick-260926-n0r (see key()). Reuses the
 * exact `key()` normalization dedupe applies so a cross-source fallback can verify a fuzzy upstream
 * search returned the SAME song before adopting it (a fuzzy search can return an unrelated track,
 * which would otherwise silently auto-play under the original track's identity). A blank/untitled
 * key is never considered a match (returns false) so we don't adopt garbage on a no-title stub.
 *
 * quick-260927-2wt: a Deezer/Last.fm radio stub resolved by a CN source never anchored into its own
 * slot in queueWithAnchor — it was spliced to the front while the stub lingered as a duplicate. The
 * root cause is the ARTIST alias, not script: key() already folds Traditional → Simplified per char
 * since n0r (the 2cy deferred-items note blaming a missing fold was stale). Observed keys:
 * `多远都要在一起|gem` (Deezer `G.E.M.`) vs `多远都要在一起|gem邓紫棋` (CN `G.E.M.邓紫棋`), and Last.fm
 * `…|邓紫棋` vs `…|gem邓紫棋`. Rule: exact key match as before, OR title halves equal (non-empty) AND
 * the artist halves are script-run subsets of each other (aliasArtist) — the artist-side mirror of
 * key()'s bilingual title rule #3. ONLY this pairwise predicate is loosened: key() / songKey /
 * dedupeBest / groupVariants are deliberately untouched, so search dedupe, similar, picks and the
 * persisted comment-thread hash (comments.ts) keep their exact identity.
 *
 * Caller audit (every non-test call site):
 *   - player.svelte.ts captureHistory (locate current in the old queue), queueWithAnchor (THE fix
 *     site: uid, then sameSongKey, else splice to front), the weaveFreshHistory prefix filter
 *     `!sameSongKey(t, seed)`; NpRelated.svelte self-filter; album page in-queue skip — looser is
 *     the intended behaviour at all five.
 *   - fallback.ts + catalog.ts WR-06 adoption — still double-gated by isAcceptableSubstitute.
 *     Adopting `G.E.M.邓紫棋 | X` for a failed `G.E.M. | X` stub is correct and accepted on purpose
 *     (candidate order is dedupeBest's, so an alias candidate may win over an exact-artist one —
 *     same song, fine).
 *   - variants.ts fetchVariants — made exact-key-first so an alias group cannot shadow the exact one.
 *
 * ponytail: an English-only alias like 'Eason Chan' vs '陈奕迅' shares no run and needs an alias
 * table — not handled.
 */
export function sameSongKey(a: Track, b: Track): boolean {
	return sameSongStrings(a.artist, a.title, b.artist, b.title);
}

/**
 * debug album-rows-miss-liked-downloaded-on-load: sameSongKey over RAW strings, so a caller holding
 * only an {artist,title} stub (an album / shelf / chart row) can test it against a persisted Track
 * without minting a fake Track. sameSongKey delegates here — ONE predicate, zero behaviour change.
 */
export function sameSongStrings(aArtist: string, aTitle: string, bArtist: string, bTitle: string): boolean {
	const ka = songKey(aArtist, aTitle);
	if (!ka || ka === '|') return false;
	const kb = songKey(bArtist, bTitle);
	if (ka === kb) return true;
	// Safe split: strip() removes every non-letter/number char, so neither half can contain '|' and
	// every key has exactly one. Splitting the finished key keeps songKey literally untouched.
	const ia = ka.indexOf('|');
	const ib = kb.indexOf('|');
	const title = ka.slice(0, ia);
	return !!title && title === kb.slice(0, ib) && aliasArtist(ka.slice(ia + 1), kb.slice(ib + 1));
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
