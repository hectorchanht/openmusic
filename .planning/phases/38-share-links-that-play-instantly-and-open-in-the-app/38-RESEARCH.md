# Phase 38: Share links that play instantly and open in the app - Research

**Researched:** 2026-09-20
**Domain:** SvelteKit static-asset serving + Android App Links / Capacitor deep links + existing player-store queue semantics
**Confidence:** HIGH for everything empirically run in this session (the `assetlinks.json` pipeline, the Capacitor cold-start seam, every file:line claim). MEDIUM for on-device App Links verification (cannot be run here — needs the emulator + a deployed `assetlinks.json`).

## Summary

Two independent halves with almost no shared code. **(A)** is entirely a re-composition of code
that already exists — `restore()`, `playNext(pin:false)` + `play(fresh:false)`, `ensureTrackDetails`,
`apiFetch`. The only genuinely new logic is a ~6-line cold-vs-warm decision and a uid-stub builder,
both of which are pure and belong in a `.ts` next to a node test. **(B)** is three files
(`static/.well-known/assetlinks.json`, `AndroidManifest.xml`, one `appUrlOpen` listener) plus one
human step (`keytool` against the release keystore).

**The landmine flagged in CONTEXT is clear.** I created `static/.well-known/assetlinks.json`, ran
BOTH builds, and served the output through `wrangler pages dev`: the dot-directory survives
`adapter-cloudflare` AND `adapter-static`, lands in `_routes.json`'s `exclude` list (so Pages serves
it as a static asset, bypassing the SvelteKit worker entirely), and is returned `200 application/json`
with no redirect. No workaround needed — the plain `static/.well-known/` path is correct.

**The landmine CONTEXT did NOT flag is the Capacitor cold start.** I read the plugin source:
`AppPlugin.handleOnNewIntent` only fires on `Activity.onNewIntent` — i.e. WARM (already running).
On a COLD start, `Bridge` captures `intent.getData()` into a private `intentUri` and then loads the
app's own `index.html`; **`appUrlOpen` never fires**. The cold path MUST read `App.getLaunchUrl()`.
A plan that only adds an `appUrlOpen` listener will have a deep link that works when the app is
already open and silently drops to the home screen when it is not.

**Primary recommendation:** Put the cold/warm decision and the uid-carrier codec in pure `.ts`
modules with node tests; add ONE player method (`arriveShared`) that both landing routes and the
deep-link handler call; ship `assetlinks.json` at the plain `static/.well-known/` path; handle BOTH
`getLaunchUrl()` (cold) and `addListener('appUrlOpen')` (warm).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Emit the uid carrier in the share URL | Client — pure service (`share.ts`) | — | `share.ts` is already the single builder seam; it is pure and server-importable, and must stay that way |
| Parse the carrier + build a resolvable stub | Client — pure service | — | Pure string→`Track` transform; the one genuinely node-testable new unit |
| Cold-vs-warm arrival decision | Client — pure function reading a player snapshot | Player store (thin caller) | CLAUDE.md's stated pattern; the store must not grow a fourth inline branch |
| Detail resolve from the stub | Client — player store | API proxy (edge) | `ensureTrackDetails` → `SOURCES[src].resolve` → `apiFetch('/api/kuwo/detail?…')` — the governor is already on this path |
| Armed-but-paused seat (cover seed, metadata, `audio.src`) | Client — player store | — | `restore()` already owns every one of these writes |
| Queue splice + instant play | Client — player store | — | `playNext` + `play` already exist; zero store diff needed for the warm half |
| Domain-ownership proof (`assetlinks.json`) | CDN / Static (Cloudflare Pages asset) | — | VERIFIED excluded from `_worker.js` routing — never touches SSR |
| URL→app interception | OS (Android PackageManager) | Native shell (`AndroidManifest.xml`) | Verification is per-HOST and done by the OS; `pathPrefix` only narrows which URLs match |
| Cold-start URL delivery | Native (Capacitor `Bridge.intentUri` → `getLaunchUrl()`) | Client router (`goto`) | `appUrlOpen` structurally cannot fire on cold start |
| Warm URL delivery | Native (`AppPlugin.handleOnNewIntent`) | Client router (`goto`) | `launchMode="singleTask"` is what routes the re-intent here |

## User Constraints (from CONTEXT.md)

All 26 decisions (D-01..D-26) in `38-CONTEXT.md` are LOCKED. They are not restated here — the
planner reads that file directly. This research investigates HOW to implement them.

Two items marked **Claude's Discretion** where this research offers a recommendation:
- **The query-param letter for the uid carrier** → recommend `?u=` (see §7 for the collision audit).
- **New player method vs parameterising `restore()`** → recommend a NEW thin method (`arriveShared`),
  NOT a parameterised `restore()`. Rationale in §4: ~40% of `restore()`'s body is persistence-specific
  and must not run for a share arrival, and `restore()` is pinned by existing tests.

## Project Constraints (from CLAUDE.md)

Directives the planner must verify every task against:

- **Tabs**, single quotes in TS — EXCEPT `src/lib/i18n/*.ts` which uses **double quotes for keys AND values**.
- **Svelte 5 runes only.** No `export let`, no `$:`. Anything using `$state`/`$derived`/`$effect`
  MUST live in `*.svelte.ts` or `*.svelte`; pure logic stays `.ts`.
- **Pure functions extracted and exported for testability; runes stores are thin callers.**
- **Stores never import UI and never localize** — they emit a `TranslationKey`; the layout host maps it.
- **No new runtime npm dependency** unless unavoidable (the web app currently has zero third-party runtime deps).
- **`browser` guard** on anything touching `localStorage`/`window`/`document` — SSR is on for both song routes.
- **`apiFetch`** for every `/api/*` call. Media/blob bytes use raw `fetch`.
- **Generation guards** on every async path that a newer user action can supersede.
- **High comment density; comments are load-bearing decision records.** New behaviour needs a
  `quick-NNNNNN-xxx` or decision-ref comment. Existing decision-ref comments must NOT be deleted.
- **Zero `as any` in production source.**
- **`pnpm check` (svelte-check) is the only quality gate** — there is no linter/formatter.
- **GSD workflow enforcement:** edits go through a GSD command, not ad-hoc.

---

## 1. Does `static/.well-known/assetlinks.json` reach production?

**YES. Verified empirically this session, end to end. No workaround needed.** [VERIFIED: local build + wrangler pages dev]

### What I ran

```bash
mkdir -p static/.well-known
printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.openmusic.app","sha256_cert_fingerprints":["AA:BB"]}}]\n' > static/.well-known/assetlinks.json
pnpm build          # adapter-cloudflare
pnpm build:native   # adapter-static
```

### Results

| Check | Result |
|-------|--------|
| `adapter-cloudflare` → `.svelte-kit/cloudflare/.well-known/assetlinks.json` | ✅ present, byte-identical |
| `adapter-static` → `build/.well-known/assetlinks.json` | ✅ present, byte-identical |
| Listed in generated `_routes.json` `exclude` | ✅ `"/.well-known/assetlinks.json"` — Pages serves it as a **static asset, bypassing `_worker.js`** |
| Served through `wrangler pages dev .svelte-kit/cloudflare` | ✅ `HTTP/1.1 200 OK`, `Content-Type: application/json`, no `Location`, no redirect |
| Live prod today (`curl -i -L https://openmusic.lol/.well-known/assetlinks.json`) | `HTTP/2 404`, `content-type: text/html`, `x-sveltekit-page: true` — the file simply does not exist yet. **No redirect, no interception.** The 404 body is the SPA shell. |
| `static/robots.txt` allows `.well-known` | ✅ `User-agent: *` / `Disallow:` (empty = allow all). Google's docs ask that robots.txt not block it. |
| Route collision | ✅ None. `find src/routes -maxdepth 3 -type d` shows no root-level catch-all; the deepest root-adjacent routes are `/song/…`, `/album/…`, `/artist/…`, `/api/…`. |

I deleted the probe file afterwards — the tree is clean. `git status` shows only the pre-existing
untracked `.planning/debug/page-switch-lag-tap-dead.md`.

### One real (harmless) side effect to document

The service worker precaches everything in `$service-worker`'s `files` array, which now includes the
new path. Confirmed in the built SW:

```
assetlinks.json`,e+`/favicon.svg`,e+`/icon-maskable.svg`,…
```

Harmless (171 bytes, same-origin, precached once per deploy) but the planner should be aware:
`src/service-worker.ts:22` filters only `.wasm`. No change needed; just don't be surprised.

### Second harmless side effect: the APK strips it

`android/app/build.gradle` `aaptOptions.ignoreAssetsPattern` contains a bare `.*` entry, which makes
aapt omit ALL dot-directories from the packaged assets. So `.well-known/` will NOT be inside the
APK's `assets/public/`. **This is correct and irrelevant** — App Links verification fetches the JSON
from the WEB host (`https://openmusic.lol`), never from the APK. Do not "fix" this.

### Ordering hazard (the one thing that can still go wrong)

