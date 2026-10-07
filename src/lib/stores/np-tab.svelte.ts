// quick-261006-44u — "open NowPlaying at tab X" request signal.
//
// The track menu's View-comments / View-related actions need to flip NowPlaying to a
// tab from OUTSIDE the component (the menu closes first, then the sheet flips).
// `tab` is local $state in NowPlaying.svelte, so this is a reactive request counter
// the component watches in a $effect — the same shape as lyricSyncRequest() in
// lyric-offset.svelte.ts: the effect depends on the counter alone, never on the tab.
//
// A LEAF store (no imports): the caller passes everything, so it stays node-testable
// and cannot form an import cycle.

export type NpTabTarget = 'comments' | 'related';

const _req = $state({ tab: null as NpTabTarget | null, n: 0 });

/** Bumped on every request. CALL inside a $effect to react to "show me the tab". */
export function npTabRequest(): number {
	return _req.n;
}

/** Which tab the latest request targets. Read inside the request effect (untracked). */
export function npTabTarget(): NpTabTarget | null {
	return _req.tab;
}

/** Ask NowPlaying to switch to `tab` (selectTab also opens the sheet when closed). */
export function requestNpTab(tab: NpTabTarget): void {
	_req.tab = tab;
	_req.n++;
}
