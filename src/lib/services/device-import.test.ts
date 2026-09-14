import { describe, it, expect } from 'vitest';

// 34-D-03/D-09/D-10/D-11/D-12/D-15/D-16: the pure import brain. Rows + rules + the current library
// in, a verdict (or a whole SyncPlan) out. No store, no DOM, no Capacitor, no device — which is the
// entire point of keeping this in a `.ts` rather than a `.svelte.ts`.
import {
	OPENMUSIC_RELATIVE_PATH,
	SCAN_PAGE_SIZE,
	PATTERN_SCAN_BUDGET_MS,
	classifyRow
} from './device-import';
import { DEFAULT_IMPORT_RULES, type ImportRules } from './device-filename';
import { deviceUid, type ScanRow } from './device-track';
import { matchKey } from './match-key';
import type { Track } from '$lib/sources/types';

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
		durationMs: 295_000,
		mimeType: 'audio/mpeg',
		size: 5_000_000,
		track: 0,
		year: 0,
		...over
	};
}

/** Rules built off the shipped defaults, so every case states only what it changes (D-14). */
function rules(over: Partial<ImportRules> = {}): ImportRules {
	return { ...DEFAULT_IMPORT_RULES, ...over };
}

/** A minimal real-source library entry (the D-09 merge target). */
function track(over: Partial<Track> = {}): Track {
	return {
		uid: 'kuwo:7',
		source: 'kuwo',
		songid: '7',
		title: 'Hello',
		artist: 'Adele',
		album: '25',
		cover: 'https://cdn/adele.jpg',
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0,
		...over
	};
}

/** existingByKey as syncDevice builds it: matchKey(artist, title) → the stored real-source Track. */
function byKey(...list: Track[]): Map<string, Track> {
	return new Map(list.map((t) => [matchKey(t.artist, t.title), t]));
}

const NONE = new Map<string, Track>();

describe('constants', () => {
	it('OPENMUSIC_RELATIVE_PATH equals the Kotlin writer’s relativePath literal', () => {
		// MediaStoreSaverPlugin.kt: `"${Environment.DIRECTORY_MUSIC}/OpenMusic/"` === 'Music/OpenMusic/'
		expect(OPENMUSIC_RELATIVE_PATH).toBe('Music/OpenMusic/');
	});

	it('exposes the paging and ReDoS budgets', () => {
		expect(SCAN_PAGE_SIZE).toBe(500);
		expect(PATTERN_SCAN_BUDGET_MS).toBe(2000);
	});
});

