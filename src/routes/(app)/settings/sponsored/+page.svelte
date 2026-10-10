<script lang="ts">
	// Settings → Sponsored strip (HIDE RULE V2, Hector 2026-10-10; key-persistence
	// refinement 2026-10-10): the honor-system × is gone. A tipper enters the
	// license key from their Gumroad tip receipt; POST /api/sponsored/verify
	// checks it against Gumroad (product permalink openmusic-tip, no token needed)
	// and rejects refunded/chargebacked purchases. A verified key sets
	// localStorage dawn_sponsored_hidden=1 (strip renders nothing) AND persists
	// the key itself as dawn_tip_license_key so the input pre-fills on return and
	// can be copied for reuse on another device/app. "Show again" clears only the
	// hidden flag — the stored key stays. The stored key is never sent anywhere
	// except /api/sponsored/verify on explicit Verify clicks.
	//
	// Labels are English literals (the strip itself is English-only too); only the
	// settings-index group row needed i18n keys (settings.groupSponsored[Desc]).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { HandCoins, Copy, Check } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { apiFetch } from '$lib/services/api-base';
	import { t } from '$lib/i18n';
	import { SPONSORED_HIDE_KEY, TIP_LICENSE_KEY } from '$lib/config/sponsored';

	let hidden = $state(false);
	let key = $state('');
	let verifying = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);

	onMount(() => {
		try {
			hidden = localStorage.getItem(SPONSORED_HIDE_KEY) === '1';
			// Pre-fill from the previously verified key (kept across "Show again").
			const stored = localStorage.getItem(TIP_LICENSE_KEY);
			if (stored) key = stored;
		} catch {
			/* storage unavailable — treat as visible, input stays empty */
		}
	});

	// Verify the key server-side; only a verified, non-refunded purchase hides.
	async function verify() {
		const licenseKey = key.trim();
		if (!licenseKey || verifying) return;
		verifying = true;
		error = null;
		try {
			const res = await apiFetch('/api/sponsored/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ license_key: licenseKey })
			});
			const data = (await res.json()) as { ok?: boolean; reason?: string };
			if (data?.ok) {
				try {
					localStorage.setItem(SPONSORED_HIDE_KEY, '1');
					// Persist the key itself so it pre-fills next time and can be
					// copied for reuse. Only sent to /api/sponsored/verify above.
					localStorage.setItem(TIP_LICENSE_KEY, licenseKey);
				} catch {
					/* storage unavailable — the strip stays visible next launch */
				}
				hidden = true;
			} else if (data?.reason === 'refunded') {
				error = 'This purchase was refunded — the sponsored strip stays visible.';
			} else if (data?.reason === 'error') {
				error = 'Could not reach Gumroad for verification — try again in a moment.';
			} else {
				error = 'Invalid license key. Find it in your Gumroad receipt email (it looks like 8XXXXXXX-8XXXXXXX-8XXXXXXX-8XXXXXXX).';
			}
		} catch {
			error = 'Verification failed — check your connection and try again.';
		} finally {
			verifying = false;
		}
	}

	function showAgain() {
		try {
			// Clear only the hidden flag — the stored key stays so the input
			// comes pre-filled and the user can re-verify in one click.
			localStorage.removeItem(SPONSORED_HIDE_KEY);
		} catch {
			/* ignore */
		}
		hidden = false;
	}

	async function copyKey() {
		const text = key.trim();
		if (!text) return;
		let ok = false;
		try {
			await navigator.clipboard.writeText(text);
			ok = true;
		} catch {
			// Fallback for non-secure contexts / older browsers.
			try {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				ok = document.execCommand('copy');
				document.body.removeChild(ta);
			} catch {
				ok = false;
			}
		}
		if (ok) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}
</script>

<svelte:head><title>{t('settings.groupSponsored')} · {t('settings.title')}</title></svelte:head>

<PageHeader title={t('settings.groupSponsored')} backLabel={t('settings.backToSettings')} onback={() => goto('/settings')} />

