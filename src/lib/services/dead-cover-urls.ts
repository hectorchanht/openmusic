// dead-cover-urls — the session's registry of cover URLs proven DEAD by an Image() probe.
//
// WHY THIS EXISTS (quick-261020-dcvr): a row's `track.cover` (pickRowCover rung 2 /
// libraryRowCover's seeded read) can be a dead-but-nonempty https URL. It then SHADOWS the live
// shared cache (rung 3): the row paints the dead URL (a broken <img> / empty CSS url() →
// gradient) while the now-playing bar — which reads the cache first — shows the healed art.
// `use:lazyCover` is one-shot per row, so the row never re-probes and sits on gradient forever
// ("row gradient while the nowbar has art").
//
// Writers: lazyCover D-15 (the track.cover probe failed) and player.healCover (the painted-cover
// probe failed, plus dead chain-hit / dead candidates) mark URLs dead here. Readers
// (pickRowCover, libraryRowCover) skip a seeded URL that is marked dead, letting the live cache
// rung show through. A URL that later passes a probe is UNMARKED (both writers do this on the
// alive path), so a transient blip can't hide a good URL forever. Session-scoped (module-level
// Set, never persisted): a wrong mark costs at most one session.
//
// This module is pure (no runes / store / cache imports) so pickRowCover stays node-testable.

const dead = new Set<string>();

/** Record a cover URL as proven-dead by an Image() probe. Idempotent. */
export function markCoverUrlDead(url: string): void {
	dead.add(url);
}

/** Clear a dead mark — called when the URL passes an Image() probe. Idempotent. */
export function unmarkCoverUrlDead(url: string): void {
	dead.delete(url);
}

/** Whether the URL is currently marked dead. Nullish / empty input is never "dead". */
export function isCoverUrlDead(url: string | null | undefined): boolean {
	return !!url && dead.has(url);
}

/** Test-only reset for the session registry. */
export function __resetDeadCoverUrls(): void {
	dead.clear();
}