describe('classifyRow', () => {
	// ── D-11: folder scope ────────────────────────────────────────────────────────────────────────
	it('skips a row outside Music/ and Download/ as "outside"', () => {
		const v = classifyRow(row({ relativePath: 'Ringtones/' }), rules(), NONE, null);
		expect(v).toEqual({ kind: 'skip', reason: 'outside' });
	});

	it('treats Music/, a nested Music subfolder and Download/ as inside', () => {
		for (const relativePath of ['Music/', 'Music/Sub/Deep/', 'Download/']) {
			expect(classifyRow(row({ relativePath }), rules(), NONE, null).kind).toBe('import');
		}
	});

	// ── D-12: extension allowlist ─────────────────────────────────────────────────────────────────
	it('skips an extension that is off by default', () => {
		const v = classifyRow(row({ displayName: 'x.opus' }), rules(), NONE, null);
		expect(v).toEqual({ kind: 'skip', reason: 'ext' });
	});

	it('imports that same row once the extension is turned on', () => {
		const v = classifyRow(row({ displayName: 'x.opus' }), rules({ extensions: ['opus'] }), NONE, null);
		expect(v.kind).toBe('import');
	});

	it('matches extensions case-insensitively', () => {
		expect(classifyRow(row({ displayName: 'x.MP3' }), rules(), NONE, null).kind).toBe('import');
	});

	it('skips a file with no extension at all', () => {
		const v = classifyRow(row({ displayName: 'noextension' }), rules(), NONE, null);
		expect(v).toEqual({ kind: 'skip', reason: 'ext' });
	});

	// ── D-12: minimum duration ────────────────────────────────────────────────────────────────────
	it('skips a row just under the minimum duration', () => {
		const v = classifyRow(row({ durationMs: 29_999 }), rules({ minSeconds: 30 }), NONE, null);
		expect(v).toEqual({ kind: 'skip', reason: 'short' });
	});

	it('imports a row exactly at the minimum duration', () => {
		expect(classifyRow(row({ durationMs: 30_000 }), rules({ minSeconds: 30 }), NONE, null).kind).toBe(
			'import'
		);
	});

	it('imports a 3s row when the floor is 0', () => {
		expect(classifyRow(row({ durationMs: 3_000 }), rules({ minSeconds: 0 }), NONE, null).kind).toBe(
			'import'
		);
	});

	it('never penalises an unknown duration', () => {
		expect(classifyRow(row({ durationMs: 0 }), rules({ minSeconds: 30 }), NONE, null).kind).toBe(
			'import'
		);
	});

	// ── D-12: skip phrases ────────────────────────────────────────────────────────────────────────
	it('skips on a phrase in the display name, case-insensitively', () => {
		const v = classifyRow(
			row({ displayName: 'My Voice Memo 3.mp3' }),
			rules({ skipRules: ['voice memo'] }),
			NONE,
			null
		);
		expect(v).toEqual({ kind: 'skip', reason: 'rule' });
	});

	it('skips on a phrase in the folder path too', () => {
		const v = classifyRow(
			row({ relativePath: 'Download/Voice Memo/' }),
			rules({ skipRules: ['voice memo'] }),
			NONE,
			null
		);
		expect(v).toEqual({ kind: 'skip', reason: 'rule' });
	});

	it('never skips when skipRules is empty', () => {
		expect(classifyRow(row(), rules({ skipRules: [] }), NONE, null).kind).toBe('import');
	});

	// ── filter order: a row failing several is counted ONCE, under the first ──────────────────────
	it('applies filters in the order outside → ext → short → rule', () => {
		const bad = {
			displayName: 'Voice Memo.opus',
			durationMs: 1_000,
			relativePath: 'Ringtones/'
		};
		const r = rules({ minSeconds: 30, skipRules: ['voice memo'] });
		expect(classifyRow(row(bad), r, NONE, null)).toEqual({ kind: 'skip', reason: 'outside' });
		expect(classifyRow(row({ ...bad, relativePath: 'Music/' }), r, NONE, null)).toEqual({
			kind: 'skip',
			reason: 'ext'
		});
		expect(
			classifyRow(
				row({ ...bad, relativePath: 'Music/', displayName: 'Voice Memo.mp3' }),
				r,
				NONE,
				null
			)
		).toEqual({ kind: 'skip', reason: 'short' });
		expect(
			classifyRow(
				row({ ...bad, relativePath: 'Music/', displayName: 'Voice Memo.mp3', durationMs: 300_000 }),
				r,
				NONE,
				null
			)
		).toEqual({ kind: 'skip', reason: 'rule' });
	});

	// ── D-09/D-10: the merge lane ────────────────────────────────────────────────────────────────
	it('relinks an OpenMusic-folder row onto the matching real-source entry', () => {
		const stored = track();
		const r = row({ relativePath: OPENMUSIC_RELATIVE_PATH, uri: 'content://media/x/9' });
		expect(classifyRow(r, rules(), byKey(stored), null)).toEqual({
			kind: 'relink',
			uid: 'kuwo:7',
			uri: 'content://media/x/9'
		});
	});

	it('relinks off embedded tags when the filename would not parse', () => {
		const stored = track();
		const r = row({
			relativePath: OPENMUSIC_RELATIVE_PATH,
			displayName: 'mangled-name.mp3',
			title: 'Hello',
			artist: 'Adele'
		});
		expect(classifyRow(r, rules(), byKey(stored), null).kind).toBe('relink');
	});

	it('imports an OpenMusic-folder row that matches nothing (D-16: never vanish)', () => {
		const r = row({ relativePath: OPENMUSIC_RELATIVE_PATH });
		expect(classifyRow(r, rules(), NONE, null).kind).toBe('import');
	});

	it('never relinks onto a device: uid', () => {
		const stored = track({ uid: deviceUid('9'), songid: '9' });
		const r = row({ relativePath: OPENMUSIC_RELATIVE_PATH });
		expect(classifyRow(r, rules(), byKey(stored), null).kind).toBe('import');
	});

	it('never relinks a row outside Music/OpenMusic/ even when the name matches (D-03)', () => {
		const stored = track();
		const r = row({ relativePath: 'Music/' });
		expect(classifyRow(r, rules(), byKey(stored), null).kind).toBe('import');
	});

	// ── D-15/D-16: the row → Track mapping ───────────────────────────────────────────────────────
	it('maps an untagged row through the filename parser', () => {
		const v = classifyRow(row({ id: '42' }), rules(), NONE, null);
		expect(v.kind).toBe('import');
		if (v.kind !== 'import') return;
		expect(v.track.uid).toBe(deviceUid('42'));
		expect(v.track.artist).toBe('Adele');
		expect(v.track.title).toBe('Hello');
	});

	it('lets embedded tags win over the filename (D-15)', () => {
		const v = classifyRow(
			row({ id: '7', title: 'Someone Like You', artist: 'Adele' }),
			rules(),
			NONE,
			null
		);
		expect(v.kind).toBe('import');
		if (v.kind !== 'import') return;
		expect(v.track.uid).toBe(deviceUid('7'));
		expect(v.track.title).toBe('Someone Like You');
		expect(v.track.artist).toBe('Adele');
	});
});
