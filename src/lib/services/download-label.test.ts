import { describe, it, expect } from 'vitest';
import { downloadLabel } from './download-label';

describe('downloadLabel (quick-261001-grb)', () => {
	it('joins artist and title with " - "', () => {
		expect(downloadLabel('陳奕迅', '明年今日')).toBe('陳奕迅 - 明年今日');
	});

	it('drops the separator when the artist is empty or whitespace', () => {
		expect(downloadLabel('', '明年今日')).toBe('明年今日');
		expect(downloadLabel('   ', '明年今日')).toBe('明年今日');
	});
});
