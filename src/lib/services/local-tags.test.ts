import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import * as mod from './local-tags';
import { localEnrichment, forgetLocalEnrichment, __resetLocalTagsMemo } from './local-tags';
import { writeAudioTags, dataUrlToBytes, TAG_MAX_BYTES } from './audio-tags';
import { MAX_ART_BYTES } from './media-artwork';

/**
 * 37-02 Task 1. The blob that reaches `localEnrichment` in production is the exact blob the player
 * already holds (`blobStore.get`), so every case here is built the same way the app builds one:
 * write real tags into a real container with `writeAudioTags`, wrap the bytes in a Blob, read back.
 *
 * The fixtures are the repo's own synthetic, licensing-clean containers (see
 * `__fixtures__/README.md`); addressed through `import.meta.url` so the suite ignores the cwd.
 */
function fixture(name: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

const MP3 = fixture('tiny.mp3');

/** A PNG header padded out to something a picture block will carry (audio-tags.test.ts idiom). */
const ART_BYTES = (() => {
	const b = new Uint8Array(64);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return b;
})();

/** Stamped, CJK, multi-line — `parseLRC` must yield lines for this one (37-D-07). */
const LRC = '[00:12.34]歌詞一\n[00:15.00]line two';

/** Build a playable-shaped Blob carrying exactly the tags a case needs. */
async function blobWith(
	fields: Parameters<typeof writeAudioTags>[1],
	art?: { data: Uint8Array; mimeType: string } | null
): Promise<Blob> {
	const out = await writeAudioTags(MP3, fields, art);
	expect(out).not.toBeNull();
	return new Blob([out!.bytes]);
}

beforeEach(() => __resetLocalTagsMemo());

describe('local-tags — module shape and purity', () => {
	it('exports only the memo service surface, named, with no default', () => {
		expect(Object.keys(mod).sort()).toEqual(['__resetLocalTagsMemo', 'forgetLocalEnrichment', 'localEnrichment']);
		expect((mod as Record<string, unknown>).default).toBeUndefined();
	});

	it('imports no runes store, no i18n and no $app', () => {
		const src = readFileSync(new URL('./local-tags.ts', import.meta.url), 'utf8')
			.split('\n')
			.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
			.join('\n');
		expect(src).not.toContain('$lib/stores');
		expect(src).not.toContain('$lib/i18n');
		expect(src).not.toContain('$app/');
	});
});

describe('local-tags — embedded LRC and art (the hit)', () => {
	it('returns the raw stamped LRC and a data: URL that round-trips to the original bytes', async () => {
		const blob = await blobWith({ title: 'T', artist: 'A', lyrics: LRC }, { data: ART_BYTES, mimeType: 'image/png' });
		const found = await localEnrichment('device:1', blob);
		expect(found.lrc).toBe(LRC);
		expect(found.art).toMatch(/^data:image\/png;base64,/);
		const back = dataUrlToBytes(found.art!);
		expect(back?.mimeType).toBe('image/png');
		expect(Array.from(back!.data)).toEqual(Array.from(ART_BYTES));
	});

	it('exposes the file`s own artist/title so the caller can query with them (37-D-05)', async () => {
		const blob = await blobWith({ title: '標題 Title', artist: 'Real Artist' });
		const found = await localEnrichment('device:names', blob);
		expect(found.artist).toBe('Real Artist');
		expect(found.title).toBe('標題 Title');
	});
});

describe('local-tags — what is REJECTED', () => {
	it('drops a plain-text lyric with no timestamps — parseLRC would render an empty pane (37-D-07)', async () => {
		const blob = await blobWith({ title: 'T', lyrics: 'no stamps here' });
		const found = await localEnrichment('device:plain', blob);
		expect(found.lrc).toBeNull();
	});

	it('drops a picture whose MIME is not an image (T-37-01)', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC }, { data: ART_BYTES, mimeType: 'text/html' });
		const found = await localEnrichment('device:badmime', blob);
		expect(found.art).toBeNull();
		expect(found.lrc).toBe(LRC); // the lyric is unaffected by the picture verdict
	});

	it('drops a picture over MAX_ART_BYTES but keeps the lyric (T-37-02)', async () => {
		const big = new Uint8Array(MAX_ART_BYTES + 1);
		big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const blob = await blobWith({ title: 'T', lyrics: LRC }, { data: big, mimeType: 'image/png' });
		const found = await localEnrichment('device:bigart', blob);
		expect(found.art).toBeNull();
		expect(found.lrc).toBe(LRC);
	});

	it('skips the decode ENTIRELY when the blob is over TAG_MAX_BYTES (T-37-03)', async () => {
		const blob = new Blob([MP3]);
		// A real 40 MB+ allocation is the thing the pre-check exists to avoid, so fake the size and
		// prove `arrayBuffer()` — the copy — is never reached.
		Object.defineProperty(blob, 'size', { value: TAG_MAX_BYTES + 1 });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		const found = await localEnrichment('device:huge', blob);
		expect(found).toMatchObject({ lrc: null, art: null });
		expect(spy).not.toHaveBeenCalled();
	});

	it('returns the empty result for an unrecognised container, never throws (Pitfall 10)', async () => {
		const found = await localEnrichment('device:junk', new Blob([new Uint8Array(64)]));
		expect(found).toMatchObject({ lrc: null, art: null });
	});
});

