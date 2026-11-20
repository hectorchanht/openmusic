// Buffer gate for slow (China-hosted) sources — NEVER-STOP doctrine
// (Hector 2026-11-19, standing): "the music have to be non stop, wait for
// 2-3s at the beginning is nothing to user cause they know they have to
// wait." Users EXPECT an initial load wait; a mid-song stall is what feels
// broken. So a FRESH play of a China-CDN track spends initial seconds
// freely: the live <audio> does not start until it holds a meaningful
// head start of buffered audio, instead of starting at canplay with a
// few seconds in hand and underrunning on the first CDN jitter.
//
// Why these sources: kuwo / qq / netease / gdnetease / joox / kugou /
// migu audio is served from mainland-China CDNs (kuwo.cn, gtimg.cn,
// music.126.net …). Measured live 2026-11-19 from North America on
// kuwo:493469900: resolve 2.2–2.7s, then ~230–270 KB/s (~2 Mbps) off
// car-er/car-lv.kuwo.cn (Tencent COS, Cache Miss) — a cold cross-Pacific
// fetch whose instantaneous rate dips below the playback bitrate
// regularly, worst at lossless (.mgg/FLAC, ~1 Mbps+ sustained).
// gdnetease is included because it serves the SAME direct 126.net
// Netease CDN URLs as netease (see sources/gdnetease.ts) — same host,
// same physics, different adapter id.
//
// NOT gated (instant by construction or a fast global CDN):
//  - blob: srcs — download-blob / prebuffer-blob / device files are
//    already local bytes; gating them would only add latency.
//  - ytmusic (Google global CDN), audius, bilibili, and every other
//    source not listed above.
//  - resume / seek / same-src re-resolve recovery — those paths never
//    call this gate; only play()'s fresh network attach does. A repeat
//    play served from the browser media cache satisfies the gate on
//    the first poll (the bytes are already buffered), so it stays
//    near-instant.
//
// Thresholds (never-stop priority, per Hector's 2026-11-19 blessing to
// lean LONGER rather than shorter):
//  - TARGET 30s of buffered-ahead audio. At 320k that is ~1.2 MB
//    (~5s at the measured Kuwo rate — an acceptable, expected start
//    wait); a track shorter than the target is ready once buffered
//    to its end, and readyState HAVE_ENOUGH_DATA (the browser's own
//    can-play-through estimate) also satisfies the gate.
//  - TIMEOUT 12s hard cap: a dead / stalled CDN can never hang the
//    play forever — on timeout we play with whatever has buffered
//    (at the measured rate 12s ≈ 3 MB ≈ 75s of 320k audio, so even a
//    timed-out gate leaves a large head start) and the existing
//    stall watchdog / error failover stays in charge from there.
import type { SourceId } from '$lib/sources/types';

export const SLOW_BUFFER_TARGET_SEC = 30;
export const SLOW_BUFFER_TIMEOUT_MS = 12_000;
export const SLOW_BUFFER_POLL_MS = 100;

/**
 * Resume hysteresis (Hector 2026-11-19, second refinement): the
 * stop-start LOOP is the specific enemy — "lag/停下播下停下播下" while
 * immersed (or driving, Car Mode) is as bad as stopping outright. The
 * loop happens because the browser auto-resumes the instant a SLIVER
 * of data lands after a `waiting` stall, then starves again seconds
 * later. So a mid-song stall on a slow source holds the resume until
 * buffered-ahead is back above a HEALTHY threshold — 15s: half the
 * initial gate (the track is warm, the route is proven), but ~15x the
 * sliver the browser would resume on. Bounded by a 10s timeout: on
 * timeout playback resumes with whatever has arrived — a dead CDN is
 * never trapped by the hold, and the never-stop failover/interlude
 * logic keeps owning total failure exactly as before.
 */
export const SLOW_RESUME_TARGET_SEC = 15;
export const SLOW_RESUME_TIMEOUT_MS = 10_000;

export const SLOW_BUFFER_SOURCES: ReadonlySet<SourceId> = new Set<SourceId>([
	'kuwo',
	'qq',
	'netease',
	'gdnetease',
	'joox',
	'kugou',
	'migu'
]);

export function isSlowBufferSource(source: string | null | undefined): boolean {
	return !!source && (SLOW_BUFFER_SOURCES as ReadonlySet<string>).has(source);
}

/** The src kinds play() attaches (mirrors the player's SrcKind). Only the
 *  two REMOTE kinds can ever be gated — blob kinds are local bytes. */
export type BufferGateSrcKind = 'url' | 'direct-url' | 'download-blob' | 'prebuffer-blob';

/**
 * Should this fresh attach wait for a head start before playing?
 * Pure + total: slow source AND a remote kind AND an http(s) src
 * (a blob:/data: src is local even if a kind label were wrong).
 */
