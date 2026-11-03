// retag-queue — the PERSISTENT background retag queue.
//
// WHY THIS EXISTS. `retagDownloads` was a foreground loop: the user tapped, confirmed, and waited
// on the settings page while every file was rewritten. Background the tab (or close it) and the
// job died mid-list with no resume. Hector (2026-10-06) authorised the change: the tap+confirm
// opt-in STAYS, but after that the job persists and runs in the background — resuming on every app
// start until the queue is empty ("run till end on start").
//
// DESIGN
// - The queue is a plain array of RetagEntry persisted to localStorage
//   (`openmusic:retag-queue:v1`). The entries are a point-in-time snapshot built by the caller —
//   lyrics included (`getPinnedLyrics(uid) ?? d.lrc`), so the background pass writes lyrics to the
//   offline files exactly like the foreground one did.
// - `enqueue(entries)` REPLACES the queue with a fresh snapshot and starts the runner. The settings
//   page is the only caller.
// - `resume()` is the app-boot hook ((app)/+layout.svelte onMount). It picks up whatever a previous
//   session left behind. No-op when the queue is empty or a run is already in flight.
// - The runner is SEQUENTIAL via `retagOne` — the per-file isolation (36-D-19) and verify-before-
//   write live there, untouched. Each entry's outcome is terminal: it is dropped from the persisted
//   queue BEFORE the progress counter moves, so a crash between the two can never re-tag it.
// - Between files the loop yields via `setTimeout(0)` — that is the "background" part on the web:
//   the UI thread breathes, the user keeps using the app, and a backgrounded tab keeps grinding
//   (throttled) instead of dying. A killed tab resumes on the next start.
// - GENERATION GUARD (the house idiom, cf. device-import): `enqueue`/`cancel` bump `gen`; the pump
//   bails at the next checkpoint when superseded, and the `finally` restarts the pump for the newer
//   gen — so overlapping pumps are impossible.
//
// quick-261020-rtg — THE CONSENT GATE. `resume()` used to pump leftover entries — including
// imported `device:` files — with NO batch write-consent: the batch ask only lived in the Settings
// tap flow. After an APK update (app restart) with a non-empty persisted queue, every remaining
// device file fell through to `writeInPlace`'s per-file consent rung: one system "Allow OpenMusic
// to modify this audio file?" dialog PER FILE (531 of them), with no way to stop. The pump now
// gates on `requestDeviceWriteConsent` at EVERY start (enqueue + boot-resume + manual resume),
// and a mid-run `'denied'` pauses the queue and re-batches ONCE instead of marching on to the
// next file's dialog. A denied batch drops the device entries (counted in the report's
// `denied-batch` bucket) and the rest of the queue still runs — never a per-file fallthrough.
//
// quick-261020-rtg — PAUSE. `phase` is now `'idle' | 'running' | 'paused'`. `pause()` stops after
// the current file and KEEPS the persisted queue (unlike `cancel()`, which wipes it); `resume()`
// continues from where it left off, re-running the consent gate because the grant may have lapsed
// while paused. The mid-run `'denied'` branch also parks in `'paused'` while it re-asks —
// `pausedByUser` (not `phase`) is what tells the pump's `finally` whether a superseding gen should
// restart, so the re-ask park can never swallow a real supersede.
//
// REACTIVE CONTRACT. `phase`/`done`/`total`/`lastReport` are the UI surface (the downloads page
// renders progress from here, surviving navigation). Everything else is plain fields. This store
// emits no localized text — the page maps `lastReport` through `t()`.

import { browser } from '$app/environment';
import { retagOne, type RetagEntry, type RetagReport } from '$lib/services/retag';
import { isDeviceUid } from '$lib/services/device-track';
import { requestDeviceWriteConsent } from '$lib/services/media-store';

const QUEUE_KEY = 'openmusic:retag-queue:v1';

export type RetagPhase = 'idle' | 'running' | 'paused';

function loadPersisted(): RetagEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(QUEUE_KEY);
		if (!raw) return [];
		const arr: unknown = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(e): e is RetagEntry => !!e && typeof (e as RetagEntry).uid === 'string' && !!(e as RetagEntry).uid
		);
	} catch {
		return [];
	}
}

function persist(entries: RetagEntry[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
	} catch {
		// Quota or private mode — the in-memory queue still completes this session; the next
		// start simply has nothing to resume.
	}
}

