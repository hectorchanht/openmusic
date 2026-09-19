import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import * as mod from './audio-tags';
import {
	writeAudioTags,
	readAudioTags,
	tagAudioBlob,
	dataUrlToBytes,
	albumTag,
	TAG_MAX_BYTES,
	type AudioContainer
} from './audio-tags';
import { bytesToBase64 } from './media-artwork';

/**
 * 36-D-02/D-03. The whole point of owning the READ side is that it makes the WRITE side provable
 * without a device: every test here writes tags into REAL container bytes and parses them back.
 *
 * The fixtures are synthetic and licensing-clean (macOS `say` + `afconvert`, plus hand-built silent
 * MPEG frames) — see `__fixtures__/README.md` for the regeneration recipe. They are addressed
 * through `new URL(..., import.meta.url)` so the suite does not depend on the process cwd.
 *
 * `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike` flavour: a SharedArrayBuffer
 * view is not a `BlobPart`, so the plain spelling makes `new Blob([bytes])` a type error.
 */
function fixture(name: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

const MP3 = fixture('tiny.mp3');
const M4A = fixture('tiny.m4a');
const M4A_NONFASTSTART = fixture('tiny-nonfaststart.m4a');
const FLAC = fixture('tiny.flac');

/** A PNG header padded out to something a picture block will carry (media-artwork.test.ts idiom). */
const ART_BYTES = (() => {
	const b = new Uint8Array(64);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return b;
})();
const ART = { data: ART_BYTES, mimeType: 'image/png' };

/** Everything we ever write. The CJK title is deliberate — UTF-8 must survive all three codecs. */
const FIELDS = {
	title: '標題 Title',
	artist: 'Artist',
	album: 'Album',
	albumArtist: 'Album Artist',
	trackNumber: '7'
};

/**
 * quick-260915-062: the RAW LRC as resolved — timestamps included, CJK, multi-line. The locked
 * decision is that this string survives byte-for-byte, so the fixture is the assertion.
 */
const LRC = '[00:12.34]歌詞一\n[00:15.00]line two';

/** Container markers a lyrics write leaves behind — and must NOT leave when there are no lyrics. */
const LYRIC_MARKERS = ['USLT', '\xa9lyr', 'LYRICS='];

/** Raw bytes as a latin1 string, so a test can assert on atom/frame names directly. */
function raw(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('latin1');
}

/** Top-level MP4 atom names in file order. 20 lines, no dependency — enough to prove a layout. */
function topLevelAtoms(bytes: Uint8Array): string[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: string[] = [];
	let off = 0;
	while (off + 8 <= bytes.byteLength) {
		const size = view.getUint32(off);
		if (size < 8) break;
		out.push(raw(bytes.subarray(off + 4, off + 8)));
		off += size;
	}
	return out;
}

const CASES: Array<[AudioContainer, Uint8Array<ArrayBuffer>]> = [
	['mp3', MP3],
	['m4a', M4A],
	['flac', FLAC]
];

describe('audio-tags — module shape and purity (36-D-03)', () => {
	it('exports exactly the tag codec surface, named, with no default', () => {
		expect(Object.keys(mod).sort()).toEqual([
			'TAG_MAX_BYTES',
			'albumTag', // quick-260919-0mw — the pure album-vs-title guard both writers call
			'dataUrlToBytes',
			'readAudioTags',
			'tagAudioBlob',
			'writeAudioTags'
		]);
		expect((mod as Record<string, unknown>).default).toBeUndefined();
	});

	it('imports no runes store, no i18n, no $app, and writes no year/genre/comment', () => {
		const src = readFileSync(new URL('./audio-tags.ts', import.meta.url), 'utf8')
			.split('\n')
			.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
			.join('\n');
		expect(src).not.toContain('$lib/stores');
		expect(src).not.toContain('$lib/i18n');
		expect(src).not.toContain('$app/');
		// 36-D-11: the track number comes from the album loop, never from the search ordering index.
		expect(src).not.toContain('displayIndex');
		expect(src).not.toContain('extFromAudioUrl');
		// 36-D-07 / 36-D-08: no setter for these exists anywhere on any path.
		expect(src).not.toContain('setYear');
		expect(src).not.toContain('setGenre');
		expect(src).not.toContain('setComment');
	});
});

describe('audio-tags — per-container round-trip (36-D-02)', () => {
	it('mp3 round-trip: writes and parses back every field plus the cover', async () => {
		const out = await writeAudioTags(MP3, FIELDS, ART);
		expect(out).not.toBeNull();
		expect(out?.format).toBe('mp3');
		expect(out!.bytes.byteLength).toBeGreaterThan(MP3.byteLength);
		const back = await readAudioTags(out!.bytes);
		expect(back).toMatchObject({ format: 'mp3', ...FIELDS });
		const { readCoverArt } = await import('taglib-wasm/simple');
		const art = await readCoverArt(out!.bytes);
		expect(art?.byteLength).toBeGreaterThan(0);
	});

	it('m4a round-trip: writes and parses back every field plus the cover', async () => {
		const out = await writeAudioTags(M4A, FIELDS, ART);
		expect(out).not.toBeNull();
		expect(out?.format).toBe('m4a');
		expect(out!.bytes.byteLength).toBeGreaterThan(M4A.byteLength);
		const back = await readAudioTags(out!.bytes);
		expect(back).toMatchObject({ format: 'm4a', ...FIELDS });
		const { readCoverArt } = await import('taglib-wasm/simple');
		expect((await readCoverArt(out!.bytes))?.byteLength).toBeGreaterThan(0);
	});

	it('flac round-trip: writes and parses back every field plus the cover', async () => {
		const out = await writeAudioTags(FLAC, FIELDS, ART);
		expect(out).not.toBeNull();
		expect(out?.format).toBe('flac');
		expect(out!.bytes.byteLength).toBeGreaterThan(FLAC.byteLength);
		const back = await readAudioTags(out!.bytes);
		expect(back).toMatchObject({ format: 'flac', ...FIELDS });
		const { readCoverArt } = await import('taglib-wasm/simple');
		expect((await readCoverArt(out!.bytes))?.byteLength).toBeGreaterThan(0);
	});

	it.each(CASES)('%s round-trip through tagAudioBlob keeps every field', async (format, bytes) => {
		const out = await tagAudioBlob(new Blob([bytes]), FIELDS);
		expect(out.result).toBe('tagged');
		const back = await readAudioTags(new Uint8Array(await out.blob.arrayBuffer()));
		expect(back).toMatchObject({ format, ...FIELDS });
	});

	it('non-faststart m4a tags cleanly and keeps mdat before moov', async () => {
		// The trap case: a tagger that grows `moov` here without fixing the `stco` chunk offsets
		// produces a file that still opens and plays garbage — silent corruption, not an error.
		expect(topLevelAtoms(M4A_NONFASTSTART)).toEqual(['ftyp', 'mdat', 'moov']);
		const out = await writeAudioTags(M4A_NONFASTSTART, FIELDS, ART);
		expect(out).not.toBeNull();
		expect(out?.format).toBe('m4a');
		const back = await readAudioTags(out!.bytes);
		expect(back).toMatchObject({ format: 'm4a', ...FIELDS });
		const atoms = topLevelAtoms(out!.bytes);
		expect(atoms.indexOf('mdat')).toBeGreaterThan(-1);
		expect(atoms.indexOf('mdat')).toBeLessThan(atoms.indexOf('moov'));
	});
});

describe('audio-tags — omit rules: an absent field is absent, never a placeholder', () => {
	it.each(CASES)('%s omits year, genre, comment and encoder tags (36-D-07/D-08)', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T' });
		expect(out).not.toBeNull();
		const { readTags } = await import('taglib-wasm/simple');
		const t = await readTags(out!.bytes);
		expect(t.year).toBeFalsy();
		expect(t.date?.length ?? 0).toBe(0);
		expect(t.genre?.length ?? 0).toBe(0);
		expect(t.comment?.length ?? 0).toBe(0);
		const s = raw(out!.bytes);
		// MP4 atom names (© is 0xA9 in latin1), FLAC Vorbis keys, ID3 frame ids.
		for (const marker of ['\xa9day', '\xa9gen', '\xa9cmt', '\xa9too', 'DATE=', 'GENRE=', 'COMMENT=', 'TYER', 'TDRC', 'TCON', 'COMM']) {
			expect(s).not.toContain(marker);
		}
	});

	it.each(CASES)('%s omits album when it is not supplied (36-D-10)', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T', artist: 'A' });
		expect(out).not.toBeNull();
		const back = await readAudioTags(out!.bytes);
		expect(back?.title).toBe('T');
		expect(back?.album).toBeUndefined();
		const s = raw(out!.bytes);
		for (const marker of ['ALBUM=', '\xa9alb', 'TALB']) expect(s).not.toContain(marker);
	});

	it.each(CASES)('%s writes no track number unless the album loop supplies one (36-D-11)', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T', artist: 'A' });
		expect(out).not.toBeNull();
		const back = await readAudioTags(out!.bytes);
		expect(back?.trackNumber).toBeUndefined();
		const s = raw(out!.bytes);
		for (const marker of ['trkn', 'TRCK', 'TRACKNUMBER=']) expect(s).not.toContain(marker);
	});
});

