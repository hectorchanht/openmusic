// YouTube Music STREAM byte-proxy (Plan 27-03, YT-PLAY-01 / YT-DOWNLOAD-01) — THE WALL (spike 006).
//
// GET /api/ytmusic/stream/:videoId — pure helpers only for now (Task 1 RED skeleton). The route
// handler lands in Task 2.

// STUB (RED) — real playability gate lands in the GREEN commit.
export function isPlayable(_playerJson: unknown): boolean {
	return false;
}

// STUB (RED) — real itag-140 selection lands in the GREEN commit.
export function selectAudioFormat(_playerJson: unknown): string | null {
	return null;
}
