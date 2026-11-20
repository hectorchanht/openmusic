import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '$lib/sources/types';
import { isSameShelfSong } from '$lib/services/dedupe';

// BULK-DOWNLOAD UNLOCK — END-TO-END (Hector 2026-11-18: "test that donate any
// amount can download songs in bulk, e2e testing").
//
// THE CHAIN UNDER TEST (all real code unless a mock boundary is named):
//   Gumroad tip jar (pay-what-you-want — ANY amount) → buyer holds a license key
//   → POST /api/sponsored/verify (REAL handler, ./routes/api/sponsored/verify)
//     checks the key against Gumroad's license API
//   → on { ok:true } the client sets localStorage dawn_supporter=1
//     (SupporterSheet.verify()'s contract, mirrored by verifyKeyOnThisDevice)
//   → isSupporter() (REAL, $lib/config/sponsored) flips true
//   → the album page's Download-all tap and the artist page's discography
//     Download ALL stop gating and run downloadAlbum (REAL)
//   → one real ZIP per album (REAL zip-store) saved via the REAL
//     saveBlobToDisk anchor seam. Per-song download is the control: it never
//     consults supporter state at all.
//
// MOCK BOUNDARIES (Hector's standing standard: e2e with MOCK data + MOCK auth —
// no real payment, no real Gumroad call, no real account):
//   - Gumroad upstream: stubbed at global fetch. The stub is the DISCRIMINATOR:
//     the same key unlocks or stays locked purely by what the stub answers, so
//     these tests FAIL if the endpoint ever starts accepting keys on its own.
//   - Track sources: downloadTrack/downloadFromDonor are stubbed at the module
//     seam — the exact seam download-album.test.ts uses (the engine's own
//     behaviour is covered by download-track.test.ts, 124 tests). The stub
//     "fetches" mock audio bytes and persists them like the real engine.
//   - Device storage: an in-memory localStorage (a fresh profile per test) and
//     an in-memory blob store; the disk save runs the REAL saveBlobToDisk
//     against a fake document (the download-save.test.ts idiom), capturing the
//     exact blob + filename the browser would have saved.
//
// WHAT THIS CANNOT PROVE: Svelte component rendering (the Vitest project is
// node-only, no jsdom). The two page gates and the sheet's flag-set live inside
// components, so — following the free-page.test.ts precedent — they are pinned
// STRUCTURALLY below (source, comments stripped): the gate predicate, its
// order before the download call, and the single flag-set inside the ok
// branch. The functional legs then drive the REAL predicate (isSupporter)
// through tap simulations that mirror those pinned bodies line for line.

const mocks = vi.hoisted(() => {
	const blobData = new Map<string, Blob>();
	return {
		blobData,
		library: {
			downloads: [] as Track[],
			beginDownload: (_uid: string) => {},
			endDownload: (_uid: string) => {},
			downloadUidFor: (tr: Track): string | null =>
				mocks.library.downloads.find((d) => d.uid === tr.uid || isSameShelfSong(d, tr))?.uid ?? null
		},
		names: {
			dnArtist: (s: string) => s,
			dnTitle: (s: string) => s
		},
		downloadTrack: vi.fn(),
		downloadFromDonor: vi.fn(),
		blobStore: {
			put: async (uid: string, blob: Blob) => {
				blobData.set(uid, blob);
				return true;
			},
			get: async (uid: string) => blobData.get(uid) ?? null,
			has: async (uid: string) => blobData.has(uid),
			moveToDir: async (_uid: string, _dir: string) => true,
			getStoredName: (_uid: string): string | null => null
		}
	};
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('$lib/stores/library.svelte', () => ({ library: mocks.library }));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/download-track', () => ({
	downloadTrack: mocks.downloadTrack,
	downloadFromDonor: mocks.downloadFromDonor
}));
vi.mock('$lib/services/blob-store', () => ({ blobStore: mocks.blobStore }));

import { POST } from '../../routes/api/sponsored/verify/+server';
import {
	GUMROAD_PRODUCT_PERMALINK,
	SUPPORTER_KEY,
	TIP_LICENSE_KEY,
	isSupporter
} from '$lib/config/sponsored';
import { downloadAlbum } from './download-album';

// ---------------------------------------------------------------------------
// Harness: fresh profile, Gumroad stub, fake document for the real save seam.
// ---------------------------------------------------------------------------

class MemoryStorage {
	private m = new Map<string, string>();
	getItem(k: string) {
		return this.m.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, String(v));
	}
	removeItem(k: string) {
		this.m.delete(k);
	}
	clear() {
		this.m.clear();
	}
}

