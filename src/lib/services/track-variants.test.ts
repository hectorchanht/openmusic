import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getTrackRecord,
	recordTrackVariant,
	pinTrackVariant,
	getVariantPin,
	defaultVariantOf,
	getDefaultVariantUid,
	collapseToCanonicalRows,
	bustTrackRecord
} from './track-record';

// track-variants (quick-261121-canon, Hector 2026-11-21 02:06 CST) — entity
// resolution → GOLDEN RECORD. Pins the two product rules:
//   (1) ONE RENDER — duplicate-source tracks collapse to one row per record;
//       every variant lives INSIDE the record as a selectable source.
//   (2) DEFAULT PLAY = OFFICIAL/ORIGINAL (正版原版) — first play picks the
//       official variant; a user pin beats the official default thereafter
//       (precedence: pin > official > auto).

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

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
	vi.useRealTimers();
});

const ARTIST = 'Megan Thee Stallion';
const TITLE = 'Hiss';

function seedThreeVariants() {
	// A live fan upload registers FIRST (auto order), the official studio cut
	// second, a karaoke variant third — the YouTube-Music duplicate mess.
	recordTrackVariant(ARTIST, TITLE, { uid: 'bilibili:L1', source: 'bilibili', title: 'Hiss (Live)' });
	recordTrackVariant(ARTIST, TITLE, { uid: 'qq:O1', source: 'qq', title: 'Hiss' });
	recordTrackVariant(ARTIST, TITLE, { uid: 'netease:K1', source: 'netease', title: 'Hiss (Karaoke)' });
}

describe('golden record — variants live inside the record', () => {
	it('registers every provider variant with provenance + officialness, deduped by uid', () => {
		seedThreeVariants();
		recordTrackVariant(ARTIST, TITLE, { uid: 'qq:O1', source: 'qq', title: 'Hiss' }); // re-register: no dup
		const rec = getTrackRecord(ARTIST, TITLE);
		expect(rec?.variants.map((v) => v.uid)).toEqual(['bilibili:L1', 'qq:O1', 'netease:K1']);
		expect(rec?.variants.find((v) => v.uid === 'qq:O1')).toMatchObject({ source: 'qq', official: true });
		expect(rec?.variants.find((v) => v.uid === 'bilibili:L1')?.official).toBe(false);
		// variants are instances too (the record knows every uid of the song)
		expect(rec?.instances).toContain('bilibili:L1');
	});

	it('ONE RENDER: duplicate-source tracks collapse to exactly one row — the official one', () => {
		seedThreeVariants();
		const rows = collapseToCanonicalRows([
			{ artist: ARTIST, title: TITLE, uid: 'bilibili:L1' },
			{ artist: ARTIST, title: TITLE, uid: 'qq:O1' },
			{ artist: ARTIST, title: TITLE, uid: 'netease:K1' },
			{ artist: 'Other', title: 'Else', uid: 'qq:X9' }
		]);
		expect(rows).toHaveLength(2); // Hiss once + the other song once
		expect(rows[0].uid).toBe('qq:O1');
		expect(rows[1].uid).toBe('qq:X9');
	});

	it('ONE RENDER without any record: the first official-titled track represents the song', () => {
		const rows = collapseToCanonicalRows([
			{ artist: 'A', title: 'Song (Live)', uid: 'bilibili:1' },
			{ artist: 'A', title: 'Song (Live)', uid: 'qq:2' }
		]);
		// Same versioned record (both are the live cut) → one row.
		expect(rows).toHaveLength(1);
	});
});

describe('golden record — default play precedence (pin > official > auto)', () => {
	it('first play picks the OFFICIAL variant even when it registered after a live upload', () => {
		seedThreeVariants();
		expect(getDefaultVariantUid(ARTIST, TITLE)).toBe('qq:O1');
		expect(defaultVariantOf(getTrackRecord(ARTIST, TITLE))?.official).toBe(true);
	});

	it('with no official variant, the default is the first-seen (auto)', () => {
		recordTrackVariant('A', 'Tune', { uid: 'bilibili:1', source: 'bilibili', title: 'Tune (Live)' });
		recordTrackVariant('A', 'Tune', { uid: 'ytmusic:2', source: 'ytmusic', title: 'Tune (Cover)' });
		expect(getDefaultVariantUid('A', 'Tune')).toBe('bilibili:1');
	});

	it('a user PIN beats the official default; unpinning restores the official default', () => {
		seedThreeVariants();
		pinTrackVariant(ARTIST, TITLE, 'bilibili:L1');
		expect(getVariantPin(ARTIST, TITLE)).toBe('bilibili:L1');
		expect(getDefaultVariantUid(ARTIST, TITLE)).toBe('bilibili:L1');
		// …and the collapse representative follows the pin too.
		const rows = collapseToCanonicalRows([
			{ artist: ARTIST, title: TITLE, uid: 'qq:O1' },
			{ artist: ARTIST, title: TITLE, uid: 'bilibili:L1' }
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].uid).toBe('bilibili:L1');
		pinTrackVariant(ARTIST, TITLE, null);
		expect(getDefaultVariantUid(ARTIST, TITLE)).toBe('qq:O1');
	});

	it('a pin naming an unregistered uid still wins (the pin is the user\u2019s word)', () => {
		seedThreeVariants();
		pinTrackVariant(ARTIST, TITLE, 'kuwo:ZZ');
		expect(getDefaultVariantUid(ARTIST, TITLE)).toBe('kuwo:ZZ');
	});

	it('variants + pin persist FOREVER (no TTL) and bust clears them with the record', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-21T00:00:00Z'));
		seedThreeVariants();
		pinTrackVariant(ARTIST, TITLE, 'qq:O1');
		vi.setSystemTime(new Date('2027-11-21T00:00:00Z')); // +1 year
		expect(getTrackRecord(ARTIST, TITLE)?.variants).toHaveLength(3);
		expect(getDefaultVariantUid(ARTIST, TITLE)).toBe('qq:O1');
		bustTrackRecord(ARTIST, TITLE);
		expect(getTrackRecord(ARTIST, TITLE)).toBeNull();
		vi.useRealTimers();
	});
});
