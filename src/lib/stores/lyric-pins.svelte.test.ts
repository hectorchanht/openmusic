import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLyrics, pinLyrics, unpinLyrics, lyricVersion } from './lyric-pins.svelte';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// quick-260919-1we — D-4's read order, asserted rather than asserted-in-prose.
//
// The plan said this wrapper needed no test of its own, and the pure store's caps are covered in
// services/lyric-pins.test.ts. This file exists for ONE claim that is otherwise only provable by
// reading two files side by side: a user's explicit pick BEATS the LRC a downloaded file's own tag
// supplies (Phase 37's `player.enrichFromLocalFile`, which does
// `if (found.lrc && !cur.lrc) this.current = { ...cur, lrc: found.lrc }`). That enrichment lands on
// `current.lrc`, and `current.lrc` is the SECOND rung of readLyrics — so the pin wins by
// construction, in either order, and this pins that down before someone "simplifies" the read.
//
// Node-runnable: no jsdom, no rAF (bumpLyricVersion takes its documented synchronous fallback).

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

function mk(source: SourceId, songid: string, lrc: string | null): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: 'Rain',
		artist: 'Jay',
		album: '',
		cover: null,
		audioUrl: null,
		lrc,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

describe('readLyrics — pin → track.lrc → null (quick-260919-1we D-4)', () => {
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemStorage(),
			configurable: true,
			writable: true
		});
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	it('falls back to track.lrc when nothing is pinned, and to null when there is no lrc', () => {
		expect(readLyrics(mk('kuwo', 'k1', '[00:01]chain'))).toBe('[00:01]chain');
		expect(readLyrics(mk('kuwo', 'k2', null))).toBeNull();
		expect(readLyrics(null)).toBeNull();
		expect(readLyrics(undefined)).toBeNull();
	});

	it("a pin BEATS the embedded LRC Phase 37 writes onto current.lrc — pin first, then enrichment", () => {
		const uid = makeUid('kuwo', 'downloaded-1');
		pinLyrics(uid, '[00:01]the user picked this');
		// enrichFromLocalFile's exact effect: the file's own tag arrives on `current.lrc`.
		const enriched = mk('kuwo', 'downloaded-1', '[00:01]the file says this');
		expect(enriched.uid).toBe(uid);
		expect(readLyrics(enriched)).toBe('[00:01]the user picked this');
	});

	it('…and in the other order — enrichment already applied, THEN the user pins', () => {
		const enriched = mk('kuwo', 'downloaded-2', '[00:01]the file says this');
		expect(readLyrics(enriched)).toBe('[00:01]the file says this'); // before the pick
		pinLyrics(enriched.uid, '[00:01]the user picked this');
		// SAME object, no player mutation, no replay — the read is what changed.
		expect(readLyrics(enriched)).toBe('[00:01]the user picked this');
	});

	it('a pin survives the whole-object reassignment player.svelte.ts does on every play()', () => {
		const uid = makeUid('qq', 'q1');
		pinLyrics(uid, '[00:01]pinned');
		// The four `this.current = { ...cur, … }` sites that would clobber a pin written INTO the
		// track. Applying it at READ time is immune to all of them.
		const fresh = { ...mk('qq', 'q1', '[00:01]resolved fresh'), detailsLoaded: true };
		expect(readLyrics(fresh)).toBe('[00:01]pinned');
	});

	it('unpin falls the read back to the automatic lyrics (the Use-automatic row)', () => {
		const t = mk('netease', 'n1', '[00:01]automatic');
		pinLyrics(t.uid, '[00:01]pinned');
		expect(readLyrics(t)).toBe('[00:01]pinned');
		unpinLyrics(t.uid);
		expect(readLyrics(t)).toBe('[00:01]automatic');
	});

	it('every write bumps the version signal, so bound surfaces repaint without a replay', () => {
		const before = lyricVersion();
		pinLyrics(makeUid('kuwo', 'k9'), '[00:01]x');
		const afterPin = lyricVersion();
		unpinLyrics(makeUid('kuwo', 'k9'));
		expect(afterPin).toBeGreaterThan(before);
		expect(lyricVersion()).toBeGreaterThan(afterPin);
	});
});
