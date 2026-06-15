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

// Bump to abandon all previously-cached (possibly poisoned) lyrics translations.
const CACHE_VER = 'v2';

const mem = new Map<string, string[]>();

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
			// carry the version: `openmusic:lyrics-tr:<VER>:<to>:<hash>`.
			if (k && k.startsWith('openmusic:lyrics-tr:') && !k.startsWith(`openmusic:lyrics-tr:${CACHE_VER}:`))
				keys.push(k);
		}
		for (const k of keys) localStorage.removeItem(k);
	} catch {
		/* ignore */
	}
}

/**
 * Translate `lines` to `to`, returning aligned output + per-line genuine-translation flags.
 * Caches (mem + localStorage) only fully-translated batches so an echo/fallback never poisons
 * the cache. `to === 'off'` or empty input is an identity pass-through (all flags false).
 */
export async function translateLinesEx(lines: string[], to: string): Promise<TranslateResult> {
	if (to === 'off' || !lines.length) return { out: lines, flags: lines.map(() => false), complete: false };
	purgeStaleLyricsCache();
	const key = `openmusic:lyrics-tr:${CACHE_VER}:${to}:${hash(lines.join('|'))}`;
	if (mem.has(key)) {
		const out = mem.get(key) as string[];
		return { out, flags: out.map(() => true), complete: true };
	}
	if (browser) {
		try {
			const c = localStorage.getItem(key);
			if (c) {
				const v = JSON.parse(c) as string[];
				mem.set(key, v);
				return { out: v, flags: v.map(() => true), complete: true };
			}
		} catch {
			/* ignore */
		}
	}
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
		if (complete) {
			mem.set(key, out);
			if (browser) {
				try {
					localStorage.setItem(key, JSON.stringify(out));
				} catch {
					/* quota */
				}
			}
		}
		return { out, flags, complete };
	} catch {
		return { out: lines, flags: lines.map(() => false), complete: false };
	}
}

/**
 * Back-compat wrapper preserving the original `string[]` contract (out.length === lines.length).
 * Callers that need the per-line genuine-translation signal use `translateLinesEx`.
 */
export async function translateLines(lines: string[], to: string): Promise<string[]> {
	return (await translateLinesEx(lines, to)).out;
}
