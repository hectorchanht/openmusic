// lyric-offset (reactive) — quick-260926-mis: per-song lyric TIME offset, in seconds.
//
// Keyed by track UID, NOT by name: a live version and its studio version are different uids and MUST
// realign independently (the live one has a talking intro, the studio one is already in step). The
// sign convention lives in services/lrc.ts (LYRIC_OFFSET_MAX).
//
// quick-260926-mzn: an explicit 0 IS stored — it is the opt-out from a shared consensus, so unset and
// 0 must be distinguishable. Only clearLyricOffset deletes an entry.
//
// Same reactive-wrapper idiom as lyric-pins.svelte.ts, minus two things:
//   - no separate pure `.ts`: the record read/write is a few lines, and the try/catch around
//     localStorage IS the browser guard (no `$app/environment` import), so this stays node-testable.
//   - no rAF-deferred bump: the bump is SYNCHRONOUS. The highlight + anchor must repaint on the same
//     tick as the hold/nudge; the verification browser pane has frozen rAF; and coalescing buys
//     nothing for a write that only ever happens on a user gesture.
//
// quick-260926-mzn — SHARED LAYER. A listener's explicit realign is submitted as a vote; a listener
// with NO local entry receives the consensus (median, >=3 agreeing) for the song's exact lyrics.
// Effective offset = local ?? shared ?? 0. The shared value is in-memory per session, never
// persisted: it is a default, not a user choice.

import { normalizeLyricOffset } from '$lib/services/lrc';
import { lyricOffsetKey, fetchSharedOffset, submitOffsetVote } from '$lib/services/lyric-offset-shared';

const KEY = 'openmusic:lyric-offset:v1';

const _v = $state({ n: 0 });

/** Current offset version. CALL inside a $derived/template to depend on offset writes. */
export function lyricOffsetVersion(): number {
	return _v.n;
}

function readRec(): Record<string, number> {
	try {
		const raw = localStorage.getItem(KEY);
		const rec: unknown = raw ? JSON.parse(raw) : null;
		return rec && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Record<string, number>) : {};
	} catch {
		return {};
	}
}

function writeRec(rec: Record<string, number>): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(rec));
	} catch {
		// quota / unavailable: non-fatal, the offset just does not persist
	}
	// Unconditional: readers re-read storage, so a failed write correctly still shows the old value.
	_v.n++;
}

/** The LOCAL offset for `uid` (0 when none). Normalized on READ so a tampered value is clamped (T-mis-01). */
export function getLyricOffset(uid: string | null | undefined): number {
	lyricOffsetVersion(); // reactive dependency
	if (!uid) return 0;
	const v = readRec()[uid];
	return normalizeLyricOffset(typeof v === 'number' ? v : 0);
}

/** Persist the offset for `uid` (0 included — see header) and repaint every reader on this tick. */
export function setLyricOffset(uid: string, sec: number): void {
	if (!uid) return;
	const rec = readRec();
	rec[uid] = normalizeLyricOffset(sec);
	writeRec(rec);
}

/** quick-260926-mzn: drop the local entry, so the shared consensus (or 0) applies again. */
export function clearLyricOffset(uid: string): void {
	if (!uid) return;
	const rec = readRec();
	delete rec[uid];
	writeRec(rec);
}

/** quick-260926-mzn: true when `uid` has a local entry, including an explicit 0. */
export function hasLocalLyricOffset(uid: string | null | undefined): boolean {
	lyricOffsetVersion(); // reactive dependency
	return !!uid && typeof readRec()[uid] === 'number';
}

// ---- quick-260926-mzn: shared consensus layer ----

const _shared = $state<Record<string, number>>({});
// Plain, non-reactive guards (house convention): nothing renders them.
const requested = new Map<string, string>(); // uid -> the lrc its shared offset was requested for
// quick-260926-wdv: ONE vote per listen. A nudge / slider drag only MARKS the listen as voted; the
// root layout flushes it when the current track changes or a track ends (flushLyricOffsetVote), so a
// long slider session costs one POST instead of one per 4 s pause. Plain field (nothing renders it).
// ponytail: a vote pending when the app is closed mid-song is lost; add a keepalive flush on
// pagehide if that ever matters (apiFetch would need to pass `keepalive` through).
let pendingVote: { uid: string; lrc: string } | null = null;

/** Local ?? shared ?? 0. Cheap enough for a $derived that re-runs on track change / offset write. */
export function getEffectiveLyricOffset(uid: string | null | undefined): number {
	lyricOffsetVersion(); // reactive dependency
	if (!uid) return 0;
	const local = readRec()[uid];
	if (typeof local === 'number') return normalizeLyricOffset(local);
	const shared = _shared[uid];
	return typeof shared === 'number' ? shared : 0;
}

