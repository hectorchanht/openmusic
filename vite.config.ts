import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

// quick-261006-i18n: give the lazy locale-dictionary chunks a stable filename prefix
// (`chunks/locale-<lang>.<hash>.js`) so the service worker can skip precaching them —
// they are fetched on demand via ensureLocale(). SvelteKit forces fully-hashed client
// chunk names (`chunks/[hash].js`), so without this the SW cannot tell a 60 KB Hindi
// dictionary from app code and would precache all 14 (~600 KB) on every install and
// every deploy (the version-keyed cache rotates), undoing the lazy-load saving.
//
// The names are assigned via outputOptions.chunkFileNames — i.e. DURING Rollup's chunk
// naming, so every importer's specifier is rendered against the final fileName. A
// generateBundle post-hoc rename does NOT update importers: the client would 404 on
// language switch and wrangler's Pages Functions bundling fails to resolve the server
// chunks (the two failed deploys of e1727457/3b090ad). This is reference-safe for both
// the client and the SSR bundle, so no isSsr special-casing is needed.
// `apply: 'build'` keeps it out of vitest.
function localeChunkNames(): Plugin {
	const LOCALE_RE = /src\/lib\/i18n\/(zh-Hant|zh-Hans|es|fr|de|pt|it|ru|tr|ar|hi|id|vi|th)\.ts$/;
	return {
		name: 'openmusic-locale-chunk-names',
		apply: 'build',
		outputOptions(options) {
			const prev = options.chunkFileNames;
			options.chunkFileNames = (chunkInfo) => {
				const ids: string[] = chunkInfo.moduleIds ?? Object.keys(chunkInfo.modules ?? {});
				let tag: string | undefined;
				for (const id of ids) {
					const m = id.match(LOCALE_RE);
					if (!m) continue;
					tag = tag === undefined ? m[1] : tag === m[1] ? tag : 'shared';
				}
				if (tag !== undefined) {
					// Keep the `locale-<tag>.<hash>.js` shape: the service worker's
					// LOCALE_CHUNK_RE matches on it to skip precaching. The prefix is
					// injected into SvelteKit's own pattern so directory + hash scheme
					// are preserved (client: _app/immutable/chunks/[hash].js).
					const prevName =
						typeof prev === 'function' ? prev(chunkInfo) : (prev ?? 'chunks/[name]-[hash].js');
					return prevName.replace(/([^/]+)$/, `locale-${tag}.$1`);
				}
				if (typeof prev === 'function') return prev(chunkInfo);
				return prev ?? 'chunks/[name]-[hash].js';
			};
			return options;
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), localeChunkNames()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Includes `*.svelte.test.ts` too: the sveltekit Vite plugin transforms `$state`
					// runes for node, and the player store's runes-backed logic (playStub dedupe +
					// generation guard, FIX-A) is pure enough to unit-test headless here. No jsdom
					// client project exists, so a `.svelte.test.ts` must run under this node project.
					include: ['src/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
