// Sleep-timer state (Svelte 5 runes singleton, TIMER-01). WRAPS the pure
// node-testable helpers in src/lib/services/sleep-timer.ts — same pure-core /
// runes-wrapper separation as the player store over media-session.ts.
//
// LEAF-STORE DISCIPLINE (CRITICAL): this store imports ONLY the pure helpers and
// imports NOTHING from the player engine — the player imports THIS store, never the
// reverse. The one-directional dependency prevents a circular import.
//
// IN-MEMORY ONLY (D-13): no persisted storage, no SSR-environment flag, no reload
// survival — a sleep timer is per-session intent that must never outlive a reload.
//
// The 1s `setInterval` is a UI-cadence countdown ONLY (drives `remaining` for the
// readouts). It is NEVER the deadline authority — that throttle-proof backstop lives
// in the player's `timeupdate` listener against the ABSOLUTE `deadline` (plan 02).
import { computeDeadline, remainingMs, type SleepMode } from '$lib/services/sleep-timer';

class SleepTimer {
	mode = $state<SleepMode>('off');
	/** ABSOLUTE wall-clock deadline (`Date.now()+ms`, D-14) — survives bg-tab throttling. */
	deadline = $state<number | null>(null);
	/** The chosen duration, kept for the active-duration highlight + restart() (D-11). */
	selectedMinutes = $state<number | null>(null);
	/** ms left, refreshed by the 1s UI tick while a minutes timer is active. */
	remaining = $state(0);
	/**
	 * UI-trigger flag (plan 18-03): any surface (track menu, nowbar badge, now-playing
	 * readout) flips this to `true` to open the ONE globally-mounted SleepTimerSheet. Pure UI
	 * state — never touched by the deadline logic, never persisted. The sheet's overlay $effect
	 * depends on this flag ONLY (the pickerOpen precedent).
	 */
	sheetOpen = $state(false);
	private tick: ReturnType<typeof setInterval> | null = null;

	get active(): boolean {
		return this.mode !== 'off';
	}

	set(mode: 'minutes', minutes: number): void;
	set(mode: 'end-of-track'): void;
	set(mode: 'minutes' | 'end-of-track', minutes?: number): void {
		this.clearTick();
		if (mode === 'minutes') {
			const now = Date.now();
			this.selectedMinutes = minutes ?? null;
			this.deadline = computeDeadline(now, minutes ?? 0);
			this.mode = 'minutes';
			this.remaining = remainingMs(now, this.deadline);
			// UI-cadence countdown ONLY — recomputed from the absolute deadline, never
			// accumulated tick-by-tick (avoids drift under bg-tab throttling).
			this.tick = setInterval(() => {
				this.remaining = remainingMs(Date.now(), this.deadline);
			}, 1_000);
		} else {
			this.mode = 'end-of-track';
			this.deadline = null;
			this.selectedMinutes = null;
			this.remaining = 0;
		}
	}

	/** Re-arm a minutes timer from the last chosen duration with a FRESH deadline (D-11). */
	restart(): void {
		if (this.selectedMinutes != null) {
			this.set('minutes', this.selectedMinutes);
		}
	}

	/** Silent cancel (D-09): off, no deadline, no leaked interval. */
	cancel(): void {
		this.clearTick();
		this.mode = 'off';
		this.deadline = null;
		this.selectedMinutes = null;
		this.remaining = 0;
	}

	private clearTick(): void {
		if (this.tick) {
			clearInterval(this.tick);
			this.tick = null;
		}
	}
}

export const sleepTimer = new SleepTimer();
