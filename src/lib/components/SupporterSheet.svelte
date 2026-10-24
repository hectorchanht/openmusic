<script lang="ts">
	// Donor-wall sheet — 2026-10-14 donor-wall-ui. UI-ONLY except the tip-key verify leg.
	//
	// quick-261023-support (Hector: "just show tip, as we are not charging monthly fee"):
	// tip-ONLY now. The supporter perk tiers are gone (no monthly-fee language anywhere).
	// The old /settings/sponsored page is FOLDED IN HERE — its two functions live as
	// sections below the tip CTAs: "Already tipped?" (Gumroad license-key verify, the one
	// REAL backend leg: POST /api/sponsored/verify) and the "Hide sponsored strip" toggle.
	// The Ko-fi / GitHub "coming soon" CTAs are GONE (2026-10-24, NO-EMPTY-ANCHORS
	// standing rule: no dead/placeholder links ship). The one real tip rail is the
	// Gumroad tip jar anchor below; Ko-fi/GitHub return only when real URLs exist.
	//
	// Follows the SleepTimerSheet precedent: mounted ONCE in (app)/+layout.svelte, driven by
	// `support.sheetOpen`, opened from the Settings support card. Same dismiss convergence
	// (scrim / drag / back-gesture → sheetOpen=false → the $effect cleanup calls
	// overlays.dismiss).
	//
	// Labels in the verify section are English literals — same as the old sponsored page
	// (the sponsored strip itself is English-only too).
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Heart, HandCoins, Copy, Check } from '@lucide/svelte';
	import { dragClose } from '$lib/actions/dragClose';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { overlays } from '$lib/stores/overlays.svelte';
	import { support } from '$lib/stores/support.svelte';
	import { apiFetch } from '$lib/services/api-base';
	import { SPONSORED_HIDE_KEY, SUPPORTER_KEY, TIP_LICENSE_KEY, TIP_JAR_URL } from '$lib/config/sponsored';
	// quick-261023-perks: tier plumbing (badge + wall render from the stored tier).
	import {
		getSupporterTier,
		setSupporterTier,
		supporterBadge,
		type SupporterTier
	} from '$lib/config/sponsored';
	import { track } from '$lib/posthog';
	import { t } from '$lib/i18n';

	// Tip-key verify state (ported verbatim from the old /settings/sponsored page).
	let supporter = $state(false);
	// quick-261023-perks: the stored tier (bronze until amounts are readable).
	let tier = $state<SupporterTier>('bronze');
	let hideStrip = $state(false);
	let key = $state('');
	let verifying = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);
	// Supporters wall opt-in (2026-10-24): sent with the verify POST. Default
	// OFF — nothing is published unless the tipper ticks the box AND gives a
	// display name. `wallListed` mirrors the server's `wall: true` answer so
	// the supporter card can confirm the listing right after verifying.
	let wallOptIn = $state(false);
	let wallName = $state('');
	let wallMessage = $state('');
	let wallListed = $state(false);

	/** Refresh the verify-section state every time the sheet opens (the key can be
	 *  verified on another device/session while the sheet stays mounted). */
	function loadVerifyState() {
		try {
			supporter = localStorage.getItem(SUPPORTER_KEY) === '1';
			tier = getSupporterTier();
			hideStrip = localStorage.getItem(SPONSORED_HIDE_KEY) === '1';
			key = localStorage.getItem(TIP_LICENSE_KEY) ?? '';
		} catch {
			/* storage unavailable — treat as unverified, input stays empty */
		}
		verifying = false;
		error = null;
		copied = false;
		wallOptIn = false;
		wallName = '';
		wallMessage = '';
		wallListed = false;
	}

	onMount(() => support.load());

	// quick-261023-perks: tier display name (explicit map — t() needs a literal key).
	const tierName = $derived(
		tier === 'gold' ? t('support.tierGold') : tier === 'silver' ? t('support.tierSilver') : t('support.tierBronze')
	);

	function close() {
		support.closeSheet();
	}

	// Single dismiss path, mirroring SleepTimerSheet (DEP is sheetOpen ONLY).
	$effect(() => {
		if (support.sheetOpen) {
			untrack(() => {
				loadVerifyState();
				overlays.open('supporter-sheet', () => (support.sheetOpen = false));
			});
			return () => untrack(() => overlays.dismiss('supporter-sheet'));
		}
	});

	// Verify the key server-side; a verified key marks supporter status and is
	// persisted — it does NOT auto-hide the strip.
	async function verify() {
		const licenseKey = key.trim();
		if (!licenseKey || verifying) return;
		// Wall opt-in needs a name to publish — catch it locally instead of
		// burning a verify round-trip on a listing that cannot be written.
		if (wallOptIn && !wallName.trim()) {
			error = 'Add a display name for the wall, or untick the wall option.';
			return;
		}
		verifying = true;
		error = null;
		// quick-261010-posthog: supporter_status_changed fires only on an
		// actual non-supporter → supporter transition (repeat verifies of an
		// already-supporter key are not "changes").
		const wasSupporter = supporter;
		try {
			const res = await apiFetch('/api/sponsored/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// public_wall is ALWAYS sent (true/false) so a re-verify can also
				// REMOVE a listing (unticked = explicit opt-out server-side).
				body: JSON.stringify({
					license_key: licenseKey,
					public_wall: wallOptIn,
					...(wallOptIn
						? { display_name: wallName.trim(), message: wallMessage.trim() }
						: {})
				})
			});
			const data = (await res.json()) as { ok?: boolean; reason?: string; admin?: boolean; wall?: boolean };
			if (data?.ok) {
				try {
					localStorage.setItem(SUPPORTER_KEY, '1');
					// Persist the key itself so it pre-fills next time and can be
					// copied for reuse. Only sent to /api/sponsored/verify above.
					localStorage.setItem(TIP_LICENSE_KEY, licenseKey);
				} catch {
					/* storage unavailable — supporter status won't persist */
				}
				// quick-261023-perks: Gumroad's keyless verify returns no amount, so a
				// tip lands on bronze; Hector's admin key lands on gold. Tiers upgrade
				// automatically once amounts become readable (needs a Gumroad token).
				const nt: SupporterTier = data?.admin ? 'gold' : 'bronze';
				setSupporterTier(nt);
				tier = nt;
				wallListed = data?.wall === true;
				supporter = true;
				track('tip_verified', { success: true });
				if (!wasSupporter) track('supporter_status_changed', { is_supporter: true });
			} else if (data?.reason === 'refunded') {
				error = 'This purchase was refunded — your supporter status stays off.';
				track('tip_verified', { success: false, reason: 'refunded' });
			} else if (data?.reason === 'error') {
				error = 'Could not reach Gumroad for verification — try again in a moment.';
				track('tip_verified', { success: false, reason: 'upstream_error' });
			} else {
				error = 'Invalid license key. Find it in your Gumroad receipt email (it looks like 8XXXXXXX-8XXXXXXX-8XXXXXXX-8XXXXXXX).';
				track('tip_verified', { success: false, reason: 'invalid' });
			}
		} catch {
			error = 'Verification failed — check your connection and try again.';
			track('tip_verified', { success: false, reason: 'network' });
		} finally {
			verifying = false;
		}
	}

	// The supporter's explicit choice: hide (or re-show) the sponsored strip.
	function toggleHideStrip(checked: boolean) {
		try {
			if (checked) {
				localStorage.setItem(SPONSORED_HIDE_KEY, '1');
			} else {
				localStorage.removeItem(SPONSORED_HIDE_KEY);
			}
		} catch {
			/* ignore */
		}
		hideStrip = checked;
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

{#if support.sheetOpen}
	<button class="scrim" aria-label={t('menu.close')} onclick={close}></button>
	<div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: close }} use:focusTrap>
		<div class="menu-head">
			<Heart size={18} fill="currentColor" /> {t('support.title')}
		</div>
		<!-- Hector's line, verbatim (kept English in every locale — a brand line). -->
		<p class="tagline">“{t('support.tagline')}”</p>
		<p class="body">{t('support.body')}</p>

		<p class="tip-title">{t('support.tipTitle')}</p>
		<p class="tip-note">{t('support.tipNote')}</p>

		<!-- The one real tip rail: the Gumroad tip jar (same destination as the
		     home strip's ☕ Tip jar). Ko-fi / GitHub Sponsors buttons were removed
		     2026-10-24 — their URLs were empty "coming soon" placeholders. -->
		<a
			class="cta"
			href={TIP_JAR_URL}
			target="_blank"
			rel="noopener"
			use:tapBounce
			onclick={() => track('tip_jar_opened', { location: 'supporter_sheet' })}
		>
			<HandCoins size={18} /> Tip on Gumroad
		</a>

		<!-- quick-261023-support: the old /settings/sponsored page, folded in. -->
		<div class="verify-sect">
			{#if supporter}
				<div class="vcard ok">
					<p class="vmsg"><HandCoins size={18} /> {supporterBadge()} {tierName} {t('support.supporterThanks')}</p>
					<label class="switch">
						<input
							type="checkbox"
							checked={hideStrip}
							onchange={(e) => toggleHideStrip(e.currentTarget.checked)}
						/>
						<span class="track"><span class="thumb"></span></span>
						<span class="switch-label">Hide sponsored strip</span>
					</label>
					<p class="vhint">Supporters can hide the strip anytime.</p>
					<label class="vlbl" for="sheet-key-saved">Your license key</label>
					<div class="keyrow">
						<input id="sheet-key-saved" class="vtxt mono" type="text" value={key} readonly aria-readonly="true" tabindex={-1} />
						<button class="vbtn icon" use:tapBounce onclick={() => void copyKey()} aria-label="Copy license key" title="Copy license key">
							{#if copied}<Check size={18} />{:else}<Copy size={18} />{/if}
						</button>
					</div>
					{#if copied}<p class="vcopied" role="status">Copied — paste it on another device or in another app.</p>{/if}
					{#if wallListed}
						<p class="vhint">☕ You're listed on the <a class="wall-link" href="/supporters">Supporters wall</a> — thank you!</p>
					{:else}
						<p class="vhint">See who's on the <a class="wall-link" href="/supporters">Supporters wall</a>.</p>
					{/if}
				</div>
			{:else}
				<div class="vcard">
					<p class="vmsg">Already tipped? Enter the license key from your tip receipt.</p>
					<label class="vlbl" for="sheet-key">Gumroad license key</label>
					<div class="keyrow">
						<input
							id="sheet-key"
							class="vtxt mono"
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
						<button class="vbtn icon" use:tapBounce onclick={() => void copyKey()} disabled={!key.trim()} aria-label="Copy license key" title="Copy license key">
							{#if copied}<Check size={18} />{:else}<Copy size={18} />{/if}
						</button>
					</div>
					{#if copied}<p class="vcopied" role="status">Copied.</p>{/if}
					<!-- Supporters wall opt-in (2026-10-24): OFF by default; the name
					     and message are published on /supporters only when ticked. -->
					<label class="switch wallchk">
						<input type="checkbox" bind:checked={wallOptIn} disabled={verifying} />
						<span class="track"><span class="thumb"></span></span>
						<span class="switch-label">Add my name to the public Supporters wall</span>
					</label>
					{#if wallOptIn}
						<label class="vlbl" for="sheet-wall-name">Display name</label>
						<input
							id="sheet-wall-name"
							class="vtxt"
							type="text"
							bind:value={wallName}
							maxlength={40}
							placeholder="How your name appears on the wall"
							autocomplete="off"
							disabled={verifying}
						/>
						<label class="vlbl wallmsg-lbl" for="sheet-wall-msg">Message <span class="opt">(optional)</span></label>
						<input
							id="sheet-wall-msg"
							class="vtxt"
							type="text"
							bind:value={wallMessage}
							maxlength={80}
							placeholder="One short line — thanks, a favourite song, anything kind"
							autocomplete="off"
							disabled={verifying}
						/>
						<p class="vhint">Only your display name and message are shown — never your key or email. Untick and verify again anytime to remove your listing.</p>
					{/if}
					{#if error}
						<p class="verr" role="alert">{error}</p>
					{/if}
					<button class="vbtn" use:tapBounce onclick={() => void verify()} disabled={verifying || !key.trim()}>
						{verifying ? 'Verifying…' : 'Verify key'}
					</button>
					<p class="vhint">The key is in the receipt email Gumroad sent after your tip.</p>
				</div>
			{/if}
		</div>
		<!-- quick-261023-perks: donor wall. Privacy-first: there is no server-side
		     donor list (Gumroad sale lookup needs an access token Hector hasn't
		     provided), so the wall shows ONLY this device's own verified entry.
		     No names, no emails — the tier badge is the recognition. -->
		<div class="wall-sect">
			<p class="tip-title">{t('support.wallTitle')}</p>
			{#if supporter}
				<div class="wall-entry">
					<span class="wall-badge" aria-hidden="true">{supporterBadge()}</span>
					<span class="wall-who">{t('support.wallYou')} · {tierName} {t('support.supporter')}</span>
				</div>
			{:else}
				<p class="wall-hint">{t('support.wallJoin')}</p>
			{/if}
			<p class="wall-hint"><a class="wall-link" href="/supporters">See the public Supporters wall →</a></p>
		</div>
	</div>
{/if}

<style>
	/* Scoped copies of the SleepTimerSheet overlay classes (the sheet is its own component). */
	.scrim { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); border: none; }
	.menu { position: fixed; left: 12px; right: 12px; bottom: 16px; z-index: 81; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 16px; padding: 8px 12px 16px; max-width: 680px; margin: 0 auto; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto; }
	.menu-head { display: flex; align-items: center; gap: 8px; font-size: calc(1rem * var(--fs-title, 1)); font-weight: 700; color: var(--color-text); padding: 10px 4px 2px; }
	.tagline { margin: 10px 4px 0; font-size: 0.9375rem; font-style: italic; color: var(--color-primary); }
	.body { margin: 8px 4px 0; font-size: 0.875rem; color: var(--color-text-muted); line-height: 1.5; }
	.tip-title { margin: 16px 4px 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); }
	.tip-note { margin: 6px 4px 0; font-size: 0.8125rem; color: var(--color-text-muted); }
	.cta { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin-top: 12px; padding: 13px; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; background: var(--color-primary); color: #fff; text-decoration: none; border: none; cursor: pointer; box-sizing: border-box; }
	/* Supporters wall opt-in (2026-10-24). */
	.wallchk { margin-top: 12px; }
	.wallchk .switch-label { font-size: 0.875rem; }
	.wallmsg-lbl { margin-top: 12px; }
	.vlbl .opt { text-transform: none; letter-spacing: 0; font-weight: 400; }
	.wall-link { color: var(--color-primary); font-weight: 700; text-decoration: none; }
	/* Verify section (ported from the old /settings/sponsored page). */
	.verify-sect { margin-top: 16px; }
	.vcard { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 14px; }
	.vmsg { margin: 0 0 12px; font-size: 0.875rem; line-height: 1.5; color: var(--color-text); display: flex; align-items: center; gap: 8px; }
	.vlbl { display: block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin: 0 0 6px; }
	.vtxt { width: 100%; min-height: 44px; padding: 12px 14px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text); font-family: inherit; font-size: 0.875rem; }
	.vtxt.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.vtxt:disabled { opacity: 0.6; }
	.verr { color: #e5484d; font-size: 0.8125rem; margin: 8px 0 0; }
	.keyrow { display: flex; gap: 8px; align-items: stretch; margin-top: 12px; }
	.keyrow .vtxt { flex: 1; min-width: 0; }
	.vbtn.icon { width: 44px; min-height: 44px; margin-top: 0; padding: 0; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
	.vcopied { color: var(--color-text-muted); font-size: 0.75rem; margin: 6px 0 0; }
	.vbtn { width: 100%; margin-top: 12px; min-height: 44px; padding: 12px 16px; background: var(--color-primary); color: #fff; border: none; border-radius: 12px; font-size: 0.9375rem; font-weight: 700; cursor: pointer; }
	.vbtn:disabled { opacity: 0.5; cursor: default; }
	.vhint { margin: 12px 0 0; font-size: 0.75rem; line-height: 1.5; color: var(--color-text-muted); }
	/* Hide-strip toggle: plain checkbox styled as a switch (no extra a11y burden). */
	.switch { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 4px 0; }
	.switch input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; }
	.track { width: 46px; height: 26px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.2s; flex: 0 0 auto; }
	.thumb { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
	.switch input:checked + .track { background: var(--color-primary); }
	.switch input:checked + .track .thumb { transform: translateX(20px); }
	.switch input:focus-visible + .track { outline: 2px solid var(--color-primary); outline-offset: 2px; }
	.switch-label { font-size: 0.9375rem; font-weight: 700; color: var(--color-text); }
	/* quick-261023-perks: donor wall. */
	.wall-sect { margin-top: 4px; }
	.wall-entry { display: flex; align-items: center; gap: 10px; margin-top: 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 14px; }
	.wall-badge { font-size: 1.375rem; line-height: 1; }
	.wall-who { font-size: 0.875rem; font-weight: 700; color: var(--color-text); }
	.wall-hint { margin: 8px 4px 0; font-size: 0.8125rem; color: var(--color-text-muted); }
</style>
