<script lang="ts">
	// quick-261029-xor1 — STANDING RULE (Hector 2026-10-29, SUPERSEDES quick-261024-load1's
	// "skeleton + spinner everywhere"): NEVER show a spinner and a skeleton together —
	// exactly ONE loading indicator per loading area. Spinner ONLY for small elements
	// (a button, a small control, a compact inline action); skeleton ONLY for long
	// text / paragraphs / long content lists. So: `lines` (About, Lyrics) and `rows`
	// (Comments) render the skeleton ALONE (the global `.sk` shimmer from app.css, no
	// ring); neither = spinner ONLY (the app's established ring — TrackMenu /
	// VersionPicker .row-spinner recipe — for overlays / compact states). `dark`
	// recolours the ring for dark surfaces like the video stage.
	let {
		label,
		lines = 0,
		rows = 0,
		dark = false
	}: { label: string; lines?: number; rows?: number; dark?: boolean } = $props();

	// Bar widths vary so the skeleton reads as content, not a grid (deterministic — no
	// Math.random in render, the pane must not reshuffle widths between paints).
	const WIDTHS = [92, 100, 84, 96, 64, 88, 72, 100];
</script>

<div class="loadstate" class:dark aria-busy="true" aria-label={label}>
	{#if rows === 0 && lines === 0}
		<span class="ring motion-always" aria-hidden="true"></span>
	{/if}
	{#if rows > 0}
		<div class="skrows" aria-hidden="true">
			{#each Array(rows) as _, i (i)}
				<div class="skrow">
					<span class="sk thumb"></span>
					<span class="skbars">
						<span class="sk bar" style:width="{WIDTHS[(i * 2) % WIDTHS.length]}%"></span>
						<span class="sk bar" style:width="{WIDTHS[(i * 2 + 3) % WIDTHS.length]}%"></span>
					</span>
				</div>
			{/each}
		</div>
	{:else if lines > 0}
		<div class="sklines" aria-hidden="true">
			{#each Array(lines) as _, i (i)}
				<span class="sk line" style:width="{WIDTHS[i % WIDTHS.length]}%"></span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.loadstate { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 20px 4px 10px; }
	.ring { flex: none; width: 20px; height: 20px; border: 2px solid var(--color-text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; }
	.loadstate.dark .ring { border-color: rgba(255, 255, 255, 0.8); border-top-color: transparent; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.sklines { width: 100%; display: flex; flex-direction: column; gap: 10px; }
	.sk.line { display: block; height: 12px; border-radius: 6px; }
	.skrows { width: 100%; display: flex; flex-direction: column; gap: 14px; }
	.skrow { display: flex; align-items: center; gap: 10px; width: 100%; }
	.sk.thumb { flex: none; width: 32px; height: 32px; border-radius: 50%; }
	.skbars { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
	.sk.bar { display: block; height: 11px; border-radius: 6px; }
</style>
