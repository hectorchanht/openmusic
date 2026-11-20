import { describe, it, expect, vi, beforeEach } from 'vitest';

// backup-io.ts (35-03, D-14/D-16/D-17/D-18) is the phase's ONE platform seam for "the backup file
// leaves the app". On web it hands a Blob to the existing anchor-save seam (download-save.ts); on
// native it writes the JSON into the app cache and opens the OS share sheet. These tests pin:
//   (1) the web branch never touches a Capacitor plugin and never re-implements the anchor save,
//   (2) the native branch writes to the CACHE directory (Pitfall 6 — the FileProvider's
//       file_paths.xml declares <cache-path> but no <files-path>, so the app-files directory would
//       fail at share time with "Failed to find configured root"),
//   (3) a DISMISSED share sheet is 'dismissed', not 'failed' (Pitfall 8 — Android rejects the
//       share promise when the user backs out, which is a normal outcome, not an error).
// All node-runnable via vi.mock: no browser, no device, no jsdom.

vi.mock('$app/environment', () => ({ browser: true }));

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
	Capacitor: { isNativePlatform: () => isNativePlatform() }
}));

const writeFile = vi.fn((_opts: { path: string; directory: string; data: string; encoding: string }) =>
	Promise.resolve()
);
const getUri = vi.fn((_opts: { path: string; directory: string }) =>
	Promise.resolve({ uri: 'file:///cache/x.json' })
);
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: {
		writeFile: (opts: unknown) => writeFile(opts as never),
		getUri: (opts: unknown) => getUri(opts as never)
	},
	Directory: { Cache: 'CACHE', Data: 'DATA' },
	Encoding: { UTF8: 'utf8' }
}));

const share = vi.fn((_opts: { title?: string; files?: string[]; dialogTitle?: string }) => Promise.resolve());
vi.mock('@capacitor/share', () => ({ Share: { share: (opts: unknown) => share(opts as never) } }));

const saveBlobToDisk = vi.fn((_blob: Blob, _filename: string) => true);
vi.mock('$lib/services/download-save', () => ({
	saveBlobToDisk: (blob: Blob, filename: string) => saveBlobToDisk(blob, filename)
}));

import { exportBackup } from './backup-io';

const JSON_BODY = '{"a":1}'; // 7 bytes — pinned below so a stray re-encode is caught
const FILENAME = 'openmusic-backup-2026-09-13.json';

beforeEach(() => {
	vi.clearAllMocks();
	isNativePlatform.mockReturnValue(false);
	saveBlobToDisk.mockReturnValue(true);
	writeFile.mockResolvedValue(undefined);
	getUri.mockResolvedValue({ uri: 'file:///cache/x.json' });
	share.mockResolvedValue(undefined);
});

describe('backup-io — web', () => {
	it('hands a application/json Blob and the exact filename to saveBlobToDisk and returns ok', async () => {
		const res = await exportBackup(JSON_BODY, FILENAME);
		expect(res).toBe('ok');
		expect(saveBlobToDisk).toHaveBeenCalledTimes(1);
		const [blob, filename] = saveBlobToDisk.mock.calls[0];
		expect(blob).toBeInstanceOf(Blob);
		// D-03: the file is meant to be human-readable, so the MIME stays application/json.
		expect(blob.type).toBe('application/json');
		expect(blob.size).toBe(7);
		expect(filename).toBe(FILENAME);
	});

	it('returns failed when the anchor save seam reports failure', async () => {
		saveBlobToDisk.mockReturnValue(false);
		await expect(exportBackup(JSON_BODY, FILENAME)).resolves.toBe('failed');
	});

	it('never touches a Capacitor plugin on web (D-18)', async () => {
		await exportBackup(JSON_BODY, FILENAME);
		expect(writeFile).not.toHaveBeenCalled();
		expect(share).not.toHaveBeenCalled();
	});
});

describe('backup-io — native', () => {
	beforeEach(() => isNativePlatform.mockReturnValue(true));

	it('writes to the cache directory as UTF-8 and shares the file:// uri', async () => {
		const res = await exportBackup(JSON_BODY, FILENAME);
		expect(res).toBe('ok');
		// Pitfall 6: CACHE, never DATA — <cache-path> is the only root the FileProvider covers.
		expect(writeFile).toHaveBeenCalledWith({
			path: FILENAME,
			directory: 'CACHE',
			data: JSON_BODY,
			encoding: 'utf8'
		});
		expect(getUri).toHaveBeenCalledWith({ path: FILENAME, directory: 'CACHE' });
		// SharePlugin rejects anything that is not a file:// url.
		expect(share).toHaveBeenCalledTimes(1);
		expect(share.mock.calls[0][0].files).toEqual(['file:///cache/x.json']);
		expect(saveBlobToDisk).not.toHaveBeenCalled();
	});

	it('reports a dismissed share sheet as dismissed, not failed (Pitfall 8)', async () => {
		share.mockRejectedValue(new Error('Share canceled'));
		await expect(exportBackup(JSON_BODY, FILENAME)).resolves.toBe('dismissed');
	});

	it('reports a failed write as failed and never opens the sheet', async () => {
		writeFile.mockRejectedValue(new Error('no space'));
		await expect(exportBackup(JSON_BODY, FILENAME)).resolves.toBe('failed');
		expect(share).not.toHaveBeenCalled();
	});
});

describe('backup-io — module shape', () => {
	it('exports named symbols only, no default (house style)', async () => {
		const mod = (await import('./backup-io')) as Record<string, unknown>;
		expect(mod.default).toBeUndefined();
		expect(typeof mod.exportBackup).toBe('function');
	});
});
