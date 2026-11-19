// Centralized History-API "back-to-close" overlay stack (Svelte 5 runes singleton,
// same shape as player.svelte.ts). NET-NEW: no popstate/history wiring existed before.
//
// INVARIANT: history depth == overlay stack depth.
//   - open(id, close)   pushes ONE entry AND ONE history state.
//   - dismiss(id)        UI close (scrim / X / drag / cover-collapse): removes the
//                        entry AND calls history.back() ONCE to pop the matching
//                        history state.
//   - back gesture       fires popstate → the handler RECONCILES the stack against
//                        the history entry the traversal actually landed on.
// quick-261114-bak: popstate handling used to count dismiss() echoes (`pendingPops`:
// N backs must produce exactly N popstates, swallowed 1:1 — the quick-261019-ovl fix
// for a boolean that swallowed only one). On Android Chrome / WebView that premise
// is false: two history.back() calls issued in the same tick (TrackMenu's pickCover /
// pickLyrics: closePicker() + close()) can coalesce into ONE traversal — one echo
// for two backs — so the counter leaked and the NEXT genuine Back was swallowed
// (Now Playing stuck open over a navigated-away page), or the depths desynced the
// other way and one Back closed Now Playing AND popped the page underneath (clean
// out to the browser's new-tab page). Observed on device 2026-11-14 in both
// directions, only after a cover/lyrics pick; a plain menu open/close never desynced.
// The counter is gone. Every pushed entry now carries a monotonic `gsdSeq`, and the
// popstate handler closes exactly the stack entries whose seq is ABOVE the landed
// entry's seq — the landed history state is the ground truth, so echo count no
// longer matters: coalesced, split, or stale-entry cases all reconcile in one pass,
// and closeTop() never issues a history.back() of its own, so one gesture can never
// pop the page underneath as a side effect.
//
// Single dismiss path (host components): UI close handlers only flip their own state
// (e.g. `menuOpen = false`); a host-side `$effect` cleanup is the ONLY caller of
// overlays.dismiss(id). That way scrim / X / drag / cover-collapse / back-gesture all
// converge on one dismiss site and history depth stays balanced.

interface OverlayEntry {
	id: string;
	close: () => void;
	/** Did we push a history state for this entry? (false if opened during SSR / no history) */
	pushed: boolean;
	/** quick-261114-bak: the `gsdSeq` written into this entry's history state (0 when
	 *  nothing was pushed). The popstate handler reconciles against it. */
	seq: number;
}

const HAS_WINDOW = typeof window !== 'undefined';

/**
 * quick-261010-npurl: resolve `url` against the current location and return its href ONLY
 * when it is same-origin — history.pushState/replaceState THROW on cross-origin URLs.
 * Absolute share URLs are same-origin on the web build; inside the Capacitor WebView the
 * share builder emits the public origin (openmusic.lol) while location.origin is
 * https://localhost, so this returns null there and callers keep the dummy entry.
 * Never throws (a share-URL builder must not break overlay open).
 */
function sameOriginHref(url: string): string | null {
	try {
		const u = new URL(url, location.href);
		return u.origin === location.origin ? u.href : null;
	} catch {
		return null;
	}
}

class Overlays {
	/** Stack of open overlays, top = last. $state so a depth readout could react if needed. */
	private stack = $state<OverlayEntry[]>([]);
	/** quick-261114-bak: monotonic sequence stamped into every pushed history state
	 *  (`gsdSeq`). The popstate handler closes the stack entries ABOVE the landed
	 *  entry's seq — see the header note for why echo-counting was replaced. */
	private nextSeq = 0;
	/** True during an outbound navigateAway() — suppresses dismiss()'s history.back() so the
	 *  hosts unmounting under the new route can't pop the just-navigated destination off. */
	private navigating = false;
	private listening = false;

	/** Current open-overlay depth (reactive). */
	get depth(): number {
		return this.stack.length;
	}