export function shouldBufferGate(input: {
	source: string | null | undefined;
	kind: BufferGateSrcKind;
	src: string | null | undefined;
}): boolean {
	if (!isSlowBufferSource(input.source)) return false;
	if (input.kind !== 'url' && input.kind !== 'direct-url') return false;
	const src = input.src ?? '';
	return src.startsWith('https://') || src.startsWith('http://');
}

/** Minimal structural view of a media element's buffer (TimeRanges-like). */
export interface BufferedRangesLike {
	length: number;
	start(index: number): number;
	end(index: number): number;
}

export interface BufferGateElement {
	buffered?: BufferedRangesLike | null;
	currentTime?: number;
	duration?: number;
	readyState?: number;
	addEventListener?: (type: string, cb: () => void) => void;
	removeEventListener?: (type: string, cb: () => void) => void;
}

/**
 * Seconds of audio buffered AHEAD of `at` (default: the element's
 * current position). 0 when no range covers the position, when the
 * element exposes no buffer (test fakes / detached elements), or on
 * any throw — a detached element's TimeRanges throw on access, and a
 * logging/gating helper must never take playback down with it.
 */
export function bufferedAheadSec(el: BufferGateElement | null | undefined, at?: number): number {
	try {
		const b = el?.buffered;
		if (!b || b.length === 0) return 0;
		const t = at ?? el?.currentTime ?? 0;
		for (let i = 0; i < b.length; i++) {
			const s = b.start(i);
			const e = b.end(i);
			if (t >= s && t <= e) return Math.max(0, e - t);
			// A range that starts a hair ahead of the playhead (the usual
			// shape right after a src attach at t=0) still counts: the
			// browser will play straight into it.
			if (s > t && s - t < 0.5) return Math.max(0, e - t);
		}
		return 0;
	} catch {
		return 0;
	}
}

/** True when the buffered ranges reach (within epsilon) the track end —
 *  a short track can never hold TARGET seconds, so full-buffer IS ready. */
export function bufferedToEnd(el: BufferGateElement | null | undefined): boolean {
	try {
		const b = el?.buffered;
		const d = el?.duration;
		if (!b || b.length === 0 || !d || !Number.isFinite(d) || d <= 0) return false;
		for (let i = 0; i < b.length; i++) {
			if (b.end(i) >= d - 0.25) return true;
		}
		return false;
	} catch {
		return false;
	}
}

export type BufferGateOutcome = 'ready' | 'timeout' | 'error' | 'superseded';

export interface WaitForBufferOpts {
	targetSec?: number;
	timeoutMs?: number;
	pollMs?: number;
	/** Polled each cycle; true = a newer play superseded this gate. */
	isSuperseded?: () => boolean;
	/** Injectable clock/sleep for tests. */
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait until the element holds a head start worth starting on:
 * buffered-ahead >= target, OR buffered to the end, OR readyState
 * HAVE_ENOUGH_DATA (4 — the browser's own can-play-through call).
 * Resolves 'timeout' at the hard cap (caller plays anyway), 'error'
 * on the element's error event (caller still plays — the player's
 * existing error/failover chain owns dead bytes), and 'superseded'
 * when a newer play takes over. Never rejects.
 *
 * An element with NO observable buffer (buffered === undefined — a
 * unit-test fake, never a real browser) resolves 'ready' at once:
 * an unmeasurable gate must not become a 12s hang.
 */
export async function waitForBufferGate(
	el: BufferGateElement | null | undefined,
	opts: WaitForBufferOpts = {}
): Promise<BufferGateOutcome> {
	if (!el || el.buffered === undefined) return 'ready';
	const target = opts.targetSec ?? SLOW_BUFFER_TARGET_SEC;
	const timeout = opts.timeoutMs ?? SLOW_BUFFER_TIMEOUT_MS;
	const poll = opts.pollMs ?? SLOW_BUFFER_POLL_MS;
	const now = opts.now ?? Date.now;
	const sleep = opts.sleep ?? defaultSleep;
	const isReady = () =>
		bufferedAheadSec(el) >= target || bufferedToEnd(el) || (el.readyState ?? 0) >= 4;
	if (isReady()) return 'ready';

	let errored = false;
	const onError = () => {
		errored = true;
	};
	const canListen = typeof el.addEventListener === 'function';
	if (canListen) el.addEventListener!('error', onError);
	try {
		const deadline = now() + timeout;
		for (;;) {
			if (opts.isSuperseded?.()) return 'superseded';
			if (errored) return 'error';
			if (isReady()) return 'ready';
			if (now() >= deadline) return 'timeout';
			await sleep(poll);
		}
	} finally {
		if (canListen && typeof el.removeEventListener === 'function')
			el.removeEventListener('error', onError);
	}
}
