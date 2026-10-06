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
// REACTIVE CONTRACT. `phase`/`done`/`total`/`lastReport` are the UI surface (the downloads page
// renders progress from here, surviving navigation). Everything else is plain fields. This store
// emits no localized text — the page maps `lastReport` through `t()`.

import { browser } from '$app/environment';
import { retagOne, type RetagEntry, type RetagReport } from '$lib/services/retag';

const QUEUE_KEY = 'openmusic:retag-queue:v1';

export type RetagPhase = 'idle' | 'running';

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
	 * Opt-in entry point. Replaces the queue with a fresh snapshot (built by the caller — titles
	 * already display-translated, lyrics already resolved) and starts the background runner.
	 */
	enqueue(entries: RetagEntry[]): void {
		const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.uid);
		this.gen++;
		this.pending = [...list];
		persist(this.pending);
		this.done = 0;
		this.total = list.length;
		this.lastReport = null;
		if (list.length > 0) void this.pump();
		else this.phase = 'idle';
	}

	/** App-boot hook: resume whatever a previous session left behind. */
	resume(): void {
		if (!browser || this.phase === 'running') return;
		const saved = loadPersisted();
		if (saved.length === 0) return;
		this.gen++;
		this.pending = saved;
		this.done = 0;
		this.total = saved.length;
		this.lastReport = null;
		void this.pump();
	}

	cancel(): void {
		this.gen++;
		this.pending = [];
		persist([]);
		this.phase = 'idle';
		this.done = 0;
		this.total = 0;
	}

	private async pump(): Promise<void> {
		if (this.pumping) return;
		this.pumping = true;
		const myGen = this.gen;
		this.phase = 'running';
		const report: RetagReport = { total: this.pending.length, tagged: 0, skipped: {} };
		try {
			while (this.pending.length > 0) {
				if (myGen !== this.gen) return; // superseded — the newer pump owns it now
				const result = await retagOne(this.pending[0]);
				if (myGen !== this.gen) return;
				// Terminal outcome — drop from the persisted queue BEFORE counting, so a crash
				// here can never re-tag this file on the next resume.
				this.pending.shift();
				persist(this.pending);
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
			if (myGen !== this.gen && this.pending.length > 0) void this.pump();
		}
	}
}

export const retagQueue = new RetagQueue();
