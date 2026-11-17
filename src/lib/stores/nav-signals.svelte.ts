// Nav re-tap signals (Svelte 5 runes singleton) — quick-261116-libcycle.
//
// The (app) layout owns the bottom nav, but the Library tab state lives inside the
// library page (its `setTab` also persists the stored tab, clears a ?playlist pin and
// writes the URL through the router). A layout-side goto() cannot reproduce that trio
// faithfully — most visibly the wrap back to 'liked', whose canonical URL is a plain
// /library that the page deliberately reads as "keep the stored tab". So the layout
// only SIGNALS here and the page advances its own tab, exactly as a pill tap does.
//
// A counter, not a boolean or an event: every re-tap must register even in quick
// succession, and the page seeds its seen-value at init, so a bump can never replay
// on a later mount. In-memory only — a signal has no meaning across a reload.
class NavSignals {
	/** Bumped once per Library re-tap. Reactive via $state (the page $effect reads it). */
	libraryCycleSeq = $state(0);

	/** Ask the mounted library page to advance to its next tab. A no-op when the page
	 *  is not mounted (the layout only fires this while /library is the current route,
	 *  and a later mount seeds the current value rather than replaying it). */
	cycleLibraryTab(): void {
		this.libraryCycleSeq += 1;
	}
}

export const navSignals = new NavSignals();
