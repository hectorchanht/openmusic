// quick-261101-ccm: tests for the CCMixter XSPF parsers/validators.
// Fixtures are shaped from the live responses captured 2026-11-01
// (search "love" + the by-id lookup for upload 71321).
import { describe, it, expect } from 'vitest';
import { parseCcmixterSearch, parseCcmixterLocation, isCcmixterMediaUrl, decodeXmlEntities } from './ccmixter';

const SEARCH_XSPF = `<?xml version="1.0" encoding="utf-8" ?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
<trackList>
    <track>
        <location>https://ccmixter.org/content/admiralbob77/admiralbob77_-_One_Love_(Only_One).mp3</location>
        <identifier>71314</identifier>
        <title>One Love (Only One)</title>
        <creator>Admiral Bob</creator>
        <image>https://ccmixter.org/content/admiralbob77/IMG_039093x94.jpg</image>
        <duration>8551488</duration>
      </track>
    <track>
        <location>https://ccmixter.org/content/Reiswerk/Reiswerk_-_Only_one_Love.mp3</location>
        <identifier>71305</identifier>
        <title>Only one Love</title>
        <creator>reiswerk &amp; friends</creator>
        <duration>5244636</duration>
      </track>
</trackList>
</playlist>`;

const BY_ID_XSPF = `<?xml version="1.0" encoding="utf-8" ?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
<trackList>
    <track>
        <location>https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Welcome_to_the_New_World_1.mp3</location>
        <identifier>71321</identifier>
        <title>Welcome to the New World</title>
        <creator>Jeris</creator>
      </track>
</trackList>
</playlist>`;

describe('isCcmixterMediaUrl', () => {
	it('accepts the canonical content mp3 shape', () => {
		expect(isCcmixterMediaUrl('https://ccmixter.org/content/Reiswerk/Reiswerk_-_Only_one_Love.mp3')).toBe(true);
	});

	it('rejects http, foreign hosts, non-content paths and non-mp3 files', () => {
		expect(isCcmixterMediaUrl('http://ccmixter.org/content/a/b.mp3')).toBe(false);
		expect(isCcmixterMediaUrl('https://evil.example/content/a/b.mp3')).toBe(false);
		expect(isCcmixterMediaUrl('https://ccmixter.org/files/Reiswerk/71305')).toBe(false);
		expect(isCcmixterMediaUrl('https://ccmixter.org/content/a/b.zip')).toBe(false);
		expect(isCcmixterMediaUrl('not a url')).toBe(false);
	});
});

describe('decodeXmlEntities', () => {
	it('decodes named + numeric entities, leaves unknown ones alone', () => {
		expect(decodeXmlEntities('Tom &amp; Jerry &lt;3 &#8212; ok')).toBe('Tom & Jerry <3 — ok');
		expect(decodeXmlEntities('a &bogus; b')).toBe('a &bogus; b');
	});
});

describe('parseCcmixterSearch', () => {
	it('maps rows: id/title/artist/cover, entities decoded, image optional', () => {
		const rows = parseCcmixterSearch(SEARCH_XSPF);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			id: '71314',
			title: 'One Love (Only One)',
			artist: 'Admiral Bob',
			cover: 'https://ccmixter.org/content/admiralbob77/IMG_039093x94.jpg'
		});
		expect(rows[1].artist).toBe('reiswerk & friends');
		expect(rows[1].cover).toBeNull();
	});

	it('drops rows with a non-numeric id, missing title or a non-media location', () => {
		const xml = `<playlist><trackList>
			<track><location>https://ccmixter.org/content/a/a.mp3</location><identifier>abc</identifier><title>X</title></track>
			<track><location>https://ccmixter.org/content/a/a.mp3</location><identifier>42</identifier></track>
			<track><location>https://evil.example/a.mp3</location><identifier>43</identifier><title>Y</title></track>
			<track><location>https://ccmixter.org/content/a/a.zip</location><identifier>44</identifier><title>Z</title></track>
		</trackList></playlist>`;
		expect(parseCcmixterSearch(xml)).toEqual([]);
	});

	it('returns [] for an empty or garbage body', () => {
		expect(parseCcmixterSearch('<playlist><trackList></trackList></playlist>')).toEqual([]);
		expect(parseCcmixterSearch('{"error":1}')).toEqual([]);
	});
});

describe('parseCcmixterLocation', () => {
	it('returns the canonical primary mp3 for a by-id body', () => {
		expect(parseCcmixterLocation(BY_ID_XSPF)).toBe(
			'https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Welcome_to_the_New_World_1.mp3'
		);
	});

	it('returns null when no usable track is present', () => {
		expect(parseCcmixterLocation('<playlist><trackList></trackList></playlist>')).toBeNull();
		expect(parseCcmixterLocation('')).toBeNull();
	});
});
