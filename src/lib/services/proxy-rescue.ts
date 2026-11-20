// Stall-fallback edge proxy — client side (Hector 2026-11-19, media-cache option ii).
//
// POSTURE: playback is DIRECT (browser → provider CDN) by default; the edge never touches
// audio bytes for a healthy play. This module owns the ONE exception: when a slow-source
// track has PROVEN it cannot sustain direct playback, the player re-attaches the SAME track
// through the own-origin byte proxy (/api/kuwo/stream/<songid>?level=<tier>), which fetches
// from the edge's shorter-haul position and warms a per-PoP cache for the next listener.
// The rescue is per-track: the next track starts direct again (posture resets), and a track
// is rescued at most once per play generation.
//
// TRIGGER (conservative on purpose — rescue spends edge bandwidth + the minimal legal
// surface, so it is for tracks that are actually failing, not first wobbles):
//   - a mid-song buffer HOLD TIMES OUT (10 s of holding could not rebuild 15 s of buffer —
//     direct throughput is measurably below the stream's need; this is the audit's
//     25.8 KB/s case), OR
//   - the SAME track stalls into its SECOND hold (even if the first recovered — two
//     starvation events in one track put it in the CDN variance tail, and a third
//     stop-start loop is the exact experience the never-stop doctrine bans).
// A first hold that recovers never rescues: one jitter on an otherwise fine route must
// not spend the proxy.
//
// KUWO ONLY in this ship (the route + this builder); the trigger policy itself is
// source-agnostic — sibling sources join by growing proxyRescueTarget's switch.
import { effectiveQuality } from '$lib/sources/quality';
import type { DefaultQuality } from '$lib/stores/settings.svelte';
import type { BufferGateOutcome } from './buffer-gate';

/** A track must stall into this many mid-song holds before the repeat-hold trigger fires. */
export const PROXY_RESCUE_HOLD_COUNT = 2;

/** Own-origin path prefix of the byte-proxy routes (also the already-rescued detector). */
export const PROXY_STREAM_PATH = '/api/kuwo/stream/';

export type KuwoStreamLevel = '128k' | '320k' | 'zp';

export interface ProxyRescueTrack {
	source: string;
	songid: string;
	quality?: string | null;
}

export interface ProxyRescueTarget {
	url: string;
	level: KuwoStreamLevel;
}

/** True when a src already points at the byte proxy (never rescue a rescue). */
export function isProxyStreamSrc(src: string | null | undefined): boolean {
	return !!src && src.includes(PROXY_STREAM_PATH);
}

/**
 * The tier the rescue must fetch = the tier actually playing. The track's own quality tag
 * is the ground truth about the encode when it says lossless (the resolver's zp rung);
 * otherwise the streaming preference decides exactly as a fresh resolve would
 * (sources/kuwo.ts: effectiveQuality → 128k/320k) — a 'lossless' preference whose track
 * resolved to an mp3 fallback honestly proxies the mp3 tier that is playing. When the
 * adaptive quality ladder lands, it re-resolves the track on a downgrade and this reads
 * the ladder's resulting tag/preference at rescue time — the composition point.
 */
export function kuwoLevelForTrack(track: ProxyRescueTrack, pref: DefaultQuality): KuwoStreamLevel {
	if (track.quality === 'lossless') return 'zp';
	return effectiveQuality(pref) === '128' ? '128k' : '320k';
}

/** The proxy target for a track, or null when this ship cannot rescue it (non-kuwo
 *  source, or a songid that is not a plain kuwo numeric id). */
export function proxyRescueTarget(track: ProxyRescueTrack, pref: DefaultQuality): ProxyRescueTarget | null {
	if (track.source !== 'kuwo') return null;
	const songid = (track.songid ?? '').trim();
	if (!/^\d{1,12}$/.test(songid)) return null;
	const level = kuwoLevelForTrack(track, pref);
	return { url: `${PROXY_STREAM_PATH}${songid}?level=${level}`, level };
}

export type ProxyRescuePhase =
	| { kind: 'hold-start'; holdCount: number }
	| { kind: 'hold-end'; outcome: BufferGateOutcome };

/**
 * The rescue decision, pure + total. Guards first (no target, already rescued for this
 * play, or the element already rides the proxy → never), then the phase trigger:
 * hold-start fires on the PROXY_RESCUE_HOLD_COUNT-th hold; hold-end fires only on a
 * 'timeout' outcome (a 'ready' hold proved direct can still carry the track; an 'error'
 * belongs to the error/failover chain, not the proxy).
 */
export function shouldRescueViaProxy(input: {
	target: ProxyRescueTarget | null;
	currentSrc: string | null | undefined;
	alreadyRescued: boolean;
	phase: ProxyRescuePhase;
}): boolean {
	if (!input.target) return false;
	if (input.alreadyRescued) return false;
	if (isProxyStreamSrc(input.currentSrc)) return false;
	return input.phase.kind === 'hold-start'
		? input.phase.holdCount >= PROXY_RESCUE_HOLD_COUNT
		: input.phase.outcome === 'timeout';
}
