import { describe, it, expect } from 'vitest';
import { lockEntityHref } from './entity-href';
import { lockScriptSync, warmScript } from './zh-convert';

// quick-260926-hze — the pure same-app entity href locker. The lock is injected, so these cases
// run on an idempotent FAKE lock (伦 → 倫) and pin the URL surgery on its own; the last describe
// runs the REAL script lock end to end.

const enc = encodeURIComponent;
const fake = (s: string) => s.replaceAll('伦', '倫');
const identity = (s: string) => s;

const ENTITY_CASES: [string, string][] = [
	['/artist/' + enc('周杰伦'), '/artist/' + enc('周杰倫')],
	['/artist/' + enc('周杰伦') + '/albums?tab=single', '/artist/' + enc('周杰倫') + '/albums?tab=single'],
	[
		'/album/' + enc('伦敦') + '?artist=' + enc('周杰伦') + '&dzid=123',
		'/album/' + enc('倫敦') + '?artist=' + enc('周杰倫') + '&dzid=123'
	],
	// share grammar: raw CJK path, '-' = space; the UNCHANGED segment survives byte-for-byte
	['/song/周杰伦/晴-天', '/song/' + enc('周杰倫') + '/晴-天'],
	['/artist/' + enc('周杰伦') + '#top', '/artist/' + enc('周杰倫') + '#top']
];

describe('lockEntityHref — fake lock (quick-260926-hze)', () => {
	it.each(ENTITY_CASES)('%s → %s', (input, expected) => {
		expect(lockEntityHref(input, fake)).toBe(expected);
	});

	it.each(['/library?tab=fav-artists', '/search?q=' + enc('周杰伦'), '//evil.example/artist/x', '/artists/x'])(
		'returns non-entity input %s identical (T-hze-01)',
		(input) => {
			expect(lockEntityHref(input, fake)).toBe(input);
		}
	);

	it('returns a malformed percent segment unchanged and never throws (T-hze-02)', () => {
		expect(lockEntityHref('/artist/%E5', fake)).toBe('/artist/%E5');
	});

	it('returns the input itself when a throwing lock is injected (T-hze-02)', () => {
		const boom = () => {
			throw new Error('lock failed');
		};
		const input = '/artist/' + enc('周杰伦');
		expect(lockEntityHref(input, boom)).toBe(input);
	});

	it("an identity lock ('off') returns the SAME string", () => {
		for (const [input] of ENTITY_CASES) expect(lockEntityHref(input, identity)).toBe(input);
	});

	it.each(ENTITY_CASES)('is idempotent on %s', (input) => {
		const once = lockEntityHref(input, fake);
		expect(lockEntityHref(once, fake)).toBe(once);
	});
});

// 十一月的萧邦, not 范特西: tongwen s2t leaves 范 alone (a valid Traditional surname char), so
// 范特西 has no zh-Hant form to lock to; 十一月的萧邦 ↔ 十一月的蕭邦 converts in both directions.
describe('lockEntityHref — real script lock round trip (quick-260926-hze)', () => {
	const simp = '/album/' + enc('十一月的萧邦') + '?artist=' + enc('周杰伦');
	const trad = '/album/' + enc('十一月的蕭邦') + '?artist=' + enc('周杰倫');

	it('zh-Hant locks a Simplified album href to Traditional', async () => {
		await warmScript('zh-Hant');
		expect(lockEntityHref(simp, (s) => lockScriptSync(s, 'zh-Hant'))).toBe(trad);
	});

	it('zh-Hans locks the Traditional album href back to Simplified', async () => {
		await warmScript('zh-Hans');
		expect(lockEntityHref(trad, (s) => lockScriptSync(s, 'zh-Hans'))).toBe(simp);
		const fantasy = '/album/' + enc('範特西') + '?artist=' + enc('周杰倫');
		expect(lockEntityHref(fantasy, (s) => lockScriptSync(s, 'zh-Hans'))).toBe(
			'/album/' + enc('范特西') + '?artist=' + enc('周杰伦')
		);
	});
});
