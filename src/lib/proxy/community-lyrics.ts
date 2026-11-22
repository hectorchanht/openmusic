// community-lyrics — pure helpers behind /api/lyrics (quick-261122-ugcb3, UGC lyrics B3, brief §3–4).
//
// One record per SONG in the existing DIAG R2 bucket under `lyrics/` — the comments thread-key
// identity (first 32 hex of SHA-256 of dedupe's songKey), so every source copy and both Chinese
// scripts of a song share one set of community versions. No new binding, no new secret (P11/P12).
//
// Same posture as comments.ts / lyric-offset.ts: no I/O, no HTTP status knowledge, never-throw
// screens returning sentinels the route maps to 4xx.
//
// THE CHECK (brief §3, all four layers must pass):
//   1. FORMAT  — checkLyricText: ≤ MAX_LYRIC_CHARS (reject, never truncate), no URLs / HTML,
//                timed text parses clean with ≥ MIN_LINES timed lines, start stamps monotonic in
//                file order, every stamp ≤ duration + END_SLACK_SEC. Unsynced plain text is
//                accepted as the labelled lower class 'plain'. Language is NEVER a rejection reason.
//   2. SANITY  — no exact-duplicate version (a duplicate becomes a PIN of the existing one), and
//                [ti:]/[ar:] metadata tags must not contradict the confirmed identity.
//   3. ABUSE   — the route requires a signed-in account + Turnstile + a per-account throttle.
//   4. POST-PUBLICATION — report-to-hide at HIDE_REPORTS distinct reporters, maintainer delete;
//                a hidden version drops out and the next-best visible one becomes canonical.
//
// CANONICAL = MOST-PINNED (Grill addendum a, Hector 2026-11-20): pins are the vote. Every listener
// holds at most ONE pin per song; pinning a version moves their vote off any other. Ties go to the
// NEWER version (a fresh correction of an equally-trusted lyric wins).

import { sha256hexN } from '$lib/auth/auth-core';
import { HIDE_REPORTS, TOKEN_MAX, isThreadKey, isCommentId } from '$lib/proxy/comments';

export { HIDE_REPORTS, isThreadKey };

/** Lyric text cap (code points). Over it is REJECTED, never truncated. */
export const MAX_LYRIC_CHARS = 20_000;
/** Body cap: 20k code points of CJK (3 bytes each) + title/artist + a 2048-char token, with slack. */
export const MAX_LYRICS_BODY_BYTES = 96 * 1024;
/** Fewest lines a submission may carry (timed lines for a synced lyric, lines for plain text). */
export const MIN_LINES = 5;
/** How far past the song's end the last stamp may sit (outro fades, duration rounding). */
export const END_SLACK_SEC = 15;
/** Versions kept per song — bounds the record and the parse each request does. */
export const MAX_VERSIONS = 30;
/** Edge-cache TTL of a public GET. A write busts the PoP it landed on; elsewhere it ages out. */
export const LYRICS_TTL = 60;
const META_MAX = 200;

export type LyricClass = 'estimated' | 'precise' | 'plain';
export type LyricVersion = {
	id: string;
	lrc: string;
	cls: LyricClass;
	t: number;
	/** submitter: 16-hex hash of the account id — never the raw id or email */
	by: string;
	reporters: string[];
	pins: string[];
};
export type LyricsRecord = { v: 1; versions: LyricVersion[] };
export type PublicLyricVersion = { id: string; lrc: string; cls: LyricClass; t: number; pins: number };
export type MaintainerLyricVersion = PublicLyricVersion & { reports: number; hidden: boolean; by: string };

export type LyricCheckErr =
	| 'empty'
	| 'too-long'
	| 'url'
	| 'html'
	| 'too-few-lines'
	| 'non-monotonic'
	| 'past-end'
	| 'identity-mismatch';

