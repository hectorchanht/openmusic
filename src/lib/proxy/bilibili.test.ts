import { describe, it, expect, vi, afterEach } from 'vitest';
import { md5Hex, biliSign, isBiliCdnUrl } from './bilibili';

// quick-261020-bili: the WBI signature stack is hand-rolled (WebCrypto has no MD5 and
// the repo adds no runtime deps), so its vectors are pinned against INDEPENDENT
// references: RFC 1320 / hashlib outputs computed outside this codebase.

describe('md5Hex (RFC 1320 vectors)', () => {
	it('matches the canonical test suite', () => {
		expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
		expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
		expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe(
			'9e107d9d372bb6826bd81d3542a419d6'
		);
		// 80-byte input crosses the 64-byte block boundary (padding path).
		expect(
			md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890')
		).toBe('57edf4a22be3c955ac49da2e2107b67a');
	});

	it('hashes UTF-8 (CJK keyword) correctly', () => {
		// hashlib.md5('周杰伦'.encode()).hexdigest()
		expect(md5Hex('周杰伦')).toBe('7a8941058aaf4df5147042ce104568da');
	});
});

describe('biliSign', () => {
	afterEach(() => vi.restoreAllMocks());

	it('produces the reference w_rid for fixed params + wts', () => {
		// Expected value computed with Python hashlib over the URLSearchParams-form
		// query (spaces as '+'), mixin 'ea1db124af3c7062474693fa704f4ff8'.
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
		const qs = biliSign(
			{ search_type: 'video', keyword: '周杰伦 晴天', page: 1, page_size: 20 },
			'ea1db124af3c7062474693fa704f4ff8'
		);
		expect(qs).toBe(
			'keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6+%E6%99%B4%E5%A4%A9&page=1&page_size=20&search_type=video&wts=1700000000&w_rid=d97cb48398293b2c34a75f4ac4ef178f'
		);
	});

	it("strips !'()* from values before signing", () => {
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
		const qs = biliSign({ keyword: "a!b'c(d)e*f" }, 'ea1db124af3c7062474693fa704f4ff8');
		expect(qs).toContain('keyword=abcdef');
	});
});

describe('isBiliCdnUrl (stream-route allowlist)', () => {
	it('accepts bilivideo + akamaized hosts', () => {
		expect(isBiliCdnUrl('https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/x.m4s')).toBe(true);
		expect(isBiliCdnUrl('https://upos-sz-mirrorakam.akamaized.net/upgcxcode/x.m4s')).toBe(true);
	});

	it('refuses everything else (open-proxy guard)', () => {
		expect(isBiliCdnUrl('https://evil.example.com/x.m4s')).toBe(false);
		expect(isBiliCdnUrl('https://bilivideo.com.evil.example.com/x')).toBe(false);
		expect(isBiliCdnUrl('not a url')).toBe(false);
	});
});
