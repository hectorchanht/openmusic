// Reactive signal for locale-dictionary chunk arrivals (quick-261006-i18n).
//
// WHY a separate .svelte.ts: `src/lib/i18n/index.ts` is a pure .ts module whose
// helpers are unit-tested in the node Vitest project. The $state itself must live
// in a runes module; index.ts imports this (deferred reads only — no cycle, this
// file never imports index.ts).
//
// t() reads `dictSignal.version` on every call so that when ensureLocale() lands
// a dictionary chunk, every rendered call site re-runs with the real strings.
// Until the chunk arrives, lookupKey falls back to the in-bundle `en` dict —
// the UI never renders blank, it just briefly renders English.
class DictSignal {
	version = $state(0);

	bump(): void {
		this.version++;
	}
}

export const dictSignal = new DictSignal();
