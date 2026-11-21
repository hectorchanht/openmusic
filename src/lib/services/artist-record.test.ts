import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	artistRecordKey,
	getArtistRecord,
	recordArtistImage,
	pinArtistImage,
	getArtistPin,
	getArtistChosen,
	registerArtistAlias,
	canonicalArtistKey,
	bustArtistRecord,
	mergeArtistCandidates,
	type ArtistImageCandidate
} from './artist-record';

// artist-record (quick-261121-canon, brief §2.3) — the ONE canonical record per artist:
// canonical key + alias table, image pin/candidates/chosen, FOREVER persistence.

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

const PIC = 'https://cdn-images.dzcdn.net/images/artist/a/1000x1000-000000-80-0-0.jpg';
const PIC2 = 'https://cdn-images.dzcdn.net/images/artist/b/1000x1000-000000-80-0-0.jpg';
const PIN = 'https://cdn-images.dzcdn.net/images/artist/pin/1000x1000-000000-80-0-0.jpg';

beforeEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

describe('artist record basics', () => {
	it('key folds spellings (matchKey) so case variants share one record', () => {
		expect(artistRecordKey('Megan Thee Stallion')).toBe(artistRecordKey('megan thee stallion'));
		recordArtistImage('Megan Thee Stallion', PIC, 'deezer-artist');
		expect(getArtistChosen('megan thee stallion')).toBe(PIC);
	});

	it('chosen is the first candidate; a pin outranks it; unpin returns to the auto winner', () => {
		recordArtistImage('Adele', PIC, 'deezer-artist');
		recordArtistImage('Adele', PIC2, 'lastfm');
		expect(getArtistChosen('Adele')).toBe(PIC);
		pinArtistImage('Adele', PIN);
		expect(getArtistPin('Adele')).toBe(PIN);
		expect(getArtistChosen('Adele')).toBe(PIN);
		pinArtistImage('Adele', null);
		// Unpin = "back to auto": the first auto candidate wins again. The ex-pin stays in
		// the candidate list (WHY NOT ALL) at its appended precedence — it is not lost, just
		// no longer chosen.
		expect(getArtistChosen('Adele')).toBe(PIC);
		expect(getArtistRecord('Adele')?.image.candidates.map((c) => c.url)).toContain(PIN);
	});

	it('rejects non-https images', () => {
		expect(recordArtistImage('Adele', 'http://evil.example.com/x.jpg', 'lastfm')).toBeNull();
		expect(getArtistRecord('Adele')).toBeNull();
	});

	it('persists FOREVER — a year later the chosen image is unchanged (no TTL)', () => {
		recordArtistImage('Adele', PIC, 'deezer-artist');
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000);
		expect(getArtistChosen('Adele')).toBe(PIC);
	});

	it('bust removes exactly that record', () => {
		recordArtistImage('Adele', PIC, 'deezer-artist');
		recordArtistImage('Beyoncé', PIC2, 'deezer-artist');
		bustArtistRecord('Adele');
		expect(getArtistRecord('Adele')).toBeNull();
		expect(getArtistChosen('Beyoncé')).toBe(PIC2);
	});
});

describe('alias table — every spelling, one record', () => {
	it('registering an alias migrates the record to the canonical key', () => {
		recordArtistImage('周杰倫', PIC, 'deezer-artist'); // resolved under the raw credit first
		registerArtistAlias('Jay Chou', '周杰倫');
		expect(canonicalArtistKey('周杰倫')).toBe(artistRecordKey('Jay Chou'));
		expect(getArtistChosen('Jay Chou')).toBe(PIC);
		expect(getArtistChosen('周杰倫')).toBe(PIC);
		// New writes under the alias land on the same record.
		recordArtistImage('周杰倫', PIC2, 'lastfm');
		expect(getArtistRecord('Jay Chou')?.image.candidates.map((c) => c.url)).toEqual([PIC, PIC2]);
	});
});

describe('mergeArtistCandidates — determinism', () => {
	it('pure + dedupes by URL keeping first provenance', () => {
		const existing: ArtistImageCandidate[] = [{ url: PIC, source: 'deezer-artist', at: 1 }];
		const incoming: ArtistImageCandidate[] = [
			{ url: PIC2, source: 'deezer-hit', at: 2 },
			{ url: PIC, source: 'lastfm', at: 3 }
		];
		const out = mergeArtistCandidates(existing, incoming);
		expect(out.map((c) => c.url)).toEqual([PIC, PIC2]);
		expect(out[0].source).toBe('deezer-artist');
		expect(existing.length).toBe(1);
		expect(incoming.length).toBe(2);
	});
});
