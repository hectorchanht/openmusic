import { describe, it, expect, vi, afterEach } from 'vitest';

// DL-BUG-01 seam (D-02/D-09): `saveBlobToDisk` is the anchor-download replacement for the buggy
// save flow (showSaveFilePicker prompt + window.open new-tab fallback) in TrackMenu/album. The
// Vitest project has no jsdom, so the fix is proven at THIS pure/DOM-thin service seam: the failure
// path is a `return false`, never a navigation. `doc` is injectable so the node test drives it with
// a fake document (createElement/click) + a stubbed URL object-URL API.
import * as mod from './download-save';
import { saveBlobToDisk } from './download-save';

// A minimal fake <a> + document.createElement, plus a stubbed URL.createObjectURL/revokeObjectURL —
// the vi.stubGlobal shim idiom mirrors blob-store.test.ts.
function makeFakeDoc() {
	const click = vi.fn();
	const anchor = { download: '', href: '', click } as unknown as HTMLAnchorElement;
	const createElement = vi.fn((_tag: string) => anchor);
	const doc = { createElement } as unknown as Document;
	return { doc, anchor, click, createElement };
}

function stubUrl() {
	const createObjectURL = vi.fn((_b: Blob) => 'blob:fake-object-url');
	const revokeObjectURL = vi.fn((_u: string) => undefined);
	vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
	return { createObjectURL, revokeObjectURL };
}

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('download-save — module shape', () => {
	it('exports exactly saveBlobToDisk (named, no default)', () => {
		expect(typeof saveBlobToDisk).toBe('function');
		expect(Object.keys(mod)).toEqual(['saveBlobToDisk']);
		expect((mod as Record<string, unknown>).default).toBeUndefined();
	});
});

describe('download-save — saveBlobToDisk happy path', () => {
	it('creates an <a>, sets download + object-URL href, clicks once, revokes, returns true', () => {
		const { createObjectURL, revokeObjectURL } = stubUrl();
		const { doc, anchor, click, createElement } = makeFakeDoc();
		const blob = new Blob(['audio-bytes']);

		const ok = saveBlobToDisk(blob, 'a - b.mp3', doc);

		expect(ok).toBe(true);
		expect(createElement).toHaveBeenCalledWith('a');
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(anchor.download).toBe('a - b.mp3');
		expect(anchor.href).toBe('blob:fake-object-url');
		expect(click).toHaveBeenCalledTimes(1);
		// the object URL is revoked (no leak) after the click
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-object-url');
	});
});

describe('download-save — saveBlobToDisk failure paths (DL-BUG-01: never navigate, never throw)', () => {
	it('returns false without throwing when createElement throws', () => {
		stubUrl();
		const throwingDoc = {
			createElement: vi.fn(() => {
				throw new Error('DOM broke');
			})
		} as unknown as Document;
		let ok: boolean | undefined;
		expect(() => {
			ok = saveBlobToDisk(new Blob(['a']), 'a - b.mp3', throwingDoc);
		}).not.toThrow();
		expect(ok).toBe(false);
	});

	it('returns false when the document is unavailable (default globalThis.document is undefined in node)', () => {
		const { createObjectURL } = stubUrl();
		const ok = saveBlobToDisk(new Blob(['a']), 'a - b.mp3', undefined);
		expect(ok).toBe(false);
		// no URL is minted when there is no DOM to attach the anchor to
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('returns false when the object-URL API is absent (no createObjectURL)', () => {
		// NOTE: Node 22's global `URL` DOES ship createObjectURL, so we must stub an object WITHOUT
		// it to exercise the guard (an SSR/native context lacking the object-URL API).
		vi.stubGlobal('URL', {});
		const { doc, createElement } = makeFakeDoc();
		const ok = saveBlobToDisk(new Blob(['a']), 'a - b.mp3', doc);
		expect(ok).toBe(false);
		expect(createElement).not.toHaveBeenCalled();
	});
});

describe('download-save — DL-BUG-01 guarantee: no navigation fallback in source', () => {
	it('the function source references neither window.open nor showSaveFilePicker on ANY path', () => {
		const src = saveBlobToDisk.toString();
		expect(src).not.toContain('window.open');
		expect(src).not.toContain('showSaveFilePicker');
	});
});
