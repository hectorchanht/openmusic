// share-arrival — the PURE decisions a shared link makes on the way in.
//
// The two song landing routes (`/song/[artist]/[title]` and the legacy `/song/[slug]`) carried
// character-for-character identical `resolveAndPlay` bodies, and the Android deep-link handler was
// about to become a third copy of the same reasoning. Three copies of "is this device already
// listening, and is this URL one of ours" is the same failure mode the repo already paid for with
// the readiness guard (four of five copies silently lacked a freshness check) — except two of these
// three are SECURITY gates, so a copy that drifts is a hole, not a stale value.
//
// This is a plain `.ts`, not `.svelte.ts`, deliberately: the decisions are pure functions of their
// inputs, so they run under the node-only Vitest project (the orchestration half below uses a
// mocked player, never a real runes store), and the store stays a thin caller — CLAUDE.md's "pure
// logic is extracted and exported for testability".
//
// 🔴 SSR CONTRACT: the second half of this module imports the RUNES PLAYER STORE, so importing
// `share-arrival` now pulls in the client graph. It must only ever be reached from a lazy
// `await import()` inside `onMount` under a `browser` guard (both `/song/*` landing pages already
// hold exactly that contract, see their header comments) or from code that is client-only by
// construction. NEVER from a `+page.ts` / `+layout.ts` loader or a `+server.ts`.
//
// Implements 38-D-01 / D-23 / D-27 / D-30 and mitigates T-38-01 / T-38-02.
import { ensureTrackDetails } from '$lib/services/catalog';
import { resolveStub } from '$lib/services/discovery';
import { parseEntityParam, stubToTrack } from '$lib/services/share';
import { player } from '$lib/stores/player.svelte';
import type { SourceId, Track } from '$lib/sources/types';

/** Is the recipient's device already producing (or about to produce) sound? */
export type ArrivalMode = 'cold' | 'warm';

/**
 * COLD = nothing is coming out of the speaker, so the shared song may take the seat.
 *
 * D-01: a seated-but-PAUSED song is COLD. `player.restore()` runs on every route and never calls
 * `play()`, so `playing` is false for the restored session a share link almost always lands on —
 * which is exactly the case D-01 rules should be re-seated.
 *
 * D-27: `loading` counts as WARM. A user with a resolve in flight has already committed to
 * listening; arming over them would silently kill the track they just started.
 *
 * Do NOT reach for the player's private `hasPlayedSinceSrc`. It looks like the more honest "real
 * output" signal, but it stays TRUE across a pause (it is reset only in `play()`), so it would
 * classify a paused track as warm — the precise opposite of what D-01 asks for.
 */
export function arrivalMode(s: { playing: boolean; loading: boolean }): ArrivalMode {
	return s.playing || s.loading ? 'warm' : 'cold';
}

/**
 * Decode the `?u=` share carrier into an unresolved `Track`, or `null` to fall back to the name
 * resolve (D-10). Never throws — the carrier is a fast path, never the only path.
 *
 * T-38-01: this is the validation gate. `u` is an attacker-controllable query string whose decoded
 * `source` selects which adapter gets dispatched, so it goes through `parseEntityParam`, whose
 * regex is the closed source enum (kept equal to the `SourceId` union by 38-D-30). A value that
 * does not match yields `null` here and nothing downstream ever performs a `SOURCES[untrusted]`
 * lookup. The `as SourceId` narrowing is safe for that reason and ONLY that reason: the alternation
 * the value just matched IS the union.
 *
 * `title`/`artist` come from the URL's own path segments — with them the carrier is a complete
 * stub, so the recipient does one direct detail resolve instead of a search fan-out (D-08).
 * `stubToTrack` is imported rather than re-inlined so the field set cannot drift from the one
 * `isTrackReady` and the resolver expect.
 */
export function stubFromUidParam(
	u: string | null | undefined,
	artist: string,
	title: string
): Track | null {
	const p = parseEntityParam(u ?? '');
	if (!p) return null;
	return stubToTrack({
		uid: p.uid,
		source: p.source as SourceId,
		songid: p.id,
		title,
		artist,
		album: '',
		cover: null
	});
}

/** D-23: the ONE host `shareOrigin()` emits and the only one App Links claims. `pages.dev` is deliberately not claimed. */
export const APP_LINK_HOST = 'openmusic.lol';

/**
 * An incoming deep-link URL reduced to the in-app path `goto()` can take, or `null` to ignore it.
 *
 * T-38-02: a hostile app can hand the activity ANY `VIEW` intent URL. The manifest's
 * host/pathPrefix filter is the OS's gate and it is not ours — an `appUrlOpen` payload must be
 * re-checked here before it can steer navigation. Two checks, both load-bearing:
 *  - `https:` only. Blocks `javascript:`, `file:` and a plaintext downgrade.
 *  - EXACT host equality, lowercased. Deliberately NOT a trailing/suffix match: an un-anchored
 *    suffix test would accept `evil-openmusic.lol`, the exact dot-anchoring mistake the allowlist
 *    in `safe-image-url.ts` documents. There is one host, so equality is also the smaller check.
 *
 * Returning `pathname + search` (never the absolute URL) is what keeps this from being an open
 * redirect: the value handed to the router is same-origin by construction. The hash is dropped —
 * no share surface uses one.
 */
export function deepLinkPath(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		if (u.hostname.toLowerCase() !== APP_LINK_HOST) return null;
		return u.pathname + u.search;
	} catch {
		// Not a URL — junk or an attack, never something to navigate to.
		return null;
	}
}

// ---- Orchestration (store-facing) ------------------------------------------------
// Everything above is pure. Everything below composes the pure decisions with the two player
// entry points plan 02 added (`armTrack` / `spliceAndPlay`) and the two existing never-throw
// resolvers. It adds NO network call of its own — see the arriveShared JSDoc.

