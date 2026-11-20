// embed-cover — the downscale is browser-only (createImageBitmap/canvas), so the node suite
// covers the pure size math plus the never-throw contract: bad input and missing decode APIs
// both resolve null instead of rejecting.
import { describe, expect, it } from 'vitest';
import { containSize, downscaleCoverImage } from './embed-cover';

describe('containSize (pure)', () => {
	it('contain-fits the long edge to maxPx, never upscales', () => {
		expect(containSize(800, 600, 192)).toEqual({ w: 192, h: 144 });
		expect(containSize(600, 800, 192)).toEqual({ w: 144, h: 192 });
		expect(containSize(100, 100, 192)).toEqual({ w: 100, h: 100 }); // no upscale
		expect(containSize(192, 192, 192)).toEqual({ w: 192, h: 192 });
	});

	it('degenerate input yields 0×0 (caller treats as failure)', () => {
		expect(containSize(0, 100, 192)).toEqual({ w: 0, h: 0 });
		expect(containSize(100, -5, 192)).toEqual({ w: 0, h: 0 });
		expect(containSize(100, 100, 0)).toEqual({ w: 0, h: 0 });
		expect(containSize(NaN, 100, 192)).toEqual({ w: 0, h: 0 });
	});
});

describe('downscaleCoverImage (never-throw contract)', () => {
	it('rejects non-inline input without throwing', async () => {
		await expect(downscaleCoverImage('')).resolves.toBeNull();
		await expect(downscaleCoverImage('https://img/cover.jpg')).resolves.toBeNull();
		await expect(downscaleCoverImage('data:text/plain;base64,AAAA')).resolves.toBeNull();
		await expect(downscaleCoverImage('data:image/png;base64,')).resolves.toBeNull();
	});

	it('returns null (not a rejection) when no decode API exists — the node/SSR path', async () => {
		// A well-formed tiny PNG data URL: node fetch() CAN decode the data: URL to a Blob, but
		// createImageBitmap / Image / OffscreenCanvas / document are all absent here.
		const tiny =
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
		await expect(downscaleCoverImage(tiny)).resolves.toBeNull();
	});
});
