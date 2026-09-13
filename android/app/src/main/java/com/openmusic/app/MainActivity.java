package com.openmusic.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the hand-written local MediaStore plugin (D-11 public-music-mediastore;
        // no npm/git dependency — T-999.1-07 mitigation) BEFORE super.onCreate so the bridge
        // picks it up when it initializes the WebView (Capacitor 8 registration mechanism).
        registerPlugin(MediaStoreSaverPlugin.class);
        super.onCreate(savedInstanceState);
        applyStatusBarInset();
    }

    /**
     * APK-only status-bar inset (quick-260913-apkpad).
     *
     * targetSdk 36 means Android 15+ FORCES edge-to-edge, so the Activity window extends under
     * the status bar and the WebView is laid out full-screen. The web CSS already guards this
     * with env(safe-area-inset-top) + viewport-fit=cover (app.html), but Android WebView only
     * reports DISPLAY-CUTOUT insets through env() — never system-bar insets — so the inset
     * resolves to 0 in the APK and the app header / NowPlaying menu button render UNDER the
     * status bar. Capacitor 8 ships no inset handling of its own (CapacitorWebView imports
     * Insets but never uses it), so the padding has to come from here.
     *
     * TARGET VIEW — do NOT switch this to a layout id from android/app/src/main/res/layout.
     * Capacitor 8's BridgeActivity calls setContentView(com.getcapacitor.android.R.layout
     * .capacitor_bridge_layout_main) — the LIBRARY's layout. The app-module activity_main.xml
     * that older Capacitor templates shipped is never inflated (it was deleted alongside this
     * comment). android.R.id.content is the decor FrameLayout hosting whatever the bridge
     * inflated, so it exists regardless of Capacitor's internal layout/id names.
     *
     * The explicit background paints the strip the padding opens up with the app's
     * theme-color (#0b0b0f, app.html) instead of the window default. Window stays edge-to-edge.
     * Web and iOS builds are untouched — this file only exists in the Capacitor shell.
     *
     * ponytail: top inset only. The bottom gesture bar overlays fine today and the web layout
     * already reserves env(safe-area-inset-bottom); add bars.bottom here if a device shows the
     * nav bar clipping the tab bar.
     */
    private void applyStatusBarInset() {
        View content = findViewById(android.R.id.content);
        if (content == null) {
            Log.w("OpenMusicInsets", "android.R.id.content missing — status bar inset NOT applied");
            return;
        }
        content.setBackgroundColor(0xFF0B0B0F);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            // Diagnostic: `adb logcat -s OpenMusicInsets` proves whether the listener fires and
            // what the platform reports, so a future top-padding regression is measured, not guessed.
            Log.i("OpenMusicInsets", "top=" + bars.top + " bottom=" + bars.bottom);
            view.setPadding(view.getPaddingLeft(), bars.top, view.getPaddingRight(), view.getPaddingBottom());
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
