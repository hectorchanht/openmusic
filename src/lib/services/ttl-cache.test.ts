import { describe, it, expect, vi, afterEach } from 'vitest';
import { cached, evictCached, __clearSearchCache } from './ttl-cache';

const TTL = 60_000;

afterEach(() => {
	__clearSearchCache();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('ttl-cache (D-04)', () => {
	it('HIT: a second call within TTL returns the cached value WITHOUT re-invoking factory', async () => {
		const factory = vi.fn(async () => 'v1');

		const a = await cached('k', TTL, factory);
		const b = await cached('k', TTL, factory);

		expect(a).toBe('v1');
		expect(b).toBe('v1');
		expect(factory).toHaveBeenCalledOnce();
	});

	it('MISS: distinct keys each invoke the factory', async () => {
		const factory = vi.fn(async (k: string) => `value-${k}`);

		const a = await cached('k1', TTL, () => factory('k1'));
		const b = await cached('k2', TTL, () => factory('k2'));

		expect(a).toBe('value-k1');
		expect(b).toBe('value-k2');
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('EXPIRY: after TTL elapses (fake timers) the next call re-invokes the factory', async () => {
		vi.useFakeTimers();
		const factory = vi.fn(async () => 'fresh');

		await cached('k', TTL, factory);
		expect(factory).toHaveBeenCalledOnce();

		// still within TTL → cached
		vi.advanceTimersByTime(TTL - 1);
		await cached('k', TTL, factory);
		expect(factory).toHaveBeenCalledOnce();

		// past TTL → re-invoke
		vi.advanceTimersByTime(2);
		await cached('k', TTL, factory);
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('REJECT: a rejected factory is NOT cached — the next call retries', async () => {
		const factory = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce('ok');

		await expect(cached('k', TTL, factory)).rejects.toThrow('boom');
		// nothing cached → retry re-invokes and succeeds
		await expect(cached('k', TTL, factory)).resolves.toBe('ok');
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('CLEAR: __clearSearchCache empties the store so the next call re-invokes', async () => {
		const factory = vi.fn(async () => 'v');

		await cached('k', TTL, factory);
		__clearSearchCache();
		await cached('k', TTL, factory);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	// quick-260926-l69: a never-rejecting factory (catalog's DATA-03 contract) can veto its own value.
	it('shouldStore false: the value is returned but NOT pinned — the next call re-invokes', async () => {
		const factory = vi.fn(async () => 'poisoned');

		await expect(cached('k', TTL, factory, () => false)).resolves.toBe('poisoned');
		await cached('k', TTL, factory, () => false);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('shouldStore true: stored as usual — the second call is a HIT', async () => {
		const factory = vi.fn(async () => 'good');

		await cached('k', TTL, factory, () => true);
		await cached('k', TTL, factory, () => true);

		expect(factory).toHaveBeenCalledOnce();
	});

	it('evictCached(prefix) drops only keys starting with prefix', async () => {
		const x = vi.fn(async () => 'x');
		const y = vi.fn(async () => 'y');
		const dz = vi.fn(async () => 'dz');
		await cached('ab|x', TTL, x);
		await cached('ab|y', TTL, y);
		await cached('dz:ab|x', TTL, dz);

		evictCached('ab|');
		await cached('ab|x', TTL, x);
		await cached('ab|y', TTL, y);
		await cached('dz:ab|x', TTL, dz);

		expect(x).toHaveBeenCalledTimes(2);
		expect(y).toHaveBeenCalledTimes(2);
		expect(dz).toHaveBeenCalledOnce();
	});
});
