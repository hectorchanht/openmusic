// pseudo-id + pseudonymous wire-contract tests (quick-261122-pseudo).
// Pins the client half of the guardrails:
//   - no ID exists while PSEUDO_ANALYTICS_LIVE is off (promise-first);
//   - the ID is a random UUID v4, stable across calls (1 profile = 1 user);
//   - "Reset my anonymous ID" yields a DIFFERENT ID (counts as a new user);
//   - the event ping carries only the ruled fields + pseudo_id, never
//     credentials, never an account/session token;
//   - account sync can never carry the pseudo-ID key (no join path).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ live: true }));
vi.mock('$lib/config/pseudo-analytics', () => ({
	get PSEUDO_ANALYTICS_LIVE() {
		return flag.live;
	}
}));

import { PSEUDO_ID_KEY, getPseudoId, resetPseudoId } from './pseudo-id';
import {
	trackLike,
	trackLyricsMissing,
	trackPlayFailure,
	trackPlayStart,
	trackSearchMiss,
	trackSessionStart
} from './analytics';
import { isPseudoId } from '$lib/services/pseudo-events';
import { selectedWantedKeys } from '$lib/services/sync';

const TRACK = { uid: 'qq:123', title: 'T', artist: 'A', source: 'qq' } as const;
let store: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	flag.live = true;
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
	fetchMock = vi.fn(async () => ({ ok: true }));
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
});
afterEach(() => vi.unstubAllGlobals());

function eventBodies() {
	return fetchMock.mock.calls
		.filter(([url]) => url === '/api/analytics/event')
		.map(([, init]) => ({ init: init as RequestInit, body: JSON.parse((init as RequestInit).body as string) }));
}

describe('pseudo-id', () => {
	it('generates nothing while the promise is not live', () => {
		flag.live = false;
		expect(getPseudoId()).toBeNull();
		expect(store.size).toBe(0);
	});

	it('is a stable random UUID v4 — one fresh profile, one ID', () => {
		const a = getPseudoId();
		expect(isPseudoId(a)).toBe(true);
		expect(getPseudoId()).toBe(a);
		expect(store.get(PSEUDO_ID_KEY)).toBe(a);
	});

	it('reset yields a different ID (counted as a new user)', () => {
		const a = getPseudoId();
		const b = resetPseudoId();
		expect(isPseudoId(b)).toBe(true);
		expect(b).not.toBe(a);
		expect(getPseudoId()).toBe(b);
	});

	it('a tampered stored value is replaced, never sent', () => {
		store.set(PSEUDO_ID_KEY, 'someone@example.com');
		expect(isPseudoId(getPseudoId())).toBe(true);
	});

	it('account sync can never carry the pseudo-ID key', () => {
		const all = { settings: true, library: true, history: true, searchHistory: true, nameTr: true, player: true };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(selectedWantedKeys(all as any, [PSEUDO_ID_KEY, 'openmusic:x'])).not.toContain(PSEUDO_ID_KEY);
	});
});

describe('pseudonymous event pings', () => {
	it('send nothing to /event while not live (counter pings unchanged)', () => {
		flag.live = false;
		trackPlayStart(TRACK);
		trackSearchMiss('x');
		trackSessionStart();
		expect(eventBodies()).toHaveLength(0);
		expect(fetchMock).toHaveBeenCalledTimes(1); // the /play counter ping only
	});

	it('play also posts a pseudonymous event with exactly the ruled fields', () => {
		trackPlayStart(TRACK);
		const [e] = eventBodies();
		expect(Object.keys(e.body).sort()).toEqual(
			['action', 'app_version', 'artist', 'platform', 'pseudo_id', 'song_id', 'source', 'title'].sort()
		);
		expect(e.body.action).toBe('play');
		expect(isPseudoId(e.body.pseudo_id)).toBe(true);
		expect(e.body.platform).toBe('mobile');
		expect(e.init.credentials).toBeUndefined();
		expect(e.init.keepalive).toBe(true);
	});

	it('the same profile sends the same pseudo_id across events', () => {
		trackPlayStart(TRACK);
		trackLike(TRACK, 'like');
		trackSessionStart();
		const ids = new Set(eventBodies().map((e) => e.body.pseudo_id));
		expect(ids.size).toBe(1);
	});

	it('v1 signal events carry their payloads', () => {
		trackSearchMiss('  包羅萬有 ');
		trackPlayFailure(TRACK, 'timeout');
		trackLyricsMissing(TRACK);
		trackSessionStart();
		const b = eventBodies().map((e) => e.body);
		expect(b[0]).toMatchObject({ action: 'search_miss', query: '包羅萬有' });
		expect(b[1]).toMatchObject({ action: 'play_failure', song_id: 'qq:123', source: 'qq', stage: 'timeout' });
		expect(b[2]).toMatchObject({ action: 'lyrics_missing', song_id: 'qq:123' });
		expect(b[3]).toMatchObject({ action: 'session_start' });
		expect(Object.keys(b[3]).sort()).toEqual(['action', 'app_version', 'platform', 'pseudo_id']);
	});

	it('a blank search is never reported', () => {
		trackSearchMiss('   ');
		expect(eventBodies()).toHaveLength(0);
	});
});
