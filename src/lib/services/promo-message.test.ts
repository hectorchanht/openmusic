// promo-message — the ready-written share messages (quick-261122-sharefeed).
// Pins from the todo ("feed it to their mouth"): language default, the single-source canon check,
// the sender name on every language. (Clipboard + reload pins live in promoShare.svelte.test.ts.)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import canon from './promo-canon.json';
// The SAME extractor the sync script uses — so the drift pin and the sync path cannot disagree.
import { extractPromoCanon } from '../../../scripts/promo-canon-extract.mjs';
import {
	CANON_SIGNATURE,
	PROMO_LANGS,
	PROMO_LINK,
	defaultPromoLang,
	orderedPromoLangs,
	renderPromo,
	renderShort,
	whatsappUrl,
	cleanSender
} from './promo-message';

const DECK_SNAPSHOT = readFileSync(new URL('./__fixtures__/promo-deck-script.txt', import.meta.url), 'utf8');

describe('canon — single source (the in-app messages ARE the deck)', () => {
	it('promo-canon.json is exactly what the extractor makes of the vendored deck snapshot', () => {
		// RED under: hand-editing promo-canon.json (a forked second copy) instead of re-syncing.
		expect(extractPromoCanon(DECK_SNAPSHOT, canon.source)).toEqual(canon);
	});

	it('every deck language is offered, in deck order, with its verbatim text', () => {
		expect(PROMO_LANGS.map((l) => l.label)).toEqual(canon.full.map((f) => f.lang));
		expect(PROMO_LANGS.map((l) => l.id)).toEqual(['yue', 'zh-TW', 'zh-CN', 'en', 'ja', 'ko']);
		for (const l of PROMO_LANGS) {
			expect(l.text).toBe(canon.full.find((f) => f.lang === l.label)!.text);
		}
	});

	it('the short versions are the deck short lines verbatim', () => {
		expect(renderShort('yue')).toBe(canon.short[0].text);
		expect(renderShort('en')).toBe(canon.short[1].text);
		expect(renderShort('zh-TW')).toBe(canon.short[2].text);
		expect(renderShort('ja')).toBeNull();
	});

	it('every full message renders as canon text — only the slots change', () => {
		for (const l of PROMO_LANGS) {
			const out = renderPromo(l.id, { sender: 'Amy' });
			const expected = l.text.replace('{name}', l.generic).slice(0, -CANON_SIGNATURE.length) + ' — Amy';
			expect(out).toBe(expected);
		}
	});

	it('no canon sentence is re-typed anywhere else in src (no drifted copy)', () => {
		// Distinctive fragments of each language's canon. Only the generated JSON may hold them.
		const fragments = ['同你分享一樣好嘢', '跟你分享一個好東西', '跟你分享一个好东西', 'sharing something good with you', 'いいものをシェアします', '좋은 거 하나 공유해요'];
		const hits: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) {
					if (name !== '__fixtures__') walk(p);
					continue;
				}
				// Shipped source only: tests quote the canon on purpose (exact-string pins).
				if (p.endsWith('promo-canon.json') || /\.(test|spec)\.ts$/.test(p)) continue;
				const src = readFileSync(p, 'utf8');
				for (const f of fragments) if (src.includes(f)) hits.push(`${p}: ${f}`);
			}
		};
		walk('src');
		expect(hits).toEqual([]);
	});
});

describe('default language = the user’s own app language', () => {
	it('PIN: app language 日本語 → the Japanese message is shown first', () => {
		const first = defaultPromoLang('ja');
		expect(first).toBe('ja');
		const ordered = orderedPromoLangs(first);
		expect(ordered[0].id).toBe('ja');
		expect(ordered[0].label).toBe('日本語');
		expect(renderPromo(ordered[0].id)).toContain('いいものをシェアします');
	});

	it('maps every app language the UI speaks today', () => {
		expect(defaultPromoLang('en')).toBe('en');
		expect(defaultPromoLang('zh-Hans')).toBe('zh-CN');
		expect(defaultPromoLang('zh-Hant')).toBe('zh-TW');
		expect(defaultPromoLang('zh-Hant', ['zh-HK'])).toBe('yue');
		expect(defaultPromoLang('zh-Hant', ['en-HK', 'zh-Hant'])).toBe('yue');
		expect(defaultPromoLang('zh-Hant', ['zh-MO'])).toBe('yue');
		expect(defaultPromoLang('ko')).toBe('ko');
		expect(defaultPromoLang('es')).toBe('en');
		expect(defaultPromoLang('fr', ['fr-FR'])).toBe('en');
	});

	it('a Japanese / Korean device on an app language without ja/ko gets its own language', () => {
		// The app UI has no ja/ko option, so a Japanese phone lands on appLang 'en'.
		expect(defaultPromoLang('en', ['ja-JP', 'en-US'])).toBe('ja');
		expect(defaultPromoLang('en', ['ko-KR'])).toBe('ko');
		// …but a Chinese app language is the user's own pick and wins over the device.
		expect(defaultPromoLang('zh-Hans', ['ja-JP'])).toBe('zh-CN');
	});

	it('other languages stay one tap away (all six, default first)', () => {
		const ordered = orderedPromoLangs('ko');
		expect(ordered.map((l) => l.id)).toEqual(['ko', 'yue', 'zh-TW', 'zh-CN', 'en', 'ja']);
	});
});

describe('sender name + track slot', () => {
	it('signs every language version with the sender name', () => {
		for (const l of PROMO_LANGS) {
			const out = renderPromo(l.id, { sender: '  Hector Chan ' });
			expect(out.endsWith(' — Hector Chan')).toBe(true);
		}
	});

	it('no sender → no sign-off at all (never signed "Hector" on someone else’s behalf)', () => {
		for (const l of PROMO_LANGS) {
			const out = renderPromo(l.id, { sender: '' });
			expect(out).not.toContain('Hector');
			expect(out).toContain(PROMO_LINK);
		}
	});

	it('cleans the sender to one capped line', () => {
		expect(cleanSender('  a\n\n b  ')).toBe('a b');
		expect(cleanSender('x'.repeat(100))).toHaveLength(40);
		expect(cleanSender(null)).toBe('');
	});

	it('leads with the shared track when given, keeping the full canon message after it', () => {
		const out = renderPromo('en', {
			sender: 'Amy',
			track: { title: '夢伴', artist: '李悅君', url: 'https://openmusic.lol/song/李悅君/夢伴' }
		});
		expect(out.startsWith('🎧 夢伴 — 李悅君\nhttps://openmusic.lol/song/李悅君/夢伴\n\n')).toBe(true);
		expect(out).toContain(renderPromo('en', { sender: 'Amy' }));
	});

	it('wa.me handoff carries the whole message, encoded', () => {
		const msg = renderPromo('yue', { sender: '阿明' });
		const url = whatsappUrl(msg);
		expect(url.startsWith('https://wa.me/?text=')).toBe(true);
		expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(msg);
	});
});
