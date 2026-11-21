// record-persist — the FOREVER local persistence for canonical records (quick-261121-canon).
//
// Hector 2026-11-21: "these will cache forever and offline ok." A resolved canonical record
// (cover / title / artist / lyrics ref) is not a cache entry — it is the app's long-term memory
// of a song, so unlike cover-cache (14-day read TTL, 2000-entry write-LRU) a record store has:
//   - NO read-side TTL and NO size cap of its own: a positive resolution, once written, reads
//     back identically forever, with zero network — every surface works fully offline.
//   - A QUOTA-ONLY eviction: localStorage is a shared ~5 MB origin budget, so if a write hits
//     QuotaExceededError the store evicts OLDEST-resolvedAt records first — but NEVER a
//     protected record (a record carrying a user pin, or a downloaded song's record). If only
//     protected records remain and the write still fails, the write is dropped silently
//     (the in-session value is lost, nothing is corrupted, nothing throws).
//   - A one-shot request for PERSISTENT storage (navigator.storage.persist()) so the browser
//     does not treat the origin's storage as evictable under pressure where the platform
//     offers that contract. Best-effort and guarded: unsupported platforms simply skip it.
//
// The memo discipline mirrors cover-cache's memoRecord (page-switch-lag fix): the parsed
// record is memoised per Storage-object identity, a write from another tab invalidates via
// the platform `storage` event, and a failed setItem drops the memo first so a mutated
// record is never served as if it were on disk. Pure + node-testable, never throws.

/** One forever store over a flat `Record<string, T>` JSON blob at `storageKey`. */
export interface ForeverStore<T> {
	/** The whole record map; {} on absent / corrupt / unavailable storage — never throws. */
	read(): Record<string, T>;
	/**
	 * Persist the whole map. On quota failure, evicts oldest (by `stampOf`) UNPROTECTED
	 * entries one at a time and retries; protected entries are never evicted. Returns true
	 * when the (possibly trimmed) map was persisted, false when the write was dropped.
	 */
	write(rec: Record<string, T>): boolean;
	/** Drop the whole blob. Never throws. */
	clear(): void;
}

function isQuotaError(e: unknown): boolean {
	if (!e || typeof e !== 'object') return false;
	const err = e as { name?: string; code?: number };
	// DOMException name in modern browsers; code 22 is the legacy QUOTA_EXCEEDED_ERR.
	return err.name === 'QuotaExceededError' || err.name === 'NSExceededError' || err.code === 22;
}

export function createForeverStore<T>(
	storageKey: string,
	opts: {
		/** True when an entry must NEVER be quota-evicted (pin / downloaded protection). */
		isProtected: (value: T) => boolean;
		/** Eviction ordering stamp (oldest first) — a record's resolvedAt. */
		stampOf: (value: T) => number;
	}
): ForeverStore<T> {
	let memo: { store: Storage; rec: Record<string, T> } | null = null;
	if (typeof window !== 'undefined') {
		window.addEventListener('storage', (e) => {
			if (e.key === null || e.key === storageKey) memo = null; // null key = other tab cleared all
		});
	}
	const readRaw = (): Record<string, T> => {
		try {
			if (memo && memo.store === localStorage) return memo.rec;
			const raw = localStorage.getItem(storageKey);
			if (!raw) return {};
			const v: unknown = JSON.parse(raw);
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				memo = { store: localStorage, rec: v as Record<string, T> };
				return memo.rec;
			}
			return {};
		} catch {
			return {};
		}
	};
	return {
		read: readRaw,
		write(rec: Record<string, T>): boolean {
			// Work on a copy: quota eviction must never mutate the caller's map.
			const work: Record<string, T> = { ...rec };
			for (;;) {
				try {
					memo = null; // a failed write must not leave a stale memo claiming success
					localStorage.setItem(storageKey, JSON.stringify(work));
					memo = { store: localStorage, rec: work };
					return true;
				} catch (e) {
					if (!isQuotaError(e)) return false; // unavailable storage / privacy mode — drop
					// Evict the OLDEST unprotected entry and retry. Protected entries (pins,
					// downloaded records) are never victims — see the module header.
					let victim: string | null = null;
					let victimStamp = Infinity;
					for (const [k, v] of Object.entries(work)) {
						if (opts.isProtected(v)) continue;
						const s = opts.stampOf(v);
						if (s < victimStamp) {
							victimStamp = s;
							victim = k;
						}
					}
					if (victim === null) return false; // only protected records left — drop the write
					delete work[victim];
				}
			}
		},
		clear(): void {
			try {
				memo = null;
				localStorage.removeItem(storageKey);
			} catch {
				/* unavailable — no-op */
			}
		}
	};
}

let persistRequested = false;

/**
 * Ask the platform for persistent storage, once per session, best-effort. Called on the
 * first record write: a granted `persist()` means the record store survives storage-pressure
 * eviction of the origin; a denial or an unsupported platform changes nothing (the records
 * still live in localStorage, and the quota policy above still applies). Never throws,
 * never blocks the write path — the promise is fire-and-forget.
 */
export function ensurePersistentStorage(): void {
	if (persistRequested) return;
	persistRequested = true;
	try {
		const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
		if (storage && typeof storage.persist === 'function') {
			void storage.persist().catch(() => false);
		}
	} catch {
		/* platform without StorageManager — nothing to request */
	}
}

/** Test seam: reset the one-shot persist latch (mirrors ttl-cache's __clearSearchCache). */
export function __resetPersistLatchForTest(): void {
	persistRequested = false;
}
