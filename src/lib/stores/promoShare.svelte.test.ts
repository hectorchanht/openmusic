// promoShare store — clipboard, persistence and counting pins (quick-261122-sharefeed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
const pings: Array<{ url: string; body: Record<string, unknown> }> = [];
vi.mock('$lib/services/api-base', () => ({ apiUrl: (p: string) => p }));

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

let clipboard: string | null;
const g = globalThis as Record<string, unknown>;
const saved = { localStorage: g.localStorage, navigator: g.navigator, fetch: g.fetch };

beforeEach(() => {
	vi.resetModules();
	clipboard = null;
	pings.length = 0;
	g.localStorage = new MemStorage();
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			language: 'en-US',
			languages: ['en-US'],
			clipboard: { writeText: async (s: string) => void (clipboard = s) }
		}
	});
	g.fetch = vi.fn(async (url: string, init: { body: string }) => {
		pings.push({ url, body: JSON.parse(init.body) });
		return new Response('{}');
	});
});

afterEach(() => {
	g.localStorage = saved.localStorage;
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved.navigator });
	g.fetch = saved.fetch;
});

async function freshStore() {
	const { promoShare } = await import('./promoShare.svelte');
	const { settings } = await import('./settings.svelte');
	return { promoShare, settings };
}

const TRACK = { title: 'Coral Sea', artist: 'Jay Chou', url: 'https://openmusic.lol/song/Jay%20Chou/Coral%20Sea' };

describe('promoShare (quick-261122-sharefeed)', () => {
	it('PIN: opens in the user’s app language — 日本語 → Japanese first', async () => {
		const { promoShare, settings } = await freshStore();
		(settings as { appLang: string }).appLang = 'ja';
		promoShare.open(TRACK);
		expect(promoShare.lang).toBe('ja');
		expect(promoShare.defaultLang).toBe('ja');
		expect(promoShare.message()).toContain('いいものをシェアします');
	});

	it('opens in Chinese for a zh-Hans user, Cantonese for a zh-Hant HK device', async () => {
		const { promoShare, settings } = await freshStore();
		settings.appLang = 'zh-Hans';
		promoShare.open(TRACK);
		expect(promoShare.lang).toBe('zh-CN');
		(navigator as unknown as { languages: string[] }).languages = ['zh-HK'];
		settings.appLang = 'zh-Hant';
		promoShare.open(TRACK);
		expect(promoShare.lang).toBe('yue');
	});

	it('PIN: Copy places the FULL message, link included, on the clipboard (exact string)', async () => {
		const { promoShare, settings } = await freshStore();
		settings.appLang = 'en';
		promoShare.open(TRACK);
		promoShare.setSender('Amy');
		expect(await promoShare.copyFull()).toBe(true);
		expect(clipboard).toBe(
			'🎧 Coral Sea — Jay Chou\nhttps://openmusic.lol/song/Jay%20Chou/Coral%20Sea\n\n' +
				"Hi there, sharing something good with you 🎵 I've been using OpenMusic — any song you can think of, and you can download it onto your own device, so the music is truly yours. The best part: it's completely free, with no ads at all. Give it a try 👉 https://openmusic.lol\n" +
				'Wishing you great music every day, good health and all the best! — Amy'
		);
	});

	it('copies without the track lead when the user switches it off', async () => {
		const { promoShare, settings } = await freshStore();
		settings.appLang = 'en';
		promoShare.open(TRACK);
		promoShare.includeTrack = false;
		await promoShare.copyFull();
		expect(clipboard!.startsWith('Hi there, sharing something good')).toBe(true);
		expect(clipboard).toContain('https://openmusic.lol');
	});

	it('PIN: the saved sender name survives a reload and signs every language', async () => {
		const first = await freshStore();
		first.promoShare.setSender('  阿明 ');
		// "Reload": a brand-new module graph over the same storage.
		vi.resetModules();
		const { promoShare } = await freshStore();
		promoShare.open(null);
		expect(promoShare.sender).toBe('阿明');
		for (const id of ['yue', 'zh-TW', 'zh-CN', 'en', 'ja', 'ko'] as const) {
			expect(promoShare.message(id).endsWith(' — 阿明')).toBe(true);
		}
	});

	it('copy-link keeps the plain link path one tap away', async () => {
		const { promoShare } = await freshStore();
		promoShare.open(TRACK);
		expect(await promoShare.copyLink()).toBe(true);
		expect(clipboard).toBe(TRACK.url);
	});

	it('counts opens / copies / WhatsApp taps — anonymous: action + lang + variant only', async () => {
		const { promoShare, settings } = await freshStore();
		settings.appLang = 'en';
		promoShare.open(TRACK);
		promoShare.setSender('Secret Name');
		await promoShare.copyFull();
		await promoShare.copyShort();
		await promoShare.copyLink();
		promoShare.countWhatsApp();
		expect(pings.map((p) => p.url)).toEqual(Array(5).fill('/api/analytics/share'));
		expect(pings.map((p) => p.body)).toEqual([
			{ action: 'open', lang: 'en', variant: 'full' },
			{ action: 'copy', lang: 'en', variant: 'full' },
			{ action: 'copy', lang: 'en', variant: 'short' },
			{ action: 'copy', lang: 'en', variant: 'link' },
			{ action: 'wa', lang: 'en', variant: 'full' }
		]);
		expect(JSON.stringify(pings)).not.toContain('Secret');
		expect(JSON.stringify(pings)).not.toContain('Coral');
	});
});
