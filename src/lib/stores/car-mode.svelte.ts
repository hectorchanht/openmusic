// car-mode — the Car Mode UI state (quick-261116-carmode, Car Mode plan Phase 4, Q2/Q5).
//
// A tiny runes store holding ONE boolean: whether the Car Mode panel owns the
// viewport. The (app) layout reads `active` and swaps the whole shell (page,
// bottom nav, Nowbar) for the panel; the home page's entry button calls enter().
//
// ENTER/EXIT also arm/disarm the Phase 2 adaptive pre-buffer: entering Car Mode
// is the moment the never-stop safety net must be topped up to ~30 minutes of
// local audio (player.armCarBuffer), and exiting hands the buffer back
// (player.disarmCarBuffer). Playback itself is NEVER touched here — exiting the
// panel must not pause, skip or re-resolve anything (Q2: the mode is a UI +
// buffer-arming state, the engine underneath keeps its own state).
//
// Import discipline (AGENTS.md): this store imports the player one-way, exactly
// like components do; the player never imports it, and settings stays a leaf.
import { player } from '$lib/stores/player.svelte';
import { logAction } from '$lib/stores/actionLog.svelte';

class CarMode {
	active = $state<boolean>(false);

	enter(): void {
		if (this.active) return;
		this.active = true;
		player.armCarBuffer();
		logAction('carmode.enter');
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;
		player.disarmCarBuffer();
		logAction('carmode.exit');
	}
}

export const carMode = new CarMode();
