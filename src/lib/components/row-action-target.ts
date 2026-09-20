// row-action-target — WHICH Track a SongRow's inline Like / Download may act on (quick-260919-l9e).
//
// A list row is not always a resolved song. Three shapes reach SongRow today:
//   * a REAL Track (search / artist / library / history) — `uid = ${source}:${songid}`, real identity;
//   * a DISCOVERY stub (charts/top, charts/tags, charts/countries) — `uid: ''`, no identity at all;
//   * a NAME stub (album tracklist, `similar.ts` nameStub) — `uid: ${source}:similar-${matchKey}`,
//     which is TRUTHY and so slips straight past a `!track.uid` guard. `library.toggleLike` would
//     ACCEPT it and persist an unplayable synthetic uid into the liked list forever.
// `resolveByName` is the marker nameStub already sets on that shape, so it is the discriminator
// here rather than a `similar-` prefix sniff — one typed field, minted in one place.
//
// PURE + node-testable on purpose (the repo has no jsdom project): the decision table is here, the
// await / in-flight flag / generation guard stay in the component, exactly as `inflightGuard.ts` and
// `track-menu-gate.ts` split them.
import type { Track } from '$lib/sources/types';

/** Does this track carry real, persistable identity? Empty uid = no. Synthetic name-stub uid = no. */
export function hasRealIdentity(track: Track | null | undefined): track is Track {
	return !!track && !!track.uid && track.resolveByName !== true;
}

/**
 * What an inline row action must do when tapped.
 *   act     — a real Track is in hand (the row's own, or one a previous tap already resolved).
 *   resolve — the row is a stub AND the surface supplied a resolver: resolve first, then act.
 *   refuse  — a stub with no resolver. The caller must SAY SO (unplayable toast), never silently
 *             no-op on a button that looks live, and never act on the stub itself.
 */
export type RowActionPlan =
	| { kind: 'act'; track: Track }
	| { kind: 'resolve' }
	| { kind: 'refuse' };

export function rowActionTarget(
	track: Track,
	resolved: Track | null,
	canResolve: boolean
): RowActionPlan {
	// The cached resolve wins: a row resolved by an earlier Like tap must not resolve again for
	// the Download tap sitting next to it.
	if (hasRealIdentity(resolved)) return { kind: 'act', track: resolved };
	if (hasRealIdentity(track)) return { kind: 'act', track };
	return canResolve ? { kind: 'resolve' } : { kind: 'refuse' };
}