	/** Is `id` currently the top of the stack? */
	private isTop(id: string): boolean {
		return this.stack.length > 0 && this.stack[this.stack.length - 1].id === id;
	}

	private has(id: string): boolean {
		return this.stack.some((e) => e.id === id);
	}

	/**
	 * Register an open overlay. Idempotent: if `id` is already the top, do nothing
	 * (rapid re-open won't push duplicate history states). Pushes one history state
	 * so the OS/browser Back gesture has something to pop.
	 *
	 * quick-261010-npurl: `url` is an OPTIONAL display URL for the pushed entry —
	 * NowPlaying passes the current song's share URL so the URL bar is always "true"
	 * while it is open. Same-origin only (pushState throws cross-origin); a
	 * cross-origin or unparseable value falls back to the same-URL dummy entry.
	 */
	open(id: string, close: () => void, url?: string) {
		if (this.isTop(id)) return;
		// If it exists deeper in the stack (shouldn't normally happen), drop the stale one.
		if (this.has(id)) this.stack = this.stack.filter((e) => e.id !== id);
		let pushed = false;
		let seq = 0;
		if (HAS_WINDOW) {
			seq = ++this.nextSeq;
			// Raw history.pushState (NOT SvelteKit's shallow-routing pushState from
			// $app/navigation). This is deliberate: a shallow-routing entry makes goto() a
			// NO-OP while it's the current entry (SvelteKit refuses to navigate out of a
			// shallow state), and history.go() desyncs SvelteKit's router index — both of which
			// break the track menu's "Go to artist"/"Go to album" navigation. A raw entry is a
			// plain Back target that goto() can cleanly replace. SvelteKit warns about raw
			// pushState, but our usage is narrow (a dummy Back sentinel, popped via history.back
			// on dismiss or replaced via goto on an outbound nav) and works correctly.
			//
			// quick-261010-npurl: popping back to the entry UNDERNEATH this one is still safe
			// with a real URL on the entry — SvelteKit's popstate handler only navigates for
			// entries carrying its own HISTORY_INDEX state; our raw states hit its else-branch,
			// which merely update_url()s the $page store without re-running loads or
			// destroying components. And popping to a SvelteKit entry underneath is a no-op:
			// its history_index still equals SvelteKit's current_history_index (raw pushes
			// don't move it), so the handler returns early.
			const target = url ? sameOriginHref(url) : null;
			try {
				history.pushState({ gsdOverlay: id, gsdSeq: seq }, '', target ?? undefined);
			} catch {
				// A URL problem must never break overlay open — degrade to the dummy entry.
				history.pushState({ gsdOverlay: id, gsdSeq: seq }, '');
			}
			pushed = true;
		}
		this.stack = [...this.stack, { id, close, pushed, seq }];
	}

	/**
	 * quick-261119-sleepfix: hand an open overlay's slot to a DIFFERENT overlay IN
	 * PLACE — same stack position, same gsdSeq, same history entry (retagged via
	 * replaceState, never a push and never a back). This is the sanctioned
	 * cross-overlay handoff for when overlay B replaces overlay A in direct
	 * response to a tap inside A (the TrackMenu "Sleep timer" cell → the global
	 * SleepTimerSheet).
	 *
	 * Why not close-then-open: A's close flips its state, A's $effect cleanup
	 * calls dismiss(A) which issues history.back(), and only then does B open
	 * (pushState). The push is synchronous/microtask-fast while the traversal
	 * is a queued task, so the push lands FIRST and the back()'s delta is
	 * computed from B's entry — it lands ON A's history entry, and the popstate
	 * reconcile closes every stack entry above the landing, B included. The
	 * sheet opened and instantly closed; the sleep timer was unreachable from
	 * its only set-entry (device report 2026-11-19; mechanism pinned in
	 * overlays.svelte.test.ts, handoff describe).
	 *
	 * With replace() no back() is ever issued: A's cleanup dismiss(A) finds no
	 * entry (has() guard → no-op), and B's own open() is idempotent against the
	 * retagged entry when B is already top (or promotes it via the has() path
	 * if it somehow isn't). B's later dismiss/back handling is completely
	 * ordinary — it owns A's history entry now. Falls back to a plain open()
	 * when fromId isn't in the stack (nothing to hand off; also race-free,
	 * because then no dismiss echo exists either).
	 */
	replace(fromId: string, toId: string, close: () => void) {
		const idx = this.stack.findIndex((e) => e.id === fromId);
		if (idx < 0) {
			this.open(toId, close);
			return;
		}
		const entry = this.stack[idx];
		const next = [...this.stack];
		next[idx] = { id: toId, close, pushed: entry.pushed, seq: entry.seq };
		this.stack = next;
		if (entry.pushed && HAS_WINDOW) {
			try {
				history.replaceState({ gsdOverlay: toId, gsdSeq: entry.seq }, '');
			} catch {
				/* a history problem must never break the handoff — the stack swap already landed */
			}
		}
	}

