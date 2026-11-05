// 43 (Bandcamp edge helpers): fixtures recorded live 2026-11-04 —
// autocomplete_elastic "lofi" (trimmed, plus one hand-added non-track row) and
// tralbum_details for band 2636669871 / track 2834446269.
import { describe, it, expect } from 'vitest';
import {
	isBandcampId,
	parseBandcampSearch,
	streamFromTralbum,
	isBcbitsMediaUrl
} from './bandcamp';
import autocomplete from '$lib/sources/__fixtures__/bandcamp.autocomplete.json';
import tralbum from '$lib/sources/__fixtures__/bandcamp.tralbum.json';

describe('isBandcampId', () => {
	it('accepts band-track numeric pairs', () => {
		expect(isBandcampId('2636669871-2834446269')).toBe(true);
	});
	it('rejects urls, single ids, triples and oversize segments', () => {
		expect(isBandcampId('https://x')).toBe(false);
		expect(isBandcampId('123')).toBe(false);
		expect(isBandcampId('1-2-3')).toBe(false);
		expect(isBandcampId('1234567890123-1')).toBe(false);
	});
});

describe('parseBandcampSearch', () => {
	const rows = parseBandcampSearch(autocomplete);
	it('keeps only track rows', () => {
		expect(rows).toHaveLength(6);
		expect(rows.some((r) => r.id === '333-1111111111')).toBe(false);
	});
	it('maps fields with songid band-track and built art url', () => {
		expect(rows[0]).toEqual({
			id: '2636669871-2834446269',
			title: 'LOFI (w/ DJ Earl)',
			artist: 'INVT',
			album: '',
			cover: 'https://f4.bcbits.com/img/a2734277808_16.jpg'
		});
		expect(rows[1].album).toBe('1 A.M Study Session 📚 - [lofi hip hop/chill beats]');
	});
	it('nulls cover without a positive integer art_id and drops incomplete rows', () => {
		const out = parseBandcampSearch({
			auto: {
				results: [
					{ type: 't', id: 1, band_id: 2, name: 'a', band_name: 'b', art_id: null },
					{ type: 't', id: 1, band_id: 2, name: 'a', art_id: 'https://evil.com/x' },
					{ type: 't', band_id: 2, name: 'no id' },
					{ type: 't', id: 1, name: 'no band' },
					{ type: 't', id: 1, band_id: 2 }
				]
			}
		});
		expect(out).toHaveLength(2);
		expect(out[0].cover).toBeNull();
		expect(out[1].cover).toBeNull();
		expect(out[1].artist).toBe('');
	});
	it('returns [] for non-object input', () => {
		expect(parseBandcampSearch(null)).toEqual([]);
		expect(parseBandcampSearch('x')).toEqual([]);
		expect(parseBandcampSearch({ auto: {} })).toEqual([]);
	});
});

describe('streamFromTralbum', () => {
	it('returns the stream_redirect + duration', () => {
		const s = streamFromTralbum(tralbum);
		expect(s?.redirect.startsWith('https://bandcamp.com/stream_redirect?')).toBe(true);
		expect(s?.duration).toBeCloseTo(206.875);
	});
	it('null on the HTTP-200 error body (Pitfall 7)', () => {
		expect(streamFromTralbum({ error: true, error_message: 'band_id required' })).toBeNull();
	});
	it('null when mp3-128 is missing or not https', () => {
		expect(streamFromTralbum({ tracks: [{ duration: 1, streaming_url: {} }] })).toBeNull();
		expect(
			streamFromTralbum({ tracks: [{ streaming_url: { 'mp3-128': 'http://bandcamp.com/x' } }] })
		).toBeNull();
		expect(streamFromTralbum(null)).toBeNull();
	});
});

describe('isBcbitsMediaUrl', () => {
	it('accepts https *.bcbits.com', () => {
		expect(isBcbitsMediaUrl('https://t4.bcbits.com/stream/x/mp3-128/1?ts=1')).toBe(true);
	});
	it('rejects bare host, lookalike paths and plain http', () => {
		expect(isBcbitsMediaUrl('https://bcbits.com/x')).toBe(false);
		expect(isBcbitsMediaUrl('https://evil.com/t4.bcbits.com')).toBe(false);
		expect(isBcbitsMediaUrl('http://t4.bcbits.com/x')).toBe(false);
		expect(isBcbitsMediaUrl('not a url')).toBe(false);
	});
});
