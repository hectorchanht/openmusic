<script lang="ts">
	// Single mounted toast renderer (D-15). Reads the global toast store and renders the one
	// visible message; mounted ONCE in the app layout alongside NowPlaying/SleepTimerSheet so
	// every page shares this host instead of carrying its own copy. Both the message AND the
	// quick-260910-omt action-button label are rendered as text content only (auto-escaped) —
	// never {@html} (T-23-01). The `.toast` style + fly transition are copied byte-identical from
	// TrackMenu's local copy (now a flex row so the optional button sits beside the message); its
	// grandfathered pill values (env safe-area top, 999px radius) are exempt from the 8pt scale
	// per UI-SPEC §1. The button is a native <button> inside the polite live region, so it is
	// keyboard-focusable and announced with the message as one utterance.
	import { fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
</script>

{#if toast.msg}<div class="toast" role="status" aria-live="polite" transition:fly={{ y: -20, duration: 180 }}><span class="msg">{toast.msg}</span>{#if toast.action}<button type="button" class="act" onclick={() => toast.act()} use:tapBounce>{toast.action.label}</button>{/if}</div>{/if}

<style>
	.toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 14px); z-index: 90; background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 0.8125rem; box-shadow: var(--shadow-lg); border-color: darkgrey; display: flex; align-items: center; gap: 12px; max-width: min(92vw, 520px); }
	.toast .msg { min-width: 0; }
	/* Copied from +layout.svelte's .notice-toast .retry (the never-stop pill's button). */
	.toast .act { flex: none; background: var(--color-primary, #7c5cff); color: #fff; border: none; border-radius: 999px; padding: 8px 14px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; min-height: 32px; }
</style>
