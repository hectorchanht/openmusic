// quick-261122-artisthyphen / ART-HYPHEN-01 — pins the /artist/{name} lookup-key choice for both a
// spaced artist shared as hyphens ("Post Malone" → /artist/Post-Malone) and a genuinely hyphenated
// one ("Jay-Z"). Listener counts below are the 2026-11-22 live Last.fm probe values.
import { describe, expect, it } from 'vitest';
import {
	artistLookupCandidates,
	pickArtistLookupKey,
	resolveArtistLookupKey
} from './artist-lookup-key';

const LIVE: Record<string, number | null> = {
	'Post-Malone': 14, // junk separate Last.fm entity
	'Post Malone': 3_752_210,
	'Jay-Z': 4_100_000,
	'Jay Z': 4_100_000 // autocorrected to the same entity
};
const fake = async (n: string) => LIVE[n] ?? null;

describe('artistLookupCandidates', () => {
	it('is unambiguous with no hyphen', () => {
		expect(artistLookupCandidates('周杰倫')).toBeNull();
		expect(artistLookupCandidates('Adele')).toBeNull();
	});
	it('is unambiguous when the param already has whitespace (in-app nav form)', () => {
		expect(artistLookupCandidates('Jay-Z feat. Someone')).toBeNull();
		expect(artistLookupCandidates('Post Malone')).toBeNull();
	});
	it('is unambiguous for the bare empty token', () => {
		expect(artistLookupCandidates('-')).toBeNull();
	});
	it('offers raw + decoded for a hyphen-only param', () => {
		expect(artistLookupCandidates('Post-Malone')).toEqual({ raw: 'Post-Malone', decoded: 'Post Malone' });
	});
});

describe('resolveArtistLookupKey (ART-HYPHEN-01)', () => {
	it('spaced artist shared as hyphens resolves against the DECODED name', async () => {
		expect(await resolveArtistLookupKey('Post-Malone', fake)).toBe('Post Malone');
	});
	it('genuinely hyphenated artist keeps its hyphen (autocorrect tie → raw)', async () => {
		expect(await resolveArtistLookupKey('Jay-Z', fake)).toBe('Jay-Z');
	});
	it('in-app spaced name passes through untouched with no probe', async () => {
		let calls = 0;
		const spy = async () => (calls++, 1);
		expect(await resolveArtistLookupKey('Post Malone', spy)).toBe('Post Malone');
		expect(calls).toBe(0);
	});
	it('both unknown → raw literal (legacy behaviour)', async () => {
		expect(await resolveArtistLookupKey('Some-Indie-Band', async () => null)).toBe('Some-Indie-Band');
	});
	it('probe failure never throws and keeps raw', async () => {
		expect(
			await resolveArtistLookupKey('Post-Malone', async () => {
				throw new Error('net');
			})
		).toBe('Post-Malone');
	});
	it('decoded must win by an order of magnitude', () => {
		const c = { raw: 'A-B', decoded: 'A B' };
		expect(pickArtistLookupKey(c, 100, 999)).toBe('A-B');
		expect(pickArtistLookupKey(c, 100, 1001)).toBe('A B');
		expect(pickArtistLookupKey(c, null, 5)).toBe('A B');
		expect(pickArtistLookupKey(c, 0, 0)).toBe('A-B');
	});
});
