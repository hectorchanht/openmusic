// Global toast store (Svelte 5 runes singleton). One transient message at a time — no
// stacking/queue. Consolidates the three local `toast()` copies (TrackMenu et al.) into a
// single source of truth so the feedback layer never drifts (D-15). In-memory only (no
// localStorage), SSR-guarded so the browser-only timer never runs on the server.
import { browser } from '$app/environment';

/** quick-260910-omt: an optional single button rendered beside the message (e.g. Undo). */
export type ToastAction = { label: string; run: () => void };

class Toast {
	/** Currently-visible message ('' = nothing showing). Reactive via $state. */
	msg = $state('');
	/** quick-260910-omt: the action button for the CURRENT message, or null. Reactive via $state. */
	action = $state<ToastAction | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	/** Show `msg` as a transient toast. A second call before the timeout REPLACES the message and
	 *  RESETS the timer (no stacking — one message at a time).
	 *
	 *  Duration (quick-260910-omt): `opts.duration` when given, else 5000ms when an action is
	 *  present (so the button is actually hittable), else the locked 2000ms plain default.
	 *
	 *  Supersede contract: `action` is reassigned on EVERY show, so a later toast — with or
	 *  without its own action — DISCARDS a pending one. A superseded action is dropped, never
	 *  fired; only an explicit `act()` runs a callback. SSR-safe: the timer is browser-only. */
	show(msg: string, opts?: { action?: ToastAction; duration?: number }): void {
		this.msg = msg;
		this.action = opts?.action ?? null;
		if (this.timer) clearTimeout(this.timer);
		if (browser) {
			this.timer = setTimeout(
				() => {
					this.msg = '';
					this.action = null;
					this.timer = null;
				},
				opts?.duration ?? (opts?.action ? 5000 : 2000)
			);
		}
	}

	/** Run the current action (if any) and close. Dismisses BEFORE running so a callback that
	 *  itself shows a toast is not immediately wiped, and so a double-tap finds no action. */
	act(): void {
		const a = this.action;
		if (!a) return;
		this.dismiss();
		a.run();
	}

	/** Close the toast now (clears the message, the action and the pending timer). */
	dismiss(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.msg = '';
		this.action = null;
	}
}

export const toast = new Toast();