export type LyricsBody =
	| {
			action: 'submit';
			k: string;
			lrc: string;
			estimated: boolean;
			title: string;
			artist: string;
			duration: number;
			token: string;
	  }
	| { action: 'report'; k: string; id: string }
	| { action: 'pin'; k: string; id: string };

// C0 except \t \n, DEL + C1, bidi overrides/isolates, BOM — the comments TEXT_STRIP family.
const TEXT_STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g;
const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
// An HTML/XML tag starts with a LETTER (or `/letter`, `!`): enhanced-LRC character stamps
// `<01:02.34>` start with a digit and are lyric timing data, not markup (B4 character layer).
const HTML_RE = /<\s*\/?\s*[a-z!][^>]*>/i;
const STAMP = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/y;
const META_RE = /^\[([a-z]{2,6}):([^\]]*)\]$/i;

const codePoints = (s: string) => [...s].length;

function stampSec(m: RegExpMatchArray): number {
	return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0) + (m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0);
}

/** Loose identity fold for the metadata-tag contradiction check: case, width, spacing, punctuation. */
export function foldIdentity(s: string): string {
	return (s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function contradicts(tag: string, confirmed: string): boolean {
	const a = foldIdentity(tag);
	const b = foldIdentity(confirmed);
	if (!a || !b) return false;
	return !a.includes(b) && !b.includes(a);
}

/**
 * LAYERS 1 + 2 (text half). Never-throw. On success returns the CANONICAL text stored and served:
 * NFC, control characters stripped, lines trimmed, blanks and metadata-tag lines dropped — so a
 * version's identity is its content, not its whitespace — plus the honest class.
 */
export function checkLyricText(
	raw: string,
	opts: { durationSec?: number; title?: string; artist?: string; estimated?: boolean } = {}
): { ok: true; lrc: string; cls: LyricClass } | { ok: false; err: LyricCheckErr } {
	if (typeof raw !== 'string') return { ok: false, err: 'empty' };
	const text = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(TEXT_STRIP, '');
	if (!text.trim()) return { ok: false, err: 'empty' };
	if (codePoints(text) > MAX_LYRIC_CHARS) return { ok: false, err: 'too-long' };
	if (URL_RE.test(text)) return { ok: false, err: 'url' };
	if (HTML_RE.test(text)) return { ok: false, err: 'html' };

	const dur = Number.isFinite(opts.durationSec) && (opts.durationSec ?? 0) > 0 ? (opts.durationSec as number) : 0;
	const kept: string[] = [];
	let timed = 0;
	let prev = -1;
	let maxStamp = 0;
	for (const line0 of text.split('\n')) {
		const line = line0.trim();
		if (!line) continue;
		const meta = META_RE.exec(line);
		if (meta && !/^\d/.test(meta[1])) {
			// LAYER 2: a metadata tag naming a DIFFERENT song than the confirmed identity.
			const tag = meta[1].toLowerCase();
			if (tag === 'ti' && contradicts(meta[2], opts.title ?? '')) return { ok: false, err: 'identity-mismatch' };
			if (tag === 'ar' && contradicts(meta[2], opts.artist ?? '')) return { ok: false, err: 'identity-mismatch' };
			continue;
		}
		STAMP.lastIndex = 0;
		const m = STAMP.exec(line);
		if (m) {
			const start = stampSec(m);
			if (start < prev) return { ok: false, err: 'non-monotonic' };
			prev = start;
			maxStamp = Math.max(maxStamp, start);
			// The §2.4 explicit end tag directly after the start (serializeLRC's [start][end] form).
			const m2 = STAMP.exec(line);
			if (m2) maxStamp = Math.max(maxStamp, stampSec(m2));
			// Enhanced-LRC character stamps (B4) count toward the end bound too.
			for (const c of line.matchAll(/<(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?>/g)) {
				maxStamp = Math.max(maxStamp, stampSec(c));
			}
			if (!line.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim()) continue; // a stamp with no words
			timed++;
		}
		kept.push(line);
	}
	if (timed > 0) {
		if (timed < MIN_LINES) return { ok: false, err: 'too-few-lines' };
		if (dur > 0 && maxStamp > dur + END_SLACK_SEC) return { ok: false, err: 'past-end' };
		// Untimed stragglers inside a timed lyric are dropped, exactly as parseLRC would.
		const lines = kept.filter((l) => {
			STAMP.lastIndex = 0;
			return STAMP.test(l);
		});
		return { ok: true, lrc: lines.join('\n'), cls: opts.estimated ? 'estimated' : 'precise' };
	}
	if (kept.length < MIN_LINES) return { ok: false, err: 'too-few-lines' };
	return { ok: true, lrc: kept.join('\n'), cls: 'plain' };
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function cleanMeta(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const s = v.normalize('NFC').replace(TEXT_STRIP, '').trim();
	return codePoints(s) <= META_MAX ? s : null;
}

/** Never-throw shape screen. The text CHECK runs separately (checkLyricText) so its reason surfaces. */
export function parseLyricsBody(text: string): LyricsBody | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	const k = typeof raw.k === 'string' ? raw.k : null;
	if (!isThreadKey(k)) return null;
	if (raw.action === 'report' || raw.action === 'pin') {
		return isCommentId(raw.id) ? { action: raw.action, k, id: raw.id } : null;
	}
	if (raw.action !== undefined && raw.action !== 'submit') return null;
	const title = cleanMeta(raw.title);
	const artist = cleanMeta(raw.artist);
	const token = raw.token;
	const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration >= 0 ? raw.duration : 0;
	if (typeof raw.lrc !== 'string' || title === null || artist === null) return null;
	if (typeof token !== 'string' || !token || token.length > TOKEN_MAX) return null;
	return { action: 'submit', k, lrc: raw.lrc, estimated: raw.estimated === true, title, artist, duration, token };
}

/** The ONLY R2 key builders for this feature (screened values only — never `log/`, never a list). */
export function lyricsObjectKey(k: string): string {
	return `lyrics/${k}.json`;
}
export function lyricsThrottleKey(who: string): string {
	return `lyrics-throttle/${who}.json`;
}

export function emptyLyricsRecord(): LyricsRecord {
	return { v: 1, versions: [] };
}

const CLASSES: readonly LyricClass[] = ['estimated', 'precise', 'plain'];
const strArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((r) => typeof r === 'string');
const isVersion = (e: unknown): e is LyricVersion =>
	isPlainObject(e) &&
	typeof e.id === 'string' &&
	typeof e.lrc === 'string' &&
	CLASSES.includes(e.cls as LyricClass) &&
	typeof e.t === 'number' &&
	Number.isFinite(e.t) &&
	typeof e.by === 'string' &&
	strArr(e.reporters) &&
	strArr(e.pins);

/** Never-throw. Anything not `{v:1, versions:[...]}` is empty; bad versions dropped one by one. */
export function parseLyricsRecord(text: string | null): LyricsRecord {
	let raw: unknown;
	try {
		raw = text ? JSON.parse(text) : null;
	} catch {
		return emptyLyricsRecord();
	}
	if (!isPlainObject(raw) || raw.v !== 1 || !Array.isArray(raw.versions)) return emptyLyricsRecord();
	return {
		v: 1,
		versions: raw.versions
			.filter(isVersion)
			.map((x) => ({ ...x, reporters: [...x.reporters], pins: [...x.pins] }))
	};
}

const visible = (x: LyricVersion) => x.reporters.length < HIDE_REPORTS;
/** Canonical order: most pins first, ties → newer first. */
const byCanon = (a: LyricVersion, b: LyricVersion) => b.pins.length - a.pins.length || b.t - a.t;

/** Move `voter`'s ONE pin for this song onto `id` (and off every other version). Null = unknown id. */
export function pinVersion(rec: LyricsRecord, id: string, voter: string): LyricsRecord | null {
	if (!rec.versions.some((x) => x.id === id)) return null;
	return {
		v: 1,
		versions: rec.versions.map((x) => {
			const others = x.pins.filter((p) => p !== voter);
			return x.id === id ? { ...x, pins: [...others, voter] } : { ...x, pins: others };
		})
	};
}

/**
 * Add a checked version. An EXACT duplicate of an existing version is not stored twice (layer 2):
 * it becomes the submitter's pin on the existing one, and `id` names that version. Over
 * MAX_VERSIONS the hidden, then least-pinned, then oldest go first.
 */
export function addVersion(
	rec: LyricsRecord,
	v: { id: string; lrc: string; cls: LyricClass; t: number; by: string },
	voter: string
): { rec: LyricsRecord; id: string; duplicate: boolean } {
	const dup = rec.versions.find((x) => x.lrc === v.lrc);
	if (dup) return { rec: pinVersion(rec, dup.id, voter) ?? rec, id: dup.id, duplicate: true };
	const added: LyricsRecord = { v: 1, versions: [...rec.versions, { ...v, reporters: [], pins: [] }] };
	const pinned = pinVersion(added, v.id, voter) ?? added;
	const kept = [...pinned.versions]
		.sort((a, b) => Number(visible(b)) - Number(visible(a)) || byCanon(a, b))
		.slice(0, MAX_VERSIONS);
	// The just-added version is never the one evicted (it is pinned and newest among its ties).
	return { rec: { v: 1, versions: kept }, id: v.id, duplicate: false };
}

/** Null when `id` is unknown. Idempotent per voter. */
export function reportVersion(rec: LyricsRecord, id: string, voter: string): LyricsRecord | null {
	if (!rec.versions.some((x) => x.id === id)) return null;
	return {
		v: 1,
		versions: rec.versions.map((x) =>
			x.id === id && !x.reporters.includes(voter) ? { ...x, reporters: [...x.reporters, voter] } : x
		)
	};
}

export function removeVersion(rec: LyricsRecord, id: string): LyricsRecord | null {
	if (!rec.versions.some((x) => x.id === id)) return null;
	return { v: 1, versions: rec.versions.filter((x) => x.id !== id) };
}

/** The public view, CANONICAL FIRST: hidden versions dropped; a pin COUNT, never the voter hashes. */
export function publicVersions(rec: LyricsRecord): PublicLyricVersion[] {
	return rec.versions
		.filter(visible)
		.sort(byCanon)
		.map(({ id, lrc, cls, t, pins }) => ({ id, lrc, cls, t, pins: pins.length }));
}

/** The canonical (most-pinned visible) version, or null. */
export function canonicalVersion(rec: LyricsRecord): PublicLyricVersion | null {
	return publicVersions(rec)[0] ?? null;
}

export function maintainerVersions(rec: LyricsRecord): MaintainerLyricVersion[] {
	return [...rec.versions].sort(byCanon).map(({ id, lrc, cls, t, pins, reporters, by }) => ({
		id,
		lrc,
		cls,
		t,
		pins: pins.length,
		reports: reporters.length,
		hidden: reporters.length >= HIDE_REPORTS,
		by
	}));
}

/**
 * A listener's vote identity for pins/reports: the ACCOUNT when signed in (one person, one vote
 * across devices and networks), else the address. Salted per feature; raw ids/IPs never stored.
 */
export async function lyricsVoterId(who: { userId?: string | null; ip: string }): Promise<string> {
	return who.userId ? sha256hexN(`user:${who.userId}|lyrics`, 16) : sha256hexN(`${who.ip}|lyrics`, 16);
}

/** The submitter tag stored on a version (same hash as their account vote). */
export async function submitterId(userId: string): Promise<string> {
	return sha256hexN(`user:${userId}|lyrics`, 16);
}
