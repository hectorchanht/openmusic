package com.openmusic.app

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.view.KeyEvent
import androidx.media.MediaBrowserServiceCompat
import androidx.media.session.MediaButtonReceiver

/**
 * debug apk-cold-media-play: "play" from OUTSIDE the app (Samsung Modes & Routines "Play music",
 * headset/BT play key, Android media resumption) did nothing until the app was opened by hand,
 * and OpenMusic was not even listed in the routine's music-app picker.
 *
 * ROOT CAUSE: the audio engine is the WebView's <audio>, which only exists while MainActivity is
 * alive, and the APK declared no MediaBrowserService — the component Android and Samsung routines
 * use to find a "music app" and to wake it. The @jofr media-session plugin's own service only
 * works once the JS side has bound it; started cold by MediaButtonReceiver it has no session, so
 * the key was dropped (and the start-without-startForeground could kill the process).
 *
 * FIX (this file):
 *  - [OpenMusicBrowserService] — exported MediaBrowserService, so the app is listed and can be
 *    connected to while closed. Its session's play/prepare/search commands route to [wake].
 *  - [OpenMusicMediaButtonReceiver] — replaces androidx's MediaButtonReceiver in the manifest.
 *    App alive + plugin service running → the old path (plugin session, notification buttons).
 *    Otherwise → [wake].
 *  - [wake] — starts MainActivity on openmusic://play/resume; the root layout restores the last
 *    track and plays it (+layout.svelte, isResumeUrl).
 *
 * ponytail: the engine stays in the WebView, so a cold start still has to start the Activity (the
 * layout minimizes it again once sound starts). Android 10+ restricts background activity starts;
 * a media-key dispatch is allowed (verified on the API 34 emulator), and "Display over other
 * apps" (SYSTEM_ALERT_WINDOW, declared in the manifest) is the fallback if a routine's is not.
 * A native ExoPlayer engine in the service is the upgrade path (YouTube Music's model).
 */
object ColdMediaLaunch {
    const val TAG = "OpenMusicColdPlay"
    const val RESUME_URL = "openmusic://play/resume"

    /** True between MainActivity.onCreate and onDestroy (process-scoped, so false on a cold start). */
    @Volatile
    var activityAlive = false

    private const val PLUGIN_SERVICE =
        "io.github.jofr.capacitor.mediasessionplugin.MediaSessionService"

    @Suppress("DEPRECATION") // getRunningServices still returns the caller's OWN services.
    fun pluginServiceRunning(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.getRunningServices(Int.MAX_VALUE).any { it.service.className == PLUGIN_SERVICE }
    }

    /** The plugin's session can take the command right now (the pre-existing, warm path). */
    fun pluginCanHandle(ctx: Context) = activityAlive && pluginServiceRunning(ctx)

    fun wake(ctx: Context) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(RESUME_URL), ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!activityAlive && !Settings.canDrawOverlays(ctx)) {
            // A media-key dispatch carries a temporary background-start allowance (emulator API 34:
            // BAL_ALLOW_PERMISSION), so this usually works without it. If Android drops the start
            // silently, "Display over other apps" is the user-grantable fallback.
            Log.i(TAG, "cold start without overlay permission; if nothing opens, grant 'Display over other apps'")
        }
        try {
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "could not start MainActivity for cold play", e)
        }
    }
}

class OpenMusicMediaButtonReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (ColdMediaLaunch.pluginCanHandle(context)) {
            MediaButtonReceiver().onReceive(context, intent) // → plugin MediaSessionService
            return
        }
        @Suppress("DEPRECATION")
        val key = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        // Only a PLAY-ish key should open the app; pause/stop/next on a closed app mean nothing.
        val isPlay = key?.action == KeyEvent.ACTION_DOWN && key.keyCode in setOf(
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_HEADSETHOOK,
        )
        if (isPlay) ColdMediaLaunch.wake(context)
    }
}

class OpenMusicBrowserService : MediaBrowserServiceCompat() {
    private lateinit var session: MediaSessionCompat

    override fun onCreate() {
        super.onCreate()
        session = MediaSessionCompat(this, "OpenMusicLauncher").apply {
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE or
                            PlaybackStateCompat.ACTION_PREPARE or
                            PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH or
                            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
                    )
                    .setState(PlaybackStateCompat.STATE_STOPPED, 0, 1f)
                    .build()
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = play()
                override fun onPrepare() = play()
                override fun onPlayFromSearch(query: String?, extras: Bundle?) = play()
                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) = play()
            })
        }
        sessionToken = session.sessionToken
    }

    /** Warm: hand the command to the plugin's live session (same path as a headset key). Cold: wake. */
    private fun play() {
        if (ColdMediaLaunch.pluginCanHandle(this)) {
            try {
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    ComponentName(this, OpenMusicMediaButtonReceiver::class.java),
                    PlaybackStateCompat.ACTION_PLAY
                ).send()
                return
            } catch (e: Exception) {
                Log.w(ColdMediaLaunch.TAG, "warm play dispatch failed, waking instead", e)
            }
        }
        ColdMediaLaunch.wake(this)
    }

    override fun onDestroy() {
        session.release()
        super.onDestroy()
    }

    // Any caller may connect: the session can only "play the last song", nothing private leaks.
    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?) =
        BrowserRoot(ROOT, null)

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        // One playable entry: media-resumption UIs and routine pickers want something to "play".
        val resume = MediaDescriptionCompat.Builder()
            .setMediaId(RESUME_ID)
            .setTitle(getString(R.string.app_name))
            .build()
        result.sendResult(mutableListOf(MediaBrowserCompat.MediaItem(resume, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)))
    }

    private companion object {
        const val ROOT = "openmusic-root"
        const val RESUME_ID = "openmusic-resume"
    }
}