`assetlinks.json` must be LIVE on `openmusic.lol` **before** a user installs/updates the APK, because
on Android ≤14 verification runs at install/update time only. Combined with
`openmusic-pushes-autodeploy-live` (a push to `main` auto-deploys prod), the natural ordering is:
ship the JSON in an early wave → confirm the live `curl` → only then cut an APK. The plan should
make that a sequenced dependency, not two parallel tasks.

---

## 2. Android App Links mechanics for this Capacitor app

### 2a. The `assetlinks.json` document

`com.openmusic.app` is LOCKED (`capacitor.config.ts:9`, matches `android/app/build.gradle`
`namespace`/`applicationId`). [VERIFIED: repo]

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.openmusic.app",
      "sha256_cert_fingerprints": [
        "37:30:88:C4:7F:83:64:6F:83:D8:B3:C7:E1:58:FB:37:F5:8D:17:7C:1B:27:00:3F:BF:1A:5E:AD:87:EB:8D:A2",
        "<RELEASE FINGERPRINT — user pastes in, see 2c>"
      ]
    }
  }
]
```

The `relation` string and array-of-one-statement shape are [CITED:
developers.google.com/digital-asset-links/v1/getting-started] and [CITED:
developer.android.com/training/app-links/verify-android-applinks].

**The first fingerprint above is REAL** — I read it from this machine's
`~/.android/debug.keystore` this session: [VERIFIED: keytool on this machine]

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA256
```

