import { describe, it, expect } from 'vitest';
// quick-261004-n1i: the watcher lives in scripts/ (a dependency-free .mjs the weekly workflow runs
// with no install step); its pure pieces are exported so they are tested here, like upstream-health.
import {
	MUSICDL_KUWO_URL,
	extractHosts,
	diffHosts,
	prBody,
	parseArgs
} from '../../../scripts/musicdl-watch.mjs';

describe('extractHosts', () => {
	it('returns lowercased, deduped, sorted hostnames from every URL in the file', () => {
		const py = `
			PRIMARY = 'https://musicapi.haitangw.net/music/kw.php'
			SECOND = "http://music.nxinxz.com/kw.php"
			OTHER = 'https://musicapi.haitangw.net/other'
			SEARCH = 'https://Search.Kuwo.cn/r.s'
		`;
		expect(extractHosts(py)).toEqual(['music.nxinxz.com', 'musicapi.haitangw.net', 'search.kuwo.cn']);
	});

	it('returns [] for text with no URLs and ignores a bare domain word', () => {
		expect(extractHosts('no urls here')).toEqual([]);
		expect(extractHosts('# talks about kuwo.cn without a scheme')).toEqual([]);
	});
});

describe('diffHosts', () => {
	it('reports added + removed as a set difference', () => {
		expect(diffHosts(['a.com', 'b.com'], ['b.com', 'c.com'])).toEqual({
			added: ['c.com'],
			removed: ['a.com'],
			changed: true
		});
	});

	it('identical lists in any order are unchanged', () => {
		expect(diffHosts(['b.com', 'a.com'], ['a.com', 'b.com'])).toEqual({ added: [], removed: [], changed: false });
	});
});

describe('prBody', () => {
	it('links the source, lists added/removed hosts and tells the reviewer src/ is untouched', () => {
		const body = prBody({
			added: ['new.example'],
			removed: ['gone.example'],
			hosts: ['keep.example', 'new.example'],
			url: MUSICDL_KUWO_URL
		});
		expect(body).toContain(MUSICDL_KUWO_URL);
		expect(body).toMatch(/## Added[\s\S]*- new\.example/);
		expect(body).toMatch(/## Removed[\s\S]*- gone\.example/);
		expect(body).toContain('Nothing in src/ was changed');
		expect(body).toContain('KUWO_AUDIO_RESOLVERS');
		expect(body).toMatch(/verify each new host/i);
	});

	it("prints '(none)' for an empty section", () => {
		const body = prBody({ added: [], removed: ['x.example'], hosts: [], url: MUSICDL_KUWO_URL });
		expect(body).toMatch(/## Added\n\n\(none\)/);
	});
});

describe('parseArgs', () => {
	it('defaults to the committed snapshot, read-only, no body file', () => {
		expect(parseArgs([])).toEqual({ snapshot: 'scripts/musicdl-kuwo-hosts.json', write: false, bodyOut: null });
	});

	it('honours --write, --body-out and --snapshot', () => {
		expect(parseArgs(['--write', '--body-out', 'pr.md', '--snapshot', 'x.json'])).toEqual({
			snapshot: 'x.json',
			write: true,
			bodyOut: 'pr.md'
		});
	});
});