	/**
	 * quick-261010-npurl: repoint the TOP overlay entry's URL WITHOUT touching history
	 * depth (a replaceState, not a push). NowPlaying calls this when the track, the
	 * resolved cover, or the display language changes while it is open, so the URL bar
	 * stays "true". No-op unless `id` is the current top entry and it pushed a state —
	 * a stale or unmounted caller can never rewrite another entry's URL.
	 */
	replaceUrl(id: string, url: string) {
		if (!HAS_WINDOW || !this.isTop(id)) return;
		const top = this.stack[this.stack.length - 1];
		if (!top.pushed) return;
		const target = sameOriginHref(url);
		if (!target) return;
		try {
			// quick-261114-bak: keep the entry's gsdSeq — the popstate reconcile keys on it.
			history.replaceState({ gsdOverlay: id, gsdSeq: top.seq }, '', target);
		} catch {
			/* a URL problem must never break the playback UI */
		}
	}

	/** Pop the top entry and run its close handler. Invoked by the popstate listener. */
	closeTop() {
		if (this.stack.length === 0) return;
		const top = this.stack[this.stack.length - 1];
		this.stack = this.stack.slice(0, -1);
		top.close();
	}

	/**
	 * Programmatic close from the UI (scrim / X / drag-close / cover-collapse). Removes
	 * the entry and, if it pushed a history state, calls history.back() ONCE to keep
	 * history depth balanced. The resulting popstate cannot double-close anything:
	 * the handler reconciles against the landed entry's gsdSeq (quick-261114-bak).
	 * No-op if `id` isn't in the stack (guards rapid/stale calls).
	 */
	dismiss(id: string) {
		if (!this.has(id)) return;
		const entry = this.stack.find((e) => e.id === id)!;
		this.stack = this.stack.filter((e) => e.id !== id);
		// During an outbound navigateAway() we do NOT history.back(): the destination route has
		// just been pushed and the hosts are unmounting under it; a back() here would pop that
		// destination right back off (the "Go to artist snaps home" over-pop). The leftover raw
		// Back entry is harmless — backing into it lands on the origin URL (or the song URL, if
		// the entry carried quick-261010-npurl's display URL) with an empty stack, so the
		// popstate listener simply no-ops.
		if (entry.pushed && HAS_WINDOW && !this.navigating) {
			// quick-261115-bak2: only pop when our entry is still AT or BELOW the current
			// history position. Device trace (2026-11-15, S23): a single Back gesture
			// traversed to the page entry AND ran this entry's cleanup dismiss WITHOUT
			// our popstate listener ever seeing that traversal — the unconditional
			// history.back() here then popped the PAGE entry too (Back closed Now
			// Playing AND skipped a page; in Chrome it exited past Home entirely).
			// If the browser already moved below our entry, the entry is already
			// popped and there is nothing to balance. The current entry's gsdSeq is
			// the witness: >= entry.seq means ours (or a sibling overlay's, in the
			// same-tick double-dismiss pick flow, whose backs queue back-to-back) is
			// still current; below it (a SvelteKit page entry carries no gsdSeq → 0)
			// means already traversed past.
			let curSeq = 0;
			try {
				const st = history.state as { gsdSeq?: unknown } | null;
				if (st && typeof st.gsdSeq === 'number') curSeq = st.gsdSeq;
			} catch {
				curSeq = 0;
			}
			if (curSeq < entry.seq) return;
			history.back();
			// quick-261114-bak: no echo bookkeeping here any more. However this back()
			// lands (its own popstate, or coalesced with a sibling dismiss's back into
			// one traversal), the popstate handler reconciles the stack against the
			// landed entry's gsdSeq — and this entry is already out of the stack, so
			// no landing can re-close it or the overlay underneath.
		}
	}