⚠️ **That debug fingerprint is machine-local, not project-wide.** Any other developer's `pnpm apk`
produces a differently-signed APK that will NOT verify. Note it in the JSON with a comment in the
plan (JSON itself can't carry comments — record it in the commit message / a sibling doc).

⚠️ **CI does NOT need a debug entry.** I checked `.github/workflows/android-main.yml`: the rolling
"prerelease" from `main` runs `assembleRelease` and signs with the **release** keystore, same as
`android-release.yml`. Only a local `pnpm apk` uses the debug keystore. So the two fingerprints above
cover every APK that exists.

### 2b. The intent-filter

`android/app/src/main/AndroidManifest.xml` today has ONLY MAIN/LAUNCHER, and
`android:launchMode="singleTask"` + `android:exported="true"` are already present (D-26 confirmed).
[VERIFIED: repo] Add a SECOND `<intent-filter>` inside the same `<activity>` — do not modify the
existing one:

```xml
<!-- 38-D-23/D-24: Android App Links. Claims openmusic.lol ONLY (the one host shareOrigin()
     emits), and ONLY the three share surfaces — every other openmusic.lol URL still opens in a
     browser. autoVerify makes the OS fetch https://openmusic.lol/.well-known/assetlinks.json at
     install/update and grant this activity the domain without a disambiguation dialog.
     NOTE: verification is per-HOST; the pathPrefix entries narrow which URLs this filter MATCHES,
     they are not part of what is verified. -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="openmusic.lol" android:pathPrefix="/song" />
    <data android:scheme="https" android:host="openmusic.lol" android:pathPrefix="/album" />
    <data android:scheme="https" android:host="openmusic.lol" android:pathPrefix="/artist" />
</intent-filter>
```

`BROWSABLE` + `DEFAULT` are both mandatory or the filter never matches a browser-originated VIEW
intent. [CITED: developer.android.com/training/app-links/verify-android-applinks]

Two subtleties worth a comment in the manifest:

- **`pathPrefix="/song"` also matches `/songbook`.** There is no such route today and `/song` has no
  sibling prefix collisions in `src/routes/(app)/`, so this is safe — but say so, because a future
  `/songs` route would silently start opening in the app.
- **Only `scheme="https"`.** `shareOrigin()` (`src/lib/services/share.ts:35`) can only ever emit
  `https://openmusic.lol` (it rewrites localhost/capacitor/file to `apiOrigin() || 'https://openmusic.lol'`).
  Adding `http` would claim a scheme we never emit. Don't.

### 2c. The literal `keytool` command for the user (D-22)

The release keystore is a GitHub secret (`RELEASE_KEYSTORE`, base64) and never lands on disk in CI.
The user has the original locally. The literal command:

```bash
# JDK 21 is required on this machine (apk-build-needs-jdk21) — the default java is 20.
export JAVA_HOME=$(/usr/libexec/java_home -v 21)

"$JAVA_HOME/bin/keytool" -list -v \
  -keystore /path/to/release.keystore \
  -alias "$KEY_ALIAS" \
  | grep -i 'SHA256:'
```

It will prompt for the keystore password — do NOT pass `-storepass` on the command line (it lands in
shell history). Copy the colon-separated uppercase hex after `SHA256:` verbatim into the JSON.

**Equivalent, if the keystore isn't handy but a signed APK is** (from a GitHub Release):

```bash
"$JAVA_HOME/bin/keytool" -printcert -jarfile app-release-signed.apk | grep -i 'SHA256:'
```

Both give the same value. [CITED: developer.android.com/training/app-links/verify-android-applinks]

**Security note for the plan:** the SHA256 fingerprint is PUBLIC data (it is derived from the
certificate that ships in every APK). Committing it is correct and is not a secret leak. The
KEYSTORE FILE and its passwords are the secrets, and neither goes anywhere near the repo.
D-26 is confirmed: Obtainium/sideload means no Play App Signing re-sign, so the release keystore
fingerprint is the single stable identity forever.

### 2d. On-device verification — the literal commands

`adb` is at `/opt/homebrew/bin/adb` and the `Pixel_3a_API_34` AVD exists. [VERIFIED: this machine]
API 34 is ≥ Android 12, so the modern verification path applies with no compat shim.

```bash
# 0. boot the emulator (needs network for the verification agent to fetch the JSON)
~/Library/Android/sdk/emulator/emulator -avd Pixel_3a_API_34 &
adb wait-for-device

# 1. install the APK
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
pnpm apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# 2. reset any prior link state, then force a re-verify
adb shell pm set-app-links --package com.openmusic.app 0 all
adb shell pm verify-app-links --re-verify com.openmusic.app

# 3. wait ~30-60s, then READ THE VERDICT (this is the pass/fail gate)
adb shell pm get-app-links com.openmusic.app
#   want:  openmusic.lol: verified
#   fail:  openmusic.lol: 1024 / legacy_failure / none

# 4. functional test — must land IN THE APP, not a browser
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://openmusic.lol/song/Adele/Hello"

# 5. negative test — an unclaimed path MUST still open a browser
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://openmusic.lol/search"
```

[CITED: developer.android.com/training/app-links/verify-android-applinks#manual-verification]

**Pitfall:** `adb shell am start` on its own will launch the app even WITHOUT a verified domain
(explicit intent resolution can still match the filter). Step 3's `verified` string is the real gate —
do not accept step 4 alone as proof.

**Pitfall:** On Android ≤14 the OS only re-verifies at install/update; on Android 15+ background
re-verification can take up to 7 days. `pm verify-app-links --re-verify` is the manual override. If
verification fails, uninstall + reinstall after fixing the JSON. [CITED: developer.android.com]

### 2e. What to grep for in `pm get-app-links` output

```
com.openmusic.app:
    ID: …
    Signatures: [37:30:88:C4:…]          ← must match a fingerprint in assetlinks.json
    Domain verification state:
      openmusic.lol: verified             ← the ONLY acceptable value
```

If `Signatures:` shows a fingerprint that is NOT in the JSON, the APK was signed with a different
keystore than the one the user ran `keytool` against. That is the single most likely failure.

---

## 3. Capacitor deep-link handling

### 3a. `@capacitor/app` is installed but has ZERO importers in `src/`

`grep -rn "capacitor/app" src` → **no matches**. [VERIFIED: repo] The package is in
`package.json` `dependencies` (`@capacitor/app@^8.1.0`, resolved `8.1.0`) and the native
`AppPlugin` is already registered — `android/app/src/main/assets/capacitor.plugins.json` lists
`com.capacitorjs.plugins.app.AppPlugin`, and `android/capacitor.settings.gradle` includes
`:capacitor-app`. So **no install, no `cap sync` prerequisite** — this phase is simply its first
JS-side consumer.

### 3b. 🔴 COLD START DOES NOT FIRE `appUrlOpen` — this is the critical finding

I read the plugin and bridge source in `node_modules`:

`node_modules/.pnpm/@capacitor+app@8.1.0…/android/…/AppPlugin.java` — the ONLY place `appUrlOpen` is
emitted:

```java
@Override
protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    String action = intent.getAction();
    Uri url = intent.getData();
    if (!Intent.ACTION_VIEW.equals(action) || url == null) return;
    JSObject ret = new JSObject();
    ret.put("url", url.toString());
    notifyListeners(EVENT_URL_OPEN, ret, true);
}
```

`handleOnNewIntent` runs only from `Activity.onNewIntent` — i.e. the app was ALREADY RUNNING
(which is exactly what `launchMode="singleTask"` guarantees for a re-tap).

`node_modules/.pnpm/@capacitor+android@8.4.0…/…/Bridge.java:228-229`, in the constructor:

```java
// Grab any intent info that our app was launched with
Intent intent = context.getIntent();
this.intentUri = intent.getData();
```

…and `Bridge.java:620-648` then builds `appUrl` from the config's server URL / `localUrl` +
`startPath` — **it never navigates to `intentUri`.** `intentUri` is only reachable via
`getIntentUri()` (`Bridge.java:519`), which `AppPlugin.getLaunchUrl` exposes (`AppPlugin.java:93-103`).

**Conclusion:** a cold App Link launch loads `https://localhost/` (the SPA index) and the deep-link
URL is available ONLY from `App.getLaunchUrl()`. [VERIFIED: plugin + bridge source read this session]

This directly answers the CONTEXT note "on a cold start the URL may arrive BEFORE the SvelteKit
router is ready" — it's worse than that: on a cold start the URL does not "arrive" at all. There is
no race to lose; there is a call you must make.

### 3c. Event payload

```ts
interface URLOpenListenerEvent {
  url: string;               // the full URL, e.g. "https://openmusic.lol/song/Adele/Hello?u=kuwo:123"
  iosSourceApplication?: unknown;  // iOS only — ignore
  iosOpenInPlace?: boolean;        // iOS only — ignore
}
```
`getLaunchUrl(): Promise<AppLaunchUrl | undefined>` where `AppLaunchUrl = { url: string }`.
Returns `undefined` when the app was launched normally (from the launcher). [VERIFIED:
`node_modules/@capacitor/app/dist/esm/definitions.d.ts:58-71, 142, 180, 241`]

### 3d. Recommended shape, matching this repo's conventions

Every existing Capacitor call site in this repo guards with `Capacitor.isNativePlatform()` from
`@capacitor/core` (`blob-store.ts:309,729,754`, `player.svelte.ts:1460`, `ytmusic.ts:257`,
`backup-io.ts:35`, `settings/downloads/+page.svelte:128`). Match that, not a `browser` check alone.
[VERIFIED: repo]

Mount point: the ROOT layout (`src/routes/+layout.svelte`) is the only place mounted once for the
whole app lifetime. Put it there, in `onMount` (NOT an `$effect` — see §4c).

```ts
// 38-D-25. Android App Links → this listener is what turns the intercepted URL into a normal
// in-app navigation, so the web and APK share ONE arrival path.
//
// 🔴 TWO SEAMS, NOT ONE. appUrlOpen fires ONLY from AppPlugin.handleOnNewIntent, i.e. when the
// activity was ALREADY RUNNING (launchMode=singleTask routes the re-tap there). On a COLD start
// Capacitor's Bridge captures intent.getData() into a private intentUri and then loads
// index.html — it NEVER navigates to it — so appUrlOpen does not fire and the deep link is
// silently lost unless getLaunchUrl() is read. Verified against
// @capacitor/app@8.1.0 AppPlugin.java + @capacitor/android@8.4.0 Bridge.java:228.
onMount(() => {
    if (!Capacitor.isNativePlatform()) return;
    let off: (() => void) | undefined;
    void (async () => {
        const { App } = await import('@capacitor/app');
        const launch = await App.getLaunchUrl();          // COLD
        if (launch?.url) routeDeepLink(launch.url);
        const h = await App.addListener('appUrlOpen', (e) => routeDeepLink(e.url)); // WARM
        off = () => void h.remove();
    })();
    return () => off?.();
});
```

`routeDeepLink` should be a pure-ish helper: strip the origin, keep `pathname + search`, reject
anything whose host is not `openmusic.lol`, then `goto(pathAndQuery)`. Extract the URL→path
transform as a pure export so it gets a node test (see §9).

**Cold-start ordering:** `onMount` in the root layout runs after the SvelteKit client router has
hydrated, so `goto()` is safe by then. This is strictly better than trying to intercept earlier.
The visible cost is one extra client-side navigation on a cold deep-link launch (index → /song/…),
which is imperceptible in an SPA and keeps ONE arrival path (D-25).

**Idempotency hazard:** `getLaunchUrl()` returns the SAME `intentUri` for the whole activity
lifetime — it is never cleared. If anything re-runs the mount logic (an HMR reload in dev, a future
re-mount), the deep link re-fires. D-03's no-op guard (`player.current?.uid === track.uid → return`)
absorbs this, but the plan should also make the listener setup run exactly once.

---

## 4. `restore()` — what it actually does, and where the seam is

`src/lib/stores/player.svelte.ts:553-655` (`async restore()`). Step by step: [VERIFIED: source read]

| # | Line (approx) | What it does | Reusable for a share arrival? |
|---|---|---|---|
| 1 | 554 | `if (!browser) return;` | ✅ yes |
| 2 | 559 | `parsePlayerState(localStorage.getItem(STATE_KEY))`; `if (!parsed) return;` | ❌ **persistence-specific** |
| 3 | 563-565 | `this.queue = parsed.queue; this.shuffle = …; this.repeatMode = …` | ❌ **persistence-specific** — a share arrival must KEEP the recipient's live queue/shuffle/repeat (D-02) |
| 4 | 566 | `this.current = target` | ✅ yes (with the shared track) |
| 5 | 578 | `this.upNextAnchorUid = parsed.anchorUid ?? target.uid` | ⚠️ **do NOT copy.** A share arrival splices into an EXISTING queue; re-anchoring is exactly what D-07 forbids |
| 6 | 586-591 | `this.resolvedCover = getPinnedCover(uid) ?? target.cover ?? getCachedCoverByUid(uid) ?? getCachedCover(artist,title) ?? null` | ✅ **yes — this is the cover seed chain to reuse verbatim** |
| 7 | 592 | `this.syncMetadata()` | ✅ yes — this is what puts title/artist on the OS media card before any playback (`hero-mediacard-cover-resolvedcover-asymmetry`) |
| 8 | 593 | `this.loading = true` | ✅ yes |
| 9 | 601-604 | offline-first: `library.isDownloaded(uid)` → `blobStore.get(uid)` | ✅ yes — a recipient who already has the song downloaded should get the blob |
| 10 | 605-612 | `ensureTrackDetails(target)` → `this.current = resolved`; patch the queue slot at `indexOf`; `backfillLyrics` if `lrcUnresolved` | ✅ yes |
| 11 | 613-622 | the offline-blob branch: `enrichFromLocalFile` | ✅ yes |
| 12 | 623 | `if (!this.audio) return;` | ✅ yes |
| 13 | 624-627 | revoke a stale `cachedBlobUrl` | ✅ yes |
| 14 | 628-637 | pick `src` = blob URL or `resolved.audioUrl`; bail if neither | ✅ yes |
| 15 | 641 | `this.pendingSeek = seek > 0 ? seek : null` | ❌ **persistence-specific** — a shared song starts at 0, always |
| 16 | 644-645 | `this.lastSrcKind = …; audio.src = src;` — **deliberately a DIRECT assign, NOT `driveSrc`** (31-D-12 comment: routing it would subject a boot restore to the re-drive brake) | ⚠️ see below |
| 17 | 647-650 | apply `pendingSeek` immediately if duration already finite | ❌ persistence-specific |
| 18 | 651-654 | `catch {}` / `finally { this.loading = false }` | ✅ yes |
| — | everywhere | **`play()` is NEVER called.** No `audio.play()`. No `playGen` bump. | ✅ this is the whole point |

### 4a. Recommended seam

Do NOT parameterise `restore()`. Four of its eighteen steps are persistence-only, two of them
(`queue`/`repeatMode` install, `pendingSeek`) are actively WRONG for a share arrival, and `restore()`
is pinned by several existing tests (`player.svelte.test.ts:2091, 2097, 2103` assert `repeatMode`
migration through it). A boolean flag threaded through a freeze-sensitive boot path is how you get
a fourth loop-class bug.

Instead add a NEW method that reuses steps 6-14 + 18. Sketch:

```ts
/**
 * 38-D-05: seat a track RESOLVED + ARMED + PAUSED — one tap from sound. The same shape
 * restore() builds for a PWA reopen (cover seed chain → syncMetadata → ensureTrackDetails →
 * audio.src), MINUS everything persistence-specific: no localStorage read, no queue/shuffle/
 * repeat install, no upNextAnchorUid re-anchor, no pendingSeek. It never calls play() —
 * mobile autoplay policy would reject a non-gesture play anyway (D-06).
 */
async armTrack(track: Track) { … }
```

`restore()` should then be left ALONE (zero diff) or, if the planner wants the two provably not to
diverge, `restore()`'s steps 6-14 can be factored into a shared private `seatAndArm(track)` that
both call — but only if the extraction is byte-for-byte behaviour-preserving and the existing
`restore()` tests stay green untouched. **Recommendation: ship the new method first, factor later
if at all.** The shortest safe diff wins here; `restore()` is the boot path.

### 4b. The `audio.src` decision (step 16) — flag for the planner

`restore()` sets `audio.src` DIRECTLY, bypassing `driveSrc` (the single-authority re-drive brake),
with an explicit 31-D-12 comment saying that is deliberate. The new arm method has the same
justification (it is also a one-shot initial arm, not a recovery re-attach), so **mirror the direct
assign and carry the reasoning forward in the comment.** Routing it through `driveSrc` would newly
subject a share arrival to the re-drive brake — a behaviour change in the code path that caused
`nowbar-freeze-reresolve-loop`. Don't.

### 4c. `attach()` + `restore()` under `untrack()` — why, and the rule for new code

`src/routes/+layout.svelte:24-40`: [VERIFIED: source read]

```svelte
$effect(() => {
    if (audioEl) {
        // ROOT CAUSE FIX (debug-song-click-lrc-flood-noplay): attach()/restore() WRITE player
        // $state (queue, current, resolvedCover, loading …). Running them tracked meant this
        // effect READ that state and then MUTATED it → the effect SELF-INVALIDATED and re-ran
        // restore() over and over → repeated audio.src re-set (the (canceled) media flood) +
        // repeated lrc re-fetch + loading pinned true …
        untrack(() => {
            player.attach(audioEl);
            void player.restore();
        });
    }
});
```

Cross-references `restore-effect-self-invalidation-loop` in project memory and `STATE.md`.

**The rule the planner must enforce:** any NEW code that calls a player method which writes `$state`
must either (a) live in `onMount` (not an `$effect`), or (b) be wrapped in `untrack()`. The deep-link
listener in §3d uses `onMount` for exactly this reason. The landing-page mount resolve (§8) also
uses `onMount`, which both pages already do. **Do not un-untrack the existing block, and do not add
a new `$effect` that calls into the player store.**

Note the contrasting precedent right below it: `+layout.svelte:52-58`'s document.title effect is
deliberately NOT untracked, with a comment explaining that it writes a DOM property rather than
`$state` so it cannot self-invalidate. That distinction is the house rule.

---

## 5. The queue-insert seam

### 5a. What `relatedTapPlay` actually is

`src/lib/components/NpRelated.svelte:151-166`: [VERIFIED: source read]

```ts
function relatedTapPlay(track: Track) {
    if (player.current?.uid === track.uid) return;          // D-03's no-op guard
    player.playNext(track, { pin: false });
    if (player.current?.uid !== track.uid) void player.play(track, { fresh: false });
}
```

The second guard is not redundant: `playNext` itself plays the track when `!this.current`
(see below), so without it a cold call would `play()` twice.

### 5b. `playNext(t, { pin: false })` — exact semantics

`player.svelte.ts:2633-2642`:

```ts
playNext(t: Track, opts: { pin?: boolean } = {}) {
    if (opts.pin !== false) this.manualUids.add(t.uid);   // pin:false ⇒ NOT added
    const q = this.queue.filter((x) => x.uid !== t.uid);  // de-dupe FIRST
    const i = q.findIndex((x) => x.uid === this.current?.uid);
    q.splice(i >= 0 ? i + 1 : 0, 0, t);                   // after current, else index 0
    this.queue = q;
    if (!this.current) this.play(t);                      // ⚠️ AUTOPLAYS
    else this.persist();
}
```

- `pin: false` keeps the uid OUT of `manualUids`, so the shared song does NOT survive a later
  `setQueue`/regenerate re-weave (`quick-260618-fiz` Fix 4 re-emits pinned entries). This is exactly
  D-07's stated intent.
- It does NOT touch `upNextAnchorUid`, `removedUids`, `queueContext`, `attachedCover` or `queueGen`.
- The de-dupe-then-splice ordering is why the `current?.uid === track.uid` guard matters: if the
  shared song IS current, `filter` removes it, `findIndex(current)` returns -1, and it lands at index 0.

### 5c. `play(t, { fresh: false })` — exact semantics

`player.svelte.ts:3266` signature:
`play(track, opts?: { fresh?: boolean; fromFallback?: boolean; context?: QueueContext; sameList?: boolean })`

With `fresh: false` (or omitted), `postPlayQueue` (`:3765-3800`) takes the `else` branch: **no**
`removedUids.clear()`, **no** `weaveFreshHistory`, **no** `upNextAnchorUid` re-anchor, **no**
`regenerate()`. Also `:3325` `if (opts?.fresh && !this.attachedCoverFor(track)) this.attachedCover = null;`
is skipped, so the recipient's album-art attachment survives too.

Note `opts.context` is only applied when explicitly passed (`:3285` `if (opts?.context !== undefined)`),
so a non-fresh play leaves `queueContext` alone. Correct for a share arrival.

### 5d. Is there already ONE store method that does both? **No.**

`grep -n "playNext(.*pin: false" src` finds exactly one composition site: `NpRelated.svelte:157`.
Every other caller (`search/+page.svelte`, the track menu, the swipe handlers) uses the PINNING
form. [VERIFIED: repo]

So the phase is about to create a **second** copy of a two-line composition, and D-12 wants a
**third** (the legacy `?play=` decoder at `(app)/+page.svelte:673`). CLAUDE.md explicitly names
per-page boilerplate duplication as the last remaining known debt.

**Recommendation: add ONE thin store method and route all three call sites through it.**

```ts
/**
 * 38-D-02/D-07: splice a track in at the TOP of the queue and play it, WITHOUT destroying the
 * listener's queue shape. Extracted from NpRelated.relatedTapPlay (quick-260910-qjv), which was
 * the only implementation; the share-arrival path (both /song routes) and the legacy ?play=
 * decoder are its second and third callers, and CLAUDE.md flags a third inline copy as debt.
 *
 * Returns false when the track is already current (a no-op re-open, D-03).
 */
spliceAndPlay(t: Track): boolean {
    if (this.current?.uid === t.uid) return false;
    this.playNext(t, { pin: false });
    if (this.current?.uid !== t.uid) void this.play(t, { fresh: false });
    return true;
}
```

Then `relatedTapPlay` becomes `player.spliceAndPlay(track)` — its two long comment blocks move onto
the method (CLAUDE.md: do not delete decision-ref comments, relocate them). This is a net DELETION
at the component and makes the behaviour unit-testable in `player.svelte.test.ts`.

### 5e. 🔴 The cold-arrival trap in `playNext`

`playNext`'s `if (!this.current) this.play(t)` fires a **`fresh: true`-equivalent autoplay** (it calls
`play(t)` with no opts, so `fresh` is falsy — but it DOES call `audio.play()`).

D-02 says "there is ONE queue-insert path for both arrivals". Taken literally, a **truly empty** cold
arrival (first-ever visit, nothing persisted, `current === null`) would hit that branch and
**autoplay — violating D-06.** In practice `restore()` usually seats something first, but:
- A brand-new user has no persisted blob → `restore()` returns at step 2 → `current` stays null.
- `restore()` is async and fire-and-forget; the landing page's `onMount` can win the race.

**The plan must handle this explicitly.** Cleanest: the cold branch calls `armTrack` (§4a) and does
its own queue splice via a `pin:false` insert that never plays, rather than going through
`spliceAndPlay`. That still satisfies D-02's "same shape" (song at the top, recipient's queue kept)
without inheriting the autoplay. Flag it in the plan as an explicit verification step —
"cold arrival with empty localStorage must NOT produce audio".

