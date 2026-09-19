import { describe, it, expect } from 'vitest';

// 34-D-03/D-09/D-10/D-11/D-12/D-15/D-16: the pure import brain. Rows + rules + the current library
// in, a verdict (or a whole SyncPlan) out. No store, no DOM, no Capacitor, no device — which is the
// entire point of keeping this in a `.ts` rather than a `.svelte.ts`.
import {
	OPENMUSIC_RELATIVE_PATH,
	SCAN_PAGE_SIZE,
	PATTERN_SCAN_BUDGET_MS,
	classifyRow,
	emptySummary,
	syncDevice
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

	// ── quick-260919-30x: the user's explicit "don't import again" ────────────────────────────────
	it('skips a row whose device uid the user marked', () => {
		expect(classifyRow(row({ id: '7' }), rules(), NONE, null, new Set([deviceUid('7')]))).toEqual({
			kind: 'skip',
			reason: 'excluded'
		});
	});

	it('an explicit mark OUTRANKS a generic rule — counted once, as "excluded"', () => {
		// The row fails minSeconds AND a skip rule AND is marked. One row, one verdict, and the
		// verdict the user chose by hand wins over the ones a preset inferred.
		const r = rules({ minSeconds: 30, skipRules: ['voice memo'] });
		expect(
			classifyRow(
				row({ id: '7', displayName: 'Voice Memo.mp3', durationMs: 1_000 }),
				r,
				NONE,
				null,
				new Set([deviceUid('7')])
			)
		).toEqual({ kind: 'skip', reason: 'excluded' });
	});

	it('"outside" stays the FIRST filter, even for a marked row', () => {
		// A malformed/null row has no folder and must never reach an id read.
		expect(
			classifyRow(row({ id: '7', relativePath: 'Ringtones/' }), rules(), NONE, null, new Set([deviceUid('7')]))
		).toEqual({ kind: 'skip', reason: 'outside' });
	});

	it('with no 5th argument every verdict is byte-identical to today (D-10 default)', () => {
		const cases: ScanRow[] = [
			row({ id: '1' }),
			row({ id: '2', relativePath: 'Ringtones/' }),
			row({ id: '3', displayName: 'x.opus' }),
			row({ id: '4', durationMs: 1_000 })
		];
		const r = rules({ minSeconds: 30 });
		for (const c of cases) {
			expect(classifyRow(c, r, NONE, null)).toEqual(classifyRow(c, r, NONE, null, new Set()));
		}
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

/** A stored device entry, as it sits in library.downloads between imports. */
function dev(id: string, over: Partial<Track> = {}): Track {
	return track({ uid: deviceUid(id), songid: id, cover: null, ...over });
}

const uids = (list: Track[]) => list.map((t) => t.uid);

describe('emptySummary', () => {
	it('is all-zero, complete, and carries the floor in force', () => {
		expect(emptySummary(rules({ minSeconds: 45 }))).toEqual({
			added: 0,
			relinked: 0,
			removed: 0,
			already: 0,
			skippedShort: 0,
			skippedExt: 0,
			skippedRule: 0,
			skippedOutside: 0,
			skippedExcluded: 0,
			minSeconds: 45,
			complete: true,
			patternFellBack: false
		});
	});
});

describe('syncDevice', () => {
	const sync = (existing: Track[], rows: ScanRow[], complete = true, over: Partial<ImportRules> = {}) =>
		syncDevice(existing, rows, rules(over), { complete, custom: null });

	it('adds new files, refreshes seen ones and drops unseen device entries on a complete scan', () => {
		const realA = track();
		const plan = sync(
			[realA, dev('1'), dev('2')],
			[row({ id: '1' }), row({ id: '3', displayName: 'Daft Punk - Da Funk.mp3' })]
		);
		expect(uids(plan.downloads)).toContain(deviceUid('3'));
		expect(uids(plan.downloads)).toContain(deviceUid('1'));
		expect(uids(plan.downloads)).toContain('kuwo:7');
		expect(uids(plan.downloads)).not.toContain(deviceUid('2'));
		expect(plan.summary.added).toBe(1);
		expect(plan.summary.removed).toBe(1);
		expect(plan.summary.already).toBe(1);
	});

	it('NEVER drops on a cancelled or failed scan (D-08)', () => {
		const realA = track();
		const plan = sync(
			[realA, dev('1'), dev('2')],
			[row({ id: '1' }), row({ id: '3', displayName: 'Daft Punk - Da Funk.mp3' })],
			false
		);
		expect(uids(plan.downloads)).toContain(deviceUid('2'));
		expect(plan.summary.removed).toBe(0);
		expect(plan.summary.complete).toBe(false);
	});

	it('refreshes a device entry from its row while preserving an adopted cover', () => {
		const old = dev('1', { title: 'Old', cover: 'https://x/c.jpg' });
		const plan = sync([old], [row({ id: '1', title: 'New' })]);
		const got = plan.downloads.find((t) => t.uid === deviceUid('1'));
		expect(got?.title).toBe('New');
		expect(got?.cover).toBe('https://x/c.jpg');
	});

	it('prepends new device tracks and keeps existing entries in their relative order', () => {
		const realA = track();
		const plan = sync(
			[realA, dev('1'), dev('2')],
			[
				row({ id: '1' }),
				row({ id: '2', displayName: 'B - B.mp3' }),
				row({ id: '3', displayName: 'C - C.mp3' })
			]
		);
		expect(uids(plan.downloads)).toEqual([deviceUid('3'), 'kuwo:7', deviceUid('1'), deviceUid('2')]);
		expect(plan.downloads[1]).toBe(realA);
	});

	it('never drops a real-source entry, even on an empty complete scan', () => {
		const realA = track();
		const plan = sync([realA], []);
		expect(plan.downloads).toEqual([realA]);
		expect(plan.summary.removed).toBe(0);
	});

	it('relinks an OpenMusic file onto its stored entry with zero churn (D-09/D-10)', () => {
		const realA = track();
		const plan = sync(
			[realA],
			[row({ id: '9', relativePath: OPENMUSIC_RELATIVE_PATH, uri: 'content://media/x/9' })]
		);
		expect(plan.relink).toEqual([{ uid: 'kuwo:7', uri: 'content://media/x/9' }]);
		expect(plan.summary.relinked).toBe(1);
		expect(plan.downloads).toHaveLength(1);
		expect(plan.downloads[0]).toBe(realA);
	});

	it('counts every skip reason exactly once and reports the floor in force', () => {
		const plan = sync(
			[],
			[
				row({ id: '1', relativePath: 'Ringtones/' }),
				row({ id: '2', displayName: 'x.opus' }),
				row({ id: '3', durationMs: 1_000 }),
				row({ id: '4', displayName: 'Voice Memo.mp3' })
			],
			true,
			{ minSeconds: 30, skipRules: ['voice memo'] }
		);
		expect(plan.summary.skippedOutside).toBe(1);
		expect(plan.summary.skippedExt).toBe(1);
		expect(plan.summary.skippedShort).toBe(1);
		expect(plan.summary.skippedRule).toBe(1);
		expect(plan.summary.added).toBe(0);
		expect(plan.summary.minSeconds).toBe(30);
	});

	it('imports a realistic library with ZERO configuration (D-14)', () => {
		const realisticRows = [
			row({ id: '1', displayName: 'Adele - Hello.mp3', relativePath: 'Music/', durationMs: 295_000 }),
			row({
				id: '2',
				displayName: '01. Daft Punk - One More Time.flac',
				relativePath: 'Music/Albums/',
				durationMs: 320_000
			}),
			row({ id: '3', displayName: 'podcast.mp3', relativePath: 'Download/', durationMs: 1_800_000 }),
			row({ id: '4', displayName: 'notification.ogg', relativePath: 'Music/', durationMs: 3_000 }),
			row({ id: '5', displayName: 'voice.opus', relativePath: 'Download/', durationMs: 60_000 }),
			row({ id: '6', displayName: 'ring.mp3', relativePath: 'Ringtones/', durationMs: 30_000 })
		];
		const plan = syncDevice([], realisticRows, DEFAULT_IMPORT_RULES, {
			complete: true,
			custom: null
		});
		expect(plan.summary.added).toBe(3);
		expect(plan.summary.skippedShort).toBe(1);
		expect(plan.summary.skippedExt).toBe(1);
		expect(plan.summary.skippedOutside).toBe(1);
		const adele = plan.downloads.find((t) => t.uid === deviceUid('1'));
		expect(adele?.artist).toBe('Adele');
		expect(adele?.title).toBe('Hello');
	});

	it('de-duplicates rows repeated across paging overlap', () => {
		const plan = sync([], [row({ id: '1' }), row({ id: '1' })]);
		expect(plan.summary.added).toBe(1);
		expect(plan.downloads).toHaveLength(1);
	});

	it('abandons a budget-blowing custom pattern for the rest of the run (ReDoS layer 2)', () => {
		// A pattern whose exec() is catastrophic: it spins for most of a second and then fails to
		// match, exactly like a nested-quantifier regex meeting a long filename.
		class SlowRegExp extends RegExp {
			exec(): RegExpExecArray | null {
				const until = performance.now() + 600;
				while (performance.now() < until) {
					/* busy-wait — a real ReDoS has no yield point either */
				}
				return null;
			}
		}
		const custom: RegExp = new SlowRegExp('(?<title>.+)');
		const rows = ['1', '2', '3', '4', '5'].map((id) =>
			row({ id, displayName: `Artist ${id} - Song ${id}.mp3` })
		);
		const t0 = performance.now();
		const plan = syncDevice([], rows, rules(), { complete: true, custom });
		const elapsed = performance.now() - t0;

		expect(plan.summary.patternFellBack).toBe(true);
		expect(plan.summary.added).toBe(5);
		// Row 5 is the one parsed AFTER the fallback: the presets still produced a real title.
		expect(plan.downloads[4].title).toBe('Song 5');
		expect(elapsed).toBeLessThan(3000);
	});

	// ── quick-260919-30x: the exclusion set the scan honours ─────────────────────────────────────
	it('does not add an excluded row and counts it under skippedExcluded', () => {
		const plan = syncDevice(
			[],
			[row({ id: '7' }), row({ id: '8', displayName: 'Daft Punk - Da Funk.mp3' })],
			rules(),
			{ complete: true, custom: null, excluded: new Set([deviceUid('7')]) }
		);
		expect(uids(plan.downloads)).not.toContain(deviceUid('7'));
		expect(uids(plan.downloads)).toContain(deviceUid('8'));
		expect(plan.summary.skippedExcluded).toBe(1);
		expect(plan.summary.added).toBe(1);
	});

	it('the buckets still add up to the unique row count with skippedExcluded included', () => {
		const rows = [
			row({ id: '1', relativePath: 'Ringtones/' }),
			row({ id: '2', displayName: 'x.opus' }),
			row({ id: '3', durationMs: 1_000 }),
			row({ id: '4', displayName: 'Voice Memo.mp3' }),
			row({ id: '5' }),
			row({ id: '6', displayName: 'Daft Punk - Da Funk.mp3' }),
			row({ id: '6', displayName: 'Daft Punk - Da Funk.mp3' }) // paging overlap — not unique
		];
		const plan = syncDevice([dev('5')], rows, rules({ minSeconds: 30, skipRules: ['voice memo'] }), {
			complete: true,
			custom: null,
			excluded: new Set([deviceUid('6')])
		});
		const s = plan.summary;
		const total =
			s.added +
			s.relinked +
			s.already +
			s.skippedShort +
			s.skippedExt +
			s.skippedRule +
			s.skippedOutside +
			s.skippedExcluded;
		expect(s.skippedExcluded).toBe(1);
		expect(total).toBe(6); // 7 rows, one a paging duplicate
	});

	// THE TEST THAT MAKES THE FEATURE STICK. An already-imported entry the user marked is never
	// `seen`, so a COMPLETE scan drops it through the existing D-07/D-08 lane — no second removal
	// path, and marking a song without removing it first still takes it out of the library.
	it('drops an already-imported entry that is now excluded (D-07/D-08 lane, no new code)', () => {
		const plan = syncDevice([dev('7'), dev('8')], [row({ id: '7' }), row({ id: '8' })], rules(), {
			complete: true,
			custom: null,
			excluded: new Set([deviceUid('7')])
		});
		expect(uids(plan.downloads)).not.toContain(deviceUid('7'));
		expect(uids(plan.downloads)).toContain(deviceUid('8'));
		expect(plan.summary.removed).toBe(1);
		expect(plan.summary.skippedExcluded).toBe(1);
		expect(plan.summary.already).toBe(1);
	});

	it('an INCOMPLETE scan still keeps an excluded entry listed (D-08 outranks the mark)', () => {
		// D-08 forbids inferring "gone" from a walk that never finished — a mark must not become the
		// loophole that lets a cancelled scan delete library rows.
		const plan = syncDevice([dev('7')], [row({ id: '7' })], rules(), {
			complete: false,
			custom: null,
			excluded: new Set([deviceUid('7')])
		});
		expect(uids(plan.downloads)).toContain(deviceUid('7'));
		expect(plan.summary.removed).toBe(0);
	});

	it('omitting opts.excluded is identical to passing an empty set (D-10)', () => {
		const rows = [row({ id: '1' }), row({ id: '2', displayName: 'Daft Punk - Da Funk.mp3' })];
		const a = syncDevice([], rows, rules(), { complete: true, custom: null });
		const b = syncDevice([], rows, rules(), { complete: true, custom: null, excluded: new Set() });
		expect(a.summary).toEqual(b.summary);
		expect(uids(a.downloads)).toEqual(uids(b.downloads));
	});

	it('is total over empty and malformed input', () => {
		const plan = syncDevice([], [], DEFAULT_IMPORT_RULES, { complete: true, custom: null });
		expect(plan.downloads).toEqual([]);
		expect(plan.relink).toEqual([]);
		expect(plan.summary).toEqual(emptySummary(DEFAULT_IMPORT_RULES));
	});
});
