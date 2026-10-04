// musicdl kuwo resolver watch (quick-261004-n1i).
//
// WHY: kuwo's full-length audio comes from free third-party resolvers (src/lib/proxy/kuwo.ts
// KUWO_AUDIO_RESOLVERS) that musicdl curates in its kuwo source. When that list changes — a
// resolver dies, a new one appears — ours silently rots: the old kw-api upstream was dead for
// months before anyone noticed. This script diffs the HOSTNAMES in musicdl's kuwo.py against a
// committed snapshot (scripts/musicdl-kuwo-hosts.json) so a change surfaces as a review PR.
//
// LICENSE: musicdl (github.com/CharlesPikachu/musicdl) is PolyForm Noncommercial. This script reads
// the file only to compare hostnames; no musicdl code is copied, and the resolver route code takes
// the URLs/params as facts only.
//
// SAFETY: this script never edits src/, and the workflow that runs it never pushes main — a push to
// main auto-deploys prod. GitHub Issues are disabled on this repo, so a PR is the review signal; a
// human verifies any new host from the edge and edits KUWO_AUDIO_RESOLVERS by hand.
//
// Run: node scripts/musicdl-watch.mjs [--snapshot <file>] [--write] [--body-out <file>]
// Exit: 1 only when musicdl cannot be read (a red job is the right signal); 0 whether or not the
// hosts changed — the workflow uses `git diff --quiet` on the snapshot as the change signal.
import { readFileSync, writeFileSync } from 'node:fs';

export const MUSICDL_KUWO_URL =
	'https://raw.githubusercontent.com/CharlesPikachu/musicdl/master/musicdl/modules/sources/kuwo.py';

/**
 * Unique, sorted, lowercase hostnames of every http(s) URL in `text`.
 * @param {string} text
 * @returns {string[]}
 */
export function extractHosts(text) {
	const hosts = new Set();
	for (const m of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
	return [...hosts].sort();
}

/**
 * @param {string[]} prev
 * @param {string[]} next
 * @returns {{ added: string[], removed: string[], changed: boolean }}
 */
export function diffHosts(prev, next) {
	const added = next.filter((h) => !prev.includes(h)).sort();
	const removed = prev.filter((h) => !next.includes(h)).sort();
	return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

/**
 * Markdown body for the review PR.
 * @param {{ added: string[], removed: string[], hosts: string[], url: string }} d
 * @returns {string}
 */
export function prBody({ added, removed, hosts, url }) {
	/** @param {string[]} list */
	const bullets = (list) => (list.length ? list.map((h) => `- ${h}`).join('\n') : '(none)');
	return [
		'# musicdl kuwo resolver hosts changed',
		'',
		`Source: ${url}`,
		'',
		'## Added',
		'',
		bullets(added),
		'',
		'## Removed',
		'',
		bullets(removed),
		'',
		'## Current hosts',
		'',
		bullets(hosts),
		'',
		'## Reviewer checklist',
		'',
		'- [ ] Verify each new host answers a full-length *.kuwo.cn url from the edge (`wrangler dev --remote`), not an 11 s preview clip.',
		'- [ ] Decide whether to edit `KUWO_AUDIO_RESOLVERS` in `src/lib/proxy/kuwo.ts` by hand.',
		'- [ ] This PR only updates the snapshot. Nothing in src/ was changed; a human must verify each new host from the edge before editing KUWO_AUDIO_RESOLVERS.',
		''
	].join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ snapshot: string, write: boolean, bodyOut: string | null }}
 */
export function parseArgs(argv) {
	/** @param {string} flag */
	const get = (flag) => {
		const i = argv.indexOf(flag);
		return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
	};
	return {
		snapshot: get('--snapshot') ?? 'scripts/musicdl-kuwo-hosts.json',
		write: argv.includes('--write'),
		bodyOut: get('--body-out')
	};
}

// ---- runner ------------------------------------------------------------------------------

async function main() {
	const { snapshot, write, bodyOut } = parseArgs(process.argv.slice(2));

	let text;
	try {
		const res = await fetch(MUSICDL_KUWO_URL, {
			signal: AbortSignal.timeout(15000),
			headers: { 'User-Agent': 'openmusic-musicdl-watch/1.0 ( https://openmusic.lol )' }
		});
		if (!res.ok) throw new Error(`http ${res.status}`);
		text = await res.text();
	} catch (e) {
		console.log(`cannot read ${MUSICDL_KUWO_URL}: ${e instanceof Error ? e.message : String(e)}`);
		process.exit(1);
	}

	/** @type {string[]} */
	let prev = [];
	try {
		const parsed = JSON.parse(readFileSync(snapshot, 'utf8'));
		if (Array.isArray(parsed?.hosts)) prev = parsed.hosts;
	} catch {
		// a missing snapshot is an empty one — the first run writes it
	}

	const hosts = extractHosts(text);
	const { added, removed, changed } = diffHosts(prev, hosts);
	console.log(`musicdl kuwo hosts: ${hosts.length} now, ${prev.length} in ${snapshot}`);
	console.log(`  added:   ${added.join(', ') || '(none)'}`);
	console.log(`  removed: ${removed.join(', ') || '(none)'}`);
	console.log(changed ? 'CHANGED' : 'unchanged');

	if (changed && write) {
		// No timestamp in the snapshot: it would change every run and open a PR every week.
		writeFileSync(snapshot, JSON.stringify({ source: MUSICDL_KUWO_URL, hosts }, null, '\t') + '\n');
		if (bodyOut) writeFileSync(bodyOut, prBody({ added, removed, hosts, url: MUSICDL_KUWO_URL }));
		console.log(`wrote ${snapshot}${bodyOut ? ` and ${bodyOut}` : ''}`);
	}
}

// Only run when executed directly, so the tests can import the pure pieces.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
