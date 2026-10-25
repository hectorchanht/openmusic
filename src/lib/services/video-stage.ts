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
}

const CHUNK_BYTES = 1024 * 1024;
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
			this.cb.onError({ kind: 'unsupported' });
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
			this.cb.onError({ kind: 'unsupported' });
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
		await this.append(await first.arrayBuffer());
		this.nextOffset = range ? range.end + 1 : 0;
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

	private bufferedEnd(): number {
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
