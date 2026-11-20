// D-01 SPA guard: the native (Capacitor) build uses adapter-static with an index.html
// fallback, which requires a fully client-rendered SPA — so SSR and prerendering are
// disabled at the root layout. This also applies to the web build, but the app already
// runs client-rendered (the single <audio> + player store live client-side), and the
// only universal load — (app)/+page.ts — reads url.searchParams only (share-token OG),
// so disabling SSR yields og:null with no server fetch (RESEARCH Pattern 2). The
// Cloudflare web deploy is otherwise unchanged.
export const ssr = false;
export const prerender = false;
