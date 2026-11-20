/**
 * debug apk-cold-media-play: the APK's ColdMediaLaunch.kt opens MainActivity on
 * `openmusic://play/resume` when "play" arrives from outside the app (Samsung routine, headset
 * key, media resumption) while it is closed. The root layout restores the last track and plays it.
 * Exact scheme/host/path only — any other VIEW url is not a play command.
 */
export const NATIVE_RESUME_URL = "openmusic://play/resume";

export function isResumeUrl(raw: string | null | undefined): boolean {
	if (!raw) return false;
	try {
		const u = new URL(raw);
		return u.protocol === "openmusic:" && u.hostname.toLowerCase() === "play" && u.pathname === "/resume";
	} catch {
		return false;
	}
}