class RetagQueue {
	phase = $state<RetagPhase>('idle');
	done = $state(0);
	total = $state(0);
	lastReport = $state<RetagReport | null>(null);

	/** Plain fields — the UI never reads these reactively (house convention). */
	private gen = 0;
	private pending: RetagEntry[] = [];
	private pumping = false;
	/**
	 * quick-261020-rtg: set by pause(), cleared by resume()/enqueue()/cancel(). The pump's
	 * `finally` restarts a superseding gen — but NEVER a user pause. (Checked instead of `phase`
	 * because the mid-run 'denied' branch also parks in 'paused' while it re-asks, and that park
	 * must not swallow a supersede.)
	 */
	private pausedByUser = false;
	/**
	 * quick-261020-rtg: a batch consent dialog is showing. Defense-in-depth against two
	 * concurrent batch asks; a second asker stands down (its device entries are dropped, never
	 * written unconsented) rather than stacking a second system dialog.
	 */
	private consentInFlight = false;
	/**
	 * quick-261020-rtg: set by enqueue({ consentBypass: true }), consumed once at pump start.
	 * The Settings page passes it after its OWN up-front batch ask, so the queue doesn't pop a
	 * second dialog for the same files. Boot-resume and manual resume NEVER bypass.
	 */
	private consentBypassOnce = false;

