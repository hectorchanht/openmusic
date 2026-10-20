import { describe, it, expect } from 'vitest';
import { buildArchiveQuery, pickPlayableFiles, type IaFile } from './archive';

// quick-261020-arch: the two pure helpers carry the whole archive trick — query
// building against Lucene injection, and the file-pick policy (format preference,
// per-recording grouping, sample junk exclusion).

describe('buildArchiveQuery', () => {
	it('gates on mediatype:audio and ANDs every term', () => {
		expect(buildArchiveQuery('beethoven moonlight')).toBe(
			'mediatype:audio AND (beethoven AND moonlight)'
		);
	});

	it('escapes Lucene specials so a hostile keyword cannot rewrite the query', () => {
		const q = buildArchiveQuery('a:b (live) "best"');
		expect(q).toContain('a\\:b');
		expect(q).toContain('\\(live\\)');
		expect(q).toContain('\\"best\\"');
		expect(q.startsWith('mediatype:audio AND (')).toBe(true);
	});

	it('degrades an all-whitespace keyword to the bare mediatype scan', () => {
		expect(buildArchiveQuery('   ')).toBe('mediatype:audio');
	});
});

describe('pickPlayableFiles', () => {
	// Shape mirrors the real MoonlightSonata_755 metadata capture (2026-10-20)
	// plus synthetic junk/sample/flac rows to pin the policy.
	const files: IaFile[] = [
		{ name: '__ia_thumb.jpg', format: 'Item Tile', size: '7041' },
		{ name: 'MoonlightSonata_files.xml', format: 'Metadata', size: '100' },
		{ name: 'MoonlightSonata_archive.torrent', format: 'Archive BitTorrent', size: '9' },
		{ name: 'Beethoven-MoonlightSonata.mp3', format: 'VBR MP3', size: '5925033', length: '370.31', title: 'beethoven - moonlight sonata' },
		{ name: 'Beethoven-MoonlightSonata.ogg', format: 'Ogg Vorbis', size: '4434574', length: '370.05' },
		{ name: 'Beethoven-MoonlightSonata_sample.mp3', format: 'VBR MP3', size: '900000', length: '30.0' },
		{ name: '01-Allegro.flac', format: 'Flac', size: '30000000', length: '401.2' },
		{ name: '01-Allegro.mp3', format: 'MP3', size: '8000000', length: '401.0' }
	];

	it('picks one file per recording — best format wins (VBR MP3 over OGG; MP3 over FLAC)', () => {
		const picked = pickPlayableFiles(files);
		const names = picked.map((p) => p.file);
		expect(names).toContain('Beethoven-MoonlightSonata.mp3');
		expect(names).not.toContain('Beethoven-MoonlightSonata.ogg');
		expect(names).toContain('01-Allegro.mp3');
		expect(names).not.toContain('01-Allegro.flac');
	});

	it('excludes samples, torrents, metadata and images', () => {
		const names = pickPlayableFiles(files).map((p) => p.file);
		expect(names.some((n) => n.includes('_sample'))).toBe(false);
		expect(names.some((n) => n.endsWith('.torrent'))).toBe(false);
		expect(names.some((n) => n.endsWith('.jpg'))).toBe(false);
		expect(names.some((n) => n.endsWith('.xml'))).toBe(false);
	});

	it('normalizes length/size and carries the file title when present', () => {
		const picked = pickPlayableFiles(files);
		const moon = picked.find((p) => p.file === 'Beethoven-MoonlightSonata.mp3');
		expect(moon?.lengthSec).toBe(370);
		expect(moon?.size).toBe(5925033);
		expect(moon?.title).toBe('beethoven - moonlight sonata');
		expect(moon?.format).toBe('VBR MP3');
	});

	it('returns [] for junk-only or empty file lists', () => {
		expect(pickPlayableFiles([])).toEqual([]);
		expect(pickPlayableFiles([{ name: 'x.torrent', format: 'Archive BitTorrent' }])).toEqual([]);
	});
});
