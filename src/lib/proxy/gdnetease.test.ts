// quick-261020-gdnt: unit tests for the GD音乐台 proxy adapter.
import { describe, it, expect } from 'vitest';
import { gdneteaseProxy } from './gdnetease';

function params(init: Record<string, string>): URLSearchParams {
	return new URLSearchParams(init);
}

describe('gdneteaseProxy.buildUrl', () => {
	it('maps search → gdstudio search with name/count/page', () => {
		const url = gdneteaseProxy.buildUrl('search', params({ id: '周杰伦', limit: '20' }), undefined);
		expect(url).toBe(
			`https://music-api.gdstudio.xyz/api.php?source=netease&types=search&name=${encodeURIComponent('周杰伦')}&count=20&page=1`
		);
	});
	it('maps url → gdstudio url with br passthrough', () => {
		const url = gdneteaseProxy.buildUrl('url', params({ id: '5257138', br: '320' }), undefined);
		expect(url).toBe('https://music-api.gdstudio.xyz/api.php?source=netease&types=url&id=5257138&br=320');
	});
	it('omits br upstream when the caller omits it (lossless path → FLAC)', () => {
		const url = gdneteaseProxy.buildUrl('url', params({ id: '5257138' }), undefined);
		expect(url).not.toContain('br=');
		expect(url).toContain('types=url');
	});
	it('maps lrc → gdstudio lyric', () => {
		const url = gdneteaseProxy.buildUrl('lrc', params({ id: '5257138' }), undefined);
		expect(url).toBe('https://music-api.gdstudio.xyz/api.php?source=netease&types=lyric&id=5257138');
	});
	it('throws on an unsupported path', () => {
		expect(() => gdneteaseProxy.buildUrl('pic', params({}), undefined)).toThrow('unsupported path');
	});
	it('defaults an empty path to search', () => {
		const url = gdneteaseProxy.buildUrl('', params({ id: 'x' }), undefined);
		expect(url).toContain('types=search');
	});
});