<section>
	{#if hidden}
		<!-- Verified state: strip hidden, reversible; stored key shown for copying. -->
		<div class="card ok">
			<p class="msg"><HandCoins size={18} /> The sponsored strip is hidden. Thanks for tipping! ☕</p>
			<label class="lbl" for="spon-key-saved">Your license key</label>
			<div class="keyrow">
				<input id="spon-key-saved" class="txt mono" type="text" value={key} readonly aria-readonly="true" tabindex={-1} />
				<button class="btn icon" use:tapBounce onclick={() => void copyKey()} aria-label="Copy license key" title="Copy license key">
					{#if copied}<Check size={18} />{:else}<Copy size={18} />{/if}
				</button>
			</div>
			{#if copied}<p class="copied" role="status">Copied — paste it on another device or in another app.</p>{/if}
			<button class="btn ghost" use:tapBounce onclick={showAgain}>Show the strip again</button>
		</div>
	{:else}
		<!-- Unverified state: enter the Gumroad license key from the tip receipt. -->
		<div class="card">
			<p class="msg">Tipped? Enter the license key from your tip receipt to hide the sponsored strip on the home page.</p>
			<label class="lbl" for="spon-key">Gumroad license key</label>
			<div class="keyrow">
				<input
					id="spon-key"
					class="txt mono"
					type="text"
					bind:value={key}
					placeholder="8XXXXXXX-8XXXXXXX-8XXXXXXX-8XXXXXXX"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					autocomplete="off"
					disabled={verifying}
					onkeydown={(e) => { if (e.key === 'Enter') void verify(); }}
				/>
				<button class="btn icon" use:tapBounce onclick={() => void copyKey()} disabled={!key.trim()} aria-label="Copy license key" title="Copy license key">
					{#if copied}<Check size={18} />{:else}<Copy size={18} />{/if}
				</button>
			</div>
			{#if copied}<p class="copied" role="status">Copied.</p>{/if}
			{#if error}
				<p class="err" role="alert">{error}</p>
			{/if}
			<button class="btn" use:tapBounce onclick={() => void verify()} disabled={verifying || !key.trim()}>
				{verifying ? 'Verifying…' : 'Verify & hide the strip'}
			</button>
			<p class="hint">The key is in the receipt email Gumroad sent after your tip. Keys generated per purchase from 2026-10-10 — earlier tips may not have one yet.</p>
		</div>
	{/if}
</section>

<style>
	.card {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
		margin-top: 12px;
	}
	.msg { margin: 0 0 12px; font-size: 0.875rem; line-height: 1.5; color: var(--color-text); display: flex; align-items: center; gap: 8px; }
	.ok .msg { color: var(--color-text); }
	.lbl { display: block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin: 0 0 6px; }
	/* Free-text input shape = the settings idiom from /settings/downloads (.txt). */
	.txt { width: 100%; min-height: 44px; padding: 12px 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text); font-family: inherit; font-size: 0.875rem; }
	.txt.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.txt:disabled { opacity: 0.6; }
	.err { color: #e5484d; font-size: 0.8125rem; margin: 8px 0 0; }
	.keyrow { display: flex; gap: 8px; align-items: stretch; }
	.keyrow .txt { flex: 1; min-width: 0; }
	.btn.icon { width: 44px; min-height: 44px; margin-top: 0; padding: 0; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
	.copied { color: var(--color-text-muted); font-size: 0.75rem; margin: 6px 0 0; }
	.btn {
		width: 100%; margin-top: 12px; min-height: 44px; padding: 12px 16px;
		background: var(--color-primary); color: #fff; border: none; border-radius: 12px;
		font-size: 0.9375rem; font-weight: 700; cursor: pointer;
	}
	.btn:disabled { opacity: 0.5; cursor: default; }
	.btn.ghost { background: transparent; color: var(--color-text); border: 1px solid var(--color-border); }
	.hint { margin: 12px 0 0; font-size: 0.75rem; line-height: 1.5; color: var(--color-text-muted); }
</style>