describe('local-tags — memo (37-D-06)', () => {
	it('decodes once across two calls for a HIT, and flags the replay as cached', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC }, { data: ART_BYTES, mimeType: 'image/png' });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		const first = await localEnrichment('device:memo-hit', blob);
		const second = await localEnrichment('device:memo-hit', blob);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(first.cached).toBeFalsy();
		expect(second.cached).toBe(true);
		expect(second.lrc).toBe(LRC);
		expect(second.art).toBe(first.art);
	});

	it('decodes once across two calls for a TOTAL MISS too — the negative memo is load-bearing', async () => {
		const blob = await blobWith({ title: 'T' }); // no lyrics, no picture
		const spy = vi.spyOn(blob, 'arrayBuffer');
		const first = await localEnrichment('device:memo-miss', blob);
		const second = await localEnrichment('device:memo-miss', blob);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(first).toMatchObject({ lrc: null, art: null });
		expect(second).toMatchObject({ lrc: null, art: null, cached: true });
	});

	it('keys per uid — a different song still decodes', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		await localEnrichment('device:a', blob);
		await localEnrichment('device:b', blob);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('__resetLocalTagsMemo clears the memo', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		await localEnrichment('device:reset', blob);
		__resetLocalTagsMemo();
		const again = await localEnrichment('device:reset', blob);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(again.cached).toBeFalsy();
	});

	it('evicts the oldest entry past the cap so a big data: URL is not retained forever', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		// 8 distinct uids against a 6-entry FIFO: the first two are evicted, so re-asking for the
		// oldest decodes again while a recent one still answers from the memo.
		for (let i = 0; i < 8; i++) await localEnrichment(`device:evict-${i}`, blob);
		expect(spy).toHaveBeenCalledTimes(8);
		expect((await localEnrichment('device:evict-7', blob)).cached).toBe(true);
		expect((await localEnrichment('device:evict-0', blob)).cached).toBeFalsy();
		expect(spy).toHaveBeenCalledTimes(9);
	});
});

// quick-260919-1eh — a retag REWRITES the bytes under a uid the memo is already keyed by, so the
// rewriter has to be able to drop exactly that one entry. Per-uid, not __resetLocalTagsMemo(): the
// other five entries describe files nobody touched and re-decoding them costs the wasm pass again.
describe('local-tags — forgetLocalEnrichment (per-uid eviction after a rewrite)', () => {
	it('drops exactly that uid — it re-decodes, a sibling still answers from the memo', async () => {
		const blob = await blobWith({ title: 'T', lyrics: LRC });
		const spy = vi.spyOn(blob, 'arrayBuffer');
		await localEnrichment('netease:edited', blob);
		await localEnrichment('netease:untouched', blob);
		expect(spy).toHaveBeenCalledTimes(2);

		forgetLocalEnrichment('netease:edited');

		expect((await localEnrichment('netease:edited', blob)).cached).toBeFalsy();
		expect(spy).toHaveBeenCalledTimes(3);
		expect((await localEnrichment('netease:untouched', blob)).cached).toBe(true);
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it('an unknown uid is a harmless no-op (never throws)', () => {
		expect(() => forgetLocalEnrichment('netease:never-seen')).not.toThrow();
	});
});