describe('audio-tags — failure is always the original bytes (36-D-06)', () => {
	it('returns null for an unknown container instead of throwing', async () => {
		const garbage = new Uint8Array(4096).fill(0x41);
		await expect(writeAudioTags(garbage, { title: 'x' })).resolves.toBeNull();
	});

	it('tagAudioBlob reports unknown container and hands back the SAME blob', async () => {
		const input = new Blob([new Uint8Array(4096).fill(0x41)]);
		const out = await tagAudioBlob(input, { title: 'x' });
		expect(out.result).toBe('unknown-container');
		expect(out.blob).toBe(input);
	});

	it('never throws when the codec itself fails to load', async () => {
		vi.resetModules();
		vi.doMock('taglib-wasm', () => {
			throw new Error('boom');
		});
		const fresh = await import('./audio-tags');
		const input = new Blob([M4A], { type: 'audio/mp4' });
		const out = await fresh.tagAudioBlob(input, { title: 'x' });
		expect(out.result).toBe('error');
		expect(out.blob).toBe(input);
		vi.doUnmock('taglib-wasm');
		vi.resetModules();
	});

	it('returns no-fields and the input blob when there is nothing to write', async () => {
		const input = new Blob([M4A], { type: 'audio/mp4' });
		const out = await tagAudioBlob(input, {});
		expect(out.result).toBe('no-fields');
		expect(out.blob).toBe(input);
	});

	it('respects the size ceiling without ever reading the blob', async () => {
		const input = new Blob([M4A], { type: 'audio/mp4' });
		const arrayBuffer = vi.fn();
		Object.defineProperty(input, 'size', { value: TAG_MAX_BYTES + 1 });
		Object.defineProperty(input, 'arrayBuffer', { value: arrayBuffer });
		const out = await tagAudioBlob(input, FIELDS);
		expect(out.result).toBe('skipped-size');
		expect(out.blob).toBe(input);
		expect(arrayBuffer).not.toHaveBeenCalled();
	});
});

