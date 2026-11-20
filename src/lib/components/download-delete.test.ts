// quick-261119-dldelete — STRUCTURAL gate for the tappable downloaded ✓.
// Vitest here has no jsdom, so components cannot be rendered; like settings-ui.test.ts these
// tests read SOURCE and pin the wiring Hector asked for: the downloaded state is a real
// button opening the ONE shared remove-download confirm, delete always takes the bytes with
// it, and the old keep-the-file toggle cannot creep back into either surface.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf-8');
/** Code only — comments in these files document the old behaviour they replaced, and a gate
 *  reading raw text would match its own prose. */
const readCode = (p: string) =>
	read(p)
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');

const DC = 'src/lib/components/DownloadControl.svelte';
const TM = 'src/lib/components/TrackMenu.svelte';
const SHEET = 'src/lib/components/RemoveDownloadSheet.svelte';

describe('downloaded ✓ is a button opening the shared confirm (quick-261119-dldelete)', () => {
	it('DownloadControl renders the downloaded state as a <button> that opens RemoveDownloadSheet', () => {
		const code = readCode(DC);
		expect(code).toContain("dlState === 'downloaded'");
		expect(code).toContain('<button');
		expect(code).toContain('class="dc downloaded"');
		expect(code).toContain('rmOpen = true');
		expect(code).toContain('<RemoveDownloadSheet');
		// the accessible name carries BOTH the state and the action
		expect(code).toContain("t('menu.downloaded')} · ${t('menu.removeDownload')}");
	});

	it('TrackMenu opens the same shared sheet for its Remove download entry', () => {
		const code = readCode(TM);
		expect(code).toContain('<RemoveDownloadSheet');
		expect(code).toContain('openRemoveDownload');
	});

	it('the keep-the-file toggle is gone from both surfaces', () => {
		expect(readCode(TM)).not.toContain('rmDeleteFile');
		expect(readCode(TM)).not.toContain('removeDownloadDeleteFile');
		expect(readCode(SHEET)).not.toContain('deleteFile');
		expect(readCode(DC)).not.toContain('deleteFile');
	});

	it('the sheet deletes through removeDownload defaults (record + blob together) and offers per-version + remove-all', () => {
		const code = readCode(SHEET);
		expect(code).toContain('library.removeDownload(uid)');
		expect(code).toContain('library.downloadVersionsFor(track)');
		expect(code).toContain("t('menu.removeDownloadAll')");
		expect(code).toContain("t('menu.removeDownloadVersions'");
		expect(code).toContain("t('menu.removeDownloadBody')");
		// dismiss routes never delete: the scrim/drag close handler is onclose, not a delete fn
		expect(code).toContain('use:dragClose={{ onclose }}');
	});
});

describe('DownloadControl gestures — tap vs long-press (quick-261119-dldelete amendment)', () => {
	const PICKER = 'src/lib/components/DownloadPickerSheet.svelte';

	it('idle: click downloads via run(); long-press opens the picker and never starts a download', () => {
		const code = readCode(DC);
		expect(code).toContain('onclick={run}');
		expect(code).toContain('use:longpress');
		expect(code).toContain('onlongpress={openPicker}');
		// the picker opener itself must not fall into the download path
		const opener = code.slice(code.indexOf('async function openPicker()'), code.indexOf('async function run()'));
		expect(opener).toContain('pickOpen = true');
		expect(opener).not.toContain('downloadTrackWithDonor');
		expect(code).toContain('<DownloadPickerSheet');
		expect(code).toContain('overlayId="downloadcontrol-dlpick"');
	});

	it('downloaded: click opens the delete confirm, long-press opens the version manager', () => {
		const code = readCode(DC);
		expect(code).toContain('rmManage = false; rmOpen = true');
		expect(code).toContain('rmManage = true; rmOpen = true');
		expect(code).toContain('manage={rmManage}');
	});

	it('the version manager lists versions even for a single version; delete-all stays multi-only', () => {
		const code = readCode(SHEET);
		expect(code).toContain('manage = false');
		expect(code).toContain('const showList = $derived(multi || manage);');
		expect(code).toContain('{#if multi}');
	});

	it('TrackMenu mounts the SAME picker component (seeded with its own-source probe), internals extracted', () => {
		const code = readCode(TM);
		expect(code).toContain('<DownloadPickerSheet');
		expect(code).toContain('seedProbe={dlProbe}');
		expect(code).toContain('overlayId="trackmenu-dlpick"');
		expect(code).toContain('onpicked={probeBlob}');
		// the private probe pool is gone from the menu — one picker, one path
		expect(code).not.toContain('dlPickProbes');
		expect(code).not.toContain('dlPickExtra');
	});

	it('the shared picker keeps the capped probe pool and the one downloadTrack pick path', () => {
		const code = readCode(PICKER);
		expect(code).toContain('mapWithConcurrency(list, 2,');
		expect(code).toContain('versionsIncludingOwn(target, found)');
		expect(code).toContain('downloadTrack(target, { audioFrom: p.track })');
		expect(code).toContain('pickedFileAlreadyOnDisk');
		expect(code).toContain('player.adoptDownloadedCurrent(target.uid)');
	});
});
