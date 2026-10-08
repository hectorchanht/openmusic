import { describe, it, expect } from 'vitest';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import { hasHttpsScheme, isRenderableCover, isYtmCoverUrl } from './url-safety';

// Phase 40 D-11b (restored quick-261008-cov2): YT Music art is cached by uid ONLY. The predicate
// is HOST-based, so a non-ytmusic track that adopted a YTM URL is caught too.
describe('isYtmCoverUrl — the YTM-host predicate (Phase 40 D-11b)', () => {
	it('accepts the YouTube image hosts over https', () => {
		expect(isYtmCoverUrl('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true);
		expect(isYtmCoverUrl('https://lh3.googleusercontent.com/abc')).toBe(true);
		expect(isYtmCoverUrl('https://yt3.ggpht.com/x')).toBe(true);
	});

	it('rejects other hosts, http, empty and lookalike hosts', () => {
		expect(isYtmCoverUrl('https://e-cdns-images.dzcdn.net/x.jpg')).toBe(false);
		expect(isYtmCoverUrl('https://y.gtimg.cn/x.jpg')).toBe(false);
		expect(isYtmCoverUrl('http://i.ytimg.com/x')).toBe(false);
		expect(isYtmCoverUrl(null)).toBe(false);
		expect(isYtmCoverUrl(undefined)).toBe(false);
		expect(isYtmCoverUrl('')).toBe(false);
		expect(isYtmCoverUrl('https://i.ytimg.com.evil.example/x')).toBe(false);
	});
});

// 37-D-02. TWO predicates, deliberately: `hasHttpsScheme` means CACHEABLE / PROBE-ABLE (the
// localStorage cover cache is sized for ~100-byte https entries and must never receive a `data:`
// URL), `isRenderableCover` means "a surface can display this". These tests pin the difference so a
// later reader cannot assume one is a drop-in for the other.
describe('hasHttpsScheme — the CACHEABLE predicate', () => {
	it('accepts https only', () => {
		expect(hasHttpsScheme('https://cdn/x.jpg')).toBe(true);
		expect(hasHttpsScheme('http://y.gtimg.cn/a.jpg')).toBe(false);
		expect(hasHttpsScheme('//cdn/a.jpg')).toBe(false);
		expect(hasHttpsScheme('')).toBe(false);
		expect(hasHttpsScheme(null)).toBe(false);
		expect(hasHttpsScheme(undefined)).toBe(false);
	});

	it('rejects a data: image — a data URL must never reach the cover cache', () => {
		expect(hasHttpsScheme('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
	});
});

describe('isRenderableCover — the DISPLAYABLE predicate (37-D-02)', () => {
	it('accepts https', () => {
		expect(isRenderableCover('https://cdn/x.jpg')).toBe(true);
	});

	it('accepts a base64 data: URL whose MIME is an image', () => {
		expect(isRenderableCover('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
		expect(isRenderableCover('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
		expect(isRenderableCover('DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=')).toBe(true);
	});

	it('rejects a non-image data: URL (T-37-01: an embedded MIME is attacker-controlled)', () => {
		expect(isRenderableCover('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
	});

	it('rejects a data: URL that is not base64-encoded', () => {
		expect(isRenderableCover('data:image/png,rawnotbase64')).toBe(false);
	});

	it('rejects http, protocol-relative, empty and nullish covers', () => {
		expect(isRenderableCover('http://y.gtimg.cn/a.jpg')).toBe(false);
		expect(isRenderableCover('//cdn/a.jpg')).toBe(false);
		expect(isRenderableCover('')).toBe(false);
		expect(isRenderableCover(null)).toBe(false);
		expect(isRenderableCover(undefined)).toBe(false);
	});
});

