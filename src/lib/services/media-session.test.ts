import { describe, it, expect } from 'vitest';
// Import ONLY the PURE module — NO runes, so the node Vitest project compiles it.
import { buildArtwork, safePositionState, playbackStateFor } from './media-session';

describe('buildArtwork (MS-01)', () => {
	it('maps a cover URL onto the full size ladder, every src === the cover URL', () => {
		const cover = 'https://cdn.example.com/art.jpg';
		const art = buildArtwork(cover);
		const sizes = art.map((a) => a.sizes);
		expect(sizes).toContain('96x96');
		expect(sizes).toContain('128x128');
		expect(sizes).toContain('256x256');
		expect(sizes).toContain('384x384');
		expect(sizes).toContain('512x512');
		expect(art.every((a) => a.src === cover)).toBe(true);
	});

	it('leaves type empty for a remote cover (browser content-sniffs the MIME)', () => {
		const art = buildArtwork('https://cdn.example.com/art.jpg');
		expect(art.every((a) => a.type === '')).toBe(true);
	});

	it('falls back to /favicon.svg (image/svg+xml, sizes any) when cover is null', () => {
		const art = buildArtwork(null);
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
		expect(art.every((a) => a.type === 'image/svg+xml')).toBe(true);
		expect(art.some((a) => a.sizes === 'any')).toBe(true);
	});

	it('treats an empty-string cover as no-cover (falls back to /favicon.svg)', () => {
		const art = buildArtwork('');
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
		expect(art.every((a) => a.type === 'image/svg+xml')).toBe(true);
	});

	// quick-260913-artcrash — NATIVE CRASH GUARD, not cosmetics. A non-https src reaches
	// @jofr/capacitor-media-session's urlToBitmap(), which does a blocking
	// HttpURLConnection.connect() with no try/catch inside a method declared
	// `throws IOException`. Android's cleartext block (allowMixedContent:false) turns a
	// http:// cover into an UNCAUGHT IOException on the CapacitorPlugins thread, killing the
	// process on every metadata write — song-end and then every relaunch via restore().
	// If these ever go green-to-red, the APK is crash-looping again.
	it('falls back to /favicon.svg for an http cover (native cleartext crash guard)', () => {
		const art = buildArtwork('http://y.gtimg.cn/music/photo_new/T002R300x300M000.jpg');
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
	});

	it('falls back to /favicon.svg for a protocol-relative cover', () => {
		const art = buildArtwork('//y.gtimg.cn/music/photo_new/T002R300x300M000.jpg');
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
	});

	it('does not let an https-prefixed hostname smuggle cleartext through', () => {
		const art = buildArtwork('http://https.evil.example/art.jpg');
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
	});

	// 37-D-02 / RESEARCH Pitfall 9: an embedded cover arrives as a data: URL. It must reach the card
	// (the plugin's network-free `;base64,` branch), and as ONE entry — the ladder would duplicate a
	// ~100 KB string six times for an array native-media-session.ts only reads `[0]` of.
	it('passes a data:image cover through as a SINGLE sizes:any entry', () => {
		const cover = 'data:image/png;base64,iVBORw0KGgo=';
		const art = buildArtwork(cover);
		expect(art).toHaveLength(1);
		expect(art[0].src).toBe(cover);
		expect(art[0].sizes).toBe('any');
		expect(art[0].type).toBe('image/png');
	});

	it('falls back to /favicon.svg for a NON-image data: URL (T-37-01)', () => {
		const art = buildArtwork('data:text/html;base64,PHNjcmlwdD4=');
		expect(art.every((a) => a.src === '/favicon.svg')).toBe(true);
	});
});

describe('safePositionState (MS-04, T-kyf-02)', () => {
	it('returns a valid state for finite duration > 0 and 0 <= position <= duration', () => {
		expect(safePositionState(200, 50)).toEqual({ duration: 200, position: 50, playbackRate: 1 });
	});

	it('returns the duration as position when position === duration', () => {
		expect(safePositionState(200, 200)).toEqual({ duration: 200, position: 200, playbackRate: 1 });
	});

	it('returns null when duration is NaN', () => {
		expect(safePositionState(Number.NaN, 5)).toBeNull();
	});

	it('returns null when duration is 0', () => {
		expect(safePositionState(0, 0)).toBeNull();
	});

	it('returns null when duration is Infinity', () => {
		expect(safePositionState(Number.POSITIVE_INFINITY, 5)).toBeNull();
	});

	it('returns null when duration is negative', () => {
		expect(safePositionState(-10, 5)).toBeNull();
	});

	it('clamps position down to duration when position > duration (never null)', () => {
		const st = safePositionState(200, 250);
		expect(st).not.toBeNull();
		expect(st?.position).toBe(200);
	});

	it('coerces a NaN position to 0 (valid object)', () => {
		const st = safePositionState(200, Number.NaN);
		expect(st).toEqual({ duration: 200, position: 0, playbackRate: 1 });
	});

	it('coerces a negative position to 0 (valid object)', () => {
		const st = safePositionState(200, -5);
		expect(st).toEqual({ duration: 200, position: 0, playbackRate: 1 });
	});
});

describe('playbackStateFor (MS-02)', () => {
	it("returns 'none' when there is no track", () => {
		expect(playbackStateFor(false, false)).toBe('none');
		expect(playbackStateFor(false, true)).toBe('none');
	});

	it("returns 'playing' when a track is present and playing", () => {
		expect(playbackStateFor(true, true)).toBe('playing');
	});

	it("returns 'paused' when a track is present but not playing", () => {
		expect(playbackStateFor(true, false)).toBe('paused');
	});
});
