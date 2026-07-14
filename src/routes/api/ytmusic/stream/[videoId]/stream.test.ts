import { describe, it, expect } from 'vitest';
import { selectAudioFormat, isPlayable } from './+server';
import fixture from './__fixtures__/player-response.json';

// The itag-140 (AAC-LC / mp4) direct url and the itag-251 (Opus/webm) url from the OK fixture.
const OK = fixture.ok;
const ITAG_140_URL = OK.streamingData.adaptiveFormats.find((f) => f.itag === 140)!.url!;
const ITAG_251_URL = OK.streamingData.adaptiveFormats.find((f) => f.itag === 251)!.url!;
const ITAG_139_URL = fixture.fallbackNoAac140.streamingData.adaptiveFormats.find(
	(f) => f.itag === 139
)!.url!;

describe('selectAudioFormat — itag-140 AAC selection (never Opus, never ciphered)', () => {
	it('returns the itag-140 (AAC/mp4) direct url for an OK player response', () => {
		expect(selectAudioFormat(OK)).toBe(ITAG_140_URL);
	});

	it('never returns the itag-251 (Opus/webm) url — iOS Safari <audio> cannot play it', () => {
		const chosen = selectAudioFormat(OK);
		expect(chosen).not.toBe(ITAG_251_URL);
		expect(chosen).toBe(ITAG_140_URL);
	});

	it('falls back to the highest-bitrate audio/mp4 direct url when itag 140 is absent', () => {
		// fallbackNoAac140 has an Opus itag-251 (higher bitrate, wrong container) + an mp4 itag-139.
		// The Opus format must be skipped; the mp4 fallback (itag 139) is chosen.
		expect(selectAudioFormat(fixture.fallbackNoAac140)).toBe(ITAG_139_URL);
	});

	it('returns null for a ciphered-only format (no direct url to proxy)', () => {
		expect(selectAudioFormat(fixture.cipheredOnly)).toBeNull();
	});

	it('returns null for a LOGIN_REQUIRED response (no streamable formats)', () => {
		expect(selectAudioFormat(fixture.loginRequired)).toBeNull();
	});

	it('returns null for a null / malformed body', () => {
		expect(selectAudioFormat(null)).toBeNull();
		expect(selectAudioFormat({})).toBeNull();
	});
});

describe('isPlayable — playabilityStatus gate', () => {
	it('is true only when playabilityStatus.status === "OK"', () => {
		expect(isPlayable(OK)).toBe(true);
	});

	it('is false for LOGIN_REQUIRED (bot gate)', () => {
		expect(isPlayable(fixture.loginRequired)).toBe(false);
	});

	it('is false for a null / malformed body', () => {
		expect(isPlayable(null)).toBe(false);
		expect(isPlayable({})).toBe(false);
	});
});
