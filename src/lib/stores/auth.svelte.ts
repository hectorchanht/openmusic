// Account session (Svelte 5 runes singleton) — magic-link sign-in + sync status
// (quick-261020-acct). Standalone like `online`: imports no other store, and the sync
// engine ($lib/services/sync.ts) is driven through injected hooks so the dependency stays
// one-way and settings remains a LEAF.
//
// Credential channels (see $lib/auth/auth-core.ts for the server side):
//   - WEB: the httpOnly `openmusic_session` cookie. Every request here carries
//     credentials:'include' semantics and this store NEVER sees — let alone stores — the
//     token. The verify() response body also contains the token (the native seam); on web
//     it is deliberately ignored.
//   - NATIVE (Capacitor WebView): cookies for the deployed origin are unreliable, so the
//     bearer token from verify() is persisted under `openmusic:auth-token:v1` and sent as
//     `Authorization: Bearer <token>` on every authed request. The WebView's JS context is
//     the app's own code only, which is what makes localStorage an acceptable home here.
//
// This store NEVER localizes: methods return closed-union status strings and the Settings →
// Account page maps them to i18n keys (the store→UI one-way rule).
import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { apiFetch } from '$lib/services/api-base';
import { isValidEmail, type AccountUser } from '$lib/auth/auth-core';
import { startSyncEngine, type SyncStatus } from '$lib/services/sync';

/** localStorage key for the NATIVE bearer token. Web never writes it (cookie only). */
const TOKEN_KEY = 'openmusic:auth-token:v1';

/** requestLink outcomes — the Account page maps each to an `account.*` i18n key.
 *  quick-261020-sync: 'network' is its own member now (the 2026-10-20 APK report showed a
 *  generic "Something went wrong" while the server HAD created the token and Resend HAD
 *  sent the mail — every failure class gets its own message from here on). */
export type RequestLinkResult = 'ok' | 'invalid-email' | 'rate-limited' | 'not-configured' | 'send-failed' | 'network' | 'error';

class Auth {
	/** The signed-in user, or null. Read one-way by the UI. */
	user = $state<AccountUser | null>(null);
	/** False until the boot session probe settles — the Account page waits for this so a
	 *  signed-in user never flashes the sign-in form. */
	ready = $state<boolean>(false);
	/** Sync engine status, written ONLY by the engine via the injected hooks. */
	syncStatus = $state<SyncStatus>('idle');
	/** Epoch ms of the last successful sync pass, or null. */
	lastSyncedAt = $state<number | null>(null);

	// PLAIN fields (house rule: state the UI never reads reactively stays non-$state).
	/** Native bearer token; null on web, where the cookie is the credential. */
	private bearer: string | null = null;
	private loaded = false;
	private engine: { stop: () => void; syncNow: () => Promise<void> } | null = null;

	/**
	 * One authed fetch through the api-base seam: credentials:'include' for the web cookie,
	 * the bearer header on native, JSON content-type whenever a body is present.
	 */
	private authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		if (init.body != null && !headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
		if (Capacitor.isNativePlatform() && this.bearer) {
			headers.set('authorization', `Bearer ${this.bearer}`);
		}
		return apiFetch(path, { ...init, credentials: 'include', headers });
	}

