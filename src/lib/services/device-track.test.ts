import { describe, it, expect } from 'vitest';

// 34-D-01/D-02/D-15/D-16: the pure ScanRow → Track mapper and the `device:` uid namespace. These are
// node-only pure functions (no store, no DOM, no Capacitor) so this test drives them directly under
// the single Vitest node project — same shape as download-filename.test.ts.
import {
	DEVICE_SOURCE,
	UNKNOWN_TAG,
	deviceUid,
	isDeviceUid,
	deviceContentUri,
	tagOrEmpty,
	rowToTrack,
	type ScanRow
} from './device-track';

/** Sensible-default ScanRow so each case below stays a one-liner. */
function row(over: Partial<ScanRow> = {}): ScanRow {
	return {
		id: '42',
		uri: 'content://media/external/audio/media/42',
		displayName: 'Adele - Hello.mp3',
		relativePath: 'Music/',
		title: '',
		artist: '',
		album: '',
		durationMs: 295000,
		mimeType: 'audio/mpeg',
		size: 8_000_000,
		track: 0,
		year: 0,
		...over
	};
}

describe('device-track — uid namespace (34-D-01 / D-02)', () => {
	it('mints a colon-form uid through makeUid', () => {
		expect(deviceUid('42')).toBe('device:42');
		expect(DEVICE_SOURCE).toBe('device');
	});

	it('recognises a device uid and nothing else', () => {
		expect(isDeviceUid('device:42')).toBe(true);
		expect(isDeviceUid('kuwo:42')).toBe(false);
		expect(isDeviceUid('')).toBe(false);
		expect(isDeviceUid(null)).toBe(false);
		expect(isDeviceUid(undefined)).toBe(false);
	});
});

describe('device-track — deviceContentUri (T-34-03: digits-only ids)', () => {
	it('reconstructs the MediaStore content URI for a device uid', () => {
		expect(deviceContentUri('device:42')).toBe('content://media/external/audio/media/42');
	});

	it('returns null for a real-source uid', () => {
		expect(deviceContentUri('kuwo:42')).toBeNull();
	});

	it('returns null for an empty or non-numeric id (no path fragment can be smuggled through)', () => {
		expect(deviceContentUri('device:')).toBeNull();
		expect(deviceContentUri('device:4 2')).toBeNull();
		expect(deviceContentUri('device:../../etc/passwd')).toBeNull();
		expect(deviceContentUri('device:4a2')).toBeNull();
	});

	it('agrees with the uri the Kotlin scan emits for the same row', () => {
		const r = row();
		expect(deviceContentUri(deviceUid(r.id))).toBe(r.uri);
	});
});

describe('device-track — tagOrEmpty (MediaStore fallback detection)', () => {
	it('treats the literal <unknown> placeholder as no tag', () => {
		expect(tagOrEmpty(UNKNOWN_TAG)).toBe('');
	});

	it('treats blank / null / undefined as no tag', () => {
		expect(tagOrEmpty('  ')).toBe('');
		expect(tagOrEmpty(null)).toBe('');
		expect(tagOrEmpty(undefined)).toBe('');
	});

	it('treats a TITLE identical to the filename stem as no tag', () => {
		expect(tagOrEmpty('Hello', 'Hello')).toBe('');
	});

	it('keeps a real tag that merely differs from the stem', () => {
		expect(tagOrEmpty('Hello', 'Adele - Hello')).toBe('Hello');
		expect(tagOrEmpty('  Hello  ')).toBe('Hello');
	});
});

describe('device-track — rowToTrack precedence (34-D-15 / D-16)', () => {
	it('D-15: embedded tags win over a filename that parses differently', () => {
		const t = rowToTrack(
			row({ title: 'Hello', artist: 'Adele', displayName: 'Hello - Adele.mp3' }),
			{ title: 'Adele', artist: 'Hello' }
		);
		expect(t.title).toBe('Hello');
		expect(t.artist).toBe('Adele');
	});

	it('D-15: an empty or <unknown> tag falls back to the parsed filename', () => {
		const t = rowToTrack(row({ title: '', artist: UNKNOWN_TAG }), {
			title: 'Hello',
			artist: 'Adele'
		});
		expect(t.title).toBe('Hello');
		expect(t.artist).toBe('Adele');
	});

	it('D-16: an untagged, unparseable file still imports with the filename stem as its title', () => {
		const t = rowToTrack(row({ displayName: 'whatever.mp3' }), { title: 'whatever', artist: '' });
		expect(t.title).toBe('whatever');
		expect(t.artist).toBe('');
	});

	it('D-16: a file with neither tags nor a parse result never yields a null title', () => {
		const t = rowToTrack(row({ displayName: 'weird file.name.flac' }), { title: '', artist: '' });
		expect(t.title).toBe('weird file.name');
		expect(t.artist).toBe('');
	});

	it('prefers the album tag, then the parsed album, then empty', () => {
		expect(rowToTrack(row({ album: '25' }), { title: 'a', artist: 'b', album: 'X' }).album).toBe('25');
		expect(rowToTrack(row({ album: UNKNOWN_TAG }), { title: 'a', artist: 'b', album: 'X' }).album).toBe('X');
		expect(rowToTrack(row(), { title: 'a', artist: 'b' }).album).toBe('');
	});
});

describe('device-track — rowToTrack Track shape', () => {
	it('emits the device uid, a placeholder source, and an unresolvable-by-network stub', () => {
		const t = rowToTrack(row({ title: 'Hello', artist: 'Adele' }), { title: 'Hello', artist: 'Adele' });
		expect(t.uid).toBe(deviceUid('42'));
		expect(t.songid).toBe('42');
		expect(t.source).toBe('kuwo');
		expect(t.audioUrl).toBeNull();
		expect(t.detailsLoaded).toBe(true);
		expect(t.cover).toBeNull();
		expect(t.lrc).toBeNull();
		expect(t.lrcUrl).toBeNull();
		expect(t.quality).toBeNull();
		expect(t.qualityLabel).toBeNull();
		expect(t.keyword).toBe('');
		expect(t.displayIndex).toBe(0);
		expect('resolvedAt' in t).toBe(false);
	});

	it('converts durationMs to whole seconds, and omits duration when it is not a positive number', () => {
		expect(rowToTrack(row({ durationMs: 295_400 }), { title: 'a', artist: 'b' }).duration).toBe(295);
		expect('duration' in rowToTrack(row({ durationMs: 0 }), { title: 'a', artist: 'b' })).toBe(false);
		expect(
			'duration' in rowToTrack(row({ durationMs: NaN }), { title: 'a', artist: 'b' })
		).toBe(false);
	});
});
