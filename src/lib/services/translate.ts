// Client helper for lyric / name translation. Calls /api/translate with in-memory +
// localStorage caching so switching tabs / re-opening a song doesn't refetch.
//
// CACHE-POISON (WR / debug:dashboard-liked-not-translated): during the /api/translate
// echo-mode bug the endpoint returned the ORIGINALS as a "successful" batch, and this
// helper persisted those originals as if they were final translations — so liked/library
// names viewed during the bug stayed Simplified forever (a cache HIT returned the cached
// original and never re-requested). Two-part hardening:
//   (a) the cache key carries a VERSION segment (CACHE_VER); bumping it abandons every
//       poisoned pre-version entry without asking the user to clear anything.
//   (b) /api/translate now reports a per-line `flags: boolean[]` (true = genuinely
//       translated, false = fell back to the original / echo). We only PERSIST a batch
//       when NO line fell back, so an echo no longer poisons the cache and the lines stay
//       eligible for a later retry. The strict out.length === lines.length contract that
//       every caller relies on is preserved.
import { browser } from '$app/environment';
import { apiFetch } from './api-base';
import { detectLang } from '$lib/i18n/detect';
import { splitLyricSegments, isMixedLyricLine } from './lyric-segments';

// Bump to abandon all previously-cached (possibly poisoned) lyrics translations.
// v2→v3 (D-02/D-04): zh-Hant output is now produced deterministically OFFLINE (client-side s2t),
// so any pre-version localStorage entry that was an API ECHO of Traditional must be abandoned.
// purgeStaleLyricsCache() already drops every non-current-version key, so the bump auto-purges.
const CACHE_VER = 'v3';

// TRANSIENT-RESILIENCE (WR / debug:lyric-tr-not-shown-hide-paren): a flaky upstream
// (Google timeout / rate-limit) makes /api/translate return the ORIGINALS as a fake
// HTTP-200 success (every line flags=false). Callers can't tell that from a real result,
// so the lyrics block silently renders untranslated originals ("translation shown
// nowhere") and — because an incomplete batch is never cached — it recurs every render of
// that session. We retry a request whose result is INCOMPLETE (some non-blank line fell
// back) a bounded number of times with short backoff so a single transient blip self-heals
// instead of becoming the final, silent answer. A genuinely-complete success, an off/empty
// pass-through, or a cache hit never retries.
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_MS = 350;

const mem = new Map<string, string[]>();

// quick-261116-lyrux (Task 4) — LINE-LEVEL CACHE. Every layer above this one keyed on
// the exact lines ARRAY (NpLyrics' trCache includes the skip set; the batch key below
// hashes the joined lines; the server's KV key hashes the received array), so ANY
// change to a batch's composition — e.g. Hector un-skipping English after the Korean
// lines already translated — invalidated EVERYTHING and re-translated lines that were
// already paid for. This layer keys PER LINE (`openmusic:line-tr:<VER>:<to>:<hash>`),
// so a re-composed batch resolves its known lines here and only the genuinely-new
// lines reach the pipeline. Same poison rule as the batch cache: only GENUINELY
// translated lines (flag true) are ever stored — an echo can never enter. The key's
// hash is the same `hash()` the batch key uses (house consistency; the SERVER's line
// keys use SHA-256 because its batch keys already do). mem + localStorage, never-throw.
const lineMem = new Map<string, string>();
const lineKey = (line: string, to: string) => `openmusic:line-tr:${CACHE_VER}:${to}:${hash(line)}`;

