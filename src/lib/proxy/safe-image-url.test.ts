import { describe, it, expect } from 'vitest';
import { safeImageUrl, DEEZER_IMAGE_HOSTS, LASTFM_IMAGE_HOSTS } from './safe-image-url';

// This guard had FOUR copies across the Deezer and Last.fm routes and NO test. It is a security
// control — the urls it approves are echoed to clients and interpolated into CSS url(...) and JSON —
// so the shared version gets the coverage the copies never had.

describe('safeImageUrl — host allowlist', () => {
	it('accepts an allowed exact host and an allowed subdomain', () => {
		expect(safeImageUrl('https://cdn-images.dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBe(
			'https://cdn-images.dzcdn.net/a.jpg'
		);
		expect(safeImageUrl('https://e-cdns-images.dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBe(
			'https://e-cdns-images.dzcdn.net/a.jpg'
		);
		expect(safeImageUrl('https://last.fm/a.png', LASTFM_IMAGE_HOSTS)).toBe('https://last.fm/a.png');
		expect(safeImageUrl('https://img.last.fm/a.png', LASTFM_IMAGE_HOSTS)).toBe(
			'https://img.last.fm/a.png'
		);
	});

	// THE reason the suffix entries are dot-anchored. Without the leading dot, `endsWith('dzcdn.net')`
	// would happily accept an attacker-registered `evil-dzcdn.net`.
	it('rejects a lookalike host that merely ENDS WITH the allowed domain', () => {
		expect(safeImageUrl('https://evil-dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('https://notlast.fm/a.png', LASTFM_IMAGE_HOSTS)).toBeNull();
	});

	it('rejects an entirely different host', () => {
		expect(safeImageUrl('https://evil.example/a.jpg', DEEZER_IMAGE_HOSTS)).toBeNull();
	});

	// Behaviour preserved verbatim from the four copies: neither permitted its apex domain.
	it('does not permit an apex domain that was only allowed as a suffix', () => {
		expect(safeImageUrl('https://dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('https://fastly.net/a.png', LASTFM_IMAGE_HOSTS)).toBeNull();
	});

	it('allows the Fastly CDN subdomains Last.fm serves art from', () => {
		expect(safeImageUrl('https://lastfm.freetls.fastly.net/i/u/a.png', LASTFM_IMAGE_HOSTS)).toBe(
			'https://lastfm.freetls.fastly.net/i/u/a.png'
		);
	});
});

describe('safeImageUrl — scheme and injection screening', () => {
	it('rejects anything that is not https', () => {
		expect(safeImageUrl('http://cdn-images.dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('//cdn-images.dzcdn.net/a.jpg', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('javascript:alert(1)', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('data:image/png;base64,AAAA', DEEZER_IMAGE_HOSTS)).toBeNull();
	});

	// These urls land inside CSS `url(...)` and JSON, so the character screen runs BEFORE parsing —
	// a paren or quote must never survive even when new URL() would accept the value.
	it('rejects quotes, parens, backslashes and whitespace even on an allowed host', () => {
		for (const bad of [
			'https://cdn-images.dzcdn.net/a).jpg',
			'https://cdn-images.dzcdn.net/a(.jpg',
			'https://cdn-images.dzcdn.net/a".jpg',
			"https://cdn-images.dzcdn.net/a'.jpg",
			'https://cdn-images.dzcdn.net/a\\.jpg',
			'https://cdn-images.dzcdn.net/a .jpg'
		]) {
			expect(safeImageUrl(bad, DEEZER_IMAGE_HOSTS)).toBeNull();
		}
	});

	it('is null-safe and never throws on unparseable input', () => {
		expect(safeImageUrl(null, DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl(undefined, DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('', DEEZER_IMAGE_HOSTS)).toBeNull();
		expect(safeImageUrl('not-a-url', DEEZER_IMAGE_HOSTS)).toBeNull();
	});

	it('returns the PARSED href, so what ships is the normalised form that was validated', () => {
		expect(safeImageUrl('https://cdn-images.dzcdn.net/a.jpg?x=1', DEEZER_IMAGE_HOSTS)).toBe(
			'https://cdn-images.dzcdn.net/a.jpg?x=1'
		);
	});
});
