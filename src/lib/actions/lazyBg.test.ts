import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lazyBg } from './lazyBg';

// quick-261103-hdn: no jsdom — the node, getComputedStyle and IntersectionObserver are stubbed.
type IOCb = (entries: Array<{ isIntersecting: boolean }>) => void;
class MockIO {
	static last: MockIO | null = null;
	disconnected = false;
	constructor(public cb: IOCb) {
		MockIO.last = this;
	}
	observe() {}
	disconnect() {
		this.disconnected = true;
	}
}

function node() {
	return { parentElement: null, style: { backgroundImage: '' } } as unknown as HTMLElement;
}

describe('lazyBg', () => {
	beforeEach(() => {
		vi.stubGlobal('IntersectionObserver', MockIO);
		vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('paints the fallback until the tile nears view, then the image for good', () => {
		const n = node();
		const a = lazyBg(n, { image: 'url(x), g', fallback: 'g' })!;
		expect(n.style.backgroundImage).toBe('g');
		MockIO.last!.cb([{ isIntersecting: false }]);
		expect(n.style.backgroundImage).toBe('g');
		MockIO.last!.cb([{ isIntersecting: true }]);
		expect(n.style.backgroundImage).toBe('url(x), g');
		expect(MockIO.last!.disconnected).toBe(true);
		a.update!({ image: 'url(y), g', fallback: 'g' });
		expect(n.style.backgroundImage).toBe('url(y), g');
	});

	it('shows at once when there is no image or no IntersectionObserver', () => {
		const n = node();
		lazyBg(n, { image: 'g', fallback: 'g' });
		expect(n.style.backgroundImage).toBe('g');
		vi.stubGlobal('IntersectionObserver', undefined);
		const m = node();
		lazyBg(m, { image: 'url(x), g', fallback: 'g' });
		expect(m.style.backgroundImage).toBe('url(x), g');
	});
});
