// quick-261024-vid1 — the MSE feeder behind the Now Playing video layer.
//
// The layer is a MUTED FOLLOWER: the player store's <audio> stays the master clock and
// the only audible element; this feeder pulls the video-only MP4 (itag-picked avc ≤ cap)
// from /api/ytmusic/video/<id> in sequential 1 MB ranges and appends them, in order, into
// one SourceBuffer. Feeding a single self-describing fMP4 from byte 0 in order is the
// classic YouTube-MSE pattern — no manifest, no muxer, no library.
//
// Phase-1 limits, deliberately: the feed is FORWARD-ONLY from byte 0. A master seek past
// the buffered range does not re-base the feed (time→byte mapping needs the file's sidx);
// the picture simply catches up at network speed while the audio never waits. Buffer
// target is ~30 s ahead of the playhead; a 1 s pump tops it up.
export type VideoStageErrorKind = 'none' | 'gated' | 'unsupported' | 'network';
export interface VideoStageError {
	kind: VideoStageErrorKind;
	/** Upstream playability reason on a gate (already header-sanitised by the route). */
	reason?: string;
	/** quick-261024-vid3: machine-readable detail for the overlay's small print (the
	 *  picked mime, MediaSource presence, isTypeSupported probes) — a screenshot of the
	 *  error must be enough to diagnose the device, no guessing round-trips. */
	detail?: string;
}

/** quick-261024-vid3: why this environment can't MSE — probed live so the answer is the
 *  DEVICE's, not a guess. `base` probes a baseline-profile string: if even that fails,
 *  the WebView's MSE is effectively absent for mp4. */
export function mseProbe(mime: string | null): string {
	if (typeof MediaSource === 'undefined') return 'mediasource:absent';
	const base = MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
	const pick = mime ? MediaSource.isTypeSupported(mime) : false;
	return `base:${base} pick:${pick} mime:${mime ?? 'none'}`;
}

export interface DirectProbeResult {
	ok: boolean;
	status: number;
	kind: VideoStageErrorKind;
	/** Playability reason on a 503 gate (route header, already sanitised server-side). */
	reason?: string;
	/** How many probe fetches ran (1 = first try). */
	attempts: number;
}

/**
 * quick-261029-vidgate — preflight for DIRECT mode. The old code handed the route URL
 * blindly to the <video> element: a gated 503 (text/plain) as `src` surfaces only as
 * MediaError code 4 (SRC_NOT_SUPPORTED), with the real reason lost and (thanks to the
 * old height===0 guard) no retry once metadata had loaded. This probe fetches a 1 KB
 * range first — the MSE feeder's first-chunk trick, minus MSE — retries a 503 gate
 * with backoff and cache-busting `retry` params, and only an OK probe lets the caller
 * set `src`. A 404 is definitive (no picture), everything else is 'network'.
 * fetch/sleep are injectable for tests.
 */
export async function probeDirectVideo(
	videoId: string,
	cap: number,
	deps: {
		fetchFn?: typeof fetch;
		sleep?: (ms: number) => Promise<void>;
		retries?: number;
	} = {}
): Promise<DirectProbeResult> {
	const fetchFn = deps.fetchFn ?? fetch;
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const retries = deps.retries ?? 2;
	const backoff = [1200, 3500];
	let last: DirectProbeResult = { ok: false, status: 0, kind: 'network', attempts: 0 };
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(backoff[attempt - 1] ?? 3500);
		const bust = attempt > 0 ? `&retry=${attempt}` : '';
		try {
			const res = await fetchFn(
				`/api/ytmusic/video/${encodeURIComponent(videoId)}?q=${cap}${bust}`,
				{ headers: { Range: 'bytes=0-1023' } }
			);
			const reason = res.headers.get('x-ytmusic-reason') ?? undefined;
			await res.body?.cancel().catch(() => {});
			if (res.ok) return { ok: true, status: res.status, kind: 'none', attempts: attempt + 1 };
			if (res.status === 404) return { ok: false, status: 404, kind: 'none', attempts: attempt + 1 };
			last = {
				ok: false,
				status: res.status,
				kind: res.status === 503 ? 'gated' : 'network',
				reason,
				attempts: attempt + 1
			};
			if (res.status !== 503) break; // only a gate is worth a quiet retry
		} catch {
			last = { ok: false, status: 0, kind: 'network', attempts: attempt + 1 };
		}
	}
	return last;
}