describe('audio-tags — tagAudioBlob contract', () => {
	it('preserves mime type on the tagged blob (quick-260913-tmi / Pitfall 6)', async () => {
		const out = await tagAudioBlob(new Blob([M4A], { type: 'audio/mp4' }), { title: 'x' });
		expect(out.result).toBe('tagged');
		expect(out.result === 'tagged' && out.format).toBe('m4a');
		expect(out.blob.type).toBe('audio/mp4');
	});

	it('sniffs container from the BYTES, not from the blob type', async () => {
		// A FLAC mislabelled as mpeg — exactly what `extFromAudioUrl`'s 'mp3' default would produce.
		const out = await tagAudioBlob(new Blob([FLAC], { type: 'audio/mpeg' }), { title: 'x' });
		expect(out.result === 'tagged' && out.format).toBe('flac');
		const bytes = new Uint8Array(await out.blob.arrayBuffer());
		expect(raw(bytes.subarray(0, 4))).toBe('fLaC');
	});

	it('embeds the cover passed as a data URL', async () => {
		const dataUrl = `data:image/png;base64,${bytesToBase64(ART_BYTES)}`;
		const out = await tagAudioBlob(new Blob([FLAC]), { title: 'x' }, dataUrl);
		expect(out.result).toBe('tagged');
		const { readCoverArt } = await import('taglib-wasm/simple');
		const art = await readCoverArt(new Uint8Array(await out.blob.arrayBuffer()));
		expect(art?.byteLength).toBe(ART_BYTES.byteLength);
	});
});

