<script lang="ts">
	// quick-261008-keytip — the hover key-tip: a control's label + its keyboard-shortcut badge(s).
	//
	// WHAT: a tiny aria-hidden bubble rendered as a DIRECT child of the transport control it
	// documents (NowPlaying's prev/play/next + seek scrubber, the Nowbar play/prev/next). It
	// shows the control's localized label — always the SAME t() string as the control's own
	// aria-label, so no new i18n keys are added and i18n.test.ts key-set parity is untouched —
	// plus one <kbd> badge per shortcut.
	//
	// WHY NOT title=: the ask is the YouTube-style "label + key badge" hover card, which a native
	// title= cannot render (no badge styling, no multi-key layout, OS-dependent delay).
	//
	// THE BADGE STRINGS MUST MATCH services/transport-keys.ts EXACTLY — that module is the single
	// source of truth and deliberately defines NO single-letter shortcuts (do not invent any):
	//   Space            → toggle play/pause
	//   ←                → previous track        →  → next track
	//   Shift+← / Shift+→ → ∓5s seek (SEEK_STEP_SECONDS; the scrubber's own focused arrows seek
	//                        the same ±5s, so the scrubber tip carries both badges)
	//
	// WHY THE REVEAL IS HOVER-GATED (see the "Global key-tip" section in app.css): this app is
	// mobile-first and hover does not exist on touch. The bubble only appears under
	// `@media (hover: hover)` — a touch browser's emulated :hover can never leave it stuck open
	// after a tap (the same gate SettingHint uses for its description panel, MENU-03 / D-12) —
	// and it is pointer-events:none everywhere, so it can never swallow the control's own tap.
	// `:focus-visible` reveals it too, so keyboard users get the shortcut documented as well.
	let {
		label,
		keys,
		placement = 'top'
	}: {
		label: string;
		/** Shortcut badge strings, in transport-keys.ts terms (e.g. ['Space'], ['←'], ['← →', 'Shift ← →']). */
		keys: string[];
		/**
		 * 'top' floats the bubble above the control (NowPlaying transport + scrubber — the
		 * sheet has headroom). 'left' floats it to the control's left, vertically centered
		 * (Nowbar — the bar is overflow:hidden with ~12px of headroom, so a top bubble would
		 * be clipped; leftwards there is the full bar width).
		 */
		placement?: 'top' | 'left';
	} = $props();
</script>

<span class="ktip" class:ktip-left={placement === 'left'} aria-hidden="true">
	<span class="ktip-label">{label}</span>
	{#each keys as k (k)}
		<kbd>{k}</kbd>
	{/each}
</span>