const CHUNK_BYTES = 1024 * 1024;

/**
 * quick-261024-vid2 — the follower's sync decision, pure for testability. The first live
 * verification froze the picture: the naive loop snapped `video.currentTime` to the
 * master every 250 ms even when the target sat OUTSIDE the buffered range (a mid-song
 * open), so the element seeked into the void forever and never played. Rules now:
 *  - target ahead of the buffer → 'wait' (never seek into unbuffered time; the feed
 *    catches up at network speed and a later tick snaps);
 *  - drift > 0.35 s inside the buffer → 'snap';
 *  - small drift → keep playing with a rate nudge (1.12 / 0.88) instead of a hard seek;
 *  - master paused → 'pause'.
 */
export type SyncAction = 'snap' | 'play' | 'pause' | 'wait';
export function syncDecision(input: {
	masterTime: number;
	videoTime: number;
	bufferedEnd: number;
	masterPlaying: boolean;
}): { action: SyncAction; rate: number } {
	const { masterTime, videoTime, bufferedEnd, masterPlaying } = input;
	if (!masterPlaying) return { action: 'pause', rate: 1 };
	if (masterTime > bufferedEnd - 0.25) return { action: 'wait', rate: 1 };
	const drift = masterTime - videoTime;
	if (Math.abs(drift) > 0.35) return { action: 'snap', rate: 1 };
	if (drift > 0.12) return { action: 'play', rate: 1.12 };
	if (drift < -0.12) return { action: 'play', rate: 0.88 };
	return { action: 'play', rate: 1 };
}
const AHEAD_TARGET_S = 30;
const PUMP_MS = 1000;

interface Callbacks {
	onMeta: (height: number) => void;
	onError: (e: VideoStageError) => void;
}

function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
	const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header ?? '');
	if (!m) return null;
	return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
}

export class VideoFeeder {
	private ms: MediaSource | null = null;
	private sb: SourceBuffer | null = null;
	private objectUrl: string | null = null;
	private ctrl: AbortController | null = null;
	private pump: ReturnType<typeof setInterval> | null = null;
	private stopped = true;
	private nextOffset = 0;
	private total: number | null = null;
	private fetching = false;
	private mime: string | null = null;

	constructor(
		private video: HTMLVideoElement,
		private videoId: string,
		private cap: number,
		private cb: Callbacks
	) {}

	async start(): Promise<void> {
		this.stopped = false;
		this.ctrl = new AbortController();
		if (typeof MediaSource === 'undefined') {
			this.cb.onError({ kind: 'unsupported', detail: mseProbe(null) });
			return;
		}
		// First chunk doubles as the resolve: its headers carry the pick (mime/height) or
		// the failure (404 = no picture for this track, 503 = the gate, reason included).
		let first: Response;
		try {
			first = await this.fetchRange(0, CHUNK_BYTES - 1);
		} catch {
			if (!this.stopped) this.cb.onError({ kind: 'network' });
			return;
		}
		if (this.stopped) return;
		if (first.status === 404) {
			this.cb.onError({ kind: 'none' });
			return;
		}
		if (!first.ok) {
			const reason = first.headers.get('x-ytmusic-reason') ?? undefined;
			this.cb.onError(
				first.status === 503 ? { kind: 'gated', reason } : { kind: 'network', reason }
			);
			return;
		}
		this.mime = first.headers.get('x-ytmusic-video-mime');
		const height = Number(first.headers.get('x-ytmusic-video-height'));
		if (!this.mime || !MediaSource.isTypeSupported(this.mime)) {
			this.cb.onError({ kind: 'unsupported', detail: mseProbe(this.mime) });
			return;
		}
		if (height > 0) this.cb.onMeta(height);
		const range = parseContentRange(first.headers.get('content-range'));
		this.total = range?.total ?? null;

		this.ms = new MediaSource();
		this.objectUrl = URL.createObjectURL(this.ms);
		this.video.src = this.objectUrl;
		await new Promise<void>((resolve) => {
			this.ms!.addEventListener('sourceopen', () => resolve(), { once: true });
		});
		if (this.stopped) return;
		this.sb = this.ms.addSourceBuffer(this.mime);
		const firstBuf = await first.arrayBuffer();
		await this.append(firstBuf);
		// A range-honouring answer says where we are; a range-IGNORED 200 hands back the
		// whole file at once — then the appended byte count IS the position (and the total).
		this.nextOffset = range ? range.end + 1 : firstBuf.byteLength;
		if (range === null) this.total = firstBuf.byteLength;
		if (this.total !== null && this.nextOffset >= this.total) return; // whole file already in
		this.pump = setInterval(() => void this.topUp(), PUMP_MS);
		void this.topUp();
	}