---

## 6. "Genuinely playing" vs "seated but paused" — the exact field

**Read `player.playing`.** It is `$state(false)` at `player.svelte.ts:193`. [VERIFIED: source read]

Where it is written: [VERIFIED: `grep -n "this.playing = "`]

| Line | Event | Sets |
|------|-------|------|
| 2012 | `el.addEventListener('play')` | `true` |
| 2076 | `el.addEventListener('pause')` | `false` |
| 1997 | `pageshow` (bfcache restore) | `!this.audio.paused` |
| 1599, 2183, 2274, 2424, 2453, 4400, 4641 | stall recovery / offline / stop paths | `false` |

**It is the right discriminator for D-01, but for a subtle reason.** The `play` listener's own
comment (`:2005-2011`) is explicit that `play` fires "the instant `paused` flips false … at
readyState HAVE_NOTHING — before a single byte loads. It is a UI-STATE signal only … NOT proof that
audio started." The field that means *real output* is `hasPlayedSinceSrc`, set only in the `playing`
listener (`:2022`) — **and it is a PRIVATE plain field, deliberately not `$state`.**

D-01 says "a paused/restored song counts as COLD. Only real audio output counts as already playing."
`player.playing` satisfies that because:
- `restore()` never calls `play()` and never calls `audio.play()` → `playing` stays `false`. ✅
- A genuinely playing track has `playing === true`. ✅
- A user-paused track has `playing === false` → COLD → the shared song takes the seat. ✅ (explicitly what D-01 asks for)

**Do NOT reach for `hasPlayedSinceSrc`** — making it public would widen the store's reactive surface
for no behavioural gain, and it stays `true` across a pause (it is reset only in `play()` at `:3311`),
which would misclassify a paused track as warm.

### The one edge case to decide in the plan