function lineCacheGet(line: string, to: string): string | null {
	const k = lineKey(line, to);
	const m = lineMem.get(k);
	if (m) return m;
	if (browser) {
		try {
			const v = localStorage.getItem(k);
			if (v) {
				lineMem.set(k, v);
				return v;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

function lineCacheSet(line: string, to: string, translated: string): void {
	if (!translated) return; // a genuine translation of a non-blank line is never empty
	const k = lineKey(line, to);
	lineMem.set(k, translated);
	if (browser) {
		try {
			localStorage.setItem(k, translated);
		} catch {
			/* quota */
		}
	}
}

function lineCacheDelete(line: string, to: string): void {
	const k = lineKey(line, to);
	lineMem.delete(k);
	if (browser) {
		try {
			localStorage.removeItem(k);
		} catch {
			/* ignore */
		}
	}
}

/**
 * quick-261121-trfix: SYNCHRONOUS peek at the line-level cache — the genuinely
 * translated string for `line`→`to` when a previous run already paid for it,
 * else null. This is what lets NpLyrics seed a language/skip switch from cache
 * with NO placeholder reset and NO fetch for already-cached lines (Hector's
 * switch rule): the pane renders cached lines as settled translations in the
 * same tick the switch happens, and only genuinely-new lines go pending.
 * Only genuine translations are ever stored (see lineCacheSet callers), so a
 * peek hit is always a real translation — an echo can never be peeked. Note
 * the standing zh-Hant asymmetry: Chinese lines are never line-cached (they
 * resolve offline), so they peek null and resolve through the chunk path.
 */
export function peekLineTranslation(line: string, to: string): string | null {
	if (!line || to === 'off') return null;
	purgeStaleLyricsCache();
	return lineCacheGet(line, to);
}

/** The batch-cache key for one translateLinesEx call (mem + localStorage). */
function batchKey(lines: string[], to: string, opts?: TranslateOptions): string {
	// quick-261120-segmix: a segment-routed run's output depends on the skip set
	// (a skipped segment stays in its source language), so segment batches key on
	// it — the same lines under a different skip set must never serve each other's
	// cached stitch. Non-segment keys are byte-identical to before.
	const segKey = opts?.segments ? `:seg${hash([...(opts.skip ?? [])].sort().join(','))}` : '';
	return `openmusic:lyrics-tr:${CACHE_VER}:${to}:${hash(lines.join('|'))}${segKey}`;
}

/**
 * quick-261121-trfix: FORCE-REFRESH bust — drop every CLIENT cache entry that
 * could serve `lines`→`to` again: the batch entry for this exact lines array
 * (under the caller's opts, so a segment run busts its own seg-keyed entry),
 * the per-line entry for each line, and the per-SEGMENT line entries a mixed
 * line's MT runs were cached under (keyed on the segment's trimmed core — the
 * same key space resolveMixedSegments writes). Scoped to exactly the given
 * lines + target: other songs, other targets and other lines keep their
 * entries. This backs the user's explicit "re-translate this song" action —
 * the ONE sanctioned exception to the no-re-translate-on-switch rule. The
 * server's content-keyed KV is untouched (it only ever stores genuine,
 * flag-true results; the client re-run re-derives everything client-side).
 */
export function bustLyricsTranslation(lines: string[], to: string, opts?: TranslateOptions): void {
	if (!lines.length || to === 'off') return;
	purgeStaleLyricsCache();
	const key = batchKey(lines, to, opts);
	mem.delete(key);
	if (browser) {
		try {
			localStorage.removeItem(key);
		} catch {
			/* ignore */
		}
	}
	for (const line of lines) {
		if (!line) continue;
		lineCacheDelete(line, to);
		for (const seg of splitLyricSegments(line)) {
			if (seg.kind !== 'mt') continue;
			const core = seg.text.trim();
			if (core && core !== line) lineCacheDelete(core, to);
		}
	}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hash(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

export interface TranslateResult {
	/** Positionally-aligned output (out.length === lines.length). Untranslated lines hold the original. */
	out: string[];
	/** Per-line: true if the server genuinely translated this line, false if it fell back to the original. */
	flags: boolean[];
	/** True if every non-empty line was genuinely translated (safe to persist). */
	complete: boolean;
}

/**
 * quick-261120-segmix: opt-in SEGMENT routing for MIXED lines (see
 * resolveMixedSegments). Only the lyrics path (NpLyrics) opts in — it owns the
 * user's lyricsSkip list, which the segment path honours per segment. Every
 * other caller (names) passes nothing and keeps the whole-line routing exactly.
 */
export interface TranslateOptions {
	/** Split mixed Han+non-Han lines into runs: Han converts offline, non-Han goes to MT. */
	segments?: boolean;
	/** Source languages whose segments pass through untranslated (NpLyrics' lyricsSkip). */
	skip?: readonly string[];
}

// Drop every persisted lyrics translation from BEFORE the current cache version, so poisoned
// echo-era entries can't keep serving Simplified originals. Runs once (cheap; idempotent).
let lyricsPurged = false;
function purgeStaleLyricsCache() {
	if (!browser || lyricsPurged) return;
	lyricsPurged = true;
	try {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			// old (unversioned) keys look like `openmusic:lyrics-tr:<to>:<hash>`; current keys
			// carry the version: `openmusic:lyrics-tr:<VER>:<to>:<hash>`. The line-level
			// keys (quick-261116-lyrux) follow the same versioning and purge the same way.
			if (
				k &&
				((k.startsWith('openmusic:lyrics-tr:') && !k.startsWith(`openmusic:lyrics-tr:${CACHE_VER}:`)) ||
					(k.startsWith('openmusic:line-tr:') && !k.startsWith(`openmusic:line-tr:${CACHE_VER}:`)))
			)
				keys.push(k);
		}
		for (const k of keys) localStorage.removeItem(k);
	} catch {
		/* ignore */
	}
}

// One round-trip to /api/translate. Returns the aligned output + per-line flags + completeness,
// or `null` when the request itself threw (transport failure) so the caller can retry. A 200 that
// echoes the originals (transient upstream soft-fail) is NOT null — it returns with `complete:false`,
// which the retry loop also treats as transient.
async function requestOnce(lines: string[], to: string): Promise<TranslateResult | null> {
	try {
		const res = await apiFetch('/api/translate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lines, to })
		});
		const data = (await res.json()) as { translated?: unknown; flags?: unknown };
		const aligned = Array.isArray(data.translated) && data.translated.length === lines.length;
		const out = aligned ? (data.translated as unknown[]).map((x) => String(x)) : lines;
		const flags = aligned
			? lines.map((line, i) => {
					// Prefer the server's per-line signal; otherwise infer (output differs from input).
					if (Array.isArray(data.flags) && data.flags.length === lines.length) return Boolean(data.flags[i]);
					return out[i] !== line;
				})
			: lines.map(() => false);
		// A blank line is trivially "complete" (nothing to translate). Persist only when every
		// non-blank line was genuinely translated — otherwise an echo would poison the cache.
		const complete = aligned && lines.every((line, i) => !line || flags[i]);
		return { out, flags, complete };
	} catch {
		return null;
	}
}

/**
 * The API path: send `lines` to /api/translate, returning the aligned output + per-line flags.
 *
 * TRANSIENT-RESILIENCE: a request that throws OR returns an INCOMPLETE batch (a non-blank line
 * fell back — the signature of a flaky/rate-limited upstream) is retried up to MAX_TRANSIENT_RETRIES
 * times with short backoff, so one transient blip no longer becomes the silent final answer. The
 * BEST result across attempts (the most genuinely-translated lines) is returned, so a partial
 * recovery still surfaces what it could translate.
 */
async function runApiLoop(lines: string[], to: string): Promise<TranslateResult> {
	// Identity fallback used only if every attempt throws (transport failure on all tries).
	let best: TranslateResult = { out: lines, flags: lines.map(() => false), complete: false };
	const score = (r: TranslateResult) => r.flags.reduce((n, f) => n + (f ? 1 : 0), 0);
	for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
		const r = await requestOnce(lines, to);
		if (r) {
			if (r.complete) {
				best = r;
				break; // fully translated — nothing better to wait for
			}
			// Keep whichever attempt translated the most lines (partial recovery still surfaces).
			if (score(r) >= score(best)) best = r;
		}
		// Retry transient failures (threw → r===null) and incomplete soft-fails, with backoff.
		if (attempt < MAX_TRANSIENT_RETRIES) await sleep(RETRY_BASE_MS * (attempt + 1));
	}
	return best;
}

// zh-Hant OFFLINE ROUTING (D-02 / D-04). zh-Hans→zh-Hant is a deterministic char/phrase
// conversion, so Chinese-detected lines are converted CLIENT-SIDE (zero network, works offline /
// on lockscreen) and ONLY the genuinely non-Chinese lines are sent to the API cascade. The dict
// is pulled via a DYNAMIC import so the ~72 KB chunk stays out of the initial bundle AND out of
// every non-zh-Hant path. Never-throw: s2tConvertLines degrades to identity on any fault, and a
// failed dynamic import falls through to the full-API path so zh-Hant never hard-breaks
// (T-25b-03). D-04: isChineseLine rides the kana/hangul-first classifier, so a JA-kana line is
// NOT offline-converted — it lands in the API-bound subset like any other non-Chinese line.
// quick-260926-kvz: the dynamic import now also pulls the ~22 KB gzip t2s dict, because
// s2tConvertLines is the idempotent s2t↔t2s merge (already-Traditional input keeps its spelling).
async function resolveZhHant(lines: string[], opts?: TranslateOptions): Promise<TranslateResult> {
	let mod: typeof import('./zh-convert');
	try {
		mod = await import('./zh-convert');
	} catch {
		// Offline converter unavailable (transient chunk-load failure) — degrade to the full-API
		// path for the whole batch so zh-Hant still resolves.
		return runApiLoop(lines, 'zh-Hant');
	}
	const { isChineseLine, s2tConvertLines } = mod;

	// Partition by index so results scatter back to their ORIGINAL positions (T-25b-01 — strict
	// positional alignment the callers depend on). Blank lines are trivially complete (nothing to
	// translate) — they belong to NEITHER bucket, so Chinese lyrics with blank separator lines
	// still make ZERO network calls.
	// quick-261120-segmix: with segment routing ON (lyrics only — the caller opts in),
	// a MIXED line (Han + translatable non-Han runs) leaves the Chinese bucket for
	// the segment path below; without the opt-in it converts whole, exactly as before.
	const chineseIdx: number[] = [];
	const apiIdx: number[] = [];
	const mixedIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // blank: leave out[i]='' / flag false (non-blocking), no request
		if (isChineseLine(line)) {
			if (opts?.segments && isMixedLyricLine(line)) mixedIdx.push(i);
			else chineseIdx.push(i);
		} else apiIdx.push(i);
	}

	const out = lines.slice();
	const flags = lines.map(() => false);

	// Chinese subset → offline s2t. A converted Chinese line is a genuine zh-Hant translation, so
	// flag those positions true (already-Traditional input s2t-passes-through unchanged — still
	// correct Traditional, still genuinely translated for this target; T-25b-04 accepted)
	// (true since quick-260926-kvz: s2tConvertLines is the idempotent merge).
	if (chineseIdx.length) {
		const converted = await s2tConvertLines(chineseIdx.map((i) => lines[i]));
		chineseIdx.forEach((orig, j) => {
			out[orig] = converted[j];
			flags[orig] = true;
		});
	}

	// Non-Chinese subset → the EXISTING API retry/best-result loop, scattered back positionally.
	if (apiIdx.length) {
		const api = await runApiLoop(apiIdx.map((i) => lines[i]), 'zh-Hant');
		apiIdx.forEach((orig, j) => {
			out[orig] = api.out[j];
			flags[orig] = api.flags[j];
		});
		// Workers AI (m2m100) returns Simplified-leaning Chinese — normalize genuinely-translated
		// API output to Traditional via the offline converter (quick-261020-wai). Echoes/fallbacks
		// (flag false) are left untouched.
		const normIdx = apiIdx.filter((_, j) => api.flags[j]);
		if (normIdx.length) {
			const normalized = await s2tConvertLines(normIdx.map((i) => out[i]));
			normIdx.forEach((orig, j) => {
				out[orig] = normalized[j];
			});
		}
	}

	// quick-261120-segmix: MIXED lines resolve per segment (see resolveMixedSegments)
	// and scatter back positionally like every other bucket.
	if (mixedIdx.length) {
		const seg = await resolveMixedSegments(
			mixedIdx.map((i) => lines[i]),
			opts?.skip ?? [],
			s2tConvertLines
		);
		mixedIdx.forEach((orig, j) => {
			out[orig] = seg.out[j];
			flags[orig] = seg.flags[j];
		});
	}

	// Same completeness rule as the API path: every NON-BLANK line must be flagged. An incomplete
	// API remainder keeps complete=false (so it stays uncached/retryable) even though the offline
	// lines are correct.
	const complete = lines.every((line, i) => !line || flags[i]);
	return { out, flags, complete };
}

/**
 * quick-261120-segmix: resolve MIXED lines (Han + non-Han in one line) at SEGMENT
 * granularity — the fix for Hector's 2026-11-20 report that the English inside a
 * Chinese lyric line never translated under a zh-Hant target (the whole line took
 * the offline path, which only converts script). Per line (services/lyric-segments):
 *   - 'cjk' runs convert OFFLINE via the caller's s2tConvertLines — batched across
 *     every mixed line in the batch, never sent to MT (script control, not paraphrase);
 *   - 'mt' runs go through the EXISTING API retry loop, batched into ONE call across
 *     all mixed lines, behind the per-line cache (keyed on the segment's trimmed
 *     core text, so a hook repeated across songs/lines costs nothing — the same
 *     key space whole lines use, since identical text wants identical translation);
 *   - 'raw' runs (punctuation/digits/spacing) pass through untouched.
 * Skip list: an mt run whose detected language is in `skip` passes through
 * untranslated and counts as RESOLVED (a deliberate pass, not a failure) — the
 * segment-level mirror of NpLyrics' per-line whitelist, so skipping English also
 * leaves the English inside mixed lines alone. Genuinely-translated API output is
 * s2t-normalized before stitching, the same Workers-AI Simplified-lean rule the
 * whole-line API bucket applies. A line's flag is true only when EVERY mt run
 * resolved (translated / skipped / cached); an echoed run keeps the line — and
 * therefore the batch — incomplete and uncached, exactly like a whole-line echo.
 * Whitespace around an mt run is never sent (providers trim anyway): the run's
 * lead/trail spacing is re-attached verbatim at stitch time, so the joined line
 * preserves the original spacing/punctuation exactly.
 */
async function resolveMixedSegments(
	lines: string[],
	skip: readonly string[],
	s2tConvertLines: (lines: string[]) => Promise<string[]>
): Promise<{ out: string[]; flags: boolean[] }> {
	const split = lines.map((l) => splitLyricSegments(l));
	// Segment results start as the ORIGINAL text; resolved segments overwrite.
	const segOut: string[][] = split.map((segs) => segs.map((s) => s.text));
	const segDone: boolean[][] = split.map((segs) => segs.map((s) => s.kind !== 'mt'));

	// CJK runs → ONE offline batch across all mixed lines.
	const cjkTexts: string[] = [];
	const cjkSlots: Array<{ li: number; si: number }> = [];
	split.forEach((segs, li) =>
		segs.forEach((s, si) => {
			if (s.kind === 'cjk') {
				cjkSlots.push({ li, si });
				cjkTexts.push(s.text);
			}
		})
	);
	if (cjkTexts.length) {
		const converted = await s2tConvertLines(cjkTexts);
		cjkSlots.forEach((slot, j) => {
			segOut[slot.li][slot.si] = converted[j];
			segDone[slot.li][slot.si] = true;
		});
	}

	// MT runs → skip gate, then the segment cache, then ONE grouped API call.
	interface MtJob {
		li: number;
		si: number;
		core: string;
		lead: string;
		trail: string;
	}
	const jobs: MtJob[] = [];
	split.forEach((segs, li) =>
		segs.forEach((s, si) => {
			if (s.kind !== 'mt') return;
			if (skip.includes(detectLang(s.text))) {
				segDone[li][si] = true; // deliberate pass-through — resolved, original kept
				return;
			}
			const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text);
			const lead = m?.[1] ?? '';
			const core = m?.[2] ?? s.text;
			const trail = m?.[3] ?? '';
			if (!core) {
				segDone[li][si] = true;
				return;
			}
			const hit = lineCacheGet(core, 'zh-Hant');
			if (hit !== null) {
				segOut[li][si] = lead + hit + trail;
				segDone[li][si] = true;
				return;
			}
			jobs.push({ li, si, core, lead, trail });
		})
	);
	if (jobs.length) {
		const api = await runApiLoop(
			jobs.map((j) => j.core),
			'zh-Hant'
		);
		// Normalize genuinely-translated output to Traditional (same rule as the
		// whole-line API bucket); echoes/fallbacks stay untouched.
		const okPos = jobs.map((_, k) => k).filter((k) => api.flags[k]);
		if (okPos.length) {
			const normalized = await s2tConvertLines(okPos.map((k) => api.out[k]));
			okPos.forEach((k, n) => {
				api.out[k] = normalized[n];
			});
		}
		jobs.forEach((j, k) => {
			if (!api.flags[k]) return; // echo/failure: original segment stays, line incomplete
			segOut[j.li][j.si] = j.lead + api.out[k] + j.trail;
			segDone[j.li][j.si] = true;
			lineCacheSet(j.core, 'zh-Hant', api.out[k]); // genuine only — an echo never enters
		});
	}

	return {
		out: segOut.map((segs) => segs.join('')),
		flags: segDone.map((line) => line.every(Boolean))
	};
}

/**
 * quick-261116-lyrux (Task 4): resolve `lines` through the LINE-LEVEL cache first and
 * run the EXISTING pipeline (resolveZhHant / runApiLoop) over ONLY the misses, then
 * scatter positionally. This is what makes a lyricsSkip toggle cheap: the previously
 * translated lines are line-hits (flag true — only genuine translations are stored),
 * and the API sees just the newly-included lines.
 *
 * zh-Hant caution (deliberate): CHINESE lines are never line-cache-served and never
 * line-cache-stored. They resolve offline inside resolveZhHant, and serving a stored
 * Chinese conversion would bypass the kvz heal semantics (healZhHantBatch re-derives
 * Chinese positions of persisted output because the converter's answers improved
 * under the same CACHE_VER) — the offline path stays untouched, exactly as before.
 * If the converter can't even load, resolveZhHant degrades to the full-API path, so
 * every line is API-bound and the line cache applies to all of them — the
 * classification below mirrors that fallback.
 */
async function resolveWithLineCache(lines: string[], to: string, opts?: TranslateOptions): Promise<TranslateResult> {
	let isChinese: ((line: string) => boolean) | null = null;
	if (to === 'zh-Hant') {
		try {
			const mod = await import('./zh-convert');
			isChinese = mod.isChineseLine;
		} catch {
			isChinese = null; // converter unavailable → full-API degradation → all API-bound
		}
	}
	const apiBound = (line: string) => !isChinese || !isChinese(line);

	const out = lines.slice();
	const flags = lines.map(() => false);
	const missIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue; // blank: trivially complete, never sent, never cached
		if (apiBound(line)) {
			const hit = lineCacheGet(line, to);
			if (hit !== null) {
				out[i] = hit;
				flags[i] = true;
				continue;
			}
		}
		missIdx.push(i);
	}
	if (missIdx.length) {
		const subLines = missIdx.map((i) => lines[i]);
		const sub = to === 'zh-Hant' ? await resolveZhHant(subLines, opts) : await runApiLoop(subLines, to);
		missIdx.forEach((orig, j) => {
			out[orig] = sub.out[j];
			flags[orig] = sub.flags[j];
			// Persist ONLY genuinely-translated API-bound lines (see the zh-Hant caution
			// above) — an echo never enters the line cache.
			if (sub.flags[j] && apiBound(lines[orig])) lineCacheSet(lines[orig], to, sub.out[j]);
		});
	}
	// Completeness is layer-agnostic: every non-blank line genuine, from ANY layer.
	const complete = lines.every((line, i) => !line || flags[i]);
	return { out, flags, complete };
}

