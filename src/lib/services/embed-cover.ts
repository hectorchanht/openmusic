// embed-cover — downscale an embedded `data:` front cover to a quota-safe cache copy.
//
// WHY THIS EXISTS (quick-261008-cov1): a downloaded file's embedded front cover is art the
// player SHOWS — the hero, the nowbar and the OS media card all paint it — but it is
// memory-only by design: the cover cache is localStorage sized for ~80–150-byte https
// entries, and ONE full-res `data:` URL in there silently stops all cover caching for the
// session (37-D-02). Hector's 2026-10-08 directive: a fetched-and-shown cover shows EVERYWHERE
// the song appears — song rows included. So when the player adopts embedded art it also stows
// a DOWNSCALED copy (bounded JPEG, ~10 KB) in the shared uid + name cache layers via
// writeCoverBoth, and every row repaints through the coverVersion() signal it already takes.
//
// The full-res `data:` URL stays memory-only on player.resolvedCover — the hero keeps full
// quality. The downscaled copy is what rows (ROW_COVER_PX=200) and any later non-download play
// read from the cache. Never throws: any failure (no canvas, undecodable bytes, SSR) returns
// null and the rows keep their gradient.

import { bytesToBase64 } from './media-artwork';

/** JPEG quality for the downscaled copy — covers are opaque, JPEG is ~3× smaller than PNG. */
const JPEG_QUALITY = 0.7;

/** Only inline image data: URLs are downscalable — never http(s) (nothing to gain) or other schemes. */
const INLINE_IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,/i;

/**
 * Pure size math, exported for tests: contain-fit a `w`×`h` image into a `maxPx` box, never
 * upscaling. Returns `{ w: 0, h: 0 }` on degenerate input (the caller treats that as failure).
 */
export function containSize(w: number, h: number, maxPx: number): { w: number; h: number } {
	if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(maxPx) || w <= 0 || h <= 0 || maxPx <= 0)
		return { w: 0, h: 0 };
	const s = Math.min(1, maxPx / Math.max(w, h));
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Downscale an inline image `data:` URL to a bounded JPEG `data:` URL (`maxPx` on the long
 * edge, contain-fit, never upscaled). Returns null on ANY failure — wrong scheme, no decode
 * or canvas API available (node/SSR), undecodable bytes. The caller treats null as "keep the
 * gradient"; it never throws into the playback path.
 */
export async function downscaleCoverImage(dataUrl: string, maxPx = 192): Promise<string | null> {
	try {
		if (typeof dataUrl !== 'string' || !INLINE_IMAGE_RE.test(dataUrl)) return null;
		// data: URL → Blob. fetch() supports data: URLs in every target browser (incl. the
		// Capacitor WebView) and avoids a manual base64 decode.
		const blob = await (await fetch(dataUrl)).blob();
		if (!blob.size) return null;
		// Decode. createImageBitmap is worker-safe; fall back to <img> where it is missing.
		let bmp: ImageBitmap | null = null;
		let img: HTMLImageElement | null = null;
		if (typeof createImageBitmap === 'function') {
			bmp = await createImageBitmap(blob);
		} else if (typeof Image !== 'undefined' && typeof URL !== 'undefined') {
			img = await new Promise<HTMLImageElement>((resolve, reject) => {
				const el = new Image();
				const url = URL.createObjectURL(blob);
				el.onload = () => {
					URL.revokeObjectURL(url);
					resolve(el);
				};
				el.onerror = () => {
					URL.revokeObjectURL(url);
					reject(new Error('decode'));
				};
				el.src = url;
			});
		} else {
			return null; // node/SSR — no image decode API
		}
		const sw = bmp ? bmp.width : (img as HTMLImageElement).naturalWidth;
		const sh = bmp ? bmp.height : (img as HTMLImageElement).naturalHeight;
		const { w, h } = containSize(sw, sh, maxPx);
		if (!w || !h) return null;
		// Draw. OffscreenCanvas where available (no DOM needed), else a detached <canvas>.
		let canvas: OffscreenCanvas | HTMLCanvasElement;
		if (typeof OffscreenCanvas !== 'undefined') {
			canvas = new OffscreenCanvas(w, h);
		} else if (typeof document !== 'undefined') {
			canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
		} else {
			return null;
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.drawImage((bmp ?? img) as CanvasImageSource, 0, 0, w, h);
		if (bmp && typeof bmp.close === 'function') bmp.close();
		// Encode. convertToBlob where available, else the toBlob callback spelling.
		const out: Blob | null = await new Promise((resolve) => {
			const off = canvas as OffscreenCanvas;
			if (typeof off.convertToBlob === 'function') {
				off.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }).then(resolve, () => resolve(null));
			} else {
				(canvas as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY);
			}
		});
		if (!out || !out.size) return null;
		const bytes = new Uint8Array(await out.arrayBuffer());
		if (!bytes.length) return null;
		return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
	} catch {
		return null; // never throws — the playback path must not break on art handling
	}
}
