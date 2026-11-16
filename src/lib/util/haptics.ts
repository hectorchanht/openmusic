// Commit-tier haptic feedback (D-17). A leaf util — no static imports, no DOM beyond the
// optional `navigator.vibrate`, SSR-safe and exception-safe. iOS Safari has no
// `navigator.vibrate`, so the call is optional-chained AND wrapped in try/catch: tick()
// must NEVER throw and must no-op silently where unsupported. 15ms is the locked
// commit-tier duration (D-17). Call sites are deliberately CURATED (long-press menu
// open, swipe commits, seek/track-change commits) — never per-tap.
//
// quick-261116-perf: on native (Capacitor APK) tick() prefers the @capacitor/haptics
// plugin (ImpactStyle.Light — the lightest built-in) because iOS native has no
// navigator.vibrate at all and Android's plugin path honours the OS haptics setting.
// The plugin loads LAZILY via dynamic import behind isNativePlatform(), memoized, so
// the web bundle and the node test project never execute it at module scope; until the
// plugin is warm (or on web) the vibrate path below is the behaviour, unchanged. The
// settings toggle reaches this leaf via setHapticsEnabled() — the settings store calls
// it on load/toggle/reset, so this util keeps its zero-import leaf invariant (the store
// imports the util, never the reverse).

let enabled = true;

/** Settings seam (quick-261116-perf): false silences every tick. Default ON. */
export function setHapticsEnabled(v: boolean): void {
	enabled = v;
}

type HapticsModule = typeof import('@capacitor/haptics');
let nativeMod: HapticsModule | null = null;
let nativeLoadStarted = false;

// Memoized one-time lazy load of the native plugin. Fire-and-forget; any failure
// (web runtime, missing plugin, node tests) leaves nativeMod null and tick() keeps
// using navigator.vibrate — exactly the pre-plugin behaviour.
function kickNativeLoad(): void {
	if (nativeLoadStarted) return;
	nativeLoadStarted = true;
	void (async () => {
		try {
			const { Capacitor } = await import('@capacitor/core');
			if (!Capacitor.isNativePlatform()) return;
			nativeMod = await import('@capacitor/haptics');
		} catch {
			/* not native / plugin unavailable — vibrate fallback stays */
		}
	})();
}

/** Fire a light commit-tier haptic where supported; no-op (never throws) where it is not. */
export function tick(): void {
	if (!enabled) return;
	kickNativeLoad();
	try {
		if (nativeMod) {
			// Native plugin warm: lightest impact, fire-and-forget, rejection swallowed.
			void nativeMod.Haptics.impact({ style: nativeMod.ImpactStyle.Light }).catch(() => {});
			return;
		}
		navigator.vibrate?.(15);
	} catch {
		/* unsupported / blocked — silently no-op (iOS Safari, denied permission) */
	}
}
