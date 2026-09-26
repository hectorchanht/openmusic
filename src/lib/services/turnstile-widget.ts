// turnstile-widget — lazy loader for the Cloudflare Turnstile browser widget (quick-260926-nsz),
// used only by the comment composer (NpComments.svelte). The server half is $lib/proxy/turnstile.
//
// The script is injected ONCE per app, on first need (the Comments pane mounting), never as a global
// <script> in app.html: most sessions never open Comments and should not pay for a third-party
// script. `?render=explicit` so it renders only where we ask, with our options.

/** PUBLIC by design — a site key ships in every page that renders the widget. The secret is server-only. */
export const TURNSTILE_SITEKEY = '0x4AAAAAAFEvje1fGyRJgFd2';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The subset of `window.turnstile` we call. */
export interface TurnstileApi {
	render(el: HTMLElement, opts: Record<string, unknown>): string | null | undefined;
	reset(id: string): void;
	remove(id: string): void;
}

let loading: Promise<TurnstileApi | null> | null = null;

/** Resolves the widget API, or null (SSR, blocked script, offline). Never rejects. */
export function loadTurnstile(): Promise<TurnstileApi | null> {
	if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
	const w = window as unknown as { turnstile?: TurnstileApi };
	if (w.turnstile) return Promise.resolve(w.turnstile);
	loading ??= new Promise((resolve) => {
		const s = document.createElement('script');
		s.src = SCRIPT_URL;
		s.async = true;
		s.defer = true;
		s.onload = () => resolve(w.turnstile ?? null);
		s.onerror = () => {
			// Forget the failed attempt so a later mount (e.g. back online) can try again.
			s.remove();
			loading = null;
			resolve(null);
		};
		document.head.appendChild(s);
	});
	return loading;
}
