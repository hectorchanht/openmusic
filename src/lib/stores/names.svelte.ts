// Reactive display-name translation. `dnArtist(text)` / `dnTitle(text)` / `dnLastfm(tag)`
// return the translated text if cached, else the ORIGINAL immediately and lazily batch a
// translation request; when results arrive they bump `rev` so any template that read a
// resolver re-renders. Each part uses its own target language + skip whitelist (settings),
// but the cache is keyed by TARGET lang (translation output depends only on the target, so
// parts sharing a target share cached results). Standalone (settings + translate + detect);
// SSR returns the input unchanged.
//
// CACHE-POISON (WR / debug:dashboard-liked-not-translated): while /api/translate was in
// echo-mode it returned the ORIGINALS as a "successful" batch; this store cached those
// originals as identity entries (orig → orig) and persisted them. The resolver then hit the
// cache and returned the original forever — liked/library names viewed during the bug stayed
// Simplified even after the API was fixed (freshly-searched names, never cached during the
// bug, translated). Two-part hardening:
//   (a) the persisted key carries a VERSION segment (STORE_VER); bumping it abandons every
//       poisoned pre-version entry, and stale keys are purged on first hydration so they
//       can't accumulate. No user action required.
//   (b) we now consult /api/translate's per-line `flags` (via translateLinesEx) and cache
//       ONLY genuinely-translated names. A name that fell back (echo / failure / genuinely
//       identical) is rendered as the original but NOT cached, so it stays eligible for a
//       later retry. To prevent a re-request storm for names that are genuinely unchanged in
//       the target script, each (lang,name) is retried at most MAX_ATTEMPTS times per session.
//
// ATTEMPT-LATCH REGRESSION (WR / debug:translation-regression): the first version of (b)
// incremented the attempt counter at QUEUE time and cleared the pending Set at flush START,
// before the ~200-800ms API round-trip resolved. The artist page renders the name + a track
// list, THEN async Last.fm enrichment lands the bio (a second render wave), THEN the
// post-flush rev++ fires a third — so a re-render during the in-flight window re-queued the
// name (cache miss) and burned a SECOND attempt before the first response arrived. attempts>=2
// then latched the name to its ORIGINAL for the session even though the API would translate it
// → artist names + bio "stopped translating". Fixed here by:
//   - an in-flight guard (`inflight`) so a name awaiting a response is NOT re-queued and burns
//     no further attempts during the round-trip;
//   - counting an attempt ONLY in the flush handler and ONLY for a name that came back NOT
//     genuinely translated AND still equal to its input (a genuine-identity / echo), never at
//     queue time and never on a transport failure (which leaves the name retryable);
//   - resetting a name's attempt count when it is genuinely translated, so an earlier
//     accidental miss can't accumulate toward the cap across views.
import { browser } from '$app/environment';
import { settings, effectiveTarget } from '$lib/stores/settings.svelte';
import { translateLinesEx } from '$lib/services/translate';
import { shouldTranslate } from '$lib/i18n/detect';
import { isChineseLine, s2tConvertLineSync, warmS2T, lockScriptSync, warmScript, type ZhScript } from '$lib/services/zh-convert';
import { readRescueHits, onRescueHit, type ZhName } from '$lib/services/name-rescue';
import { matchKey, norm } from '$lib/services/match-key';
import { splitArtists } from '$lib/util/artist-split';

// Bump to abandon all previously-persisted (possibly poisoned) name translations.
const STORE_VER = 'v2';
const keyFor = (lang: string) => `openmusic:name-tr:${STORE_VER}:${lang}`;
// Bounded per-session retries for a name that keeps coming back untranslated (genuinely
// identical in the target script), so we don't loop forever re-requesting it. An attempt is
// only counted on a genuine-identity result (see flush handler), never at queue time.
const MAX_ATTEMPTS = 2;