`player.loading === true` with `playing === false` means a play is **in flight** (the user tapped, the
~2.7s resolve is running). A share arrival landing in that window reads COLD and would re-seat over
a play the user just asked for.

Recommend the decision function take BOTH and treat `loading` as warm-ish:

```ts
// pure, node-testable
export type ArrivalMode = 'cold' | 'warm';
export function arrivalMode(s: { playing: boolean; loading: boolean }): ArrivalMode {
    return s.playing || s.loading ? 'warm' : 'cold';
}
```

This is a discretionary refinement, not a re-litigation of D-01 — D-01 rules on *paused/restored*,
and "a resolve the user started is in flight" is a state D-01 does not name. Flag it to the user if
the planner prefers not to decide.

---

## 7. The share URL carrier

### 7a. Where the URL is built

`src/lib/services/share.ts:415-427` — `songShareUrl(t, coverUrl?, itunesId?)`:

```ts
const base = shareOrigin();
const path = `${base}/song/${encodePathSegment(t.artist)}/${encodePathSegment(t.title)}`;
const token = coverToken(coverUrl, itunesId);
return usableToken(token) ? `${path}?ci=${encodeURIComponent(token)}` : path;
```

Sole caller: `src/lib/components/TrackMenu.svelte:783`. [VERIFIED: `grep -rn songShareUrl src`]

### 7b. Collision audit for a new `?u=` param — **clean** [VERIFIED: source read]

| Consumer | Reads | Affected by `u`? |
|---|---|---|
| `song/[artist]/[title]/+page.ts` | `url.searchParams.get('ci')` only | ❌ no |
| `ogImageUrl(origin, type, artist, title, cardCoverToken)` (`share.ts:534-543`) | appends `&ci=` only, length-capped | ❌ no |
| `/api/og` | its own `type`/`artist`/`title`/`ci` params | ❌ no |
| `coverToken` / `coverUrlFromToken` round-trip | the `ci` value only | ❌ no |
| `parseEntityParam` | a PATH param, not query | ❌ no |
| `song/[slug]/+page.ts` | `n`, `a`, `c` | ❌ no (different route shape) |

`ci` and `u` are independent; the path segments are untouched so the raw-CJK readability
(`quick-260807-vl1`) survives. Use `&` when `ci` is present, `?` when it is not — or simplest,
build with `URLSearchParams` and append once. **Recommendation: `?u=` (or `&u=`), value =
`track.uid` (the colon form `${source}:${songid}`, from `makeUid`), `encodeURIComponent`'d** — the
colon is a legal query character but encoding it is harmless and keeps the round-trip trivial.

### 7c. Parsing — reuse what exists, don't write a new regex

`parseEntityParam(param)` (`share.ts:504-514`) already validates `{source}{id}` against the closed
source enum and returns `{ source, id, uid }` in the canonical colon form. But its regex expects the
**separator-less** path form (`kuwo123`), not the colon uid.

