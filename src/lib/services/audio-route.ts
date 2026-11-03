// Audio-output route-loss detector (quick-261014-routefix) ---------------------------------
//
// When the active audio output disappears — wired earphones unplugged, BT headset disconnected
// — playback MUST pause instead of blasting out of the phone speaker. The player wires this in
// `player.attach()` and pauses via its sanctioned route-loss path (a DELIBERATE pause: no stall
// retry, no self-heal, no auto-resume; the queue waits for the next user tap).
//
// TWO arms, because no single API sees the event on every platform:
//  1. NATIVE (APK): the hand-written `AudioRoute` Capacitor plugin
//     (android/app/src/main/java/com/openmusic/app/AudioRoutePlugin.kt) forwards Android's
//     `ACTION_AUDIO_BECOMING_NOISY` — the canonical OS signal, fired for wired unplug AND A2DP
//     disconnect — as an `audioBecomingNoisy` listener event. Needed because the System WebView
//     does NOT pause the web `<audio>` on output-route loss, and `enumerateDevices()` on
//     Android exposes only a single "Default" audiooutput, so JS cannot see the route change.
//  2. WEB `devicechange`: on platforms where `enumerateDevices()` faithfully lists outputs
//     (desktop Chrome etc.), a STRICT SHRINK of the audiooutput device set — a device vanished,
//     not added or renamed — fires the callback. Additions/renames (BT connect, default-route
//     switch, camera/mic churn) must never pause; they are not a "headphones pulled" event.
//
// Never-throw service (house rule): every platform absence or rejection degrades to "this arm
// is a no-op", never a broken player.

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** JS-side shape of the hand-written native `AudioRoute` plugin. */
interface AudioRoutePlugin {
	addListener(
		eventName: 'audioBecomingNoisy',
		listener: () => void
	): Promise<PluginListenerHandle>;
}

/** Stops both detector arms. Idempotent. */
export interface AudioRouteWatcher {
	stop(): void;
}

function audioOutputIds(devices: MediaDeviceInfo[]): Set<string> {
	return new Set(
		devices.filter((d) => d.kind === 'audiooutput').map((d) => d.deviceId)
	);
}

/**
 * Start watching for audio-output route loss. `onLoss` fires at most once per loss event;
 * the caller (player) decides whether anything is actually audible and should pause.
 * Safe to call on web, SSR, and native — unsupported arms are silent no-ops.
 */
export function watchAudioRouteLoss(onLoss: () => void): AudioRouteWatcher {
	const stops: Array<() => void> = [];
	const addStop = (fn: () => void) => {
		stops.push(() => {
			try {
				fn();
			} catch {
				/* a stop must never throw */
			}
		});
	};

	// quick-261014-routefix arm 1 — native APK becoming-noisy broadcast.
	try {
		if (Capacitor.isNativePlatform()) {
			const AudioRoute = registerPlugin<AudioRoutePlugin>('AudioRoute');
			let handle: PluginListenerHandle | null = null;
			void AudioRoute.addListener('audioBecomingNoisy', () => {
				try {
					onLoss();
				} catch {
					/* never let a listener throw back into the bridge */
				}
			})
				.then((h) => {
					handle = h;
				})
				.catch(() => {
					/* plugin missing on an old APK build — web arm still applies */
				});
			addStop(() => {
				void handle?.remove().catch(() => {});
			});
		}
	} catch {
		/* Capacitor unavailable — web arm still applies */
	}

	// quick-261014-routefix arm 2 — web `devicechange` with strict-shrink detection.
	try {
		const md: MediaDevices | undefined =
			typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
		if (
			md &&
			typeof md.enumerateDevices === 'function' &&
			typeof md.addEventListener === 'function'
		) {
			let baseline = new Set<string>();
			// Baseline snapshot at watch start (best-effort; a failed snapshot just means the
			// first devicechange compares against an empty set — a shrink can only fire when a
			// device that was PRESENT at snapshot time disappears, so an empty baseline can
			// never produce a false pause).
			void md
				.enumerateDevices()
				.then((devices) => {
					baseline = audioOutputIds(devices);
				})
				.catch(() => {});
			const onChange = () => {
				const before = baseline;
				void md
					.enumerateDevices()
					.then((devices) => {
						const now = audioOutputIds(devices);
						const removed = [...before].filter((id) => !now.has(id));
						baseline = now;
						// STRICT shrink only: something that existed at baseline is gone AND the
						// total count dropped. A same-count rename/swap is a route switch, not a
						// loss — pausing there would punish the user for switching outputs.
						if (removed.length > 0 && now.size < before.size) {
							try {
								onLoss();
							} catch {
								/* never-throw */
							}
						}
					})
					.catch(() => {});
			};
			md.addEventListener('devicechange', onChange);
			addStop(() => md.removeEventListener('devicechange', onChange));
		}
	} catch {
		/* mediaDevices unavailable — no-op */
	}

	let stopped = false;
	return {
		stop() {
			if (stopped) return;
			stopped = true;
			for (const s of stops) s();
		}
	};
}