class Names {
	rev = $state(0); // bump → callers re-evaluate resolvers
	private cache = new Map<string, Map<string, string>>(); // lang → (original → translated)
	private pending = new Map<string, Set<string>>();
	// lang → names currently awaiting an API response (between flush start and resolution).
	// resolve() skips re-queueing these so an in-flight re-render can't burn another attempt.
	private inflight = new Map<string, Set<string>>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private hydrated = new Set<string>();
	// lang → (name → attempt count). Caps re-requests for genuinely-unchanged names. Only
	// incremented in the flush handler for a name that came back genuinely-identical.
	private attempts = new Map<string, Map<string, number>>();
	private purged = false;
	// quick-260919-2jo: once-per-direction latch for the script-lock dict warm. PLAIN field, not
	// `$state` — it is an internal guard the UI never reads reactively (the house convention for
	// loop guards / generation counters). A Set, not a boolean, because a user can flip the lock
	// between the two scripts in one session and each direction has its own dict.
	private lockWarmed = new Set<string>();
	// quick-260925-x8o: display aliases mirrored from the wa7 rescue cache (openmusic:name-rescue:v1).
	// PLAIN fields — reactivity rides `rev` + settings.zhScript. titleAlias is keyed by the rescue's
	// own matchKey(artist, title); artistAlias by norm(artist).
	private titleAlias = new Map<string, string>();
	private artistAlias = new Map<string, string>();
	private aliasHydrated = false;

	constructor() {
		// quick-260925-x8o live repaint: a rescue that verifies a pair mid-tap repaints visible rows.
		if (browser)
			onRescueHit((artist, title, zh) => {
				this.recordAlias(matchKey(artist, title), zh);
				this.rev++;
			});
	}

	/**
	 * quick-260925-x8o: the wa7 live smoke paired `Joker Xue / The Actor` with the HK credit line
	 * `薛之謙, 阿蘭, 劉宇寧, 白舉綱 & 袁成傑`. An artist-alone alias (no context, by decision) cannot
	 * attribute a multi-performer credit to one raw artist, so only a single-performer zh artist
	 * becomes an artist alias; the pair-keyed title alias still applies.
	 * ponytail: single-performer rule; add per-part alignment if a "A & B" ↔ "甲, 乙" pair is ever needed.
	 */
	private recordAlias(key: string, zh: ZhName): void {
		this.titleAlias.set(key, zh.title);
		// norm() strips every non-letter/number, so '|' can only be matchKey's separator.
		const bar = key.indexOf('|');
		const artistKey = bar > 0 ? key.slice(0, bar) : '';
		if (artistKey && splitArtists(zh.artist).length === 1) this.artistAlias.set(artistKey, zh.artist);
	}

	/** quick-260925-x8o: ONE localStorage read per session (T-x8o-03). */
	private hydrateAliases(): void {
		if (!browser || this.aliasHydrated) return;
		this.aliasHydrated = true;
		try {
			for (const { key, zh } of readRescueHits()) this.recordAlias(key, zh);
		} catch {
			/* show originals */
		}
	}

	private aliasOn(): boolean {
		const s = settings.zhScript; // reactive read — flipping the setting repaints
		return browser && (s === 'zh-Hant' || s === 'zh-Hans');
	}

	private aliasArtist(text: string): string | null {
		void this.rev;
		if (!text || !this.aliasOn()) return null;
		this.hydrateAliases();
		if (!this.artistAlias.size) return null;
		return this.artistAlias.get(norm(text)) ?? null;
	}

	private aliasTitle(text: string, artist: string | undefined): string | null {
		void this.rev;
		if (!text || !artist || !this.aliasOn()) return null;
		this.hydrateAliases();
		if (!this.titleAlias.size) return null;
		return this.titleAlias.get(matchKey(artist, text)) ?? null;
	}

