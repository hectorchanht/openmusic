// posthog — third-party product analytics (PostHog, org "dawn studio", the
// ONE shared "Default project"; every event carries the super property
// { app: 'openmusic' } so shared-project data stays attributable).
//
// quick-261010-posthog: Complements the first-party D1 play-count analytics
// in analytics.ts — that module stays untouched; PostHog is the
// product-analytics complement.
//
// Browser-only: call initPosthog() from onMount in the root layout. The
// posthog-js import is dynamic so the SSR/prerender bundle never executes
// browser SDK code. Anonymous by design — never call posthog.identify().
// Session replay OFF, autocapture OFF: we capture key events manually only.
//
// Key/host resolution: VITE_POSTHOG_KEY / VITE_POSTHOG_HOST when baked at
// build time, falling back to the shared project's public client key/host
// (public keys — safe to embed in the frontend bundle). No PII in events,
// ever: only anonymous behavioural signals (ids, flags, buckets).

import { browser } from '$app/environment';

const FALLBACK_KEY = 'phc_Dn2EebGR8eVrLKfQwArtfwxE4cUKQq2NPhwMRph4LqUf';
const FALLBACK_HOST = 'https://us.i.posthog.com';

const APP_SUPER_PROP = { app: 'openmusic' } as const;
const FIRST_OPEN_KEY = 'posthog_first_open_seen';

type PostHogLike = {
	init: (key: string, opts: Record<string, unknown>) => void;
	register: (props: Record<string, unknown>) => void;
	capture: (event: string, props?: Record<string, unknown>) => void;
};

let client: PostHogLike | null = null;
let initStarted = false;

/** Browser-only SDK init. Idempotent; safe to call from onMount. */
export async function initPosthog(): Promise<void> {
	if (!browser || initStarted) return;
	initStarted = true;
	try {
		// posthog-js's documented entry is a default-exported singleton; the
		// namespace cast goes through unknown because the ESM/CJS interop
		// shape is wider than PostHogLike.
		const mod = (await import('posthog-js')) as unknown as { default: PostHogLike };
		const ph = mod.default;
		ph.init(import.meta.env.VITE_POSTHOG_KEY || FALLBACK_KEY, {
			api_host: import.meta.env.VITE_POSTHOG_HOST || FALLBACK_HOST,
			autocapture: false,
			capture_pageview: true,
			capture_pageleave: true
		});
		// CRITICAL: every event from this app must carry { app: 'openmusic' } —
		// the shared project is useless without it.
		ph.register({ ...APP_SUPER_PROP });
		client = ph;
	} catch {
		// analytics must never break the app — capture() no-ops below.
	}
}

/** Fire-and-forget event capture. No-op until initPosthog() completes. */
export function track(event: string, props: Record<string, unknown> = {}): void {
	if (!browser || !client) return;
	try {
		client.capture(event, props);
	} catch {
		/* analytics ping failed — ignore */
	}
}

/** app_first_open — exactly once per browser (localStorage flag). */
export function trackFirstOpen(): void {
	if (!browser || !client) return;
	try {
		if (localStorage.getItem(FIRST_OPEN_KEY)) return;
		localStorage.setItem(FIRST_OPEN_KEY, '1');
		const params = new URLSearchParams(location.search);
		track('app_first_open', {
			referrer: document.referrer || '',
			utm_source: params.get('utm_source') || '',
			locale: navigator.language || ''
		});
	} catch {
		/* storage unavailable (private mode) — skip */
	}
}
