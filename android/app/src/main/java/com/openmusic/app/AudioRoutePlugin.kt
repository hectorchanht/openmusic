package com.openmusic.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Hand-written, local Capacitor plugin (NO npm/git dependency — T-999.1-07 mitigation):
 * forwards Android's `ACTION_AUDIO_BECOMING_NOISY` broadcast to the web player.
 *
 * Why native at all: the app plays through a single `<audio>` in the System WebView. On the
 * user's phone, unplugging the earphones / disconnecting the BT headset does NOT pause that
 * element — the WebView never sees the platform's "becoming noisy" treatment, so music keeps
 * playing out of the phone speaker. The web `devicechange` detector (audio-route.ts) cannot
 * catch this either: Android Chrome/WebView expose only a single "Default" audiooutput in
 * `enumerateDevices()`, so an output-route change is invisible to JS.
 *
 * `ACTION_AUDIO_BECOMING_NOISY` is the canonical OS signal for exactly this: wired-headset
 * unplug AND A2DP disconnect both fire it when the noisy route was the active output. The web
 * side listens for the `audioBecomingNoisy` event (see `src/lib/services/audio-route.ts`) and
 * pauses via the player's sanctioned route-loss path — a DELIBERATE pause, so the pause
 * listener treats it as intentional (no stall retry, no self-heal, no auto-resume; the queue
 * simply waits for the next user tap).
 *
 * Registration: context-registered (NOT manifest-declared) in `load()` — the app only needs
 * this while it is alive and playing. Unregistered in `handleOnDestroy()`. `notifyListeners`
 * uses `retainUntilConsumed = true` so the event is not dropped if the web layer attaches its
 * listener a beat after the broadcast fires.
 */
@CapacitorPlugin(name = "AudioRoute")
class AudioRoutePlugin : Plugin() {

    private var noisyReceiver: BroadcastReceiver? = null

    override fun load() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                    Log.i("OpenMusicAudioRoute", "becoming-noisy -> notify web layer")
                    notifyListeners("audioBecomingNoisy", JSObject(), true)
                }
            }
        }
        noisyReceiver = receiver
        try {
            val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                context.registerReceiver(receiver, filter)
            }
            Log.i("OpenMusicAudioRoute", "becoming-noisy receiver registered")
        } catch (e: Exception) {
            // Registration failure degrades to the web `devicechange` detector — never a broken app.
            Log.w("OpenMusicAudioRoute", "receiver registration failed: ${e.message}")
            noisyReceiver = null
        }
    }

    override fun handleOnDestroy() {
        val receiver = noisyReceiver
        noisyReceiver = null
        if (receiver != null) {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {
                // Already unregistered / never registered — harmless.
                Log.w("OpenMusicAudioRoute", "receiver unregister failed: ${e.message}")
            }
        }
    }
}
