import cloudflare from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';

// D-01: dual-adapter build switch. Default (BUILD_TARGET unset) keeps adapter-cloudflare
// so the Cloudflare Pages deploy output is unchanged. `BUILD_TARGET=native` swaps in
// adapter-static to emit a full client-side SPA (build/index.html fallback) that the
// Capacitor Android shell wraps. fallback: 'index.html' is safe — there is no
// prerendered homepage to conflict and no +page.server.ts. strict: false is required
// for the dynamic SPA routes (/album/[name], /artist/[name]) that rely on the fallback.
const native = process.env.BUILD_TARGET === 'native';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
	},
	kit: {
		adapter: native
			? staticAdapter({
					pages: 'build',
					assets: 'build',
					fallback: 'index.html',
					precompress: false,
					strict: false
			  })
			: cloudflare(),
		// D-03 / Pitfall 1: the Capacitor native (adapter-static) shell serves its own
		// files, so SvelteKit must NOT auto-register the web service worker there.
		// Web (Cloudflare) build keeps register: true.
		serviceWorker: { register: !native }
	}
};

export default config;