/**
 * What an arrival did, which is what the landing page renders:
 *  - `armed`    — the song is seated, resolved and PAUSED. Idle UI; the "Play on openmusic" CTA
 *                 (D-19) starts an already-armed element instead of beginning a resolve.
 *  - `played`   — sound is coming out now. The page shows the D-20 "your queue is intact" toast.
 *  - `noop`     — nothing changed (already current under D-03, or the page navigated away). Render
 *                 nothing; in particular NOT the unplayable message — the song is fine.
 *  - `notfound` — neither the carrier nor the name resolve produced a playable song. The only
 *                 outcome that earns the unplayable message.
 */
export type ArrivalOutcome = 'armed' | 'played' | 'noop' | 'notfound';

/**
 * The ONE cold/warm dispatcher. Every arrival ends here: both `/song/*` routes (via
 * `arriveShared`), the legacy `?play=` decoder (38-D-12) and the Android deep link (which
 * `goto()`s the route, 38-D-25). One behaviour to reason about and test, not three.
 *
 * WARM (38-D-07) → `spliceAndPlay`: the recipient's queue shape survives, the shared song just
 * splices in after current and plays non-fresh. COLD (38-D-05/D-06) → `armTrack`, which seats the
 * track resolved + paused and never calls `play()`. The cold branch must NOT go through
 * `spliceAndPlay`/`playNext`: `playNext` AUTOPLAYS when the queue is truly empty (38-D-29), which
 * is precisely the first-time-visitor case, and a non-gesture autoplay both violates D-06 and is
 * rejected by mobile autoplay policy anyway.
 *
 * 38-D-03: re-arriving on the song that is already `current` is a NO-OP — never re-seat, never
 * restart, never re-resolve. Same guard shape `relatedTapPlay` has always carried. It also absorbs
 * the Capacitor `getLaunchUrl()` re-fire hazard (RESEARCH §3d): a duplicate delivery of the same
 * URL costs nothing.
 */
export async function arriveTrack(track: Track): Promise<ArrivalOutcome> {
	if (player.current?.uid === track.uid) return 'noop';
	// 38-D-01/D-27: the two `$state` fields, never the private `hasPlayedSinceSrc` (see arrivalMode).
	const mode = arrivalMode({ playing: player.playing, loading: player.loading });
	if (mode === 'warm') return player.spliceAndPlay(track) ? 'played' : 'noop';
	return (await player.armTrack(track)) ? 'armed' : 'notfound';
}

/**
 * A share link arriving at a `/song/*` page: try the `?u=` carrier's direct detail resolve, and
 * fall through to the name resolve when it misses.
 *
 * 38-D-08: with artist/title already in the path, the carrier is a complete stub, so the recipient
 * does ONE detail call instead of the search fan-out — and hears the same version the sender did.
 * 38-D-13: this fires on mount, immediately; a recipient who taps play straight away (the common
 * case) gains nothing from an interaction-gated prefetch, because their tap IS the first
 * interaction.
 * 38-D-10: a dead, wrong or unresolvable carrier degrades SILENTLY to the existing name resolve.
 * The carrier is a fast path, never the only path — written as an explicit branch on each side so
 * it cannot rot into an implicit one. A stale link degrades to today's behaviour, never to a dead
 * page (the isolate-and-degrade house rule).
 * 38-D-15: carrier-free legacy links get the SAME mount-time treatment. One code path, and those
 * links need the help most.
 * 38-D-16: a tap during the in-flight resolve awaits THIS promise in the page — never a second
 * request; `apiFetch`'s GET dedupe is the second net under it.
 *
 * 🔴 Adds NO network call. Every request lives inside `ensureTrackDetails` / `resolveStub`, whose
 * adapters already route through the `apiFetch` governor (dedupe + concurrency cap + timeout +
 * circuit breaker), so D-15's "route it through the governor" needs no code here — only the
 * discipline of not reaching for a raw request (RESEARCH §8d). And no forced element reload and no
 * blob pre-buffer: warm-up stops at resolve + `audio.src` (38-D-14), the shape `restore()` uses.
 */
export async function arriveShared(
	input: { artist: string; title: string; u?: string | null },
	signal?: AbortSignal
): Promise<ArrivalOutcome> {
	// T-38-01: the ONLY path from the query string to a source dispatch, and it is a closed enum.
	const stub = stubFromUidParam(input.u, input.artist, input.title);
	if (stub) {
		// 38-D-03 BEFORE any network — re-opening a link for the seated song must cost nothing.
		if (player.current?.uid === stub.uid) return 'noop';
		if (arrivalMode({ playing: player.playing, loading: player.loading }) === 'cold') {
			// Seat-first: the nowbar shows the shared song with its seeded cover while the single
			// detail call runs (38-D-13), the same UX restore() already gives a PWA reopen.
			const armed = await player.armTrack(stub);
			if (armed) return 'armed';
		} else {
			const resolved = await ensureTrackDetails(stub, signal);
			// ensureTrackDetails never throws for a miss — it returns the input untouched and
			// unstamped, so "no audioUrl" IS the carrier-miss signal (RESEARCH §8c).
			if (resolved.audioUrl) return player.spliceAndPlay(resolved) ? 'played' : 'noop';
		}
		// …and either miss FALLS THROUGH to the name resolve below. 38-D-10.
	}

	// The page navigated away mid-resolve — do not spend the search fan-out on a dead view (T-38-04).
	if (signal?.aborted) return 'noop';

	const byName = await resolveStub(input.artist, input.title);
	if (!byName) return 'notfound';
	return arriveTrack(byName);
}
