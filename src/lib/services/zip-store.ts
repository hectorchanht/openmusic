// zip-store.ts — PURE, node-testable store-only ZIP writer (40-D-03: the web album download saves
// ONE `.zip`, zero third-party runtime deps).
//
// Format per PKWARE APPNOTE.TXT: local file header (4.3.7), central directory header (4.3.12), end of
// central directory record (4.3.16); general-purpose flag bit 11 = UTF-8 names (4.4.4), so CJK entry
// names round-trip; DOS time/date (4.4.6); CRC-32 (4.4.7). Method 0 (stored): audio is already
// compressed, so deflate would cost CPU for ~0% gain and the format collapses to three fixed headers.
//
// Bytes are never copied: each entry's Blob is a PART of the output Blob (IndexedDB-backed blobs stay
// referenced, not duplicated), and the CRC streams `blob.stream()` chunk by chunk — bounded memory.
// No directory entries are written; unzip/ditto create `Folder/` from the implicit entry paths.
//
// PURITY CONTRACT: no `$lib/stores` / `$app` imports — this lives in the single Vitest node project.
//
// ponytail: no Zip64 — buildZip returns null above 0xFFFFFFFF archive bytes or 0xFFFF entries (a
// lossless 12-track album is ~0.3-0.6 GB). Upgrade path = Zip64 extra fields + Zip64 EOCD records.

export interface ZipEntry {
	/** `Folder/file.ext` — forward slashes, UTF-8. */
	name: string;
	blob: Blob;
}

const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const EOCD = 22;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	TABLE[n] = c >>> 0;
}

/** CRC-32 (poly 0xedb88320). Chainable: pass the previous result to continue over the next chunk. */
export function crc32(bytes: Uint8Array, crc = 0): number {
	let c = ~crc >>> 0;
	for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return ~c >>> 0;
}

async function blobCrc(blob: Blob): Promise<number> {
	let crc = 0;
	const reader = blob.stream().getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return crc;
		crc = crc32(value, crc);
	}
}

function dosDateTime(d: Date): { time: number; date: number } {
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

/**
 * 40-D-03: assemble a store-only ZIP from `entries`. Resolves null (never throws on size) when the
 * archive would need Zip64; both guards run BEFORE any blob is streamed.
 */
export async function buildZip(entries: ZipEntry[]): Promise<Blob | null> {
	if (entries.length > MAX_U16) return null;

	const enc = new TextEncoder();
	const names = entries.map((e) => enc.encode(e.name));
	let total = EOCD;
	for (let i = 0; i < entries.length; i++) {
		total += LOCAL_HEADER + CENTRAL_HEADER + 2 * names[i].length + entries[i].blob.size;
	}
	if (total > MAX_U32) return null;

	const { time, date } = dosDateTime(new Date());
	const parts: BlobPart[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (let i = 0; i < entries.length; i++) {
		const { blob } = entries[i];
		const name = names[i];
		const crc = await blobCrc(blob);

		const lh = new Uint8Array(LOCAL_HEADER + name.length);
		const l = new DataView(lh.buffer);
		l.setUint32(0, 0x04034b50, true);
		l.setUint16(4, VERSION, true);
		l.setUint16(6, FLAG_UTF8, true);
		l.setUint16(8, 0, true);
		l.setUint16(10, time, true);
		l.setUint16(12, date, true);
		l.setUint32(14, crc, true);
		l.setUint32(18, blob.size, true);
		l.setUint32(22, blob.size, true);
		l.setUint16(26, name.length, true);
		l.setUint16(28, 0, true);
		lh.set(name, LOCAL_HEADER);
		parts.push(lh, blob);

		const ch = new Uint8Array(CENTRAL_HEADER + name.length);
		const c = new DataView(ch.buffer);
		c.setUint32(0, 0x02014b50, true);
		c.setUint16(4, VERSION, true);
		c.setUint16(6, VERSION, true);
		c.setUint16(8, FLAG_UTF8, true);
		c.setUint16(10, 0, true);
		c.setUint16(12, time, true);
		c.setUint16(14, date, true);
		c.setUint32(16, crc, true);
		c.setUint32(20, blob.size, true);
		c.setUint32(24, blob.size, true);
		c.setUint16(28, name.length, true);
		// 30 extra len, 32 comment len, 34 disk start, 36 internal attrs, 38 external attrs: all 0.
		c.setUint32(42, offset, true);
		ch.set(name, CENTRAL_HEADER);
		central.push(ch);

		offset += lh.length + blob.size;
	}

	const cdSize = central.reduce((n, ch) => n + ch.length, 0);
	const eocd = new Uint8Array(EOCD);
	const e = new DataView(eocd.buffer);
	e.setUint32(0, 0x06054b50, true);
	e.setUint16(8, entries.length, true);
	e.setUint16(10, entries.length, true);
	e.setUint32(12, cdSize, true);
	e.setUint32(16, offset, true);

	return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}
