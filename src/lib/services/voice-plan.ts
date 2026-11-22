// AI voice button — pure proposal helpers (quick-261122-voice). The store does the I/O
// (search, library reads); the shaping decisions live here so they are node-testable.
import type { Track } from '$lib/sources/types';
import type { VoiceIntentKind } from '$lib/services/voice-intent';

export type ControlAction = 'pause' | 'resume' | 'next' | 'previous';
export type ListSource = 'artist' | 'genre' | 'liked' | 'history';

/** What the action card proposes. OK executes exactly this — nothing is re-decided. */
export type VoiceProposal =
	| { kind: 'play-song'; track: Track; alternates: Track[] }
	| { kind: 'play-list'; source: ListSource; label: string; tracks: Track[] }
	| { kind: 'control'; action: ControlAction }
	| { kind: 'answer'; text: string }
	| { kind: 'none'; reason: 'not-found' | 'not-understood' | 'no-liked' | 'no-history' | 'nothing-playing'; query: string };

export const LIST_CAP = 40;
export const ALTERNATES = 3;

function norm(s: string): string {
	return s.toLowerCase().replace(/[\s·・.,，、()（）'"-]+/g, '');
}

/**
 * The artist's own songs first: rows whose artist field contains the spoken name (either way
 * round, so "张学友" matches "张学友 / 梅艳芳" duets). When too few match (the name came back
 * romanised, or the search was fuzzy), the whole result list stands in — something plays.
 */
export function pickArtistTracks(list: Track[], artist: string, cap = LIST_CAP): Track[] {
	const a = norm(artist);
	if (!a) return list.slice(0, cap);
	const own = list.filter((t) => {
		const ta = norm(t.artist ?? '');
		return !!ta && (ta.includes(a) || a.includes(ta));
	});
	return (own.length >= 3 ? own : list).slice(0, cap);
}

/** The control a transport intent maps to. */
export function controlFor(kind: VoiceIntentKind): ControlAction | null {
	return kind === 'pause' || kind === 'resume' || kind === 'next' || kind === 'previous' ? kind : null;
}

/** Swap the card's main song for an alternate (the "not this one" path), keeping the rest. */
export function swapAlternate(p: Extract<VoiceProposal, { kind: 'play-song' }>, uid: string): VoiceProposal {
	const alt = p.alternates.find((t) => t.uid === uid);
	if (!alt) return p;
	return { kind: 'play-song', track: alt, alternates: [p.track, ...p.alternates.filter((t) => t.uid !== uid)] };
}
