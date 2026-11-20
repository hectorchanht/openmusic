import { describe, it, expect } from 'vitest';
import { splitDescription } from './description';

describe('splitDescription — linkify segments (quick-261024-about)', () => {
	it('splits a URL out of prose, keeping newlines in text segments', () => {
		const segs = splitDescription('導演：某君\n睇呢度 https://example.com/x 好正');
		expect(segs).toEqual([
			{ t: 'text', s: '導演：某君\n睇呢度 ' },
			{ t: 'link', s: 'https://example.com/x', href: 'https://example.com/x' },
			{ t: 'text', s: ' 好正' }
		]);
	});

	it('keeps trailing punctuation as text, not part of the link', () => {
		const segs = splitDescription('(https://a.b/c).');
		expect(segs[1]).toEqual({ t: 'link', s: 'https://a.b/c', href: 'https://a.b/c' });
		expect(segs.map((s) => s.s).join('')).toBe('(https://a.b/c).');
	});

	it('plain text is one segment; empty text is none', () => {
		expect(splitDescription('冇連結')).toEqual([{ t: 'text', s: '冇連結' }]);
		expect(splitDescription('')).toEqual([]);
	});
});
