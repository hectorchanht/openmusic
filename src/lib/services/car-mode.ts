// car-mode — the PURE decisions behind the Car Mode panel (quick-261116-carmode,
// Car Mode plan Phase 4). The component (components/CarMode.svelte) is a thin shell
// over these helpers + the player/library stores, so every judgement the panel makes
// is node-testable here. Never throws; no browser globals; no store imports.

/** What the reliability dot says about the CURRENT track's audio source:
 *  - 'local'  — the bytes are on the device (library download, prebuffer or
 *    car-buffer blob): the Never-Stop safety net is holding this track, so the
 *    music survives a dead zone. Rendered GREEN.
 *  - 'stream' — the bytes are coming over the network right now. Rendered AMBER:
 *    not a warning, just the honest "this one depends on signal" signal the
 *    plan's subconscious-first design calls for (colour, never a text badge).
 *  - 'none'   — nothing is loaded, so there is nothing to vouch for; the dot
 *    is not rendered at all. */
export type ReliabilityDot = 'local' | 'stream' | 'none';

/** Decide the reliability dot from the player's reactive provenance mirror
 *  (player.currentLocal — true exactly when the attached src is a download-blob
 *  or prebuffer-blob; see player.setSrcKind). No track → no dot. */
export function reliabilityDot(input: { hasTrack: boolean; isLocal: boolean }): ReliabilityDot {
	if (!input.hasTrack) return 'none';
	return input.isLocal ? 'local' : 'stream';
}

/** Progress fraction for the panel's top sliver, clamped to [0, 1]. Mirrors the
 *  Nowbar's inline math (currentTime / duration) but guards the degenerate
 *  inputs a bare division would leak: unknown/zero duration, NaN, negative or
 *  overshooting times (a seek past the end before durationmetadata lands). */
export function progressFraction(currentTime: number, duration: number): number {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
	const f = currentTime / duration;
	return f >= 1 ? 1 : f;
}
