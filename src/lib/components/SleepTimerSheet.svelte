<script lang="ts">
	// Globally-mounted sleep-timer sub-sheet (TIMER-01, plan 18-03). This is the THIRD instance
	// of the exact `pickerOpen` overlay precedent from TrackMenu.svelte — but driven by the
	// shared `sleepTimer.sheetOpen` UI flag instead of a component-local boolean, so the track
	// menu, the nowbar moon badge AND the expanded now-playing readout all open the SAME sheet.
	//
	// It is mounted ONCE (ungated) in (app)/+layout.svelte so it is reachable whether the
	// now-playing is collapsed (nowbar) or expanded (NowPlaying).
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Moon } from '@lucide/svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
	import { player, fmtTime } from '$lib/stores/player.svelte';
	import { t } from '$lib/i18n';

	const DURATIONS = [5, 10, 15, 30, 45, 60];

	function close() {
		sleepTimer.sheetOpen = false;
	}

	// After EVERY set/cancel, arm (or disarm) the player's coarse secondary wake-timer backstop
	// (18-02 contract: the UI must call player.onSleepTimerSet() after set('minutes', n) to catch
	// the iOS screen-wake-after-stall case). onSleepTimerSet() is idempotent — a non-minutes set or
	// a cancel just disarms any prior wake timer. The timeupdate listener stays the expiry authority.
	function pickMinutes(min: number) {
		sleepTimer.set('minutes', min);
		player.onSleepTimerSet();
		close();
	}
	function pickEndOfTrack() {
		sleepTimer.set('end-of-track');
		player.onSleepTimerSet();
		close();
	}
	function cancelTimer() {
		sleepTimer.cancel();
		player.onSleepTimerSet();
		close();
	}

	// ---- back-gesture wiring (SINGLE dismiss path — clones TrackMenu's pickerOpen $effect) ----
	// DEP IS `sleepTimer.sheetOpen` ONLY (Pitfall 6 — never add sleepTimer.active/remaining or the
	// 1s tick would churn open/dismiss every second, desyncing history depth). The overlays calls
	// are untrack()ed so another overlay pushing/popping can't re-run this effect. Visibility is
	// gated by the `{#if sleepTimer.sheetOpen}` render guard, NOT by the effect. The $effect
	// cleanup is the ONE site that calls overlays.dismiss — scrim/drag/back-gesture all converge
	// on it (each only flips sheetOpen=false), keeping history depth balanced.
	$effect(() => {
		if (sleepTimer.sheetOpen) {
			untrack(() => overlays.open('trackmenu-timer', () => (sleepTimer.sheetOpen = false)));
			return () => untrack(() => overlays.dismiss('trackmenu-timer'));
		}
	});
</script>

{#if sleepTimer.sheetOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: close }} use:focusTrap>
		<div class="menu-head">
			{t('menu.sleepTimer')}{#if sleepTimer.active && sleepTimer.mode === 'minutes'} · {fmtTime(sleepTimer.remaining / 1000)}{/if}
		</div>
		{#each DURATIONS as min (min)}
			<button
				class="mi"
				class:on={sleepTimer.mode === 'minutes' && sleepTimer.selectedMinutes === min}
				onclick={() => pickMinutes(min)}
			>
				<Moon size={18} /> {t('timer.minutes', { n: min })}
			</button>
		{/each}
		<button class="mi" class:on={sleepTimer.mode === 'end-of-track'} onclick={pickEndOfTrack}>
			<Moon size={18} /> {t('timer.endOfTrack')}
		</button>
		{#if sleepTimer.active}
			<button class="mi cancel" onclick={cancelTimer}>
				{t('timer.cancel')}
			</button>
		{/if}
	</div>
{/if}

<style>
	/* Standalone copies of the minimal TrackMenu sub-sheet classes (the sheet is its own
	   component, so it can't inherit TrackMenu's scoped <style>). Kept in visual sync with
	   .scrim/.menu/.menu-head/.mi/.mi.on in TrackMenu.svelte. */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	.menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
	.mi:hover { background: var(--color-surface); }
	.mi.on { color: var(--color-primary); background: var(--color-surface); }
	.mi.cancel { color: #ff7a90; justify-content: center; }
</style>
