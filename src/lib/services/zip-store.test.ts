import { describe, it, expect } from 'vitest';
import { crc32, buildZip, type ZipEntry } from './zip-store';

// 40-D-03: the store-only ZIP writer. Pure, node-only — the produced Blob is parsed back with a
// DataView (fixtures are tiny) and every fixed header field is checked against PKWARE APPNOTE.
const enc = new TextEncoder();

describe('zip-store — crc32 (40-D-03)', () => {
	it('matches the standard CRC-32 check value', () => {
		expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
	});

	it('is chainable across chunks', () => {
		const a = enc.encode('hello ');
		const b = enc.encode('world');
		const ab = new Uint8Array([...a, ...b]);
		expect(crc32(b, crc32(a))).toBe(crc32(ab));
	});
});

describe('zip-store — buildZip (40-D-03)', () => {
	it('an empty archive is a bare 22-byte EOCD', async () => {
		const z = await buildZip([]);
		expect(z).not.toBeNull();
		expect(z!.size).toBe(22);
		const v = new DataView(await z!.arrayBuffer());
		expect(v.getUint32(0, true)).toBe(0x06054b50);
		expect(v.getUint16(8, true)).toBe(0);
		expect(v.getUint16(10, true)).toBe(0);
	});

	it('writes local headers, central directory and EOCD that round-trip', async () => {
		const bodies = ['first file body', '七里香 audio bytes'];
		const entries: ZipEntry[] = [
			{ name: 'Album/a.mp3', blob: new Blob([bodies[0]]) },
			{ name: '周杰倫 - 葉惠美/七里香.m4a', blob: new Blob([bodies[1]]) }
		];
		const z = await buildZip(entries);
		expect(z).not.toBeNull();
		expect(z!.type).toBe('application/zip');
		const buf = new Uint8Array(await z!.arrayBuffer());
		const v = new DataView(buf.buffer);

		// EOCD is the last 22 bytes (no comment).
		const eocd = buf.length - 22;
		expect(v.getUint32(eocd, true)).toBe(0x06054b50);
		expect(v.getUint16(eocd + 8, true)).toBe(2);
		expect(v.getUint16(eocd + 10, true)).toBe(2);
		const cdSize = v.getUint32(eocd + 12, true);
		const cdOffset = v.getUint32(eocd + 16, true);
		expect(cdOffset + cdSize).toBe(eocd);

		// Local header #1 sits at offset 0.
		expect(v.getUint32(0, true)).toBe(0x04034b50);

		let cd = cdOffset;
		for (let i = 0; i < entries.length; i++) {
			const body = enc.encode(bodies[i]);
			const nameBytes = enc.encode(entries[i].name);
			// Central header.
			expect(v.getUint32(cd, true)).toBe(0x02014b50);
			expect(v.getUint16(cd + 8, true)).toBe(0x0800);
			expect(v.getUint16(cd + 10, true)).toBe(0);
			expect(v.getUint32(cd + 16, true)).toBe(crc32(body));
			expect(v.getUint32(cd + 20, true)).toBe(body.length);
			expect(v.getUint32(cd + 24, true)).toBe(body.length);
			expect(v.getUint16(cd + 28, true)).toBe(nameBytes.length);
			expect(buf.slice(cd + 46, cd + 46 + nameBytes.length)).toEqual(nameBytes);
			const lh = v.getUint32(cd + 42, true);

			// Local header it points at.
			expect(v.getUint32(lh, true)).toBe(0x04034b50);
			expect(v.getUint16(lh + 4, true)).toBe(20);
			expect(v.getUint16(lh + 6, true)).toBe(0x0800);
			expect(v.getUint16(lh + 8, true)).toBe(0);
			expect(v.getUint32(lh + 14, true)).toBe(crc32(body));
			expect(v.getUint32(lh + 18, true)).toBe(body.length);
			expect(v.getUint32(lh + 22, true)).toBe(body.length);
			expect(v.getUint16(lh + 26, true)).toBe(nameBytes.length);
			expect(v.getUint16(lh + 28, true)).toBe(0);
			expect(buf.slice(lh + 30, lh + 30 + nameBytes.length)).toEqual(nameBytes);
			const data = lh + 30 + nameBytes.length;
			expect(buf.slice(data, data + body.length)).toEqual(body);

			cd += 46 + nameBytes.length;
		}
		expect(cd).toBe(eocd);
	});

	it('returns null above 0xFFFF entries without reading any blob', async () => {
		const entries = { length: 0x10000 } as unknown as ZipEntry[];
		expect(await buildZip(entries)).toBeNull();
	});

	it('returns null when the archive would pass 4 GiB without streaming', async () => {
		let streamed = false;
		const huge = {
			size: 0x1_0000_0000,
			stream: () => {
				streamed = true;
				throw new Error('must not stream');
			}
		} as unknown as Blob;
		expect(await buildZip([{ name: 'x.flac', blob: huge }])).toBeNull();
		expect(streamed).toBe(false);
	});
});