describe('audio-tags — dataUrlToBytes', () => {
	it('dataUrlToBytes round-trips bytesToBase64 output', () => {
		const out = dataUrlToBytes(`data:image/png;base64,${bytesToBase64(ART_BYTES)}`);
		expect(out?.mimeType).toBe('image/png');
		expect(Array.from(out!.data)).toEqual(Array.from(ART_BYTES));
	});

	it('dataUrlToBytes returns null for a remote URL or an empty payload', () => {
		expect(dataUrlToBytes('https://x')).toBeNull();
		expect(dataUrlToBytes('data:image/png;base64,')).toBeNull();
		expect(dataUrlToBytes('')).toBeNull();
	});
});

describe('audio-tags — readAudioTags', () => {
	it('returns null for bytes that are not one of the three containers', async () => {
		await expect(readAudioTags(new Uint8Array(4096).fill(0x41))).resolves.toBeNull();
	});
});

// 37-D-02: the embedded FrontCover comes out of the SAME readTags() pass that already yields
// title/artist/lyrics — never a second `readCoverArt`/`readPictures` open of a file up to 40 MB.
// These tests are the permanent form of the scratch round-trip RESEARCH Q2 ran.
describe('audio-tags — embedded picture read (37-D-02)', () => {
	it.each(CASES)('%s round-trips the front cover: mime + byte-exact data', async (format, bytes) => {
		const out = await writeAudioTags(bytes, FIELDS, ART);
		expect(out?.format).toBe(format);
		const back = await readAudioTags(out!.bytes);
		expect(back?.art?.mimeType).toBe('image/png');
		// Byte-exact, not just "some bytes": a truncated/padded picture would still be truthy.
		expect(Array.from(back!.art!.data)).toEqual(Array.from(ART_BYTES));
	});

	// The single-picture case above IS `pictures[0]`, so the `?? pictures[0]` fallback branch is
	// covered by it; the write side has no way to emit a second, non-FrontCover entry.
	it.each(CASES)('%s written with NO picture reads back with art ABSENT', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, FIELDS, null);
		expect(out).not.toBeNull();
		const back = await readAudioTags(out!.bytes);
		expect(back?.art).toBeUndefined();
		// Same "absent is ABSENT" contract as album — the key is missing, not an empty object.
		expect('art' in (back as object)).toBe(false);
	});

	it('never opens the file a second time for the picture (T-37-04)', () => {
		// Raw source, comments INCLUDED: the whole-file grep is the plan's own gate, and keeping the
		// names out of the prose too means the check can never be satisfied by a comment that says
		// "don't call X" while the code does.
		const src = readFileSync(new URL('./audio-tags.ts', import.meta.url), 'utf8');
		expect(src).not.toContain('readCoverArt');
		expect(src).not.toContain('readPictures');
	});
});

describe('audio-tags — lyrics (quick-260915-062): raw LRC, timestamps intact', () => {
	it.each(CASES)('%s round-trips the LRC byte-for-byte and writes the container marker', async (format, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T', lyrics: LRC });
		expect(out).not.toBeNull();
		expect(out?.format).toBe(format);
		const back = await readAudioTags(out!.bytes);
		// Byte-for-byte: the leading [mm:ss.xx] stamps, the CJK and the newline all survive.
		expect(back?.lyrics).toBe(LRC);
		const marker = { mp3: 'USLT', m4a: '\xa9lyr', flac: 'LYRICS=' }[format];
		expect(raw(out!.bytes)).toContain(marker);
	});

	it.each(CASES)('%s carries lyrics through tagAudioBlob alongside every other field', async (format, bytes) => {
		const out = await tagAudioBlob(new Blob([bytes]), { ...FIELDS, lyrics: LRC });
		expect(out.result).toBe('tagged');
		const back = await readAudioTags(new Uint8Array(await out.blob.arrayBuffer()));
		expect(back).toMatchObject({ format, ...FIELDS, lyrics: LRC });
	});

	it.each(CASES)('%s writes NO lyrics bytes when the track has none', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T' });
		expect(out).not.toBeNull();
		expect((await readAudioTags(out!.bytes))?.lyrics).toBeUndefined();
		const s = raw(out!.bytes);
		for (const marker of LYRIC_MARKERS) expect(s).not.toContain(marker);
	});

	it.each(CASES)('%s omits an EMPTY lrc rather than writing an empty frame (36-D-10 rule)', async (_f, bytes) => {
		const out = await writeAudioTags(bytes, { title: 'T', lyrics: '' });
		expect(out).not.toBeNull();
		expect((await readAudioTags(out!.bytes))?.lyrics).toBeUndefined();
		const s = raw(out!.bytes);
		for (const marker of LYRIC_MARKERS) expect(s).not.toContain(marker);
	});

	it('counts as a real field: lyrics alone is enough to tag', async () => {
		const out = await tagAudioBlob(new Blob([FLAC]), { lyrics: LRC });
		expect(out.result).toBe('tagged');
		const back = await readAudioTags(new Uint8Array(await out.blob.arrayBuffer()));
		expect(back?.lyrics).toBe(LRC);
	});
});