	/** Boot probe: GET /api/auth/session, then start the sync engine when signed in.
	 *  Fire-and-forget from the app layout; idempotent. */
	async load(): Promise<void> {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			if (Capacitor.isNativePlatform()) {
				try {
					const raw = localStorage.getItem(TOKEN_KEY);
					const parsed = raw ? (JSON.parse(raw) as { token?: unknown }) : null;
					this.bearer = typeof parsed?.token === 'string' ? parsed.token : null;
				} catch {
					this.bearer = null;
				}
			}
			const res = await this.authedFetch('/api/auth/session');
			const body = (await res.json().catch(() => null)) as { user: AccountUser | null } | null;
			this.user = body?.user ?? null;
			// A native token the server no longer knows is dead weight — drop it so the next
			// sign-in starts clean instead of sending a stale bearer forever.
			if (!this.user && this.bearer) {
				this.bearer = null;
				try {
					localStorage.removeItem(TOKEN_KEY);
				} catch {
					/* ignore */
				}
			}
		} catch {
			this.user = null;
		}
		this.ready = true;
		if (this.user) this.startEngine();
	}

	/** Sign-in step 1: ask the server to email a magic link. Returns a status union the
	 *  page localizes; never throws.
	 *
	 *  quick-261020-sync — honest errors, one retry: a NETWORK failure (fetch threw,
	 *  timeout, DNS) retries ONCE (2 attempts total) before reporting 'network', so a
	 *  flaky first attempt doesn't burn the flow. A 4xx/5xx from the server NEVER retries —
	 *  the server already decided, and a blind retry could re-send the mail the first
	 *  attempt already queued (the production case this fixes: the token existed and the
	 *  mail was sent, but the client showed "Something went wrong"). */
	async requestLink(email: string): Promise<RequestLinkResult> {
		if (!browser) return 'error';
		const clean = email.trim().toLowerCase();
		if (!isValidEmail(clean)) return 'invalid-email';
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				// AbortSignal.timeout is the native timeout — never hand-rolled (the fetch
				// helpers carry the same convention). A hung edge call strands the form
				// forever otherwise; a timeout reports as a NETWORK failure like any other.
				const res = await this.authedFetch('/api/auth/magic-link', {
					method: 'POST',
					body: JSON.stringify({ email: clean }),
					signal: AbortSignal.timeout(15_000)
				});
				if (res.ok) return 'ok';
				const err = ((await res.json().catch(() => null)) as { err?: string } | null)?.err;
				if (err === 'rate-limited') return 'rate-limited';
				if (err === 'invalid-email') return 'invalid-email';
				if (err === 'not-configured') return 'not-configured';
				if (err === 'send-failed') return 'send-failed';
				return 'error';
			} catch {
				if (attempt === 0) continue; // retry once, on network failure only
				return 'network';
			}
		}
		return 'network'; // unreachable — every loop path returns above
	}

	/** Sign-in step 2 (called by the /auth/magic page): redeem the token from the email
	 *  link. On success the user is set and the sync engine starts (its first pass pulls
	 *  the account's envelope, so a fresh device converges on its own data). */
	async verify(token: string): Promise<boolean> {
		if (!browser) return false;
		try {
			const res = await this.authedFetch('/api/auth/verify', {
				method: 'POST',
				body: JSON.stringify({ token })
			});
			if (!res.ok) return false;
			const body = (await res.json().catch(() => null)) as { user: AccountUser; token: string } | null;
			if (!body?.user) return false;
			this.user = body.user;
			this.ready = true;
			// Native ONLY: persist the bearer (see header). On web the token in this body is
			// ignored on purpose — the httpOnly cookie is already set and JS must not hold it.
			if (Capacitor.isNativePlatform() && typeof body.token === 'string' && body.token) {
				this.bearer = body.token;
				try {
					localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: body.token }));
				} catch {
					/* quota — the in-memory bearer still covers this session */
				}
			}
			this.startEngine();
			return true;
		} catch {
			return false;
		}
	}

	/** Sign out: stop the engine, delete the server session, drop every local credential.
	 *  The server call is best-effort — local sign-out proceeds even when it fails. */
	async logout(): Promise<void> {
		this.engine?.stop();
		this.engine = null;
		try {
			await this.authedFetch('/api/auth/logout', { method: 'POST' });
		} catch {
			/* unreachable server — the local sign-out below still applies */
		}
		this.user = null;
		this.bearer = null;
		this.syncStatus = 'idle';
		this.lastSyncedAt = null;
		if (Capacitor.isNativePlatform()) {
			try {
				localStorage.removeItem(TOKEN_KEY);
			} catch {
				/* ignore */
			}
		}
	}

	/** "Sync now" (Settings → Account): one immediate convergence pass. */
	async syncNow(): Promise<void> {
		if (!this.user) return;
		if (!this.engine) this.startEngine();
		else await this.engine.syncNow();
	}

	private startEngine(): void {
		if (this.engine || !browser) return;
		this.engine = startSyncEngine({
			request: (path, init) => this.authedFetch(path, init),
			isSignedIn: () => this.user !== null,
			setStatus: (s) => (this.syncStatus = s),
			setLastSyncedAt: (t) => (this.lastSyncedAt = t)
		});
	}
}

export const auth = new Auth();