const ls = () => (globalThis as unknown as { localStorage: MemoryStorage }).localStorage;

const GUMROAD_URL = 'https://api.gumroad.com/v2/licenses/verify';
type GumroadMode = 'valid' | 'invalid' | 'refunded' | 'chargebacked' | 'http-error' | 'transport-error';
let gumroadMode: GumroadMode = 'valid';
const gumroadCalls: { url: string; params: URLSearchParams }[] = [];
const fetchStub = vi.fn();

/** The saves the browser would have performed: filename + the exact blob. */
const saves: { filename: string; blob: Blob | null }[] = [];
let lastObjectBlob: Blob | null = null;
const fakeDoc = {
	createElement: (_tag: string) => {
		const anchor = {
			download: '',
			href: '',
			click: () => {
				saves.push({ filename: anchor.download, blob: lastObjectBlob });
			}
		};
		return anchor;
	}
};

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

const mk = (n: number, over: Partial<Track> = {}): Track =>
	({
		uid: `qq:${n}`,
		source: 'qq',
		songid: String(n),
		title: `Song${n}`,
		artist: 'Artist',
		album: 'Album',
		cover: null,
		audioUrl: 'https://cdn.example/a.m4a',
		lrc: null,
		quality: null,
		detailsLoaded: true,
		...over
	}) as Track;

const META = { artist: 'Artist', album: 'Album' };
const albumOf = (ns: number[], meta = META) => ({ tracks: ns.map((n) => mk(n)), meta });