	/**
	 * Perform an outbound goto() from INSIDE an overlay (the track menu's "Go to artist" /
	 * "Go to album"). Pass a thunk that runs the SvelteKit goto(); returns its promise.
	 *
	 * The ordering here is load-bearing — it's the result of empirically tracing every failure
	 * mode:
	 *  - goto() runs FIRST, while the overlays are still OPEN. SvelteKit only navigates out of
	 *    an overlay's raw Back entry while that entry is the live current one; closing the
	 *    overlay first makes goto() resolve as a silent NO-OP (URL never changes).
	 *  - `navigating` is set for the whole call so the history.back() each overlay's
	 *    $effect-cleanup dismiss() would fire — as the destination route unmounts the hosts —
	 *    is SUPPRESSED. Without this, that back() pops the just-pushed destination straight back
	 *    off ("Go to artist" flashes the artist page then snaps to the origin).
	 *  - AFTER navigation settles, any overlay still mounted (the now-playing sheet lives in the
	 *    root layout and survives the route change) is closed and its UI reset — still with
	 *    back() suppressed — then the flag clears.
	 *
	 * Leftover raw Back entries are harmless: backing into one lands on the origin URL with an
	 * empty stack, so the popstate listener simply no-ops.
	 */
	async navigateAway(navigate: () => Promise<void>): Promise<void> {
		this.navigating = true;
		try {
			await navigate();
		} finally {
			const entries = this.stack;
			this.stack = [];
			for (let i = entries.length - 1; i >= 0; i--) entries[i].close();
			this.navigating = false;
		}
	}

	/**
	 * Install the single popstate listener. Call ONCE from the app layout onMount and
	 * run the returned teardown in its cleanup. SSR-safe.
	 */
	init(): () => void {
		if (!HAS_WINDOW || this.listening) return () => {};
		this.listening = true;
		const onpop = (e?: PopStateEvent) => {
			// quick-261114-bak: reconcile against the LANDED entry. `history.state` at
			// popstate time is the state of the entry the traversal landed on: one of
			// ours (carries gsdSeq), a SvelteKit entry (its own state shape, no gsdSeq
			// → 0), or null (→ 0). Every stack entry ABOVE that point was popped by
			// this traversal and closes; everything at or below it stays. A dismiss()
			// echo lands exactly on the entry below the dismissed one — whose seq is
			// the new stack top's — so echoes close nothing, however many popstates a
			// batch of same-tick history.back() calls actually produced. An entry
			// with seq 0 pushed nothing, so no traversal can ever close it.
			let landed = 0;
			try {
				// quick-261115-bak2: the event's own state is the landed entry's state
				// (the source SvelteKit's handler trusts); history.state can lag it on
				// some Android WebViews, so it is only the fallback.
				const st = (e?.state ?? history.state) as { gsdSeq?: unknown } | null;
				if (st && typeof st.gsdSeq === 'number') landed = st.gsdSeq;
			} catch {
				landed = 0;
			}
			while (this.stack.length > 0 && this.stack[this.stack.length - 1].seq > landed) {
				this.closeTop();
			}
		};
		window.addEventListener('popstate', onpop);
		return () => {
			window.removeEventListener('popstate', onpop);
			this.listening = false;
		};
	}
}

export const overlays = new Overlays();