/**
 * Translate `lines` to `to`, returning aligned output + per-line genuine-translation flags.
 * Caches (mem + localStorage) only fully-translated batches so an echo/fallback never poisons
 * the cache — plus, since quick-261116-lyrux, a per-LINE cache underneath (see
 * resolveWithLineCache) so a re-composed batch only pays for its new lines.
 * `to === 'off'` or empty input is an identity pass-through (all flags false).
 *
 * D-02: `to === 'zh-Hant'` routes through `resolveZhHant` — Chinese lines convert offline (zero
 * network) and only the non-Chinese remainder hits the API. Every other target is byte-identical
 * to before (full `lines[]` → the API retry loop, no offline branch, no zh-convert import).
 */
export async function translateLinesEx(lines: string[], to: string, opts?: TranslateOptions): Promise<TranslateResult> {
	if (to === 'off' || !lines.length) return { out: lines, flags: lines.map(() => false), complete: false };
	purgeStaleLyricsCache();
	const key = batchKey(lines, to, opts);
	if (mem.has(key)) {
		const out = mem.get(key) as string[];
		return { out, flags: out.map(() => true), complete: true };
	}
	if (browser) {
		try {
			const c = localStorage.getItem(key);
			if (c) {
				let v = JSON.parse(c) as string[];
				if (to === 'zh-Hant') v = await healZhHantBatch(key, lines, v);
				mem.set(key, v);
				return { out: v, flags: v.map(() => true), complete: true };
			}
		} catch {
			/* ignore */
		}
	}

	// D-02 choke-point interception: offline-first for zh-Hant, unchanged API path otherwise.
	// quick-261116-lyrux (Task 4): the pipeline now runs behind the LINE-LEVEL cache —
	// known lines resolve per-line, only misses reach resolveZhHant / runApiLoop.
	const best = await resolveWithLineCache(lines, to, opts);

	if (best.complete) {
		mem.set(key, best.out);
		if (browser) {
			try {
				localStorage.setItem(key, JSON.stringify(best.out));
			} catch {
				/* quota */
			}
		}
	}
	return best;
}

