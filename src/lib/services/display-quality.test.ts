import { describe, it, expect } from 'vitest';
import type { Track } from '$lib/sources/types';
import {
	displayQualityLabel,
	trackQualityLabel,
	trackSourceLabel,
	withDownloadQuality,
	type QualityPair
} from './display-quality';

// display-quality is the ONE derivation behind the Now-Playing quality pill, the Track
// detail sheet's Quality row and the VersionPicker rows (quick-261102-qtruth). These tests
// pin the precedence every surface now shares — download record > resolved stamps > stub
// claim — against Hector's 2026-11-02 report: one joox track whose pill said 320K while
// its Detail sheet said LOSSLESS.

function mk(over: Partial<Track> = {}): Track {
	return {
		uid: 'joox:Z7AFBA4F9E9E24',
		source: 'joox',
		songid: 'Z7AFBA4F9E9E24',
		title: '最後一次',
		artist: '高爾宣 OSN',
		album: '最後一次',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '高爾宣 OSN 最後一次',
		displayIndex: 1,
		...over
	};
}

const LOSSLESS: QualityPair = { quality: 'lossless', qualityLabel: 'LOSSLESS' };
const K320: QualityPair = { quality: '320k', qualityLabel: '320K' };

describe('displayQualityLabel — resolved truth beats the stub claim', () => {
	it('a stub stamped 320K displays LOSSLESS once the resolved object is what is read', () => {
		// The stub/search-era object claims the 320 tier…
		const stub = mk({ quality: '320k', qualityLabel: '320K' });
		expect(displayQualityLabel(stub, null)).toBe('320K');
		// …but play() installs the RESOLVED object as current, and joox's resolver stamps
		// the lossless tier it actually picked (label LOSSLESS). Reading the live object —
		// never a snapshot copy — is what makes the pill agree with the Detail sheet.
		const resolved = mk({
			detailsLoaded: true,
			audioUrl: 'https://hk.stream.music.joox.com/0800Z7AFBA4F9E9E24.ogg?vkey=x',
			quality: 'lossless',
			qualityLabel: 'LOSSLESS'
		});
		expect(displayQualityLabel(resolved, null)).toBe('LOSSLESS');
	});

	it('a track that resolves to a plain 320K stream still displays 320K', () => {
		const resolved = mk({
			detailsLoaded: true,
			audioUrl: 'https://cdn.example.com/a.mp3',
			quality: '320k',
			qualityLabel: '320K'
		});
		expect(displayQualityLabel(resolved, null)).toBe('320K');
	});

	it('falls back to the raw tier when the source gives no label wording', () => {
		expect(displayQualityLabel(mk({ quality: 'lossless', qualityLabel: null }), null)).toBe('lossless');
		expect(trackQualityLabel(mk({ quality: null, qualityLabel: 'FLAC' }))).toBe('FLAC');
	});

	it('an unresolved stub with no tier displays nothing (no empty pill)', () => {
		expect(displayQualityLabel(mk(), null)).toBeNull();
		expect(displayQualityLabel(null, null)).toBeNull();
		expect(displayQualityLabel(undefined, LOSSLESS)).toBeNull();
	});
});

describe('displayQualityLabel — the download record wins (abq3 precedence)', () => {
	it('Hector’s case: current stamped 320K + a LOSSLESS download record → LOSSLESS', () => {
		// player.current can carry a stale 320K stamp (persisted snapshot, or a stream
		// resolve whose src was superseded by the downloaded file). The Detail sheet has
		// always merged the record; the pill now derives through the same precedence.
		const current = mk({ detailsLoaded: true, quality: '320k', qualityLabel: '320K' });
		expect(displayQualityLabel(current, LOSSLESS)).toBe('LOSSLESS');
	});

	it('a downloaded track still displays its download-record quality over a fresh re-resolve', () => {
		// A fresh resolve reports the source's current STREAMING tier (320K here); the file
		// on disk is the FLAC the user actually holds, so the record wins.
		const reresolved = mk({ detailsLoaded: true, quality: '320k', qualityLabel: '320K' });
		const merged = withDownloadQuality(reresolved, LOSSLESS);
		expect(merged.quality).toBe('lossless');
		expect(merged.qualityLabel).toBe('LOSSLESS');
		expect(trackQualityLabel(merged)).toBe('LOSSLESS');
	});

	it('a record carrying a LOWER tier still wins — it describes the file that plays', () => {
		const current = mk({ quality: 'lossless', qualityLabel: 'LOSSLESS' });
		expect(displayQualityLabel(current, K320)).toBe('320K');
	});

	it('no record (or a record with no quality info) never blanks a good label', () => {
		const current = mk({ quality: '320k', qualityLabel: '320K' });
		expect(withDownloadQuality(current, null)).toBe(current);
		expect(withDownloadQuality(current, { quality: null, qualityLabel: null })).toBe(current);
		expect(displayQualityLabel(current, null)).toBe('320K');
	});

	it('a record identical to the track stamps returns the same object (no churn)', () => {
		const current = mk({ quality: 'lossless', qualityLabel: 'LOSSLESS' });
		expect(withDownloadQuality(current, LOSSLESS)).toBe(current);
	});
});

describe('trackSourceLabel — the Now-Playing source pill', () => {
	it('reads the registry adapter label, the Play-from-source sheet wording', () => {
		expect(trackSourceLabel(mk())).toBe('JOOX');
		expect(trackSourceLabel(mk({ source: 'gdnetease', uid: 'gdnetease:1', songid: '1' }))).toBe(
			'Netease（GD）'
		);
		expect(trackSourceLabel(mk({ source: 'suyin', uid: 'suyin:1', songid: '1' }))).toBe('Kuwo（溯音）');
	});

	it('follows the CURRENT track — a fallback swap changes the label', () => {
		// The pill derives from player.current; play() installs the fallback swap as
		// current, so the label must be the swap’s source, not the tapped stub’s.
		const tapped = mk({ source: 'qq', uid: 'qq:1', songid: '1' });
		const swap = mk({ source: 'joox' });
		expect(trackSourceLabel(tapped)).toBe('QQ 音乐');
		expect(trackSourceLabel(swap)).toBe('JOOX');
		expect(trackSourceLabel(swap)).not.toBe(trackSourceLabel(tapped));
	});

	it('null track → null (no pill)', () => {
		expect(trackSourceLabel(null)).toBeNull();
		expect(trackSourceLabel(undefined)).toBeNull();
	});
});
