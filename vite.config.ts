import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

// quick-261006-i18n: give the lazy locale-dictionary chunks a stable filename prefix
// (`locale-<lang>.<hash>.js`) so the service worker can skip precaching them — they
// are fetched on demand via ensureLocale(). SvelteKit forces fully-hashed client
// chunk names (`chunks/[hash].js`), so without this the SW cannot tell a 60 KB Hindi
// dictionary from app code and would precache all 14 (~600 KB) on every install and
// every deploy (the version-keyed cache rotates), undoing the lazy-load saving.
// Runs at generateBundle: renaming chunk.fileName there is reference-safe (the
// bundler rewrites every importer). `apply: 'build'` keeps it out of vitest, which
// never runs generateBundle.
function localeChunkNames(): Plugin {
	const LOCALE_RE = /src\/lib\/i18n\/(zh-Hant|zh-Hans|es|fr|de|pt|it|ru|tr|ar|hi|id|vi|th)\.ts$/;
	return {
		name: 'openmusic-locale-chunk-names',
		apply: 'build',
		generateBundle(_options, bundle) {
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== 'chunk' || !chunk.isDynamicEntry) continue;
				const locales = chunk.moduleIds
					.map((id) => id.match(LOCALE_RE)?.[1])
					.filter((l): l is string => l !== undefined);
				if (locales.length === 0) continue;
				const tag = new Set(locales).size === 1 ? locales[0] : 'shared';
				const base = chunk.fileName.split('/').pop() ?? chunk.fileName;
				const hash = base.replace(/\.js$/, '');
				chunk.fileName = chunk.fileName.replace(/[^/]+$/, `locale-${tag}.${hash}.js`);
			}
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