/**
 * quick-260926-kvz: re-derive the Chinese positions of a PERSISTED zh-Hant batch offline. Batches
 * cached before the s2t merge served an already-Traditional 杰 as 傑 (周杰倫 → 周傑倫) for as long
 * as the entry lived, and a cold names flush reading one could re-poison the name cache. Chinese
 * positions are deterministic offline results (resolveZhHant's s2t branch), so recomputing them
 * costs no network; non-Chinese positions came from the API and are kept untouched. That is why
 * CACHE_VER stays v3 — a bump would throw away those paid API lines. Writes back only on an
 * actual change. Never throws.
 *
 * Per line via warmScript + s2tConvertLineSync, NOT s2tConvertLines: the batch call answers
 * IDENTITY when s2t fails to load, which here would overwrite a good cached Traditional value with
 * the untranslated original. The sync call answers null instead, and a null keeps the cached value.
 */
async function healZhHantBatch(key: string, lines: string[], v: string[]): Promise<string[]> {
	if (!Array.isArray(v) || v.length !== lines.length) return v; // tampered / colliding entry
	let mod: typeof import('./zh-convert');
	try {
		mod = await import('./zh-convert');
	} catch {
		return v;
	}
	const { isChineseLine, s2tConvertLineSync, warmScript } = mod;
	const idx: number[] = [];
	// quick-261120-segmix: MIXED lines are excluded — a segment-stitched value is
	// NOT a pure offline result, so re-deriving it whole-line here would erase the
	// MT-translated segments. Pure-Chinese positions heal exactly as before (for a
	// non-segment batch a mixed line's stored value IS the whole-line conversion,
	// which this same sync converter reproduces identically, so skipping it is a
	// no-op there too).
	for (let i = 0; i < lines.length; i++)
		if (lines[i] && isChineseLine(lines[i]) && !isMixedLyricLine(lines[i])) idx.push(i);
	if (!idx.length) return v;
	await warmScript('zh-Hant'); // never rejects; loads both dicts for the merge
	const healed = v.slice();
	let changed = false;
	for (const i of idx) {
		const fresh = s2tConvertLineSync(lines[i]);
		if (fresh !== null && fresh !== v[i]) {
			healed[i] = fresh;
			changed = true;
		}
	}
	if (!changed) return v;
	try {
		localStorage.setItem(key, JSON.stringify(healed));
	} catch {
		/* quota — still serve the healed batch this session (mem) */
	}
	return healed;
}

/**
 * Back-compat wrapper preserving the original `string[]` contract (out.length === lines.length).
 * Callers that need the per-line genuine-translation signal use `translateLinesEx`.
 */
export async function translateLines(lines: string[], to: string, opts?: TranslateOptions): Promise<string[]> {
	return (await translateLinesEx(lines, to, opts)).out;
}
