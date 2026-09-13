package com.openmusic.app;

import android.os.Bundle;
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
     * Padding the root CoordinatorLayout (dark #0b0b0f background, matching the app theme-color)
     * pushes the WebView below the system bars while the window itself stays edge-to-edge.
     * Web and iOS builds are untouched — this file only exists in the Capacitor shell.
     *
     * ponytail: top inset only. The bottom gesture bar overlays fine today and the web layout
     * already reserves env(safe-area-inset-bottom); add bars.bottom here if a device shows the
     * nav bar clipping the tab bar.
     */
    private void applyStatusBarInset() {
        View root = findViewById(R.id.om_root);
        if (root == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(view.getPaddingLeft(), bars.top, view.getPaddingRight(), view.getPaddingBottom());
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }
}