	stop(): void {
		this.stopped = true;
		this.ctrl?.abort();
		if (this.pump) clearInterval(this.pump);
		this.pump = null;
		try {
			if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
		} catch {
			// already closed — nothing to end cleanly
		}
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		this.ms = null;
		this.sb = null;
	}

	private fetchRange(start: number, end: number): Promise<Response> {
		return fetch(`/api/ytmusic/video/${encodeURIComponent(this.videoId)}?q=${this.cap}`, {
			headers: { Range: `bytes=${start}-${end}` },
			signal: this.ctrl?.signal
		});
	}

	/** End of the buffered range (the feed is forward-only from 0, so it starts at 0). */
	bufferedEnd(): number {
		try {
			const b = this.video.buffered;
			return b.length > 0 ? b.end(b.length - 1) : 0;
		} catch {
			return 0;
		}
	}

	private async append(buf: ArrayBuffer): Promise<void> {
		const sb = this.sb;
		if (!sb || this.stopped || buf.byteLength === 0) return;
		await new Promise<void>((resolve) => {
			const done = () => {
				sb.removeEventListener('updateend', done);
				resolve();
			};
			sb.addEventListener('updateend', done);
			try {
				sb.appendBuffer(buf);
			} catch {
				sb.removeEventListener('updateend', done);
				resolve();
			}
		});
	}

	/** Fetch the next chunk whenever the buffer runs low; serialised by `fetching`. */
	private async topUp(): Promise<void> {
		if (this.stopped || this.fetching || !this.sb) return;
		if (this.total !== null && this.nextOffset >= this.total) return;
		if (this.bufferedEnd() - this.video.currentTime > AHEAD_TARGET_S) return;
		this.fetching = true;
		try {
			const end = this.total !== null ? Math.min(this.nextOffset + CHUNK_BYTES - 1, this.total - 1) : this.nextOffset + CHUNK_BYTES - 1;
			const res = await this.fetchRange(this.nextOffset, end);
			if (this.stopped) return;
			if (!res.ok) {
				// Mid-stream failure (URL died, gate drift) — surface it once; the stage's
				// retry restarts the feed from byte 0.
				this.cb.onError({ kind: 'network' });
				this.stop();
				return;
			}
			const range = parseContentRange(res.headers.get('content-range'));
			// Alignment is the feed's integrity: a 200 mid-feed (range ignored → the whole
			// file again) or a range starting anywhere but nextOffset would append bytes
			// at the wrong position and corrupt the stream (a frozen frame + a dead media
			// element is exactly what that looks like). Refuse and surface instead.
			if ((res.status === 200 && this.nextOffset > 0) || (range !== null && range.start !== this.nextOffset)) {
				this.cb.onError({ kind: 'network' });
				this.stop();
				return;
			}
			const buf = await res.arrayBuffer();
			if (this.stopped) return;
			await this.append(buf);
			this.nextOffset = range ? range.end + 1 : this.nextOffset + buf.byteLength;
			if (this.total === null && range) this.total = range.total;
		} catch {
			// abort (stop/track change) or a transient network throw — the pump retries the
			// transient case on its next tick; a stopped feeder ignores both.
		} finally {
			this.fetching = false;
		}
		// Chain immediately while still behind (don't wait for the next pump tick).
		if (!this.stopped && this.bufferedEnd() - this.video.currentTime <= AHEAD_TARGET_S) {
			void this.topUp();
		}
	}
}
