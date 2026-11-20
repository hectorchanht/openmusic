import { describe, it, expect } from 'vitest';
import {
	proxyRescueTarget,
	shouldRescueViaProxy,
	isProxyStreamSrc,
	kuwoLevelForTrack,
	PROXY_RESCUE_HOLD_COUNT,
	type ProxyRescueTarget
} from './proxy-rescue';

const kuwoTrack = { source: 'kuwo', songid: '493469900', quality: '320k' };

describe('proxy-rescue — target building', () => {
	it('builds the own-origin stream URL for a kuwo track at the playing tier', () => {
		expect(proxyRescueTarget(kuwoTrack, '320')).toEqual({
			url: '/api/kuwo/stream/493469900?level=320k',
			level: '320k'
		});
	});

	it('honours a 128 preference as the 128k tier', () => {
		expect(proxyRescueTarget(kuwoTrack, '128')?.level).toBe('128k');
	});

	it('a lossless-tagged track rescues at the zp tier even under a lossy preference (the encode playing is lossless)', () => {
		expect(proxyRescueTarget({ ...kuwoTrack, quality: 'lossless' }, '320')?.level).toBe('zp');
	});

	it('auto preference resolves through effectiveQuality (no connection info → 320k)', () => {
		expect(proxyRescueTarget(kuwoTrack, 'auto')?.level).toBe('320k');
	});

	it('returns null for non-kuwo sources (this ship wires kuwo only)', () => {
		expect(proxyRescueTarget({ source: 'qq', songid: '12345', quality: null }, '320')).toBeNull();
		expect(proxyRescueTarget({ source: 'netease', songid: '12345', quality: null }, '320')).toBeNull();
	});

	it('returns null for a non-numeric songid (the route would 400 it anyway)', () => {
		expect(proxyRescueTarget({ source: 'kuwo', songid: 'BGH1', quality: null }, '320')).toBeNull();
		expect(proxyRescueTarget({ source: 'kuwo', songid: '', quality: null }, '320')).toBeNull();
	});
});

describe('proxy-rescue — level derivation', () => {
	it('maps preferences exactly like the kuwo resolver (128→128k, everything lossy→320k)', () => {
		expect(kuwoLevelForTrack(kuwoTrack, '128')).toBe('128k');
		expect(kuwoLevelForTrack(kuwoTrack, '320')).toBe('320k');
		// A 'lossless' preference whose track actually resolved to an mp3 encode (tag 320k)
		// proxies the tier that is PLAYING, not the tier that was requested.
		expect(kuwoLevelForTrack(kuwoTrack, 'lossless')).toBe('320k');
	});
});

describe('proxy-rescue — trigger policy', () => {
	const target: ProxyRescueTarget = { url: '/api/kuwo/stream/493469900?level=320k', level: '320k' };
	const base = { target, currentSrc: 'https://car-er.kuwo.cn/x/y.mp3', alreadyRescued: false };

	it('does NOT rescue on the first hold, even at the hold-start check (first wobbles are free)', () => {
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-start', holdCount: 1 } })).toBe(false);
	});

	it('rescues when the same track stalls into its second hold', () => {
		expect(
			shouldRescueViaProxy({ ...base, phase: { kind: 'hold-start', holdCount: PROXY_RESCUE_HOLD_COUNT } })
		).toBe(true);
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-start', holdCount: 3 } })).toBe(true);
	});

	it('rescues after a hold that TIMES OUT (direct measurably cannot carry the track)', () => {
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-end', outcome: 'timeout' } })).toBe(true);
	});

	it('does NOT rescue after a hold that recovered (direct proved it can still carry the track)', () => {
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-end', outcome: 'ready' } })).toBe(false);
	});

	it('does NOT rescue on an error outcome (the error/failover chain owns dead bytes)', () => {
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-end', outcome: 'error' } })).toBe(false);
		expect(shouldRescueViaProxy({ ...base, phase: { kind: 'hold-end', outcome: 'superseded' } })).toBe(false);
	});

	it('never rescues twice for the same play, and never rescues a rescue', () => {
		expect(
			shouldRescueViaProxy({ ...base, alreadyRescued: true, phase: { kind: 'hold-end', outcome: 'timeout' } })
		).toBe(false);
		expect(
			shouldRescueViaProxy({
				...base,
				currentSrc: 'https://openmusic.lol/api/kuwo/stream/493469900?level=320k',
				phase: { kind: 'hold-end', outcome: 'timeout' }
			})
		).toBe(false);
	});

	it('never rescues without a target', () => {
		expect(
			shouldRescueViaProxy({ ...base, target: null, phase: { kind: 'hold-end', outcome: 'timeout' } })
		).toBe(false);
	});
});

describe('proxy-rescue — isProxyStreamSrc', () => {
	it('detects own-origin proxy srcs (relative or absolute) and nothing else', () => {
		expect(isProxyStreamSrc('/api/kuwo/stream/493469900?level=320k')).toBe(true);
		expect(isProxyStreamSrc('https://openmusic.lol/api/kuwo/stream/493469900?level=320k')).toBe(true);
		expect(isProxyStreamSrc('https://car-er.kuwo.cn/x/y.mp3')).toBe(false);
		expect(isProxyStreamSrc('blob:https://openmusic.lol/abc')).toBe(false);
		expect(isProxyStreamSrc(null)).toBe(false);
		expect(isProxyStreamSrc(undefined)).toBe(false);
	});
});