Two clean options for the planner:
1. Emit the separator-less form in `?u=` and reuse `parseEntityParam` verbatim (zero new validation code).
2. Emit the colon uid and add a small sibling `parseUidParam` that splits on `:` and validates the
   source against the SAME closed enum (`ENTITY_SOURCE_RE`'s alternation).

**Recommendation: option 1.** It is a smaller diff, it reuses a tested validator, and D-09's
"debuggable in a URL bar" is satisfied either way (`?u=kuwo123` is just as readable). If the planner
prefers the colon form for consistency with `Track.uid`, option 2 is fine — but the source-enum
allowlist is mandatory either way. It is the validation gate before the value is used to dispatch
`SOURCES[source].resolve` (the `T-24-03` discipline `parseEntityParam` already documents).

⚠️ **The enum in `share.ts:467` is STALE.** `ENTITY_SOURCE_RE` lists
`netease|qq|kuwo|joox|fivesing|jamendo` — but `src/lib/sources/` also contains `audius.ts` and
`ytmusic.ts`. An `audius:` or `ytmusic:` share link would fail the parse and fall back to the name
resolve (D-10 — degrades correctly, never breaks). Worth a one-line fix in this phase, or an
explicit "known, degrades safely" comment. Do not silently leave it ambiguous.

### 7d. Tests that WILL go red when the carrier lands

These pin the current zero-query-param output. The plan must budget for them: [VERIFIED: source read]

| File:line | Assertion | Why it breaks |
|---|---|---|
| `share.test.ts:314-315` | `songShareUrl({…}).endsWith('/song/Jay-Chou/Dao-Xiang')` | a trailing `?u=` breaks `endsWith` |
| `share.test.ts:768` | `songShareUrl({title:'A',artist:'B'}, cover)).not.toContain('?')` | now contains `?u=` |
| `share.test.ts:784` | same shape | same |
| `names.test.ts:205-207` | `expect(url).toBe('/song/李悅君/夢伴')` + `not.toContain('?')` | exact-match |
| `names.test.ts:245` | `expect(songShareUrl(…)).toBe('/song/Adele/Hello')` | exact-match |

🔴 **And one structural test that pins the CALL SHAPE in a component's source text:**
`names.test.ts:219` asserts `src` does NOT match `/songShareUrl\(\{ title: track\.title/`, and
`share.test.ts:834` asserts it DOES match `/songShareUrl\(\{ title: dTitle, artist: dArtist \}, /`
(anchored on the call head **with its trailing comma, single-line**). If the plan changes
`TrackMenu.svelte:783`'s call signature or reformats it across lines, that regex fails. Either keep
the first two arguments in that exact single-line shape and append the uid as a 4th argument, or
update the regex deliberately — never accidentally.

**Cleanest signature that keeps `share.test.ts:834` green:**
`songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover), track.uid)`.

### 7e. The two landing routes

| | `/song/[slug]` (legacy) | `/song/[artist]/[title]` (current) |
|---|---|---|
| Carriers | `?n=` title, `?a=` artist, `?c=` cover URL | none; identity is the two path segments; optional `?ci=` cover TOKEN |
| Emitted by | **nothing** — no live emitter (`grep` finds no caller) | `songShareUrl` ← `TrackMenu.svelte:783` (the only emitter) |
| OG cover | `buildOg({ cover: c })` → `isHttpsUrl` gate → external CDN URL | `ogImageUrl(url.origin, …)` → own-origin `/api/og` |
| Page cover render | `data.og.image` direct (absolute external) | `apiUrl('/api/og?…')` (relative on web, `VITE_API_BASE` on native) |
| Mount behaviour | identical — `retry` bound, no resolve | identical |
| `resolveAndPlay` | identical: `player.playStub(artist, title, null, 'home-discovery')` | identical |

Both `resolveAndPlay` bodies are character-for-character the same apart from the guard comment.
`playStub` (`player.svelte.ts:3183-3243`) does `resolveStub(artist,title)` → `setQueue([tr], ctx)` →
`play(tr, { fresh: true })` — **it NUKES the queue**, which is precisely what this phase exists to
stop. Both routes need the change; treating only one leaves a live route on the old behaviour.

**Recommendation for the open question:** give BOTH routes the same treatment by extracting the
shared arrival logic into a single lazily-imported module (`$lib/services/share-arrival.ts` or
similar) that each page's `onMount` calls with `{ artist, title, uidParam }`. That collapses the
existing near-duplicate `resolveAndPlay` into one implementation instead of forking it further —
a net deletion, and it dodges having to decide whether `[slug]` is deprecated. Deprecating `[slug]`
is riskier: old links are in the wild (D-11's exact reasoning for keeping the `?play=` decoder), and
the route is 190 lines of already-working SSR/OG surface.

---

## 8. Mount-time resolve without breaking SSR-safety

### 8a. The contract both pages hold

Module-top imports on `/song/[artist]/[title]/+page.svelte` are exactly: `browser`, `onMount`,
`PageOg`, `apiUrl`, `type PageData`. The header comment (`:8-13`) states the rule:

> There is NO top-level store import and NO store METHOD call at module scope — the player store
> (which pulls the whole client graph) is imported LAZILY inside `onMount` under a `browser` guard.
> i18n is likewise lazy-imported client-side (its index imports the settings store).

`export const ssr = true` in the `+page.ts` for both routes. Break the rule and SSR compiles the
whole client graph — and both routes are the crawler landing surface.

### 8b. The pattern to add a mount-time resolve

```ts
onMount(() => {
    // 38-D-13/D-16: resolve FIRES ON MOUNT. SSR-SAFETY (unchanged contract): the arrival module
    // is dynamically imported here, under browser + inside onMount, so SSR never pulls the store
    // graph. onMount — NOT an $effect — because the arrival writes player $state and a tracked
    // effect that reads-then-writes $state self-invalidates (restore-effect-self-invalidation-loop).
    if (!browser) return;
    const ac = new AbortController();
    void (async () => {
        const { arriveShared } = await import('$lib/services/share-arrival');
        await arriveShared({ artist: data.artist, title: data.name, u: uParam }, ac.signal);
    })();
    return () => ac.abort();
});
```

Three things the plan must preserve:
- `await import(...)` inside `onMount`, never a top-level import.
- `onMount`, never `$effect` (§4c).
- An `AbortController` threaded into the resolve, so a fast navigation away supersedes it. The repo
  has `combinedSignal` (`$lib/services/abort-signal.ts`) for merging a caller signal with a timeout —
  use it rather than hand-rolling (CLAUDE.md's shared-primitives table lists it as one of 3 copies
  that were already deduped).

The existing `retry` binding (D-19) stays — it now calls the same `arriveShared` (which is a no-op
re-entry under D-03 if the track is already current) or just `player.toggle()` if already armed.

### 8c. What `ensureTrackDetails` needs to resolve from a uid stub

`ensureTrackDetails(track, signal?, quality?)` (`catalog.ts:347-368`) short-circuits `device:` uids
and `isTrackReady(track)`, then dispatches `SOURCES[track.source].resolve(track, signal, quality)`.
[VERIFIED: source read]

The minimum stub is the shape `stubToTrack` already builds (`share.ts:89-101`):

```ts
{
  uid: 'kuwo:123', source: 'kuwo', songid: '123',
  title, artist,                      // from the decoded path segments
  album: '', cover: null,
  audioUrl: null, lrc: null, lrcUrl: null,
  detailsLoaded: false, quality: null, qualityLabel: null,
  keyword: title, displayIndex: 1
}
```

**Per-source verification of whether `songid` alone is sufficient:** [VERIFIED: adapter source read]

| Source | `resolve()` needs | uid-only stub sufficient? |
|---|---|---|
| **kuwo** (`kuwo.ts:113`) | `track.songid` → ONE `/api/kuwo/detail?id=…` call | ✅ **yes — this is the fast path D-08 is buying** |
| **netease** (`netease.ts:130`) | `track.songid` → builds `/api/netease/url?id=…` | ✅ yes |
| **qq** (`qq.ts:312`) | `qqId \|\| songMid \|\| songid` → one detail call; comment confirms `mid` alone returns everything | ✅ yes |
| **jamendo / audius / fivesing** | id-keyed | ✅ likely (not individually re-read; low share volume) |
| **joox** (`joox.ts:299`) | ⚠️ POSITIONAL `n = track.jooxIndex \|\| track.displayIndex \|\| 1` plus `track.keyword` | ⚠️ **NO — not reliably** |
| **ytmusic** (`ytmusic.ts:245`) | not re-read; `autoResolveEligible: false` flags it off the auto-resolve floor | ⚠️ treat as unverified |

**The joox caveat is real but self-healing.** A uid-only joox stub sends `n=1` with `keyword=title`,
which likely returns the wrong song → the identity check fails → `joox.ts` runs its documented
self-heal (re-search by stable songmid to derive the correct `n`). It will usually recover, at the
cost of the extra call D-08 was trying to avoid. And `joox-swaps-songmid-songid` (project memory)
means cross-field matching is already in play.

**This is exactly what D-10 covers.** Treat "resolve returned no `audioUrl`" as a carrier miss and
fall through to the existing name resolve. The planner should write that as an explicit branch, not
leave it implicit:

```ts
const resolved = await ensureTrackDetails(stub, signal);
if (resolved.audioUrl) { /* fast path */ }
else { /* D-10: silent fall-back to the name resolve (resolveStub / playStub) */ }
```

`ensureTrackDetails` never throws for a missing url — it returns the input track untouched and
deliberately does NOT stamp `resolvedAt` (`catalog.ts:362-366`), so the next caller re-resolves.

### 8d. `apiFetch` routing is automatic

Every source adapter already calls `apiFetch` (`kuwo.ts:129`, `joox.ts`, etc.). So D-15's "route it
through the governor" needs **no new code** — resolving via `ensureTrackDetails`/`resolveStub`
inherits dedupe + `MAX_CONCURRENT_REQUESTS=8` + 25s timeout + the circuit breaker. The plan should
simply NOT add a raw `fetch` anywhere. [VERIFIED: `api-base.ts` + adapter reads]

### 8e. D-14's "no byte prefetch" is satisfied by doing nothing

Setting `audio.src` and stopping is exactly what `restore()` does. Do **not** add `audio.load()`,
`preload="auto"`, or any blob pre-buffer — `api-fetch-flood-freeze` names the f7c2580 blob
pre-buffer as a removed cause. The app-wide `<audio>` at `+layout.svelte:88` carries no `preload`
attribute, so the browser default applies. Leave it.

---

## 9. Testing — what is realistically testable here

Infrastructure: single Vitest `server` project, `environment: 'node'`, **no jsdom**,
`include: ['src/**/*.{test,spec}.{js,ts}']` (`vite.config.ts:10-22`). `*.svelte.test.ts` runs under
the same node project — the SvelteKit Vite plugin transforms runes for node. [VERIFIED: config read]

### Testable in node — put the logic here

| Unit | Where | Test |
|---|---|---|
| uid carrier **emit** — `songShareUrl` appends `?u=`/`&u=` correctly with and without `ci` | `share.ts` (pure, already tested) | extend `share.test.ts` |
| uid carrier **parse** — valid, unknown source, empty, garbage, injection-ish input | `share.ts` (reuse/extend `parseEntityParam`) | `share.test.ts` |
| `uidParam → Track` stub builder | pure `.ts` | new/extended test |
| **`arrivalMode({playing, loading})`** — the cold/warm decision | pure `.ts` | new test — this is the highest-value 5-line test in the phase |
| Deep-link `URL → pathname+search`, host allowlist rejection | pure `.ts` | new test |
| `spliceAndPlay` — queue shape preserved, `manualUids` untouched, no-op when already current | `player.svelte.ts` | **`player.svelte.test.ts`** — the suite already drives the real `play()` with `makeFakeAudio()` and mocked `ensureTrackDetails` (see `:430-440`) |
| `armTrack` — sets `current`/`resolvedCover`/`audio.src`, **never calls `play()`**, leaves `queue`/`upNextAnchorUid`/`repeatMode` untouched | `player.svelte.ts` | `player.svelte.test.ts` — `restore()` is already tested there (`:2091, 2097, 2103`), same harness |
| **D-06 regression: a cold arrival with an EMPTY queue produces NO `audio.play()`** | | the single most valuable new assertion in the phase (§5e) |
| i18n key-set parity for the new toast key across all 15 dicts | `i18n.test.ts` | automatic — the existing parity test fails if any dict is missed |

### NOT testable here — must be E2E / on-device

| Thing | Why | How to verify |
|---|---|---|
| `assetlinks.json` reaches prod | deploy-time | `curl -i https://openmusic.lol/.well-known/assetlinks.json` after deploy (already proven in the build; this is the post-deploy confirm) |
| App Links verification | OS-level | `adb shell pm get-app-links com.openmusic.app` → `verified` (§2d) |
| Link opens the APK | OS-level | `adb shell am start …` (§2d) + a real tap from another app |
| `getLaunchUrl()` cold path | needs a real cold start | emulator: force-stop the app, then `am start` the deep link (`apk-debug-via-emulator-cdp` — CDP into the WebView) |
| `appUrlOpen` warm path | needs the app running | emulator: open the app, background it, `am start` the deep link |
| Actual audio on first tap | autoplay policy + real CDN | device/emulator |
| Cold-resolve latency win | network | device; note `cold-start-budget-measured` says the ~2.7s is upstream qq detail — a kuwo uid carrier should measurably beat it |

### Sandbox limits to respect in any local E2E

`sandbox-no-cn-upstream-network`: netease/qq Meting proxies are BLOCKED here; **kuwo and Deezer
work**. So any local browser E2E of the carrier fast path must use a `kuwo:` uid. Dev server is
4321 (launch.json) or 5173 (bare `pnpm dev`) — probe, don't assume.
`grep-false-empty-trust-read-sed`: cross-check any "clean" grep audit with `sed`/Read.

### Recommended module layout (keeps the pure seam testable)

```
src/lib/services/share.ts            (+) uid carrier emit + parse — PURE, already tested
src/lib/services/share-arrival.ts    (NEW) arrivalMode() + the stub builder + arriveShared()
                                     orchestration; the pure parts exported for node tests
src/lib/services/share-arrival.test.ts (NEW)
src/lib/stores/player.svelte.ts      (+) armTrack() and spliceAndPlay() — thin callers
src/lib/stores/player.svelte.test.ts (+) their suites
```

`share-arrival.ts` must NOT statically import the player store (it is dynamically imported from a
lazily-loaded context anyway) — or if it does, the LANDING PAGES must keep importing IT lazily. The
second is simpler and matches the existing contract.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Parse `{source}{id}` from the carrier | a new regex | `parseEntityParam` (`share.ts:504`) | already validates against the closed source enum, already tested, never throws |
| Build a `Track` from a stub | a new literal | `stubToTrack`'s exact field set (`share.ts:89`) | any missing field silently changes `isTrackReady`/resolve behaviour |
| Cover seed for the armed track | a new chain | `restore()`'s `getPinnedCover ?? track.cover ?? getCachedCoverByUid ?? getCachedCover` (`:586-591`) | the pin-first ordering is `quick-260915-w4f`; `hero-mediacard-cover-resolvedcover-asymmetry` is what happens when a new cover surface skips the shared cache |
| OS media-card metadata | `navigator.mediaSession` directly | `this.syncMetadata()` | same memory: metadata written only in `play()` success branches made restore/resume fall back to the PWA name |
| Queue splice + play | a third inline `playNext`+`play` | ONE store method (§5d) | CLAUDE.md names this exact duplication class as the last known debt |
| Governed `/api/*` fetch | a raw `fetch` | `apiFetch` (automatic via `ensureTrackDetails`) | `api-fetch-flood-freeze` |
| Caller signal + timeout | a hand-rolled `AbortController` pair | `combinedSignal` (`$lib/services/abort-signal.ts`) | already deduped from 3 copies |
| https / "solid cover" test | a new regex | `hasHttpsScheme` (`$lib/services/url-safety.ts`) | 6 copies under 4 names were already merged |
| Toast | a local `toast()` | `toast.show(t('…'))` (`$lib/stores/toast.svelte.ts`) | single global host at `(app)/+layout.svelte` |
| Deep-link cold start | an `$effect` racing the router | `App.getLaunchUrl()` in `onMount` | §3b — `appUrlOpen` structurally cannot fire |

---

## Common Pitfalls

### Pitfall 1: only wiring `appUrlOpen` → cold deep links silently vanish
**What goes wrong:** Tapping a link with the app closed opens the app at the home screen; the song
never loads. Tapping it with the app open works perfectly, so it passes a casual test.
**Root cause:** §3b — `appUrlOpen` is emitted only from `handleOnNewIntent`.
**Avoid:** call `App.getLaunchUrl()` on mount too. **Warning sign:** works warm, dead cold.

### Pitfall 2: `playNext` autoplays on a truly empty cold arrival
**What goes wrong:** D-06 ("no autoplay on cold arrival") is violated for first-time visitors only.
**Root cause:** `player.svelte.ts:2640` `if (!this.current) this.play(t)`.
**Avoid:** §5e. **Warning sign:** works for you (you have persisted state), breaks for a new user or
after clearing site data.

### Pitfall 3: adding a tracked `$effect` that calls the player store
**What goes wrong:** the effect reads player `$state`, the store method writes it, the effect
self-invalidates and loops — repeated `audio.src` re-sets, an lrc re-fetch flood, `loading` pinned true.
**Root cause:** `restore-effect-self-invalidation-loop` (documented at `+layout.svelte:24-33`).
**Avoid:** `onMount`, or `untrack()`. **Warning sign:** "updated at … restore … $effect" console
warnings — project memory says these ARE the loop; do not dismiss them.

### Pitfall 4: routing the armed `audio.src` through `driveSrc`
**What goes wrong:** a share arrival becomes subject to the re-drive brake → a spurious STOP.
**Root cause:** `driveSrc`'s `SRC_REDRIVE_CAP` brake exists for recovery storms, not initial arms;
`restore()` bypasses it deliberately (31-D-12 comment at `:642-644`).
**Avoid:** mirror the direct assign, carry the comment.

### Pitfall 5: the assetlinks fingerprint doesn't match the installed APK
**What goes wrong:** verification silently reports `1024` / `legacy_failure`; links open in a browser.
**Root cause:** the debug fingerprint is machine-local; or the release keystore used differs.
**Avoid:** `adb shell pm get-app-links` prints the `Signatures:` the OS actually sees — diff it
against the JSON. **Warning sign:** `verified` never appears no matter how many re-verifies you run.

### Pitfall 6: shipping the APK before the JSON is live
**What goes wrong:** on Android ≤14 verification runs at install/update; the install sees a 404 and
caches the failure. Users must reinstall after the JSON lands.
**Avoid:** sequence the waves — JSON deployed + `curl`-confirmed, THEN the APK.

### Pitfall 7: the source-text regex tests
**What goes wrong:** `pnpm test` goes red on a reformat, not a behaviour change.
**Root cause:** `names.test.ts:219` and `share.test.ts:834` assert against the raw text of
`TrackMenu.svelte`. **Avoid:** §7d.

### Pitfall 8: a new toast key missing from one of 15 locale dictionaries
**What goes wrong:** `i18n.test.ts` key-set parity fails (this is the good outcome — it is caught).
**Avoid:** add the key to all 15 of `ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant`, with
**DOUBLE QUOTES for both key and value** (no formatter enforces this).

### Pitfall 9: re-opening the same link twice restarts the song
**Root cause:** forgetting D-03's guard. **Avoid:** it lives inside `spliceAndPlay` (§5d) so all
three call sites inherit it. Also covers the `getLaunchUrl()` idempotency hazard (§3d).

### Pitfall 10: stale comments after this phase
`quick-260809-38i`'s comments on BOTH landing pages (`[artist]/[title]:43-44, 78-82` and
`[slug]:38-39, 74-78`) say "it now starts at 'idle' and STAYS there until the user taps play … no
resolve, no playback". **This phase makes those statements false.** CLAUDE.md: a comment that
contradicts the code is worse than none. They must be rewritten to state the new invariant
(*resolve on mount, never PLAY on mount*) while preserving the `quick-260809-38i` decision ref —
the no-autoplay decision still stands (D-06), only the resolve moved.
The folded todo (`song-share-stale-cover-comment`) appears **already fully addressed** on `[slug]`
(the corrected `quick-260723-r4p` comment is at `:18-25` and the `<img>` renders at `:83-92`) —
verify and close it rather than re-doing it.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| `@capacitor/app` (npm) | deep-link listener | ✅ | 8.1.0, already a dep, native plugin already registered | — |
| `adb` | App Links verification | ✅ `/opt/homebrew/bin/adb` | — | — |
| Android emulator AVD | on-device verification | ✅ `Pixel_3a_API_34` (API 34 ≥ 12 → modern verification) | — | physical device |
| JDK 21 | `pnpm apk` | ✅ via `/usr/libexec/java_home -v 21` | default java is 20 → **must export `JAVA_HOME`** | — |
| `keytool` | release fingerprint | ✅ ships with the JDK | — | `keytool -printcert -jarfile <signed apk>` |
| Release keystore | the release fingerprint | ❌ **not on this machine** — GitHub secret only | — | **D-22: human step, user runs `keytool` and pastes** |
| `wrangler` | local Pages serve | ✅ (used this session for the content-type probe) | — | — |
| CN upstreams (netease/qq) | local E2E of the fast path | ❌ blocked in sandbox | — | **use a `kuwo:` uid** — kuwo + Deezer work |
| New npm packages | — | n/a | — | **none required by this phase** |

**Blocking, no fallback:** the release SHA256 fingerprint. This is D-22's human checkpoint and the
plan must gate the assetlinks task on it.

---

## Package Legitimacy Audit

**No external packages are installed by this phase.** Every dependency it touches
(`@capacitor/app@8.1.0`, `@capacitor/core@8.4.0`) is already in `package.json`, already in
`pnpm-lock.yaml`, already registered in `android/capacitor.plugins.json`, and is a first-party
Ionic/Capacitor package. slopcheck was therefore not run (nothing to check). If the planner
introduces a package, the Package Legitimacy Gate must run before it lands.

| Package | Registry | Source Repo | Disposition |
|---|---|---|---|
| `@capacitor/app` | npm | github.com/ionic-team/capacitor-plugins | Pre-existing dependency — no new install |

---

## Validation Architecture

`.planning/config.json` was not read as JSON in this session; `workflow.nyquist_validation` is not
known to be `false`, so this section is included.

### Test framework
| Property | Value |
|---|---|
| Framework | Vitest `^4.1.3`, single `server` project, `environment: 'node'`, no jsdom |
| Config | `vite.config.ts` (`test.projects[0]`), `expect.requireAssertions: true` |
| Include | `src/**/*.{test,spec}.{js,ts}` — `*.svelte.test.ts` runs here too |
| Quick run | `pnpm test -- src/lib/services/share.test.ts` (or the new `share-arrival.test.ts`) |
| Full suite | `pnpm test` (`vitest --run`, ~67 files) |
| Typecheck gate | `pnpm check` (`svelte-kit sync && svelte-check`) — the ONLY lint gate |

### Behaviour → test map
| Behaviour | Type | Command | File |
|---|---|---|---|
| uid carrier emit/parse round-trip | unit | `pnpm test -- share.test.ts` | ✅ exists, extend |
| cold/warm decision (`arrivalMode`) | unit | `pnpm test -- share-arrival.test.ts` | ❌ Wave 0 |
| stub builder from a uid param | unit | same | ❌ Wave 0 |
| deep-link URL → path + host allowlist | unit | same | ❌ Wave 0 |
| `spliceAndPlay` keeps queue shape / no-ops on current | unit | `pnpm test -- player.svelte.test.ts` | ✅ exists, extend |
| `armTrack` never plays; cold+empty produces no audio | unit | same | ✅ exists, extend |
| i18n key parity for the new toast key | unit | `pnpm test -- i18n.test.ts` | ✅ exists, automatic |
| `assetlinks.json` served correctly | manual | `curl -i https://openmusic.lol/.well-known/assetlinks.json` | manual-only |
| App Links verified on device | manual | `adb shell pm get-app-links com.openmusic.app` | manual-only |
| Cold + warm deep-link open | manual | `adb shell am start …` (§2d) | manual-only |

### Sampling rate
- Per task commit: the touched suite (`pnpm test -- <file>`) + `pnpm check`
- Per wave merge: full `pnpm test`
- Phase gate: full suite green + `pnpm check` clean, THEN the on-device checklist

### Wave 0 gaps
- [ ] `src/lib/services/share-arrival.test.ts` — the pure seam (arrivalMode, stub builder, deep-link URL parse)
- [ ] no framework install needed; no new fixtures needed

---

## Security Domain

### Applicable ASVS categories

| Category | Applies | Control |
|---|---|---|
| V2 Authentication | no | no auth in this phase |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| **V5 Input Validation** | **yes** | The `?u=` carrier is attacker-controllable input that is used to dispatch `SOURCES[source].resolve`. It MUST pass a closed-enum source allowlist (`parseEntityParam`'s discipline) before any dispatch. A bare `SOURCES[untrusted]` lookup is the risk. The deep-link URL must likewise be host-checked (`openmusic.lol` only) before `goto()`. |
| V6 Cryptography | no | the SHA256 fingerprint is a published public identity, not a secret |
| V14 Configuration | yes | `JOOX_TOKEN`/`LASTFM_SECRET` stay edge-only; the release keystore stays a GitHub secret. Nothing in this phase moves a secret. |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Malicious `?u=` value used to dispatch an arbitrary source / poison a uid | Tampering | closed-source-enum allowlist before dispatch; `parseEntityParam` returns `null` on no-match and the caller falls through to the name resolve (D-10) |
| Deep-link URL from a hostile app pointing off-host, routed into `goto()` | Spoofing | host allowlist (`openmusic.lol`) in `routeDeepLink`; the manifest already restricts to that host + three prefixes, but do not rely on the OS alone |
| Open redirect via the carrier | Tampering | the carrier never becomes a URL — it becomes `{source, id}` fed to a registry lookup |
| SSRF via the landing loader | — | unchanged: both `+page.ts` loaders perform NO fetch and stay synchronous (`[artist]/[title]/+page.ts:14-20`) — **do not add a fetch to a loader** |
| Domain hijack of App Links | Spoofing | `assetlinks.json` is served from our own https origin with a valid cert; the fingerprint pins the signing identity |
| Secret leak via CI logs | Info disclosure | unchanged — the fingerprint is public; `android-release.yml:79-108` passes keystore secrets via `env:` only, no `set -x` |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `jamendo` / `audius` / `fivesing` resolve from `songid` alone | §8c | LOW — D-10's fall-through to the name resolve absorbs it; only a lost fast path |
| A2 | `ytmusic` uid carriers are effectively out of scope (`autoResolveEligible: false`) | §8c | LOW — degrades to name resolve |
| A3 | Android verification latency on API 34 is minutes, not the Android-15 7-day window | §2d | MEDIUM — only affects how long the human checkpoint waits; `--re-verify` is the override |
| A4 | Capacitor `getLaunchUrl()` still returns the intent URI after the WebView has fully loaded (it reads a field captured at Bridge construction, never cleared) | §3b/3d | LOW — verified by source read; the field is never nulled |
| A5 | `pathPrefix="/song"` has no current sibling-route collision | §2b | LOW — verified against the route tree today; a future `/songs` route would change it |
| A6 | Exact toast wording and its key name | D-20 | none — explicitly Claude's discretion |

**The Environment Availability, assetlinks pipeline, `_routes.json` exclusion, content-type,
Capacitor cold-start behaviour, debug-keystore fingerprint, and every file:line citation in this
document were VERIFIED by running commands or reading source in this session.**

---

## Open Questions

1. **`/song/[slug]` — same treatment or deprecate?**
   - Known: no live emitter; old links are in the wild; the two `resolveAndPlay` bodies are
     character-identical; both routes are 190-line working SSR/OG surfaces.
   - Unclear: whether the user wants the legacy route to keep resolving at all.
   - Recommendation: give both the same treatment via ONE shared arrival module (§7e). Net deletion,
     no deprecation decision needed. Flag to the user only if the planner disagrees.

2. **Does the D-01 cold/warm split treat "a resolve is in flight" (`loading === true`) as warm?**
   - Known: `player.playing` is the correct field for the paused-vs-playing distinction D-01 rules on.
   - Unclear: D-01 does not name the in-flight-resolve state.
   - Recommendation: treat it as warm (§6). This is a refinement, not a re-litigation — surface it to
     the user during planning if they want it explicit.

3. **`ENTITY_SOURCE_RE` is missing `audius` and `ytmusic`** (`share.ts:467`).
   - Known: those adapters exist; the enum is stale; the failure mode is a safe fall-through to the
     name resolve.
   - Recommendation: fix the alternation in this phase (one line) OR add an explicit "known-stale,
     degrades safely" comment. Do not leave it silent.

---

## Sources

### Primary (HIGH confidence — run or read in this session)
- Local builds: `pnpm build` (adapter-cloudflare) and `pnpm build:native` (adapter-static), output inspected
- `npx wrangler pages dev .svelte-kit/cloudflare --port 4173` + `curl -i http://127.0.0.1:4173/.well-known/assetlinks.json`
- `curl -i -L https://openmusic.lol/.well-known/assetlinks.json` (live, 404, no redirect)
- `keytool -list -v -keystore ~/.android/debug.keystore` (real debug SHA256)
- `node_modules/.pnpm/@capacitor+app@8.1.0…/android/src/main/java/com/capacitorjs/plugins/app/AppPlugin.java`
- `node_modules/.pnpm/@capacitor+android@8.4.0…/…/com/getcapacitor/Bridge.java:228, 519, 600-648`
- `node_modules/@capacitor/app/dist/esm/definitions.d.ts:58-71, 142, 180, 241`
- Repo: `player.svelte.ts` (`restore` 553, `playNext` 2633, `setQueue` 2539, `play` 3266, `playStub` 3183,
  `postPlayQueue` 3765, `playing` 193 + writes, `attach` listeners 1985-2090),
  `NpRelated.svelte:151`, `share.ts` (35, 89, 415, 467, 504, 534),
  both `/song/*` routes, `(app)/+page.svelte:673`, `+layout.svelte:24-40`, `api-base.ts`,
  `catalog.ts:227, 347`, `kuwo.ts:113`, `qq.ts:312`, `joox.ts:299`, `netease.ts:130`,
  `AndroidManifest.xml`, `build.gradle`, `capacitor.config.ts`, `vite.config.ts`,
  `android-main.yml`, `android-release.yml`, `share.test.ts`, `names.test.ts`, `player.svelte.test.ts`
- `adb`, emulator AVD list, `find src/routes`

### Secondary (HIGH-MEDIUM — official docs)
- developer.android.com/training/app-links/verify-android-applinks (intent-filter, adb commands, hosting requirements)
- developer.android.com/training/app-links/verify-android-applinks#manual-verification (verify/get/set-app-links)
- developers.google.com/digital-asset-links/v1/getting-started (assetlinks.json shape, `application/json`)

### Tertiary
- Project memory (`MEMORY.md`): sandbox network limits, JDK 21, emulator+CDP, auto-deploy on push,
  `api-fetch-flood-freeze`, `restore-effect-self-invalidation-loop`, `nowbar-freeze-reresolve-loop`,
  `cold-start-budget-measured`, `hero-mediacard-cover-resolvedcover-asymmetry`, `joox-swaps-songmid-songid`,
  `grep-false-empty-trust-read-sed`.

## Metadata

**Confidence breakdown:**
- Static-asset pipeline (§1): **HIGH** — empirically built and served, both adapters
- Capacitor cold/warm seam (§3): **HIGH** — read from the installed plugin + bridge source
- `restore()` / queue semantics (§4, §5): **HIGH** — full source read with line numbers
- Carrier collision audit (§7): **HIGH** — every consumer enumerated and checked
- Per-source uid-stub sufficiency (§8c): **HIGH for kuwo/netease/qq/joox**, MEDIUM for the rest (A1/A2)
- App Links on-device behaviour (§2d): **MEDIUM** — commands are from official docs, not run here
  (needs a deployed `assetlinks.json` + a signed APK)

**No new npm dependency. No new store. Two new thin player methods, one new pure module, three files
for the Android half, one human `keytool` step.**

**Research date:** 2026-09-20
**Valid until:** ~2026-10-20 (30 days — the repo internals are stable; the Android App Links docs
change slowly, but re-check the Android 15+ re-verification window if the phase slips)
