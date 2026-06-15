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
	private resolve(text: string, target: string, whitelist: readonly string[]): string {
		void this.rev; // reactive dependency
		if (!text || target === 'off' || !browser) return text;
		if (!shouldTranslate(text, target, whitelist)) return text;
		const m = this.langCache(target);
		const hit = m.get(text);
		if (hit !== undefined) return hit;
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

	/** Artist name → artistLang + artistSkip. ju0: `'auto'` resolves to settings.appLang. */
	dnArtist(text: string): string {
		return this.resolve(text, effectiveTarget(settings.artistLang), settings.artistSkip);
	}

	/** Song / album title → titleLang + titleSkip. ju0: `'auto'` resolves to settings.appLang. */
	dnTitle(text: string): string {
		return this.resolve(text, effectiveTarget(settings.titleLang), settings.titleSkip);
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

	/** Drop ALL cached name/bio translations — in-memory maps + every `openmusic:name-tr:*` key.
	 * Used by the Data settings tab. Bumps `rev` so live resolvers re-render from originals. */
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