// quick-260919-0mw — albumTag(). Downloads arrived claiming an album that was just the song title
// (`The Weeknd - The Hills (Explicit).flac` → ALBUM=`The Hills (Explicit)`; `Polar G - 過一招 (feat.
// 拉天糖).m4a` → ALBUM=`过一招 (feat. 拉天糖)`). The value is real upstream data — CN/streaming catalogs
// set a single's album to its own track name — so the guard sits at the write seam.
describe('albumTag — drop an album that is just the song title (quick-260919-0mw)', () => {
	it('keeps a GENUINE album name', () => {
		expect(albumTag('Beauty Behind the Madness', 'The Hills')).toBe('Beauty Behind the Madness');
	});

	it('drops an album equal to the title', () => {
		expect(albumTag('The Hills', 'The Hills')).toBeUndefined();
	});

	it('drops the real evidence shape, parenthetical included', () => {
		expect(albumTag('The Hills (Explicit)', 'The Hills (Explicit)')).toBeUndefined();
	});

	it('is case / space / punctuation insensitive (matchKey normalisation)', () => {
		expect(albumTag('the hills', 'The Hills')).toBeUndefined();
		expect(albumTag('The  Hills!', 'The Hills')).toBeUndefined();
	});

	it('drops when ANY supplied title matches — the multi-title call shape', () => {
		expect(
			albumTag('过一招 (feat. 拉天糖)', '过一招 (feat. 拉天糖)', '過一招 (feat. 拉天糖)')
		).toBeUndefined();
	});

	it('SCRIPT MISMATCH: the raw title matches even when the display title does not', () => {
		// This is the Polar G case — the album rides the RAW catalog string (Simplified) while the
		// tag/filename carries the display title (Traditional). Passing BOTH is what catches it.
		expect(albumTag('过一招', '过一招', '過一招')).toBeUndefined();
		// Only the display title supplied → the mismatch survives, which is why both are passed.
		expect(albumTag('过一招', '過一招')).toBe('过一招');
	});

	it('keeps an album whose name merely CONTAINS the title', () => {
		expect(albumTag('The Hills Have Eyes', 'The Hills')).toBe('The Hills Have Eyes');
	});

	it('36-D-10 unchanged: an empty / absent album is omitted', () => {
		expect(albumTag('', 'x')).toBeUndefined();
		expect(albumTag(undefined, 'x')).toBeUndefined();
		expect(albumTag(null, 'x')).toBeUndefined();
	});

	it('an absent title cannot drop anything', () => {
		expect(albumTag('25', undefined, null, '')).toBe('25');
	});

	it('downstream: an undefined album means setAlbum is never called (36-D-10 re-pinned)', async () => {
		const out = await tagAudioBlob(new Blob([FLAC]), {
			title: 'The Hills',
			artist: 'The Weeknd',
			album: albumTag('The Hills', 'The Hills')
		});
		expect(out.result).toBe('tagged');
		const back = await readAudioTags(new Uint8Array(await out.blob.arrayBuffer()));
		expect(back?.title).toBe('The Hills');
		expect(back?.album ?? '').toBe(''); // no album frame written at all
	});
});
