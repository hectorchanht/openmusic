import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	pinRecordCover,
	unpinRecordCover,
	pinRecordLyrics,
	unpinRecordLyrics,
	carryRecordWithDownload,
	refreshTrackRecord,
	readRecordCover
} from './records.svelte';
import { readChosenCover } from './cover-version.svelte';
import { readLyrics } from './lyric-pins.svelte';
import { getPinnedCover } from '$lib/services/cover-cache';
import { getTrackRecord } from '$lib/services/track-record';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// records.svelte (quick-261121-canon) — the canonical-record write seams. The claims pinned
// here are the brief's core promise (§2.4/§5 test 3): a correction lands ONCE, on the record,
// and every instance/surface sees it — plus the download carry (Hector 2026-11-21: records
// cache forever + offline) and pin-preserving force refresh. Node-runnable (sync bump
// fallback), in-memory localStorage stub.

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

function mk(source: SourceId, songid: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title: 'Hello',
		artist: 'Adele',
		album: '25',
		cover: null,
		lrc: null,
		...extra
	} as Track;
}

const PIN = 'https://cdn-images.dzcdn.net/images/cover/pin/1000x1000-000000-80-0-0.jpg';
const AUTO = 'https://cdn-images.dzcdn.net/images/cover/auto/1000x1000-000000-80-0-0.jpg';
const LRC = '[00:01.00]hello from the other side';

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('cover pin — once on the record, everywhere (brief test 3)', () => {
	it('pinning via instance A serves instance B through the shared chosen read', () => {
		const a = mk('netease', '1');
		const b = mk('qq', '2');
		pinRecordCover(a, PIN);
		// The row/NP read path (readChosenCover) for a DIFFERENT instance of the song:
		expect(readChosenCover(b.uid, b.artist, b.title)).toBe(PIN);
		// And the record reader agrees:
		expect(readRecordCover('Adele', 'Hello')).toBe(PIN);
		// Dual-write: the legacy per-uid pin exists for un-migrated readers.
		expect(getPinnedCover(a.uid)).toBe(PIN);
	});

	it('unpin clears both layers and the read falls back', () => {
		const a = mk('netease', '1');
		pinRecordCover(a, PIN);
		unpinRecordCover(a);
		expect(getTrackRecord('Adele', 'Hello')?.cover.pin).toBeNull();
		expect(readChosenCover(a.uid, a.artist, a.title)).toBeNull();
	});
});

describe('lyrics pin — the record pointer serves every instance', () => {
	it('pinning lyrics on instance A makes instance B read them', () => {
		const a = mk('netease', '1');
		const b = mk('qq', '2', { lrc: '[00:02.00]the qq instance lyrics' });
		pinRecordLyrics(a, LRC);
		// B's own pin is empty; the record pointer names A's uid, whose text serves B.
		expect(readLyrics(b)).toBe(LRC);
		// A's own read is unchanged (its per-uid pin leads).
		expect(readLyrics(a)).toBe(LRC);
		unpinRecordLyrics(a);
		expect(readLyrics(b)).toBe('[00:02.00]the qq instance lyrics');
	});
});

describe('download carry — the record travels with the download', () => {
	it('marks the record downloaded + seeds its cover, readable offline (store read, no fetch)', () => {
		const a = mk('netease', '1', { cover: AUTO });
		carryRecordWithDownload(a);
		const rec = getTrackRecord('Adele', 'Hello');
		expect(rec?.downloaded).toBe(true);
		expect(rec?.cover.chosen).toBe(AUTO);
		expect(rec?.lyrics.chosenRef?.uid).toBe(a.uid);
	});
});

describe('force refresh — rebuilds auto data, preserves user intent', () => {
	it('a pin survives refreshTrackRecord while the record is rebuilt', async () => {
		const a = mk('netease', '1', { cover: AUTO });
		pinRecordCover(a, PIN);
		// Offline refresh: every network leg fails; the resolver merges local feeders only.
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		const chosen = await refreshTrackRecord(a);
		expect(getTrackRecord('Adele', 'Hello')?.cover.pin).toBe(PIN);
		expect(chosen).toBe(PIN);
	});
});