	/**
	 * Opt-in entry point. Replaces the queue with a fresh snapshot (built by the caller — titles
	 * already display-translated, lyrics already resolved) and starts the background runner.
	 *
	 * quick-261020-rtg: `opts.consentBypass` is for the Settings page ONLY — it already ran the
	 * batch ask up front (and dropped the device files on deny), so the pump's gate would pop a
	 * second dialog for nothing. Every other path goes through the gate.
	 */
	enqueue(entries: RetagEntry[], opts?: { consentBypass?: boolean }): void {
		const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.uid);
		this.gen++;
		this.pending = [...list];
		persist(this.pending);
		this.done = 0;
		this.total = list.length;
		this.lastReport = null;
		this.pausedByUser = false;
		this.consentBypassOnce = opts?.consentBypass === true;
		if (list.length > 0) void this.pump();
		else this.phase = 'idle';
	}

	/**
	 * App-boot hook: resume whatever a previous session left behind. ALSO the user-resume path
	 * from a manual pause (phase 'paused'): the pending list is already in memory and persisted,
	 * so it just re-arms the pump. No-op when idle-with-nothing or already running.
	 */
	resume(): void {
		if (!browser || this.phase === 'running') return;
		if (this.phase === 'paused') {
			// quick-261020-rtg: manual resume. The grant may have lapsed while paused, so the
			// pump re-runs the consent gate (no bypass here) rather than assuming the old one.
			// Progress (done/total) is kept — this continues the same job, not a new one.
			this.pausedByUser = false;
			this.gen++;
			void this.pump();
			return;
		}
		const saved = loadPersisted();
		if (saved.length === 0) return;
		this.gen++;
		this.pending = saved;
		this.done = 0;
		this.total = saved.length;
		this.lastReport = null;
		void this.pump();
	}

	/**
	 * quick-261020-rtg: stop after the current file. The persisted queue is KEPT (unlike
	 * cancel) — resume() continues where this left off. Bumps gen so the in-flight pump bails
	 * at its next checkpoint; the pump's `finally` does NOT restart it (pausedByUser).
	 */
	pause(): void {
		if (this.phase !== 'running') return;
		this.pausedByUser = true;
		this.gen++;
		this.phase = 'paused';
	}

	cancel(): void {
		this.gen++;
		this.pending = [];
		persist([]);
		this.pausedByUser = false;
		this.phase = 'idle';
		this.done = 0;
		this.total = 0;
	}

	/** Drop every device entry from pending (+persist). Returns the dropped count. */
	private dropDeviceEntries(): number {
		const kept = this.pending.filter((e) => !isDeviceUid(e.uid));
		const dropped = this.pending.length - kept.length;
		if (dropped > 0) {
			this.pending = kept;
			persist(this.pending);
		}
		return dropped;
	}

	/**
	 * quick-261020-rtg: the ONE batch-consent entry point. Serialized by consentInFlight; a
	 * superseding gen while the dialog is up discards the answer (the newer pump re-gates).
	 */
	private async askConsent(uids: string[], myGen: number): Promise<boolean> {
		if (this.consentInFlight) return false;
		this.consentInFlight = true;
		try {
			if (myGen !== this.gen) return false;
			return await requestDeviceWriteConsent(uids);
		} finally {
			this.consentInFlight = false;
		}
	}

	private async pump(): Promise<void> {
		if (this.pumping) return;
		this.pumping = true;
		const myGen = this.gen;
		this.phase = 'running';
		const report: RetagReport = { total: this.pending.length, tagged: 0, skipped: {} };
		try {
			// quick-261020-rtg: CONSENT GATE. Runs at EVERY pump start — enqueue, boot-resume
			// and manual resume alike. Before this gate, resume() pumped leftover device entries
			// with no batch grant and each one hit writeInPlace's per-file consent rung: one
			// system dialog PER FILE (531 after an APK update), unstoppable. A denied batch
			// drops the device entries (counted in `denied-batch`) and the REST of the queue
			// still runs — "skip the device files", never "ask per file".
			const bypass = this.consentBypassOnce;
			this.consentBypassOnce = false;
			if (!bypass) {
				const deviceUids = this.pending.filter((e) => isDeviceUid(e.uid)).map((e) => e.uid);
				if (deviceUids.length > 0) {
					const granted = await this.askConsent(deviceUids, myGen);
					if (myGen !== this.gen) return;
					if (!granted) {
						const dropped = this.dropDeviceEntries();
						this.total -= dropped;
						report.total -= dropped;
						report.skipped['denied-batch'] = (report.skipped['denied-batch'] ?? 0) + dropped;
					}
				}
			}
			while (this.pending.length > 0) {
				if (myGen !== this.gen) return; // superseded — the newer pump owns it now
				const result = await retagOne(this.pending[0]);
				if (myGen !== this.gen) return;
				// Terminal outcome — drop from the persisted queue BEFORE counting, so a crash
				// here can never re-tag this file on the next resume.
				this.pending.shift();
				persist(this.pending);
				if (result === 'denied') {
					// quick-261020-rtg: the batch grant never landed (or lapsed) for this file.
					// The queue must NEVER fall through to writeInPlace's per-file consent rung
					// — that fallthrough IS the 531-dialogs bug. Park visibly in 'paused' and
					// re-ask the batch ONCE for the remaining device files: granted → resume the
					// pump; denied → drop the remaining device entries and resume with the rest.
					// A superseding pause()/cancel()/enqueue() during the dialog wins via the
					// gen guard — the dialog's answer is then discarded, never acted on.
					report.skipped['denied'] = (report.skipped['denied'] ?? 0) + 1;
					this.done++;
					this.phase = 'paused';
					const remaining = this.pending.filter((e) => isDeviceUid(e.uid)).map((e) => e.uid);
					let granted = false;
					if (remaining.length > 0) granted = await this.askConsent(remaining, myGen);
					if (myGen !== this.gen) return;
					if (!granted) {
						const dropped = this.dropDeviceEntries();
						this.total -= dropped;
						report.total -= dropped;
						report.skipped['denied-batch'] = (report.skipped['denied-batch'] ?? 0) + dropped;
					}
					this.phase = 'running';
					// Yield between files: the UI stays interactive while the queue drains.
					await new Promise((r) => setTimeout(r, 0));
					continue;
				}
				if (result === 'tagged') report.tagged++;
				else report.skipped[result] = (report.skipped[result] ?? 0) + 1;
				this.done++;
				// Yield between files: the UI stays interactive while the queue drains.
				await new Promise((r) => setTimeout(r, 0));
				if (myGen !== this.gen) return;
			}
			this.phase = 'idle';
			this.lastReport = report;
			persist([]);
		} finally {
			this.pumping = false;
			// A superseding enqueue/cancel landed while we were pumping — its pump() call
			// early-returned on the flag above, so kick the newer gen now that we're out.
			// quick-261020-rtg: NOT after a user pause — a paused queue stays paused until
			// resume(). (pausedByUser, not phase: the mid-run 'denied' branch also parks in
			// 'paused' while it re-asks, and that park must not swallow a supersede.)
			if (myGen !== this.gen && this.pending.length > 0 && !this.pausedByUser) void this.pump();
		}
	}
}

export const retagQueue = new RetagQueue();