	// Drop every persisted name translation from BEFORE the current store version, so poisoned
	// echo-era identity entries can't keep serving Simplified originals. Once per session.
	private purgeStale() {
		if (!browser || this.purged) return;
		this.purged = true;
		try {
			const keys: string[] = [];
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				// current keys are `openmusic:name-tr:<VER>:<lang>`; anything else under the
				// `openmusic:name-tr:` namespace is a pre-version (possibly poisoned) entry.
				if (k && k.startsWith('openmusic:name-tr:') && !k.startsWith(`openmusic:name-tr:${STORE_VER}:`))
					keys.push(k);
			}
			for (const k of keys) localStorage.removeItem(k);
		} catch {
			/* ignore */
		}
	}

	private langCache(lang: string): Map<string, string> {
		let m = this.cache.get(lang);
		if (!m) {
			m = new Map();
			if (browser && !this.hydrated.has(lang)) {
				this.hydrated.add(lang);
				this.purgeStale();
				try {
					const raw = localStorage.getItem(keyFor(lang));
					if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) m.set(k, v);
				} catch {
					/* ignore */
				}
			}
			this.cache.set(lang, m);
		}
		return m;
	}

	private persist(lang: string) {
		if (!browser) return;
		try {
			const m = this.cache.get(lang);
			if (m) localStorage.setItem(keyFor(lang), JSON.stringify(Object.fromEntries(m)));
		} catch {
			/* quota */
		}
	}

	private attemptCount(lang: string): Map<string, number> {
		let a = this.attempts.get(lang);
		if (!a) {
			a = new Map();
			this.attempts.set(lang, a);
		}
		return a;
	}

	private inflightSet(lang: string): Set<string> {
		let s = this.inflight.get(lang);
		if (!s) {
			s = new Set();
			this.inflight.set(lang, s);
		}
		return s;
	}

	private schedule(lang: string) {
		if (this.timers.has(lang)) return;
		this.timers.set(
			lang,
			setTimeout(() => {
				this.timers.delete(lang);
				const set = this.pending.get(lang);
				if (!set || !set.size) return;
				const items = [...set];
				this.pending.set(lang, new Set());
				// Mark these as in flight so a re-render during the round-trip doesn't re-queue
				// them (and doesn't burn an attempt). Cleared in finally.
				const flying = this.inflightSet(lang);
				for (const it of items) flying.add(it);
				translateLinesEx(items, lang)
					.then(({ out, flags }) => {
						const m = this.langCache(lang);
						const attempts = this.attemptCount(lang);
						let changed = false;
						items.forEach((orig, i) => {
							if (flags[i] && out[i] !== undefined) {
								// Genuinely translated → cache it and clear any accidental prior misses
								// so an earlier in-flight blip can't accumulate toward the cap.
								m.set(orig, out[i]);
								attempts.delete(orig);
								changed = true;
							} else if ((out[i] ?? orig) === orig) {
								// Came back NOT genuinely translated AND still equal to the input — a
								// genuine identity (already in target) or an echo. Count ONE attempt;
								// once at the cap, resolve() stops re-requesting (no storm). A transport
								// failure goes through .catch and burns NO attempt (stays retryable).
								attempts.set(orig, (attempts.get(orig) ?? 0) + 1);
							}
						});
						if (changed) this.persist(lang);
						this.rev++; // re-render even if nothing changed (resolvers re-read; uncached names retry)
					})
					.catch(() => {
						/* transport failure: leave originals, burn no attempt — eligible for retry */
					})
					.finally(() => {
						for (const it of items) flying.delete(it);
					});
			}, 160)
		);
	}

	/**
	 * Core resolver: returns the translated text for `target` if available, else the
	 * original immediately and queues a translation. Returns the original (no queue)
	 * when shouldTranslate(text, target, whitelist) is false (off / whitelisted source /
	 * already-in-target). Cache is keyed by target lang only. A name already in flight is
	 * NOT re-queued (so an in-flight re-render can't burn an attempt); a name that keeps
	 * coming back genuinely-identical is queued at most MAX_ATTEMPTS times per session.
	 */
	private resolveTranslated(text: string, target: string, whitelist: readonly string[]): string {
		void this.rev; // reactive dependency
		if (!text || target === 'off' || !browser) return text;
		if (!shouldTranslate(text, target, whitelist)) return text;
		const m = this.langCache(target);
		const hit = m.get(text);
		if (hit !== undefined) return hit;
		// quick-260712-et3 — zh-Hant NO-FLASH fast path. Simplified→Traditional is a
		// deterministic OFFLINE conversion (tongwen s2t), so when the dict is already warm we
		// convert on THIS render and return Traditional immediately — never Simplified-then-flip
		// (the now-playing marquee title flash). Only Chinese lines qualify (isChineseLine rides
		// the kana/hangul-first classifier, so JA/KO fall through to the async API path unchanged).
		// If the dict is not warm yet, kick the lazy load and fall through to the async queue for
		// this one render (the single unavoidable cold-start conversion).
		if (target === 'zh-Hant' && isChineseLine(text)) {
			const conv = s2tConvertLineSync(text);
			if (conv !== null) {
				if (conv !== text) {
					// Deterministic genuine translation — cache + persist so later renders and other
					// surfaces hit instantly. Identity (already Traditional) is left uncached: it
					// re-converts trivially next time and never flashes.
					m.set(text, conv);
					this.persist(target);
				}
				return conv;
			}
			warmS2T(); // not warm yet — start the lazy load; async queue below handles this render
		}
		// Already awaiting a response — don't re-queue, don't touch attempts. The flush will
		// bump rev and this resolver will re-run with a cache hit (or count the attempt then).
		if (this.inflightSet(target).has(text)) return text;
		const attempts = this.attemptCount(target);
		if ((attempts.get(text) ?? 0) >= MAX_ATTEMPTS) return text; // give up retrying; show original
		let set = this.pending.get(target);
		if (!set) {
			set = new Set();
			this.pending.set(target, set);
		}
		if (!set.has(text)) {
			set.add(text);
			this.schedule(target);
		}
		return text;
	}

	/**
	 * quick-260919-2jo — THE display seam. Every public accessor (dnArtist / dnTitle / dnLastfm /
	 * dnBio, and the 26 call sites behind them: rows, now-playing, the OS media-session card, the
	 * document title, the download filename) already funnels through `resolve`, so wrapping it
	 * here applies the Chinese script lock EVERYWHERE with zero call-site edits.
	 *
	 * The lock is applied AFTER `resolveTranslated`, and that ordering is the point:
	 *  - the translation cache (`openmusic:name-tr:*`) stays keyed on ORIGINALS and is never
	 *    written with locked text, so flipping the lock needs no cache flush;
	 *  - D-6, the lock wins. titleLang: zh-Hant + lock: Simplified translates to Traditional and
	 *    then locks back to Simplified. Wasteful, but it is a contradiction the user authored and
	 *    the lock gets the last word rather than us arbitrating.
	 */
	private resolve(text: string, target: string, whitelist: readonly string[]): string {
		return this.applyLock(this.resolveTranslated(text, target, whitelist));
	}

	/**
	 * quick-260919-2jo: force one already-resolved string into the locked script. 'off' — and any
	 * value that is not one of the two scripts, i.e. a tampered persisted setting that slipped the
	 * load() guard (T-2jo-02) — returns the input BYTE-FOR-BYTE, which is what makes D-1's default
	 * a true no-op for every existing user. Non-Chinese text is filtered inside `lockScriptSync`
	 * by the single `isChineseLine` gate; there is deliberately no second classifier here.
	 */
	private applyLock(text: string): string {
		void this.rev; // reactive dependency — a warmLock rev bump must repaint lock-only surfaces
		if (!browser || !text) return text;
		const target = settings.zhScript; // reactive $state read: flipping the setting repaints
		if (target !== 'zh-Hant' && target !== 'zh-Hans') return text;
		this.warmLock(target);
		return lockScriptSync(text, target);
	}

	/**
	 * quick-260919-2jo: warm the locked direction's dict ONCE, then bump `rev` so the first render
	 * (which necessarily showed the unconverted original — `lockScriptSync` degrades to identity
	 * while cold) repaints converted.
	 *
	 * LOAD-BEARING, not belt-and-braces: with translation OFF there is no async translate queue to
	 * bump `rev` at all, so without this a cold dict would leave the whole page in the source
	 * script until some unrelated re-render happened to come along. Latched per direction → one
	 * dict build, one rev bump, no retry storm (T-2jo-03).
	 */
	private warmLock(target: ZhScript): void {
		if (this.lockWarmed.has(target)) return;
		this.lockWarmed.add(target);
		void warmScript(target).then(() => {
			this.rev++;
		});
	}

	/**
	 * quick-260919-2jo: the script lock WITHOUT the translation layer — public for callers that
	 * want script consistency but must not pay for a `/api/translate` round trip. Synchronous and
	 * network-free by construction (D-7); `download-track.ts` uses it for the album tag.
	 */
	zhLock(text: string): string {
		return this.applyLock(text);
	}

	/*
	 * quick-260925-x8o — rescued Chinese names (wa7-verified English→Chinese pairs) DISPLAY here while
	 * the script lock is on. Aliased text BYPASSES resolveTranslated and goes to applyLock only: the
	 * alias IS the Chinese name the user asked to see, and routing it through titleLang/artistLang
	 * could undo it (titleLang 'en' would send 珊瑚海 to /api/translate and show "Coral Sea" after a
	 * round trip), would put network on the render path, and could flicker. applyLock still renders
	 * the selected script (周杰倫 vs 周杰伦); the translation cache is never written with alias text.
	 */

	/**
	 * quick-260925-x8o: lock an alias. Under zh-Hant it goes through Simplified FIRST: tongwen's s2t
	 * phrase table is keyed on Simplified, so char-mapping an already-Traditional alias over-converts
	 * (周杰倫 → 周傑倫) while 周杰伦 → 周杰倫. The round trip renders a rescued name exactly as the
	 * lock renders the same name arriving Simplified from a CN catalog. Warms the t2s dict once (its
	 * rev bump repaints the cold first render).
	 */
	private lockAlias(a: string): string {
		if (settings.zhScript === 'zh-Hant') {
			this.warmLock('zh-Hans');
			a = lockScriptSync(a, 'zh-Hans');
		}
		return this.applyLock(a);
	}

	/** Artist name → artistLang + artistSkip. ju0: `'auto'` resolves to settings.appLang.
	 * quick-260925-x8o: a rescued single-performer Chinese artist wins while the lock is on. */
	dnArtist(text: string): string {
		const a = this.aliasArtist(text);
		return a !== null
			? this.lockAlias(a)
			: this.resolve(text, effectiveTarget(settings.artistLang), settings.artistSkip);
	}

	/** Song / album title → titleLang + titleSkip. ju0: `'auto'` resolves to settings.appLang.
	 * quick-260925-x8o: `artist` is the SAME track's raw artist — it keys the rescued Chinese title
	 * ("Coral Sea" alone must never become 珊瑚海). Album/artist-name callers must NOT pass one. */
	dnTitle(text: string, artist?: string): string {
		const a = this.aliasTitle(text, artist);
		return a !== null
			? this.lockAlias(a)
			: this.resolve(text, effectiveTarget(settings.titleLang), settings.titleSkip);
	}

	/** Last.fm tag → lastfmLang + lastfmSkip. ju0: `'auto'` resolves to settings.appLang. */
	dnLastfm(text: string): string {
		return this.resolve(text, effectiveTarget(settings.lastfmLang), settings.lastfmSkip);
	}

	/**
	 * Last.fm bio → target chosen by `settings.bioLang` (fnp). 'auto' follows appLang;
	 * 'off' leaves it untranslated; otherwise an explicit language. No skip list.
	 */
	dnBio(text: string): string {
		return this.resolve(text, effectiveTarget(settings.bioLang), []);
	}

	/** quick-260712-et3: warm the offline s2t dict at app boot when an active content target
	 * resolves to zh-Hant, so the FIRST render can convert Simplified→Traditional synchronously
	 * (no flash). No-op for every non-Traditional target — keeps the ~72 KB tongwen dict out of
	 * non-Hant paths (D-03). Called once from the app shell's onMount after settings.load(). */
	warm(): void {
		if (!browser) return;
		const wantsHant = [
			settings.titleLang,
			settings.artistLang,
			settings.lastfmLang,
			settings.bioLang
		].some((t) => effectiveTarget(t) === 'zh-Hant');
		if (wantsHant) warmS2T();
		// quick-260919-2jo: …or when the script lock is on — warm THAT direction at boot so the
		// cold-dict first render (original script, then a warmLock repaint) is the rare case
		// rather than the normal one. Non-Chinese users with the lock off download neither dict.
		const lock = settings.zhScript;
		if (lock === 'zh-Hant' || lock === 'zh-Hans') this.warmLock(lock);
	}

	/** Drop ALL cached name/bio translations — in-memory maps + every `openmusic:name-tr:*` key.
	 * Used by the Data settings tab. Bumps `rev` so live resolvers re-render from originals.
	 * quick-260925-x8o: rescue aliases are untouched — they come from the RESOLUTION cache
	 * (openmusic:name-rescue:v1), not this translation cache. */
	clearCache(): void {
		this.cache.clear();
		this.pending.clear();
		this.inflight.clear();
		this.attempts.clear();
		this.hydrated.clear();
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		if (browser) {
			try {
				const keys: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.startsWith('openmusic:name-tr:')) keys.push(k);
				}
				for (const k of keys) localStorage.removeItem(k);
			} catch {
				/* ignore */
			}
		}
		this.rev++;
	}
}

export const names = new Names();
