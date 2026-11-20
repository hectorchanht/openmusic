import { describe, it, expect } from 'vitest';
import { MAX_UPLOAD_BYTES, screenLogPayload, diagKey, isDiagKey } from './diag-payload';
import { ACTION_LOG_CAP, serializeActionLog } from '$lib/diagnostics/action-log-logic';
import type { ActionLogEntry } from '$lib/diagnostics/action-log-logic';

// The server-side screen for an UNTRUSTED request body, plus the R2 key helpers. Everything here
// runs before a byte is written to (or read from) the bucket, so each case below is a way someone
// could have made the endpoint do work it should refuse to do.

describe('screenLogPayload — rejects bodies with nothing to store', () => {
	it('rejects an empty body', () => {
		expect(screenLogPayload('')).toBeNull();
	});

	// A syntactically fine but empty log. Storing it burns an R2 object for zero diagnostic value.
	it('rejects an empty array', () => {
		expect(screenLogPayload('[]')).toBeNull();
	});

	it('rejects a body that is not JSON', () => {
		expect(screenLogPayload('not json')).toBeNull();
	});

	it('rejects valid JSON that is not an array', () => {
		expect(screenLogPayload('{"a":1}')).toBeNull();
		expect(screenLogPayload('"a string"')).toBeNull();
	});

	// parseActionLog filters per entry, so an array of junk parses to [] — which is still nothing.
	it('rejects an array whose entries are all malformed', () => {
		expect(screenLogPayload('[{"x":1}]')).toBeNull();
		expect(screenLogPayload('[null,1,"a"]')).toBeNull();
	});
});

describe('screenLogPayload — size cap (T-33-04)', () => {
	it('caps at 512 KiB', () => {
		expect(MAX_UPLOAD_BYTES).toBe(512 * 1024);
	});

	it('rejects an oversize body', () => {
		expect(screenLogPayload('x'.repeat(MAX_UPLOAD_BYTES + 1))).toBeNull();
	});

	// The ordering case: this body is a perfectly VALID log, so the only thing that can reject it is
	// a length screen that runs BEFORE the parse. Parsing half a megabyte first is what blows the
	// Workers free-tier 10 ms CPU budget and turns a clean 413 into an opaque 5xx (Pitfall 4).
	it('rejects an oversize body that would otherwise parse fine', () => {
		const fat = 'y'.repeat(MAX_UPLOAD_BYTES);
		const text = serializeActionLog([{ t: 1, ev: 'a', d: { pad: fat } }]);
		expect(text.length).toBeGreaterThan(MAX_UPLOAD_BYTES);
		expect(screenLogPayload(text)).toBeNull();
	});

	it('accepts a body exactly at the cap boundary if it is a valid log', () => {
		const base = serializeActionLog([{ t: 1, ev: 'a', d: { pad: '' } }]);
		const pad = 'y'.repeat(MAX_UPLOAD_BYTES - base.length);
		const text = serializeActionLog([{ t: 1, ev: 'a', d: { pad } }]);
		expect(text.length).toBe(MAX_UPLOAD_BYTES);
		expect(screenLogPayload(text)).toBe(1);
	});
});

describe('screenLogPayload — accepts a real payload and reports its entry count', () => {
	it('returns the entry count for a genuine serializeActionLog payload', () => {
		const entries: ActionLogEntry[] = [
			{ t: 1, ev: 'a' },
			{ t: 2, ev: 'b', d: { ms: 1 }, n: 3, tl: 5 }
		];
		expect(screenLogPayload(serializeActionLog(entries))).toBe(2);
	});

	// The count is of VALID entries — parseActionLog drops the junk row, so a partially-corrupt log
	// still uploads rather than being lost, which is the whole point of a diagnostic channel.
	it('counts only the well-shaped entries', () => {
		expect(screenLogPayload('[{"t":1,"ev":"a"},{"bad":true}]')).toBe(1);
	});

	// More entries than the client's ring buffer can physically hold means the body did not come
	// from our own log, so there is no reason to store it.
	it('rejects more entries than the client ring buffer can hold', () => {
		const tooMany: ActionLogEntry[] = Array.from({ length: ACTION_LOG_CAP + 1 }, (_, i) => ({
			t: i,
			ev: 'e'
		}));
		expect(screenLogPayload(serializeActionLog(tooMany))).toBeNull();
		expect(screenLogPayload(serializeActionLog(tooMany.slice(1)))).toBe(ACTION_LOG_CAP);
	});
});

describe('diagKey — chronological == lexicographic', () => {
	it('formats the key with a colon/dot-free ISO stamp and an 8-char suffix', () => {
		expect(diagKey(Date.UTC(2026, 8, 12, 14, 3, 22, 123), 'a1b2c3d4-ffff-4444-8888-aaaabbbbcccc')).toBe(
			'log/2026-09-12T14-03-22-123Z-a1b2c3d4.json'
		);
	});

	// R2 lists keys in lexicographic UTF-8 order and offers no "sort by time", so the timestamp
	// prefix IS the ordering. A colon or dot in the key would also make it awkward to handle.
	it('sorts a later key after an earlier one', () => {
		const early = diagKey(Date.UTC(2026, 0, 1, 0, 0, 0, 0), 'aaaaaaaa');
		const late = diagKey(Date.UTC(2026, 8, 12, 14, 3, 22, 123), 'aaaaaaaa');
		expect([late, early].sort()).toEqual([early, late]);
	});

	it('distinguishes two uploads landing in the same millisecond', () => {
		const now = Date.UTC(2026, 8, 12, 14, 3, 22, 123);
		expect(diagKey(now, 'aaaaaaaa')).not.toBe(diagKey(now, 'bbbbbbbb'));
	});
});

describe('isDiagKey — screens an untrusted ?key= (T-33-09)', () => {
	it('accepts what diagKey produces', () => {
		expect(isDiagKey(diagKey(Date.now(), 'a1b2c3d4-ffff'))).toBe(true);
	});

	// The traversal attempt this guard exists for. R2 keys are a flat namespace so `..` has no
	// special meaning there, which makes this defence-in-depth rather than the only line — but it
	// also means the read endpoint can only ever return objects the upload endpoint could have written.
	it('rejects traversal, foreign prefixes and anything else off-shape', () => {
		for (const bad of [
			null,
			'',
			'log/../x.json',
			'../log/x.json',
			'other/a.json',
			'a.json',
			'log/a b.json',
			'log/a.json?x',
			'log/sub/a.json',
			'log/a.txt',
			'log/.json',
			'log/a.json/'
		]) {
			expect(isDiagKey(bad)).toBe(false);
		}
	});
});