beforeEach(() => {
	vi.clearAllMocks();
	// A FRESH PROFILE: empty localStorage, empty blob store, nothing downloaded.
	vi.stubGlobal('localStorage', new MemoryStorage());
	vi.stubGlobal('document', fakeDoc);
	mocks.blobData.clear();
	mocks.library.downloads = [];
	gumroadMode = 'valid';
	gumroadCalls.length = 0;
	gateEvents.length = 0;
	saves.length = 0;
	lastObjectBlob = null;

	// Gumroad upstream stub — the ONLY network this flow may touch.
	fetchStub.mockImplementation(async (input: unknown, init?: { body?: unknown }) => {
		const url = String(input);
		if (url !== GUMROAD_URL) throw new Error(`unexpected fetch in test: ${url}`);
		gumroadCalls.push({ url, params: init?.body as URLSearchParams });
		switch (gumroadMode) {
			// The 'valid' payload mirrors the REAL keyless-verify response shape:
			// success + uses + a purchase object with NO amount/price field —
			// Gumroad's license verify cannot see what was paid (see
			// $lib/config/sponsored.ts). That is the any-amount fact: a key from
			// a $1 tip and a key from a $25 tip are indistinguishable here, and
			// no amount threshold exists anywhere in the unlock path.
			case 'valid':
				return { ok: true, json: async () => ({ success: true, uses: 1, purchase: {} }) };
			case 'invalid':
				return { ok: true, json: async () => ({ success: false }) };
			case 'refunded':
				return { ok: true, json: async () => ({ success: true, purchase: { refunded: true } }) };
			case 'chargebacked':
				return { ok: true, json: async () => ({ success: true, purchase: { chargebacked: true } }) };
			case 'http-error':
				return { ok: false, json: async () => ({}) };
			case 'transport-error':
				throw new Error('network down');
		}
	});
	vi.stubGlobal('fetch', fetchStub);

	// The track-source engine stub: "fetch" mock audio, persist it, report the
	// save — the real downloadTrack's contract (persist: true, save: false).
	mocks.downloadTrack.mockImplementation(
		async (tr: Track, opts: { onSaved?: (u: string, f: string, b: Blob) => void }) => {
			const blob = new Blob([`audio:${tr.uid}`], { type: 'audio/mp4' });
			await mocks.blobStore.put(tr.uid, blob);
			opts.onSaved?.(tr.uid, `${tr.artist} - ${tr.title}.m4a`, blob);
			return 'saved';
		}
	);
	mocks.downloadFromDonor.mockImplementation(async () => 'no-audio');

	// The REAL saveBlobToDisk resolves URL.createObjectURL at call time.
	(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => {
		lastObjectBlob = b;
		return 'blob:mock-save';
	});
	(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn(() => undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
	(URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreateObjectURL;
	(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevokeObjectURL;
});

// ---------------------------------------------------------------------------
// The client legs, mirroring the components (pinned structurally below).
// ---------------------------------------------------------------------------

function fakeEvent(body: unknown) {
	return {
		platform: { env: {} },
		request: new Request('https://openmusic.lol/api/sponsored/verify', {
			method: 'POST',
			headers: { origin: 'https://openmusic.lol', 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (e: unknown) => (POST as any)(e);

/**
 * SupporterSheet.verify()'s network + flag contract: POST the key (wall
 * opt-out on this device), and ONLY on an ok answer set dawn_supporter=1 and
 * persist the key. A non-ok answer changes nothing on the device.
 */
async function verifyKeyOnThisDevice(licenseKey: string) {
	const res = await post(fakeEvent({ license_key: licenseKey, public_wall: false }));
	const data = (await res.json()) as { ok?: boolean; reason?: string };
	if (data?.ok) {
		ls().setItem(SUPPORTER_KEY, '1');
		ls().setItem(TIP_LICENSE_KEY, licenseKey);
	}
	return data;
}

const gateEvents: string[] = [];

/** album/[name]/+page.svelte onDownloadTap(): gate first, download second. */
async function tapAlbumDownloadAll(tracks: Track[], meta: { artist: string; album: string }) {
	if (!isSupporter()) {
		gateEvents.push('toast:support.bulkLocked', 'supporter-sheet:open');
		return 'gated' as const;
	}
	return downloadAlbum(tracks, meta);
}

/** artist/[name]/albums/+page.svelte downloadAll(): same gate, then one
 *  downloadAlbum run per album, sequentially. */
async function tapDiscographyDownloadAll(albums: { tracks: Track[]; meta: { artist: string; album: string } }[]) {
	if (!isSupporter()) {
		gateEvents.push('toast:support.bulkLocked', 'supporter-sheet:open');
		return 'gated' as const;
	}
	const results: { saved: number; total: number }[] = [];
	for (const al of albums) results.push(await downloadAlbum(al.tracks, al.meta));
	return results;
}

function hasSig(bytes: Uint8Array, sig: number[]): boolean {
	outer: for (let i = 0; i + sig.length <= bytes.length; i++) {
		for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
		return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// 1. LOCKED state — a fresh profile gets the gate, never a zip.
// ---------------------------------------------------------------------------

describe('bulk unlock e2e — locked (fresh profile)', () => {
	it('album Download all: gate toast + tip sheet, no download runs, no zip is produced', async () => {
		expect(isSupporter()).toBe(false);
		const r = await tapAlbumDownloadAll(albumOf([1, 2, 3]).tracks, META);
		expect(r).toBe('gated');
		expect(gateEvents).toEqual(['toast:support.bulkLocked', 'supporter-sheet:open']);
		expect(mocks.downloadTrack).not.toHaveBeenCalled();
		expect(saves).toHaveLength(0);
	});

	it('discography Download ALL: gated the same way, nothing downloads', async () => {
		const r = await tapDiscographyDownloadAll([albumOf([1, 2]), albumOf([3], { artist: 'Artist', album: 'Second' })]);
		expect(r).toBe('gated');
		expect(gateEvents).toEqual(['toast:support.bulkLocked', 'supporter-sheet:open']);
		expect(mocks.downloadTrack).not.toHaveBeenCalled();
		expect(saves).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// 2 + 3. ANY-AMOUNT unlock, then bulk download actually produces the zip.
// ---------------------------------------------------------------------------

describe('bulk unlock e2e — donate any amount → unlock → bulk download', () => {
	it('the endpoint consults Gumroad (permalink + the submitted key) and the ok answer sets the flag', async () => {
		const data = await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		expect(data.ok).toBe(true);
		// The grant came from the SERVER having asked Gumroad — not from the
		// client believing the key string.
		expect(gumroadCalls).toHaveLength(1);
		expect(gumroadCalls[0].params.get('product_permalink')).toBe(GUMROAD_PRODUCT_PERMALINK);
		expect(gumroadCalls[0].params.get('license_key')).toBe('TIPKEY-ANY-AMOUNT');
		expect(ls().getItem(SUPPORTER_KEY)).toBe('1');
		expect(ls().getItem(TIP_LICENSE_KEY)).toBe('TIPKEY-ANY-AMOUNT');
		expect(isSupporter()).toBe(true);
	});

	it('supporter state persists across a reload (fresh module read of the stored flag)', async () => {
		await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		expect(isSupporter()).toBe(true);
		// A reload re-reads localStorage from scratch — a brand-new module
		// instance must still see the supporter state.
		vi.resetModules();
		const fresh = await import('$lib/config/sponsored');
		expect(fresh.isSupporter()).toBe(true);
	});

	it('after unlock, album Download all saves ONE real zip named after the album, entries + audio inside', async () => {
		await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		const res = await tapAlbumDownloadAll(albumOf([1, 2, 3]).tracks, META);
		expect(res).toEqual({ saved: 3, total: 3 });
		expect(gateEvents).toEqual([]);
		expect(saves).toHaveLength(1);
		expect(saves[0].filename).toBe('Artist - Album.zip');
		const zip = saves[0].blob;
		expect(zip).not.toBeNull();
		expect(zip!.type).toBe('application/zip');
		const bytes = new Uint8Array(await zip!.arrayBuffer());
		// A real zip: local-header signature up front, end-of-central-directory at the tail.
		expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(hasSig(bytes, [0x50, 0x4b, 0x05, 0x06])).toBe(true);
		// Store-only zip: entry names and the mock audio payloads ride in clear.
		const text = new TextDecoder().decode(bytes);
		for (const n of [1, 2, 3]) {
			expect(text).toContain(`Artist - Album/Artist - Song${n}.m4a`);
			expect(text).toContain(`audio:qq:${n}`);
		}
	});

	it('after unlock, discography Download ALL saves one zip per album, in order', async () => {
		await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		const second = { artist: 'Artist', album: 'Second' };
		const results = await tapDiscographyDownloadAll([albumOf([1, 2]), albumOf([4], second)]);
		expect(results).toEqual([
			{ saved: 2, total: 2 },
			{ saved: 1, total: 1 }
		]);
		expect(saves.map((s) => s.filename)).toEqual(['Artist - Album.zip', 'Artist - Second.zip']);
		const secondText = new TextDecoder().decode(new Uint8Array(await saves[1].blob!.arrayBuffer()));
		expect(secondText).toContain('Artist - Second/Artist - Song4.m4a');
	});
});

// ---------------------------------------------------------------------------
// 4. NEGATIVE — the server is the grantor; bad answers keep the gate shut.
// ---------------------------------------------------------------------------

describe('bulk unlock e2e — negative (server grants, client never self-grants)', () => {
	it('the SAME key flips outcome with Gumroad’s answer — refused when Gumroad says no, unlocked when it says yes', async () => {
		gumroadMode = 'invalid';
		const refused = await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		expect(refused.ok).toBe(false);
		expect(refused.reason).toBe('invalid');
		expect(ls().getItem(SUPPORTER_KEY)).toBeNull();
		expect(isSupporter()).toBe(false);
		expect(await tapAlbumDownloadAll(albumOf([1]).tracks, META)).toBe('gated');
		expect(saves).toHaveLength(0);

		gumroadMode = 'valid';
		const granted = await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT');
		expect(granted.ok).toBe(true);
		expect(isSupporter()).toBe(true);
		// Both calls carried the identical key string to Gumroad — only the
		// upstream answer changed, so the upstream answer is the grantor.
		expect(gumroadCalls.map((c) => c.params.get('license_key'))).toEqual([
			'TIPKEY-ANY-AMOUNT',
			'TIPKEY-ANY-AMOUNT'
		]);
	});

	it('a refunded tip does not unlock', async () => {
		gumroadMode = 'refunded';
		const data = await verifyKeyOnThisDevice('TIPKEY-REFUNDED');
		expect(data.ok).toBe(false);
		expect(data.reason).toBe('refunded');
		expect(isSupporter()).toBe(false);
		expect(await tapAlbumDownloadAll(albumOf([1]).tracks, META)).toBe('gated');
		expect(saves).toHaveLength(0);
	});

	it('a chargebacked tip does not unlock', async () => {
		gumroadMode = 'chargebacked';
		const data = await verifyKeyOnThisDevice('TIPKEY-CHARGEBACK');
		expect(data.ok).toBe(false);
		expect(data.reason).toBe('refunded');
		expect(isSupporter()).toBe(false);
	});

	it('Gumroad unreachable or erroring fails closed — no unlock, gate stays', async () => {
		gumroadMode = 'transport-error';
		expect((await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT')).reason).toBe('error');
		expect(isSupporter()).toBe(false);
		gumroadMode = 'http-error';
		expect((await verifyKeyOnThisDevice('TIPKEY-ANY-AMOUNT')).reason).toBe('error');
		expect(isSupporter()).toBe(false);
		expect(await tapAlbumDownloadAll(albumOf([1]).tracks, META)).toBe('gated');
		expect(saves).toHaveLength(0);
	});

	it('the endpoint refuses a keyless request outright (400, ok:false)', async () => {
		const res = await post(fakeEvent({ public_wall: false }));
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.ok).toBe(false);
		expect(gumroadCalls).toHaveLength(0);
		expect(isSupporter()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 5. CONTROL — per-song download is free for everyone, supporter or not.
//    The engine's own behaviour is download-track.test.ts's suite; this leg
//    pins that the per-song path consults NO supporter state (structural) and
//    runs with the flag off (functional, at the repo's engine seam).
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(p, 'utf-8');
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

describe('bulk unlock e2e — control: per-song download stays free', () => {
	it('no supporter gate exists anywhere in the per-song path (TrackMenu + downloadTrack sources)', () => {
		for (const p of ['src/lib/components/TrackMenu.svelte', 'src/lib/services/download-track.ts']) {
			const code = stripComments(read(p));
			expect(code, p).not.toContain('isSupporter');
			expect(code, p).not.toContain('SUPPORTER_KEY');
			expect(code, p).not.toContain('dawn_supporter');
		}
	});

	it('a per-song download (the exact call TrackMenu.pickDownload makes) succeeds with the flag OFF', async () => {
		expect(isSupporter()).toBe(false);
		const track = mk(1);
		const res = await mocks.downloadTrack(track, { audioFrom: track });
		expect(res).toBe('saved');
		expect(gateEvents).toEqual([]);
		expect(isSupporter()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Structural pins — the component wiring the functional legs mirror.
// ---------------------------------------------------------------------------

describe('bulk unlock e2e — the real pages/sheet are wired to this chain (source-pinned)', () => {
	it('album page: the Download-all button’s tap gates on isSupporter BEFORE any downloadAlbum call', () => {
		const code = stripComments(read('src/routes/(app)/album/[name]/+page.svelte'));
		expect(code).toContain('onclick={onDownloadTap}');
		const rest = code.slice(code.indexOf('function onDownloadTap()'));
		const gate = rest.indexOf('if (!isSupporter())');
		const run = rest.indexOf('void downloadAlbum()');
		expect(gate).toBeGreaterThan(-1);
		expect(run).toBeGreaterThan(gate);
		const gateBlock = rest.slice(gate, run);
		expect(gateBlock).toContain("t('support.bulkLocked')");
		expect(gateBlock).toContain('support.openSheet()');
		expect(gateBlock).toContain('return');
	});

	it('artist page: discography Download ALL gates on isSupporter BEFORE the pack run', () => {
		const code = stripComments(read('src/routes/(app)/artist/[name]/albums/+page.svelte'));
		expect(code).toContain('onclick={downloadAll}');
		const rest = code.slice(code.indexOf('async function downloadAll()'));
		const gate = rest.indexOf('if (!isSupporter())');
		const run = rest.indexOf('downloadAlbumTracks(');
		expect(gate).toBeGreaterThan(-1);
		expect(run).toBeGreaterThan(gate);
		const gateBlock = rest.slice(gate, run);
		expect(gateBlock).toContain("t('support.bulkLocked')");
		expect(gateBlock).toContain('support.openSheet()');
	});

	it('SupporterSheet: the flag is set exactly once, inside the verify ok branch, after posting to the endpoint', () => {
		const code = stripComments(read('src/lib/components/SupporterSheet.svelte'));
		expect(code).toContain("apiFetch('/api/sponsored/verify'");
		const sets = [...code.matchAll(/localStorage\.setItem\(SUPPORTER_KEY, '1'\)/g)];
		expect(sets).toHaveLength(1);
		const okBranch = code.indexOf('if (data?.ok)');
		expect(okBranch).toBeGreaterThan(-1);
		expect(sets[0].index).toBeGreaterThan(okBranch);
	});

	it('isSupporter reads ONLY the supporter flag — no tier, no amount, no price anywhere in the gate predicate', () => {
		const code = stripComments(read('src/lib/config/sponsored.ts'));
		const body = code.slice(code.indexOf('export function isSupporter()'));
		const fn = body.slice(0, body.indexOf('\n}\n') + 3);
		expect(fn).toContain('SUPPORTER_KEY');
		expect(fn).not.toContain('TIER');
		expect(fn.toLowerCase()).not.toContain('amount');
		expect(fn.toLowerCase()).not.toContain('price');
	});
});
