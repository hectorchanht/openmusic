import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	trackRecordKey,
	getTrackRecord,
	recordTrackCoverCandidates,
	pinTrackCover,
	getTrackCoverPin,
	pinTrackLyrics,
	markTrackDownloaded,
	bustTrackRecord,
	getTrackChosenCover,
	mergeTrackCandidates,
	type TrackCoverCandidate
} from './track-record';
import { setPinnedCover } from './cover-cache';

// track-record (quick-261121-canon, brief §2.2/§2.4/§5) — the ONE canonical record per
// song. Pins the brief's test strategy: pin propagation across instances (test 3), merge
// determinism (test 6), candidate completeness + chosen precedence (test 7), the per-uid →
// per-record pin migration, the version-distinct key, and FOREVER persistence (no TTL —
// Hector 2026-11-21: "cache forever and offline ok").

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

const A = 'https://cdn-images.dzcdn.net/images/cover/a/1000x1000-000000-80-0-0.jpg';
const B = 'https://cdn-images.dzcdn.net/images/cover/b/1000x1000-000000-80-0-0.jpg';
const CROWD = 'https://cdn-images.dzcdn.net/images/cover/crowd/1000x1000-000000-80-0-0.jpg';
const PIN = 'https://cdn-images.dzcdn.net/images/cover/pin/1000x1000-000000-80-0-0.jpg';

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

describe('trackRecordKey — versioned identity', () => {
	it('a live cut is a DIFFERENT record from the studio cut', () => {
		expect(trackRecordKey('Adele', 'Hello')).not.toBe(trackRecordKey('Adele', 'Hello (Live)'));
	});
	it('folds case/punct so spellings share one record', () => {
		expect(trackRecordKey('Adele', 'Hello')).toBe(trackRecordKey('adele', 'hello'));
	});
});

describe('mergeTrackCandidates — determinism + completeness (brief tests 6+7)', () => {
	it('is pure: same inputs → deep-equal output, inputs unmutated', () => {
		const existing: TrackCoverCandidate[] = [{ url: A, source: 'chain', at: 1 }];
		const incoming: TrackCoverCandidate[] = [
			{ url: B, source: 'instance', at: 2 },
			{ url: A, source: 'cache', at: 3 }
		];
		const snapE = JSON.parse(JSON.stringify(existing));
		const snapI = JSON.parse(JSON.stringify(incoming));
		const out1 = mergeTrackCandidates(existing, incoming);
		const out2 = mergeTrackCandidates(existing, incoming);
		expect(out1).toEqual(out2);
		expect(existing).toEqual(snapE);
		expect(incoming).toEqual(snapI);
		// Completeness: both distinct gate-passing covers are kept; the dupe keeps FIRST provenance.
		expect(out1.map((c) => c.url)).toEqual([A, B]);
		expect(out1[0].source).toBe('chain');
	});
});

describe('record + chosen precedence (pin > crowd > auto)', () => {
	it('auto chosen is the first candidate; a crowd candidate outranks it; a pin outranks all', () => {
		recordTrackCoverCandidates('Adele', 'Hello', [
			{ url: A, source: 'chain' },
			{ url: B, source: 'instance' }
		]);
		expect(getTrackChosenCover('Adele', 'Hello')).toBe(A);
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: CROWD, source: 'crowd' }]);
		expect(getTrackChosenCover('Adele', 'Hello')).toBe(CROWD);
		pinTrackCover('Adele', 'Hello', PIN);
		expect(getTrackChosenCover('Adele', 'Hello')).toBe(PIN);
		// Unpinning falls back to the crowd pick, not to nothing.
		pinTrackCover('Adele', 'Hello', null);
		expect(getTrackChosenCover('Adele', 'Hello')).toBe(CROWD);
	});

	it('registers instance uids + album from hints, deduped', () => {
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: A, source: 'chain' }], { uid: 'netease:1', album: '25' });
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: B, source: 'chain' }], { uid: 'netease:1' });
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: B, source: 'chain' }], { uid: 'qq:2' });
		const rec = getTrackRecord('Adele', 'Hello');
		expect(rec?.instances).toEqual(['netease:1', 'qq:2']);
		expect(rec?.album).toBe('25');
	});

	it('refuses non-https candidates (the value is painted as an <img src>)', () => {
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: 'http://evil.example.com/x.jpg', source: 'chain' }]);
		expect(getTrackRecord('Adele', 'Hello')?.cover.candidates).toEqual([]);
		expect(getTrackChosenCover('Adele', 'Hello')).toBeNull();
	});
});

describe('pin propagation + legacy migration (brief test 3)', () => {
	it('a legacy per-uid pin migrates into the record and then serves EVERY instance', () => {
		setPinnedCover('netease:1', PIN); // the old world: pin keyed by one instance's uid
		// First read through instance A migrates it into the record…
		expect(getTrackCoverPin('Adele', 'Hello', 'netease:1')).toBe(PIN);
		// …and instance B (a different source, same song) now reads the same pin.
		expect(getTrackCoverPin('Adele', 'Hello', 'qq:2')).toBe(PIN);
		expect(getTrackRecord('Adele', 'Hello')?.cover.pin).toBe(PIN);
	});

	it('a record pin set directly serves any spelling of the song', () => {
		pinTrackCover('Adele', 'Hello', PIN);
		expect(getTrackCoverPin('adele', 'hello')).toBe(PIN);
	});
});

describe('lyrics pin + download flag', () => {
	it('pinTrackLyrics keys the pin to the song and registers the instance', () => {
		const rec = pinTrackLyrics('Adele', 'Hello', 'netease:1');
		expect(rec.lyrics.pinUid).toBe('netease:1');
		expect(rec.instances).toContain('netease:1');
	});

	it('markTrackDownloaded flags the record and seeds the lyrics ref from the offline copy', () => {
		const rec = markTrackDownloaded('Adele', 'Hello', 'netease:1');
		expect(rec.downloaded).toBe(true);
		expect(rec.lyrics.chosenRef).toEqual({ uid: 'netease:1', variant: 'download' });
	});
});

describe('forever + bust', () => {
	it('a resolved record reads back identically a year later (no TTL)', () => {
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: A, source: 'chain' }]);
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000);
		expect(getTrackChosenCover('Adele', 'Hello')).toBe(A);
	});

	it('bust removes exactly that one record', () => {
		recordTrackCoverCandidates('Adele', 'Hello', [{ url: A, source: 'chain' }]);
		recordTrackCoverCandidates('Adele', 'Skyfall', [{ url: B, source: 'chain' }]);
		bustTrackRecord('Adele', 'Hello');
		expect(getTrackRecord('Adele', 'Hello')).toBeNull();
		expect(getTrackChosenCover('Adele', 'Skyfall')).toBe(B);
	});
});