/** True when the applied offset is the listeners' consensus (no local entry, a shared value exists). */
export function isSharedLyricOffset(uid: string | null | undefined): boolean {
	lyricOffsetVersion(); // reactive dependency
	if (!uid) return false;
	return typeof readRec()[uid] !== 'number' && typeof _shared[uid] === 'number';
}

/**
 * Fetch the consensus for (uid, lrc) once. The synchronous part writes NO $state — that is what keeps
 * a calling $effect from self-invalidating (the restore-effect loop class). `_shared` is written only
 * after the awaits, and only if no later lyrics change for this uid superseded the request.
 *
 * ponytail: one attempt per (uid, lyrics) per session, no retry — a miss or 503 just means no shared
 * offset until the next session.
 */
export async function ensureSharedLyricOffset(uid: string, lrc: string | null | undefined): Promise<void> {
	if (!uid || !lrc) return;
	if (typeof readRec()[uid] === 'number') return; // a local entry wins; no need to ask
	if (requested.get(uid) === lrc) return;
	requested.set(uid, lrc);
	const k = await lyricOffsetKey(uid, lrc);
	if (!k) return;
	const off = await fetchSharedOffset(k);
	if (requested.get(uid) !== lrc) return; // superseded by a newer lyrics pick for this uid
	if (off == null) delete _shared[uid];
	else _shared[uid] = off;
}

/**
 * Mark this listen for a vote after an explicit realign (quick-260926-wdv). Nothing is sent here:
 * flushLyricOffsetVote() sends it once, at the end of the song or on a track change, reading the
 * local offset AT FLUSH TIME — so any amount of nudging votes once with the final value, and a
 * reset / cleared offset votes nothing.
 */
export function scheduleLyricOffsetVote(uid: string, lrc: string): void {
	if (!uid || !lrc) return;
	// A different song's listen is over — send its vote before marking this one.
	if (pendingVote && pendingVote.uid !== uid) void flushLyricOffsetVote();
	pendingVote = { uid, lrc };
}

/** Send the pending vote (the local offset AT FLUSH TIME), then forget it. Never throws. */
export async function flushLyricOffsetVote(): Promise<void> {
	const p = pendingVote;
	pendingVote = null;
	if (!p) return;
	const v = readRec()[p.uid];
	if (typeof v !== 'number') return; // reset / cleared since the nudge: nothing to vote
	const k = await lyricOffsetKey(p.uid, p.lrc);
	if (k) await submitOffsetVote(k, v);
}

/**
 * The readout tap. Cancels any pending vote (reset never votes, and must not let a stale nudge vote
 * fire), then:
 *   - a local entry exists  -> clear it (back to the default: the listeners' value if one is
 *     showing, else 0);
 *   - only a shared value   -> store an explicit 0 (opt out of a bad consensus; survives reload);
 *   - nothing               -> no-op.
 * Two taps from "local 2 over shared 1.5" reach 0: first back to the listeners' value, then force 0.
 * The "Synced by listeners" label tells the user which state they are in.
 */
export function resetLyricOffset(uid: string): void {
	pendingVote = null;
	if (!uid) return;
	if (typeof readRec()[uid] === 'number') clearLyricOffset(uid);
	else if (typeof _shared[uid] === 'number') setLyricOffset(uid, 0);
}

// ---- quick-260926-qat: the timing row's open flag ----
//
// The lyrics pane's timing row (−0.5s / readout / +0.5s) is hidden by default and opened from the
// track menu. The flag is IN-MEMORY and SESSION-ONLY on purpose: a fresh app start always shows clean
// lyrics, so it is never persisted. It stays open across track changes (a user realigning a whole live
// album should not have to reopen it per song). `req` is a monotonic "bring the row into view" counter
// NowPlaying reacts to — the same reactive-counter shape as `_v.n` — so that effect depends on the
// counter alone, never on the flag or on any tab state.

const _bar = $state({ open: false, req: 0 });

/** Is the timing row shown? CALL inside a $derived/template/effect to depend on it. */
export function lyricSyncOpen(): boolean {
	return _bar.open;
}

/** Bumped on every open request. CALL inside an $effect to react to "show me the row". */
export function lyricSyncRequest(): number {
	return _bar.req;
}

export function setLyricSyncOpen(v: boolean): void {
	_bar.open = v;
	if (v) _bar.req++;
}

export function toggleLyricSyncOpen(): void {
	setLyricSyncOpen(!_bar.open);
}

/** TEST-ONLY: reset the shared layer (mirrors api-base's __resetGovernor). */
export function __resetSharedLyricOffsets(): void {
	for (const k of Object.keys(_shared)) delete _shared[k];
	requested.clear();
	pendingVote = null;
}
