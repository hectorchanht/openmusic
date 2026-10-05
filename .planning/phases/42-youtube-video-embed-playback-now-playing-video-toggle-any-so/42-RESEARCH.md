# Phase 42: YouTube video + embed playback - Research

**Researched:** 2026-10-04
**Domain:** YouTube IFrame Player API embed · mobile background-media rules (WebKit, Chromium, Android WebView) · player-store engine seam
**Confidence:** MEDIUM overall. HIGH on the policy and browser-engine facts (official docs plus WebKit and Chromium source read today). MEDIUM on how the pieces behave together on a real device. That last part needs on-device checks, listed under Validation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(verbatim from 42-CONTEXT.md `<decisions>`)

**VID-01 — Where video shows: toggle in Now Playing**
- A "Video" button on the Now Playing screen swaps the cover art for the YouTube embed, starting at the
  current playback position. The app's `<audio>` pauses while video shows; closing the video resumes
  audio at the position the video reached.

**VID-02 — Which songs: ANY song (search YouTube)**
- YT Music tracks use their own videoId. Any other source searches YT Music by title + artist to find a
  matching video (reuse the existing ytmusic search route / `parseSearchEnvelope` / name-rescue
  machinery; one search per tap, cached). Wrong-match risk must be mitigated (match scoring via the
  existing scoreMatch / sameSongKey primitives; prefer the Videos shelf / official video).

**VID-03 — Web fallback: auto-play via the embed**
- On WEB, a YT Music track whose edge audio proxy still fails after its `loadRetries` budget plays
  through the YouTube embed (from the user's IP) instead of falling to cross-source fallback / skip.

**VID-04 — "Fix the caveat": lock-screen / background audio for embed playback**
- The user explicitly asked to FIX the caveat that embed playback has no lock-screen/background audio
  on mobile web. Research must establish what is actually achievable (iOS Safari + Android Chrome +
  installed PWA), with evidence, and implement the best achievable behaviour. If a full fix is
  impossible, the plan must say so explicitly and implement the best mitigation (e.g. hand back to the
  `<audio>` proxy path when the page is hidden/locked, Media Session metadata from our page, resume on
  return) — never silently ship the caveat.

**VID-05 — APK**
- The APK resolves on-device already (VISIONOS from the phone's IP). Research decides whether video on
  the APK uses the WebView embed (check Referer / error 152/153 on origin https://localhost) or
  device-side HLS from `hlsManifestUrl` in a `<video>` element.

### Claude's Discretion
- Component structure (a child of NowPlaying, not more lines in the ~2000-line NowPlaying.svelte —
  see CLAUDE.md anti-patterns), store shape, i18n keys (all 16 locales, double quotes), loading/error
  states, embedding-disabled handling (errors 101/150 → hide/disable the toggle for that song).

### Deferred Ideas (OUT OF SCOPE)
(from `<domain>`: "Not in scope")
- YouTube account/library sync (legal-gated milestone, spike 008), PoToken generation,
  third-party resolvers (Invidious/Piped/cobalt), proxying video bytes through the Worker.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VID-01 | Video toggle in Now Playing: the embed replaces the cover at the current position, `<audio>` pauses, and closing resumes audio where the video reached | §Pattern 1 (engine seam), §Pattern 3 (NpVideo), the IFrame API facts in Q5, Pitfalls 3/4/9 |
| VID-02 | Any song: YT Music tracks use their own videoId, other sources get a cached search by title + artist with wrong-match mitigation | §Pattern 2 (`pickVideoIds`), Q7 verdict, Pitfalls 6/7 |
| VID-03 | Web: a ytmusic track whose edge proxy fails past `loadRetries` plays through the embed | §Pattern 4 (error-handler hook), Q8 verdict, Pitfalls 1/2/8 |
| VID-04 | Make the background/lock-screen caveat explicit and implement the best achievable behaviour | Q1 verdict (full fix impossible, with evidence), §Pattern 5 (hidden → hand back to `<audio>`), Pitfalls 4/5 |
| VID-05 | APK: WebView embed or device-side HLS | Q6 verdict (one engine: the embed, gated by a Wave-0 emulator probe; HLS is the fallback) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Svelte 5 runes only. Stores are `*.svelte.ts` singleton classes. Internal counters and guards are **plain fields**, not `$state`. Stores never import UI and never localize; they emit `TranslationKey`s.
- **Pure `.ts` vs runes `.svelte.ts` split is load-bearing.** Matching, parsing, scoring and caching go in pure node-testable `.ts`. Stores stay thin callers.
- **Generation-guard idiom** on every async path a newer action can supersede.
- **Never-throw services** return a sentinel (null / [] / 'miss') at the exported boundary.
- **Shared primitives table: import, never re-inline.** Relevant here: `combinedSignal` (abort-signal.ts), `apiFetch` (api-base.ts), `hasHttpsScheme`, `isTrackReady`. Search rows must go through the one parser (`parseSearchEnvelope`, extended, never forked).
- SSR is off app-wide, but every store or service touching `window`/`document`/`localStorage` is `browser`-guarded or feature-detected.
- localStorage keys follow `openmusic:<domain>:v<N>`.
- i18n: every `src/lib/i18n/*.ts` uses **double quotes**, and every locale has an identical key set (`i18n.test.ts` guards parity). **Counted 15 locale files today** (CLAUDE.md says 16, which is stale) [VERIFIED: `ls src/lib/i18n`].
- High comment density with decision refs (`VID-0x`, `quick-…`). Never delete existing decision-ref comments.
- Zero `as any` in production code. Prefer `satisfies` and `as const`.
- **Anti-pattern:** new UI goes in a child component, not into NowPlaying.svelte. `player.svelte.ts` is a god object, so add as little as possible and push logic into pure services. (Real sizes today: player.svelte.ts **5183** lines, NowPlaying.svelte **1538** lines [VERIFIED: wc -l]. The CLAUDE.md figures are stale.)
- `+server.ts` exports only HTTP verbs. Helpers live in `$lib/*`.
- Do not route media bytes through `apiFetch` (spike rule). The embed fetches nothing through our code anyway.
- Memory rules that bind this phase:
  - Foreground return must **never grow a `play()` call** (quick-260703-i7e, enforced in the attach() visibilitychange comment).
  - Untrack `$effect`s that mutate player state (restore-effect self-invalidation loop).
  - Every audio-start path must also write media-session metadata (hero/media-card asymmetry).
  - pnpm needs Node 24.
  - "Downloads never YT Music" was superseded by quick-261004-o9t (out of scope here).

## Summary

The only way to stream YouTube from the user's own IP on web is YouTube's **official IFrame Player API embed**. Its rules decide the whole design. Fetched today, the official docs require:
- a viewport of at least 200×200,
- no app UI overlaid on any part of the player,
- no automatic playback until more than half of the player is visible,
- an HTTP `Referer` identity, or the embed fails with **error 153** [VERIFIED: developers.google.com Required Minimum Functionality, updated 2026-09-14; IFrame API reference, updated 2026-09-29].

The Developer Policies also **forbid playing from a "background player … not displayed in the page, tab, or screen that the user is viewing"** [VERIFIED: developer-policies, updated 2026-09-14].

So VID-04's caveat cannot be "fixed" by keeping the embed playing in the background. It is blocked by policy, and it is blocked technically on every platform:
- **iOS WebKit** interrupts any audible `<video>` on background and on screen lock. Only Picture-in-Picture, AirPlay and CarPlay are exempt [VERIFIED: WebKit `MediaSessionManagerIOS.mm` + `HTMLMediaElement::shouldOverrideBackgroundPlaybackRestriction`].
- **Chromium on Android phones and in Android WebView** pauses a hidden video-with-audio unless that frame's own user-activated play unlocked it [VERIFIED: `web_media_player_impl.cc` `ShouldPausePlaybackWhenHidden`, `render_frame_media_playback_options.cc`].
- **YouTube itself** made background play Premium-only on mobile web in Jan 2026 [CITED: androidauthority.com, 2026-01-29].

The best achievable behaviour, and what the plan must ship and state openly, is this. **Whenever the embed stops being visible** (video toggled off, NowPlaying collapsed, page hidden or locked), read its position, destroy it, and **hand playback back to the app's own `<audio>` at that position**. That path already plays on the lock screen with our own Media Session metadata. On return to foreground we never auto-switch back to the embed.

This works on Android Chrome and the APK. It very likely works on currently shipping iOS Safari, but that needs a device check. WebKit main landed a new rule **on 2026-09-30** (bug 310600) that refuses audible `play()` in a hidden page. The rule's own layout test asserts *"Audio playing in an iframe does not allow the main document to start"*. Once that ships, the iOS hand-off at lock becomes "paused at lock, resume from lock-screen controls". Our Media Session action handlers run with a user gesture, so that resume works.

For VID-03 the same visibility rule means the embed can only auto-play where it is shown. The fallback **expands Now Playing with the video in the cover slot**, plays once per song, and on any embed failure re-enters the existing `runFallback` never-stop chain.

**Primary recommendation:** One engine on every target: the official IFrame API on `www.youtube-nocookie.com`, lazy-loaded inside a new `NpVideo.svelte` child of NowPlaying. Add a pure `services/yt-video.ts` that picks videos from the existing `/api/ytmusic/search` response, with a new `musicVideoType`-aware row view from the one parser. Add a small `stores/video.svelte.ts`. Add a ~80-line "external engine" seam to `player.svelte.ts` (attach / tick / playing / ended / detach / failed) that routes toggle, seek, Media Session and the sleep timer while the embed is active. Gate the APK on a Wave-0 emulator probe for error 153 on `https://localhost`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Video playback (bytes, decode, ads, controls) | Browser, inside YouTube's cross-origin iframe | — | Only YouTube's player may stream from the user's IP on web. We control it only through the IFrame API (postMessage). |
| Video match for non-YT songs | Browser (pure service) | API/edge (existing `/api/ytmusic/search` metadata route, not bot-gated) | The edge only forwards InnerTube search; parse, score and cache stay client-side and node-testable (house rule) |
| Transport authority (play/pause/seek/ended/queue advance) | Browser store (`player.svelte.ts` via the engine seam) | — | Every caller (Nowbar, NowPlaying, keys, Media Session, sleep timer) already routes through the player, so one seam fixes them all |
| Background/lock-screen audio | Browser `<audio>` (existing path) | OS Media Session (web) / jofr plugin (APK) | The embed cannot play hidden (policy + engines), so `<audio>` owns hidden playback |
| VID-03 failure detection | Browser store (audio `error` handler, LOAD RETRY branch) | — | Already the single failure seam |
| APK video | Android WebView (same embed) | Device-side HLS `<video>` via on-device VISIONOS (fallback only) | One engine unless the Wave-0 probe shows 153/152 |
| Referer / identity | Browser default referrer policy | — | The prod page sends no Referrer-Policy, so the default `strict-origin-when-cross-origin` applies, which is YouTube's recommendation |

## Research Question Verdicts (the questions CONTEXT required us to settle)

### Q1 / VID-04: background and lock-screen embed playback. **A full fix is impossible. Ship the hand-back.**

| Platform | Can the embed keep playing hidden/locked? | Evidence |
|----------|-------------------------------------|----------|
| iOS Safari + iOS home-screen PWA (same WebKit) | **No.** `VideoAudio` sessions carry `BackgroundProcessPlaybackRestricted` + `SuspendedUnderLockPlaybackRestricted`, so they are interrupted on background and on lock. The only overrides are external target (AirPlay), CarPlay, and PiP (PiP for background only, not lock). | [VERIFIED: WebKit main `Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm` L89-91; `MediaSessionManagerInterface::applicationDidEnterBackground`; `HTMLMediaElement::shouldOverrideBackgroundPlaybackRestriction`] |
| Android Chrome (phone) | **No by default.** `IsBackgroundMediaSuspendEnabled()` is true on Android phones. A hidden player with video and audio is paused unless `allow_background_video_playback_` is set, which happens only when `Play()` runs with transient user activation **in that frame** or on a system/notification resume. Our tap is in the parent frame and the YT iframe is cross-origin, so it is not unlocked. | [VERIFIED: Chromium main `web_media_player_impl.cc` `ShouldPausePlaybackWhenHidden`/`Play()`/`UnlockBackgroundPlayback`; `render_frame_media_playback_options.cc`; `media_switches.cc` `kResumeBackgroundVideo` ENABLED on Android] |
| Android WebView (APK) | **No.** Background media suspend is always on in WebView ("Exception is for Webview"). | [VERIFIED: `render_frame_media_playback_options.cc` comment + code] |
| YouTube's own player JS | Google states background play is Premium-only and was "updated … to ensure consistency across all platforms" on mobile web (Jan 2026). Brave notes embedded iframes don't play in background even with its override. | [CITED: androidauthority.com/youtube-background-play-broken-3636179 (2026-01-29)] [CITED: sitelint.com Brave article, undated] (MEDIUM/LOW) |
| Policy | **Forbidden regardless:** "must not … create, include, or promote features that play content … from a background player, meaning a player that is not displayed in the page, tab, or screen that the user is viewing". | [VERIFIED: developers.google.com/youtube/terms/developer-policies, updated 2026-09-14] |

**Can our page's Media Session control or represent the iframe's media?**
- **Chromium:** partly. Media Session routing picks *"the top-most frame"* among frames that have a playing or paused player. A page-paused player is **removed** from the session when another player is present ("If there is more than one observer, remove the paused one") [VERIFIED: `media_session_impl.cc` `ComputeFrameForRouting`, `OnPlayerPaused`]. So whether our frame or YouTube's owns the foreground notification depends on ordering. Pausing `<audio>` **before** the embed starts keeps our player suspended in the session as the only one, which makes our frame the routed one. A device check is needed, and it matters little because the hand-back makes `<audio>` own the hidden/lock state anyway. On a PAUSE action Chrome itself also pauses players in non-routed frames [VERIFIED: `DidReceiveAction`].
- **WebKit:** device-only. Media Session action handlers run with a user-gesture indicator (`MediaSession::callActionHandler` → `UserGestureIndicator(IsProcessingUserGesture::Yes)`) [VERIFIED: WebKit `MediaSession.cpp`]. That is what lets a lock-screen ▶ restart our `<audio>`.

**Best achievable (implement this):**
1. **On `visibilitychange: hidden` while the embed is the engine** and the user's intent is "playing", do the hand-back:
   - `t = ytPlayer.getCurrentTime()`, then `ytPlayer.destroy()` (a destroyed embed can't be ghost-resumed by Chromium on return).
   - Call `player.detachExternal(t, { play: true })`. That sets `audio.currentTime = t; audio.play()` for VID-01, or does a non-fresh re-attach of the ytmusic proxy at `t` for VID-03.
   - Write metadata and playbackState through the existing `syncMetadata()`.
2. **On `visible`: do nothing.** Audio keeps playing and video mode stays off. The user can tap Video again. This honours the quick-260703-i7e rule and the embed autoplay rules.
3. What the user gets:

| Platform | Result |
|----------|--------|
| Android Chrome | Seamless audio continuation. Expected to work: our `<audio>` was gesture-unlocked earlier, audio-only players aren't background-paused, and no hidden-start rule exists in Chromium. |
| APK | Same as Android Chrome. Even better: the audio resolves on-device. |
| iOS Safari / PWA, shipping builds | The same hand-back. Expected to work (MEDIUM, device check). |
| iOS with WebKit ≥ 2026-09-30 | `play()` while hidden is refused, because iframe audio does not count as a same-document hand-over [VERIFIED: WebKit commit a09645c2 / bug 310600 and `LayoutTests/media/media-playback-in-background-handover.html`]. The song is paused at lock with our metadata shown, and lock-screen ▶ resumes it (gesture-backed). |

4. **State plainly in the plan and the UI copy what cannot be done:** a YouTube *video* never keeps playing in the background or on the lock screen. The app switches to its own audio stream instead. For a VID-03 song (ytmusic proxy failing) that audio stream may itself fail when hidden. The existing never-stop chain then takes over (cross-source `runFallback`).

### Q2: Referer / origin (errors 152/153)
- **153:** "The request does not include the HTTP Referer header or equivalent API Client identification" [VERIFIED: IFrame API reference, onError, updated 2026-09-29]. RMF: "ensure they are not setting the Referrer-Policy in a way that suppresses the Referer value. YouTube recommends using strict-origin-when-cross-origin". WebViews must supply identity, ideally `https://<app id>` [VERIFIED: required-minimum-functionality "API Client Identity and Credentials"].
- **152-x** ("Video not available") is reported with the same root cause (missing Referer, WKWebView custom scheme) [CITED: github.com/Cap-go/capacitor-youtube-player/issues/49] (LOW-MEDIUM).
- **This app (web):** nothing suppresses Referer, so it's fine.
  - No `Referrer-Policy` header and no CSP on prod [VERIFIED: `curl -sI https://openmusic.lol/`].
  - No `<meta name=referrer>` in `src/app.html` [VERIFIED: read].
  - The only `no-referrer` uses are per-element (`<audio>` via `player.attach()` L2176, `<img>`s, fetches). They do not affect iframes.
  - The widget API itself creates the iframe with `referrerpolicy="strict-origin-when-cross-origin"` and `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"`. It auto-adds `origin=location.protocol//location.host` and `enablejsapi=1`, and adds `widget_referrer=document.referrer` when the page is itself framed [VERIFIED: live `www-widgetapi.js`, player build 8ab5c328, fetched 2026-10-04].
  - **Rule:** never add a global `no-referrer` (meta or `_headers`). Never set `referrerpolicy` on the embed.
- **APK (origin `https://localhost`):** the iframe would send `Referer: https://localhost/`.
  - A plain-http dev `http://localhost:1430` embed works for Tauri. Only custom schemes (`tauri://`, `capacitor://`, `ionic://`) fail with 153 [CITED: github.com/tauri-apps/tauri/issues/14422 (2025-11-05)].
  - So https://localhost **probably works** [ASSUMED]. RMF nonetheless asks WebView apps for an app-ID Referer ("Failure to comply … might result in reduced functionality"), so it is not the policy-blessed identity. Settle it with a Wave-0 emulator probe (see Q6).

### Q3: CSP and the service worker. **No change needed.**
- No CSP anywhere:
  - no `kit.csp` in `svelte.config.js`, no `static/_headers` (no such file), no meta in `app.html`;
  - `hooks.server.ts` only adds CORS on `/api/*`;
  - the prod response has no CSP / Permissions-Policy / X-Frame-Options [VERIFIED: read files + curl].
  - The only CSP is `frame-ancestors` on the `/turnstile-bridge` route response [VERIFIED: `src/lib/proxy/turnstile-bridge-page.ts`].
- If a CSP is ever added, it needs:
  - `script-src https://www.youtube.com` (the loader `iframe_api` plus `www.youtube.com/s/player/<build>/www-widgetapi.vflset/www-widgetapi.js`; `s.ytimg.com` is no longer used by the loader [VERIFIED: fetched loader]);
  - `frame-src https://www.youtube-nocookie.com https://www.youtube.com`.
- Service worker: `shouldBypass()` returns true for **any cross-origin URL** [VERIFIED: `src/lib/services/sw-cache.ts`]. The script, iframe and googlevideo requests are never intercepted or cached. The iframe document is cross-origin, so it is outside our SW's control anyway.

### Q4: embedding-disabled videos (101/150)
- 101/150 = "owner … does not allow it to be played in embedded players". 100 = removed or private [VERIFIED: IFrame API onError].
- **No published frequency data** for official music videos [VERIFIED: search found none]. Treat it as common enough to need handling. Label MVs on some regional catalogues do disable embedding [ASSUMED].
- **Detection:** `onError` fires after load. No pre-check (the InnerTube `player` call that exposes `playableInEmbed` is the bot-gated endpoint, so don't).
- **UX:** keep up to 3 ranked candidates from the single search.
  - On 101/150/100: `loadVideoById({ videoId: next, startSeconds: t })`.
  - When the list is exhausted, close the video, resume audio, show a toast ("This video can't be played here"), and write a **miss** to the cache so the toggle is disabled for that song for the miss TTL.
  - For VID-03 (fallback mode), exhaustion calls `player.extFailed()` → `runFallback(current)`. The never-stop chain stays intact.

### Q5: position sync, autoplay, lazy load
- `start` playerVar: "positive integer … the player will look for the closest keyframe … usually no more than around two seconds" earlier. The `startSeconds` and `seekTo` behaviour is the same [VERIFIED: player_parameters + reference]. Expected hand-off accuracy is about 0.25–2 s. Fine for music.
- `getCurrentTime()` is synchronous, but it is fed by the iframe's periodic `infoDelivery` messages, so it can lag a few hundred ms [ASSUMED]. Poll at 4 Hz while playing.
- `getDuration()` returns 0 until metadata loads [VERIFIED: reference].
- **Autoplay with sound:**

| Environment | Embed auto-plays with sound? | Why |
|-------------|------------------------------|-----|
| Chrome desktop and Android | **Yes** | Our page has sticky activation and the widget iframe carries `allow="autoplay"` [VERIFIED: developer.chrome.com/blog/autoplay; widgetapi allow attribute]. Covers both the VID-01 tap and the VID-03 gesture-less fallback. |
| APK WebView | **Yes** | Capacitor sets `setMediaPlaybackRequiresUserGesture(false)` [VERIFIED: `node_modules/@capacitor/android/.../Bridge.java:586`]. |
| iOS Safari | **No** | Our tap's activation does not reach the cross-origin iframe. WebKit's media gesture reasons are per-document: active token, the iframe window's own transient activation, media-finished grace, or Safari settings/quirks [VERIFIED: WebKit `Document::mediaUserGestureReason`]. YT's scripted unmuted `play()` is refused, so `onAutoplayBlocked` fires and YouTube's own big ▶ shows. **The user taps inside the player.** Muted-start-then-`unMute()` does not help: WebKit's `updateShouldPlay()` pauses a playing element whose audible playback isn't permitted [VERIFIED: WebKit `HTMLMediaElement::setMutedInternal`/`updateShouldPlay`]. |

  So on iOS do **not** auto-mute. Show a hint *below* the player (never over it: overlay ban) and let YouTube's play button take the tap.
- **Lazy load:**
  - Inject `https://www.youtube.com/iframe_api` (~1 KB loader → ~27 KB widget script [VERIFIED: fetched sizes]) only when the first video opens.
  - `NpVideo.svelte` is a dynamic import inside NowPlaying, so phase 41's first-paint graph is untouched.
  - The player stays lean: it imports nothing new except a type.

### Q6 / VID-05: APK. **Same embed (one engine), gated by a Wave-0 emulator probe. HLS `<video>` is the documented fallback.**
- Embed on APK pros: zero native code, one engine, sanctioned API, autoplay allowed (Capacitor flag).
- Embed on APK risk: Referer identity "localhost" (Q2).
- HLS cons:
  - a second engine with its own tests;
  - YouTube-ToS-wise the same extraction class as the existing on-device audio;
  - depends on the rotting VISIONOS pin;
  - Android WebView HLS support is plausible but unproven for YouTube's manifest. Chrome Android has played HLS natively for years, desktop Chrome got a built-in demuxer in 142, and WebView shares the pipeline [CITED: tech-ish.com 2025-12-08; testmuai.com 2026-04-30] (MEDIUM/LOW).
  - Variant layout (muxed vs separate audio group) is unknown → device check.
- **Decision rule for the plan:** Wave-0 task on the existing `Pixel_3a_API_34` AVD + CDP (memory: apk-debug-via-emulator-cdp). Load a known-embeddable videoId through the real IFrame API code path in the debug APK, then read `onError` / the rendered player.
  - **Plays → ship the embed on APK** (no HLS).
  - **153/152 → implement the HLS fallback:**
    - `selectHlsManifest(json)` in `proxy/ytmusic-innertube.ts`;
    - `nativeResolveHlsUrl(videoId, signal)` in `services/ytmusic-native.ts`, reusing `callPlayer`/`getVisitorData`;
    - an `HlsEngine` (own `<video playsinline>`) behind the same player seam.
  - Do **not** build the openmusic.lol bridge page (the Turnstile precedent) unless HLS also fails. It is the most code (a full postMessage relay).
- APK background: WebView suspends hidden video for both engines, so VID-04's hand-back is the APK behaviour too. It is reliable there because audio resolves on-device.

### Q7 / VID-02: matching
- **Reuse the route as-is:** `GET /api/ytmusic/search?q=<artist title>&hl=en`.
  - It already returns `{ ytmusicMerged: [songsJson, videosJson] }`, edge-cached 10 min per full URL [VERIFIED: `src/routes/api/ytmusic/search/+server.ts`].
  - Use the **exact URL name-rescue uses** (`` `${artist} ${title}` `` + `&hl=en`) so the edge cache and `apiFetch` GET dedupe are shared.
  - Cost per cold tap: 1 client GET → 2 InnerTube POSTs at the edge (metadata, not bot-gated). Warm cost: 0 (localStorage).
- **Classify rows by `musicVideoType`, not by shelf.**
  - Every row carries it at `overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType` [VERIFIED: present on all 8 rows of `src/lib/sources/__fixtures__/ytmusic-search.json`].
  - Values: `MUSIC_VIDEO_TYPE_OMV | _UGC | _ATV | _OFFICIAL_SOURCE_MUSIC` [VERIFIED: ytmusicapi `models/content/enums.py`, `navigation.py` NAVIGATION_VIDEO_TYPE].
  - The Songs shelf yields **ATV** ("art track", a static cover image). Videos yields OMV/UGC.
  - Shelf titles are localized ("Songs" / "影片"), and the merged parse dedupes across shelves, so the type is the locale-proof signal.
  - **Prefer OMV > OFFICIAL_SOURCE_MUSIC > UGC. Exclude ATV** for non-YT songs, since a static art track is not "the video".
- **Don't use `norm()` / `matchKey()` for the title evidence.** They strip `【…】`, and CN MV titles put the song name exactly there ("周杰倫 Jay Chou【告白氣球 Love Confession】Official MV" → norm drops the title) [VERIFIED: `match-key.ts` regex].
  - Use a fold that keeps bracket contents: `foldScript(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')`. `foldScript` is exported from `dedupe.ts`, and the same fold shape as `versionedMatchKey`.
  - Accept a row iff all of these hold:
    - (a) fold(query title) ⊂ fold(row.title);
    - (b) some `splitArtists(query.artist)` fold ⊂ fold(row.title + row.artist), or `sameSongStrings(...)` is true;
    - (c) no `VARIANT_KEYWORDS` term (exported from `score-match.ts`) appears in the row title unless it is in the query;
    - (d) a valid videoId (`/^[A-Za-z0-9_-]{11}$/`).
  - Rank by type, then `scoreMatch(query, rowTrack)`, then duration proximity, then shelf order. Return the top 3.
- **Cache:**
  - `openmusic:yt-video:v1`, keyed by `matchKey(artist, title)` (so the same song across sources shares an entry).
  - Value: `{ ids: string[], at }` or `{ miss: true, at }`. Hit TTL 30 d, miss 1 d, cap 500, oldest-first eviction.
  - Mirror `name-rescue.ts` exactly; it is the house template. Validate every id on read (the store is user-writable).
- **YT Music tracks:** `[track.songid]` (locked). Caveat: a Songs-shelf ytmusic track is usually ATV, so "Video" shows the album art (see Open Question 1).

### Q8: player-store integration (the seam)
- See Pattern 1. Net additions to `player.svelte.ts` are about 80 lines:
  - an `ext` plain field;
  - `embedFallbackUid` (`$state`) and `embedTriedUid` (plain);
  - `attachExternal` / `extTick` / `extPlaying` / `extEnded` / `detachExternal` / `extFailed`;
  - routing guards in `toggle()`, `seekFraction()`, the 6 Media Session handlers and `expireSleepTimer()`;
  - the VID-03 hook after the LOAD RETRY branch (L2707-2726);
  - `if (this.ext) this.dropExternal()` at `play()` entry.
- Plus two **move-only** refactors so the embed shares, not copies, the policy:
  - the `playing` listener body (L2268-2323) → `private onRealOutput()`;
  - the `ended` listener body (L2431-2474) → `private onTrackEnded()`.

## Standard Stack

### Core
| Library / API | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| YouTube IFrame Player API (runtime script, not npm) | loader `https://www.youtube.com/iframe_api` → widget build `8ab5c328` observed 2026-10-04 [VERIFIED: fetched] | Embed + control YouTube playback from the user's IP | The only sanctioned way to play YouTube in a web page. Error/event contract documented (ref updated 2026-09-29). |
| Existing `/api/ytmusic/search` route | in repo | Video candidates (Songs + Videos shelves) | Already merged and edge-cached. Metadata endpoints aren't bot-gated (spike 005/006). |
| Existing `parseSearchEnvelope` (to be split into `parseSearchRows` + map) | in repo | One InnerTube row parser | CLAUDE.md: never fork the parser |
| `score-match.ts` (`scoreMatch`, `VARIANT_KEYWORDS`), `dedupe.ts` (`foldScript`, `sameSongStrings`), `match-key.ts` (`matchKey`), `util/artist-split.ts` (`splitArtists`), `api-base.ts` (`apiFetch`), `abort-signal.ts` (`combinedSignal`) | in repo | Match scoring, folding, cache key, governed fetch | Shared-primitives table |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@capacitor/core` `Capacitor.isNativePlatform()` | 8.4.0 (installed) | Web-only gating of VID-03 | Already imported by player and ytmusic.ts |
| `ytmusic-native.ts` (`callPlayer`, `getVisitorData`) | in repo | APK HLS fallback only (if the Wave-0 probe fails) | Only on a 153/152 probe result |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| IFrame API (`new YT.Player`) | Raw `postMessage` `{event:'command',func:'playVideo'}` protocol | Undocumented internals. The API is ~28 KB, lazy, and documented. Use the API. |
| Local minimal `YT` typings | `@types/youtube` (DefinitelyTyped) | A new devDependency for ~20 lines of types. Write local types (ponytail). |
| `www.youtube-nocookie.com` host | `www.youtube.com` | Nocookie = privacy-enhanced (fits the app's no-cookie analytics posture). Same API (`host` option read by widgetapi [VERIFIED: source]). Switch the constant if a regression appears [ASSUMED parity]. |
| Embed on APK | HLS `<video>` from on-device `hlsManifestUrl` | Only if the Wave-0 probe shows 153/152 (Q6) |
| Embed on APK | openmusic.lol bridge page (Turnstile pattern) | Last resort: most code, a double-iframe relay |
| `segmentMap` from InnerTube `next` (YTM's Song↔Video time mapping) | — | Requires a new edge route. Out of the lazy path. Duration-gated sync instead (Pitfall 7). |

**Installation:** none. No npm packages are added.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | No packages installed by this phase |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
The YouTube IFrame API is a runtime third-party script from `www.youtube.com` (Google), not a registry package. Trust boundary is covered in Security Domain.

## Architecture Patterns

### System Architecture Diagram

```
 [tap "Video" in NowPlaying]                     [<audio> error, web, ytmusic, foreground,
            │                                       loadRetries spent, first time for this uid]
            ▼                                                     │
   video.open(track)                                              ▼
     ├─ ytmusic → ids=[songid]                     player: embedTriedUid=uid; disarmStall();
     └─ findVideoIds(track)  (pure, never-throw)           embedFallbackUid=uid; expanded=true
          ├─ localStorage hit/miss ──────────┐                     │
          └─ apiFetch /api/ytmusic/search    │                     ▼
               → parseSearchRows             │        NowPlaying mounts → video.startFallback(uid)
               → pickVideoIds (top 3)        │                     │
            │ none → toast, audio untouched  │                     │
            ▼                                ▼                     ▼
   player.attachExternal(engine)  ── pauses <audio> (deliberate) · routes toggle/seek/MS/sleep to engine
            │
            ▼
   NpVideo.svelte (lazy) → loadYtIframeApi() → new YT.Player(host=nocookie, videoId, start=⌊t⌋,
            │                                      playsinline=1, autoplay=1, rel=0)
            │  events + 4 Hz getCurrentTime poll
            ├─ PLAYING ─────────► player.extPlaying()   (= onRealOutput: failure counters reset)
            ├─ tick ────────────► player.extTick(t,dur,playing) (position state, sleep backstop, persist)
            ├─ ENDED ───────────► player.extEnded()     (= onTrackEnded: sleep-stop / repeat-one / next)
            ├─ 101/150/100 ─────► next candidate (loadVideoById) ─ exhausted ─► VID-01: close+toast+miss
            │                                                                    VID-03: player.extFailed()
            │                                                                             → runFallback
            ├─ 2/5/153 ─────────► close (+ log; 153 = identity problem)          (never-stop chain)
            └─ autoplayBlocked ─► hint under player; user taps YouTube's ▶ (iOS)
   CLOSE triggers ── toggle off · NowPlaying collapse (unmount) · visibilitychange:hidden (VID-04)
            │        · track change (play() entry drops ext, NO resume)
            ▼
   t = getCurrentTime(); destroy(); player.detachExternal(t, {play})
            ├─ VID-01: audio.currentTime = t → audio.play()          (lock-screen-capable path)
            └─ VID-03: play(current,{fresh:false}) at t → proxy retry → error → runFallback
```

### Recommended Project Structure
```
src/lib/
├── services/yt-video.ts            # PURE: isVideoId, pickVideoIds, cache (openmusic:yt-video:v1), findVideoIds (never-throw)
├── services/yt-video.test.ts
├── services/yt-iframe-api.ts       # browser-only lazy loader for https://www.youtube.com/iframe_api + minimal local YT types
├── sources/ytmusic.ts              # + export parseSearchRows(json, kw) → {track, videoType}[]; parseSearchEnvelope maps it
├── sources/__fixtures__/ytmusic-search-merged.json   # NEW Wave-0 fixture: real {ytmusicMerged:[songs,videos]} incl. a CJK MV
├── stores/video.svelte.ts          # small runes store: mode 'off'|'video'|'fallback', status, ids, idx, uid
├── stores/player.svelte.ts         # + ~80-line engine seam (Pattern 1) + VID-03 hook (Pattern 4)
└── components/NpVideo.svelte       # child of NowPlaying, dynamically imported; owns the YT.Player lifecycle + hidden hand-back
```

### Pattern 1: the external-engine seam in the player (minimal, identity-guarded)
**What:** while the embed is active, the player keeps being the single transport authority, but delegates to an engine object. Callbacks check `this.ext === engine`, so a stale embed's late events are ignored (the generation-guard idiom, by identity).
**When:** VID-01 and VID-03. Dropped at `play()` entry (track change) and on detach.
```ts
// player.svelte.ts — Phase 42 (VID-01/03/04). Sketch; names are recommendations.
type ExtEngine = { play(): void; pause(): void; seek(t: number): void };
/** VID-03 signal read by the (app) layout / NowPlaying: this uid plays through the embed. */
embedFallbackUid = $state<string | null>(null);
private ext: ExtEngine | null = null;        // plain: not UI state
private embedTriedUid: string | null = null;  // plain: VID-03 fires once per uid (Pitfall 2)

attachExternal(e: ExtEngine) {
	this.pauseAudio();          // deliberate → `pause` listener won't treat it as external
	this.disarmStall();         // else STALL_TIMEOUT_MS later recoverLoadStall → runFallback
	this.ext = e;
	logAction('ext.attach', { uid: this.current?.uid });
}
extTick(e: ExtEngine, t: number, dur: number, playing: boolean) {
	if (this.ext !== e) return;
	if (sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)) return this.expireSleepTimer();
	this.currentTime = t; if (dur > 0) this.duration = dur;
	if (this.playing !== playing) { this.playing = playing; this.syncPlaybackState(); }
	const st = safePositionState(dur, t); if (st) this.ms?.setPositionState(st);
	this.persistThrottled();
}
extPlaying(e: ExtEngine) { if (this.ext === e) this.onRealOutput(); }   // moved body of the `playing` listener
extEnded(e: ExtEngine)   { if (this.ext === e) this.onTrackEnded(); }   // moved body of the `ended` listener
extFailed(e: ExtEngine)  { if (this.ext !== e || !this.current) return; this.ext = null; void this.runFallback(this.current); }
detachExternal(e: ExtEngine, t: number | null, opts: { play: boolean }) { /* ext=null; seat <audio> at t; play if opts.play */ }
// toggle():       if (this.ext) { this.playing ? this.ext.pause() : this.ext.play(); return; }
// seekFraction(): if (this.ext) { this.ext.seek(clamped * this.duration); return; }
// MS 'play'/'pause'/'seek*': route to ext first (they currently hit this.audio directly — L2757-2781)
// expireSleepTimer(): if (this.ext) { this.ext.pause(); sleepTimer.cancel(); return; }  // audio.paused is TRUE in ext mode (Pitfall 3)
// onTrackEnded() repeat-one: if (this.ext) { this.ext.seek(0); this.ext.play(); return; }
```

### Pattern 2: pure video pick (VID-02), the house never-throw + cache template
```ts
// services/yt-video.ts — PURE core (node-testable), orchestrator at the bottom like name-rescue.ts
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export type YtVideoType = 'OMV' | 'OFFICIAL_SOURCE_MUSIC' | 'UGC' | 'ATV' | null;
const RANK: Record<string, number> = { OMV: 3, OFFICIAL_SOURCE_MUSIC: 2, UGC: 1 };   // ATV excluded
// Keeps 【…】 contents (norm() drops them — CN MV titles put the song name there).
const fold = (s: string) => foldScript(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function pickVideoIds(rows: Array<{ track: Track; videoType: YtVideoType }>,
	q: { artist: string; title: string; duration?: number }, max = 3): string[] {
	const qt = fold(q.title);
	if (!qt) return [];
	const qArtists = splitArtists(q.artist).map(fold).filter(Boolean);
	const variantsAsked = VARIANT_KEYWORDS.filter((k) => q.title.toLowerCase().includes(k));
	return rows
		.filter(({ track: r, videoType: v }) =>
			!!v && v in RANK && VIDEO_ID.test(r.songid) &&
			fold(r.title).includes(qt) &&
			(qArtists.some((a) => fold(r.title + r.artist).includes(a)) || sameSongStrings(q.artist, q.title, r.artist, r.title)) &&
			!VARIANT_KEYWORDS.some((k) => !variantsAsked.includes(k) && r.title.toLowerCase().includes(k)))
		.map((x, i) => ({ id: x.track.songid, i, s: RANK[x.videoType!] * 100 + scoreMatch(q, x.track)
			- (q.duration && x.track.duration ? Math.min(30, Math.abs(q.duration - x.track.duration)) / 10 : 0) }))
		.sort((a, b) => b.s - a.s || a.i - b.i)
		.slice(0, max)
		.map((x) => x.id);
}
// ponytail: containment-based evidence, no fuzzy distance — upgrade if a real false match shows up.
```
(Replace the `x.videoType!` non-null with a narrowed local in the real code. House style is zero casts.)

### Pattern 3: NpVideo lifecycle (lazy, visible, no overlays)
- Render as a **sibling layer positioned over `.cover`'s box**, NOT inside `.cover-strip` / `.cover`:
  - `.cover` carries a `scale()` transform plus tap and swipe handlers (NowPlaying L957-1018).
  - The iframe swallows pointer events, so the swipe-down-to-collapse gesture won't start on the video. That's acceptable.
- Size: fill the square cover box (≥ 200×200 on every phone). YouTube letterboxes 16:9 inside. A 16:9 iframe at 340 px wide would be only 191 px tall, which **violates the 200 px minimum**.
- Nothing of ours may overlap the iframe (RMF overlay ban). The close affordance is the Video toggle itself, placed in the transport row.
- `playerVars`: `{ playsinline: 1, autoplay: 1, start: Math.floor(t), rel: 0, iv_load_policy: 3 }`. Keep YouTube's controls (iOS needs its ▶).
- On mount: `attachExternal`. Poll `getCurrentTime()` every 250 ms while state ∈ {1, 3}.
- Install a **plain** `document.addEventListener('visibilitychange', …)` (not an `$effect`; restore-loop lesson) for VID-04. Remove it on destroy.
- On destroy (collapse, toggle off, track change): read the time, `destroy()`, then `detachExternal`.

### Pattern 4: VID-03 hook (after LOAD RETRY, before `runFallback`)
```ts
// player.svelte.ts error listener, immediately after the LOAD RETRY `if` (~L2726), before `this.playing = false`.
// Phase 42 VID-03: web ytmusic, edge stream still gated after its loadRetries budget → YouTube's own
// embed (user's IP). FOREGROUND ONLY: the embed must be visible (YouTube API policy forbids background
// players; RMF: no autoplay until >50% visible) — a hidden failure keeps today's runFallback.
// Once per uid, so a later proxy retry (collapse / hidden hand-back) cannot re-open it in a loop.
if (
	!this.hasPlayedSinceSrc && this.current?.source === 'ytmusic' &&
	!Capacitor.isNativePlatform() &&
	!(typeof document !== 'undefined' && document.hidden) &&
	this.embedTriedUid !== this.current.uid
) {
	this.embedTriedUid = this.current.uid;
	this.disarmStall();
	logAction('embed.fallback', { uid: this.current.uid });
	this.embedFallbackUid = this.current.uid;
	this.expanded = true;          // NowPlaying mounts; NpVideo plays in the cover slot
	return;
}
```
Reset `embedTriedUid` only in `play()` when the uid changes. NowPlaying (or the `(app)` layout effect, `untrack`ed) reads `player.embedFallbackUid` and opens `video.startFallback()`.

### Pattern 5: VID-04 hidden hand-back (inside NpVideo)
```ts
// Plain listener — NOT an $effect (restore-effect-self-invalidation lesson). Decide on INTENT, not the
// instantaneous embed state: on iOS WebKit may have already interrupted the video (PAUSED) before
// this handler runs, and Chromium pauses it on hide too (Pitfall 4).
const onVis = () => {
	if (!document.hidden || !session || session.intent !== 'play') return;
	const t = yt.getCurrentTime();
	yt.destroy();                         // a destroyed embed cannot be auto-resumed by Chromium on return
	player.detachExternal(engine, t, { play: true });   // <audio> takes over; may be refused on new WebKit (catch → paused, metadata shown)
	video.close('hidden');                // never auto-reopen on return (quick-260703-i7e)
};
```

### Anti-Patterns to Avoid
- **Hiding the embed behind the cover / `display:none` / 1×1 to "play audio only"** violates the Developer Policies (background player; "separate, isolate … audio or video components") [VERIFIED: developer-policies]. VID-03 therefore *shows the video*.
- **Any app element over the iframe** (gradient, our own ▶, captions). That is the RMF overlay ban.
- **Muting to dodge iOS autoplay then `unMute()` by script.** WebKit pauses it (Q5).
- **Auto-switching back to the embed on `visible`.** It breaks quick-260703-i7e and iOS autoplay.
- **Putting the iframe inside `{#key}`/`.cover-strip`, or keying it on cover changes.** Every remount restarts the video.
- **`$effect`-driven hand-off or attach.** Tracked player writes self-invalidate (memory: restore-effect loop). Use plain listeners and explicit calls, and `untrack` any layout effect that opens fallback.
- **Adding `referrerpolicy="no-referrer"` anywhere global** breaks every embed with 153.
- **Forking the row parser** for `musicVideoType`. Extend the one parser (`parseSearchRows`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Talking to the YouTube iframe | Custom postMessage protocol | Official IFrame API (`YT.Player`) | Origin checks, `origin`/`enablejsapi`/`widget_referrer` and the allow-list are handled [VERIFIED: widgetapi source] |
| Search row parsing | A second InnerTube walker | `parseSearchRows` (split from `parseSearchEnvelope`) | One parser (shared-primitives rule) |
| Script folding / identity | New normalizer | `foldScript`, `sameSongStrings`, `matchKey`, `splitArtists`, `VARIANT_KEYWORDS`, `scoreMatch` | Ranking and identity must agree on script (dedupe.ts comment) |
| Bounded TTL cache | New cache shape | Copy the `name-rescue.ts` cache block (key, TTLs, cap, validation) | House template, already reviewed for hostile values |
| Governed GET + timeout | Raw fetch | `apiFetch` + `combinedSignal(6000)` | Concurrency cap, dedupe, circuit breaker (api fetch-flood lesson) |
| Track-end policy for the embed | Re-implemented sleep/repeat/next | Move the `ended` body into `onTrackEnded()` and call it from both | `decideEndedAction` precedence stays single-sourced |
| Failure-counter reset on real output | Copy of the `playing` resets | Move them into `onRealOutput()` | 20+ counters; a copy would drift (track-ready lesson) |
| HLS playback (APK fallback only) | hls.js / MSE | Native `<video src=hlsManifestUrl>` | Chromium/Android plays HLS natively. No new dep. |

**Key insight:** every hard part here (identity, autoplay, background, PiP) is decided by YouTube or the browser engine. Our code only has to be one honest seam plus a hand-back.

## Common Pitfalls

### Pitfall 1: Existing test asserts the old VID-03 path
**What goes wrong:** `player.svelte.test.ts` ~L6359 ("a ytmusic load error re-attaches up to 2 times, then fails over") expects `runFallback` after 3 errors. In node, `document` is undefined (= foreground) and `Capacitor.isNativePlatform()` is false (= web), so the new hook fires instead.
**Avoid:** update that test to expect `embedFallbackUid` set and `runFallback` not called. Add a test for `extFailed → runFallback` and one for the hidden case (stub `document.hidden = true` → still `runFallback`).

### Pitfall 2: VID-03 re-open loop
**What goes wrong:** collapse or hide → hand-back retries the proxy → it fails again → the hook re-expands NowPlaying, and so on forever.
**Avoid:** `embedTriedUid` once-per-uid, reset only when `play()` gets a different uid. The `errorBurst`/FAILURE_CAP ceilings still backstop it.

### Pitfall 3: Sleep timer silently cancels instead of stopping the video
**What goes wrong:** `expireSleepTimer()` treats `audio.paused` as "user already paused → silent clear" (L2083-2086). In ext mode the audio is always paused.
**Avoid:** route to `ext.pause()` first. The `timeupdate` backstop doesn't fire in ext mode, so `extTick` must run the `isExpired` check (and the wake-timer path calls `expireSleepTimer` already).

### Pitfall 4: Deciding the hand-back on the instantaneous embed state
**What goes wrong:** at `visibilitychange:hidden`, WebKit (and Chromium on Android) may already have paused the iframe's video, so `getPlayerState()===2` says "user paused" and no hand-back happens.
**Avoid:** keep `session.intent`. Set it to 'play' on PLAYING and to 'pause' only on a pause issued through *our* controls or a PAUSED while `!document.hidden`. Ignore PAUSED events that arrive while hidden.
**Warning sign:** the lock screen shows nothing or the wrong song after locking during video.

### Pitfall 5: Double audio on Android return
**What goes wrong:** Chromium pauses a hidden video for visibility and **auto-resumes it on foreground** (visibility pause reason). If we only `pauseVideo()` and keep the iframe, the user returns to embed + `<audio>` both playing.
**Avoid:** `destroy()` the player in the hidden hand-back [VERIFIED: Chromium `visibility_pause_reason_` / `kResumeBackgroundVideo`].

### Pitfall 6: `norm()`/`matchKey()` erase the MV title
**What goes wrong:** `norm` drops `【…】`/`(...)` groups, and CN official MVs put the song name in `【】`.
**Avoid:** use the bracket-keeping fold for evidence. Use `matchKey` only as the cache key.

### Pitfall 7: Official MVs are not time-aligned with the audio
**What goes wrong:** MVs often have intros, skits or outros. "Start at the current position" then lands mid-intro, and "resume where the video reached" lands wrong in the audio.
**Avoid:** sync positions only when `|videoDuration − audioDuration| ≤ 8 s`. Otherwise start the video at 0 and, on close, resume audio at its own pre-video position. YTM's real fix (`segmentMap` from `next`) is a new edge route and out of scope (see Open Question 2).
**Warning sign:** the user reports the video starting at the wrong point.

### Pitfall 8: Stall watchdog and stale `<audio>` errors fight the embed
**What goes wrong:** `armStall()` was armed at src-set. 15 s later `recoverLoadStall` → `runFallback` swaps the song from under the playing video.
**Avoid:** `disarmStall()` in `attachExternal` (and in the VID-03 hook). `play()` entry drops `ext`, so a new src re-arms normally.

### Pitfall 9: Unmount = close
**What goes wrong:** NowPlaying renders only under `{#if player.expanded}` (`(app)/+layout.svelte` L436-437). Collapsing destroys the embed.
**Avoid:** make NpVideo's destroy the hand-back. This is correct by policy (a collapsed player isn't displayed). Don't try to keep it alive in a hidden layer.

### Pitfall 10: Pre-roll ads
**What goes wrong:** monetized videos may play an ad first. PLAYING/position during the ad is not the song [ASSUMED behaviour].
**Avoid:** only sync position or seek once `getDuration()` is within the duration gate or `getVideoData().video_id` equals the requested id. Treat ad time as loading. Device-check.

### Pitfall 11: iOS user-paused embed in PiP
**What goes wrong:** if a user PiPs YouTube's own fullscreen player and leaves the app, our hidden hand-back destroys the PiP (a cross-origin video's PiP state is invisible to us).
**Avoid:** accept it and document. Policy-wise the hand-back is the safe default.

### Pitfall 12 (project-wide, outside this phase): new WebKit hidden-start rule
**What goes wrong:** the 2026-09-30 WebKit restriction refuses an audible `play()` while hidden unless it is within **10 s** of an audible end in the same document. The app's background auto-advance does `ended` → resolve (cold ~5.5 s, memory: cold-start budget) → `play()`. That passes today but will fail whenever the resolve exceeds 10 s once this ships in Safari.
**Avoid:** log a todo. Not this phase's scope.

## Code Examples

### Lazy IFrame API loader (official contract: `onYouTubeIframeAPIReady`)
```ts
// services/yt-iframe-api.ts — browser-only; imported only from NpVideo (lazy chunk).
// Source: developers.google.com/youtube/iframe_api_reference ("Loading a Video Player").
let loading: Promise<YtApi> | null = null;
export function loadYtIframeApi(timeoutMs = 10_000): Promise<YtApi> {
	const w = window as unknown as { YT?: YtApi; onYouTubeIframeAPIReady?: () => void };
	if (w.YT?.Player) return Promise.resolve(w.YT);
	loading ??= new Promise<YtApi>((resolve, reject) => {
		const fail = (why: string) => { clearTimeout(timer); loading = null; reject(new Error(why)); };
		const timer = setTimeout(() => fail('yt-api timeout'), timeoutMs);
		const prev = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			prev?.();
			clearTimeout(timer);
			if (w.YT?.Player) resolve(w.YT); else fail('yt-api missing');
		};
		const s = document.createElement('script');
		s.src = 'https://www.youtube.com/iframe_api';
		s.onerror = () => fail('yt-api load failed');
		document.head.appendChild(s);
	});
	return loading;
}
```

### Creating the player (VID-01 / VID-03)
```ts
// Source: IFrame API reference (events, states -1/0/1/2/3/5, errors 2/5/100/101/150/153, destroy()).
const yt = await loadYtIframeApi();
const p = new yt.Player(hostDiv, {
	host: 'https://www.youtube-nocookie.com',          // privacy-enhanced; widgetapi honours `host`
	videoId: ids[0],
	width: '100%', height: '100%',
	playerVars: { playsinline: 1, autoplay: 1, start: Math.floor(startAt), rel: 0, iv_load_policy: 3 },
	events: {
		onStateChange: (e) => { /* 1 → player.extPlaying(engine), intent='play'; 0 → player.extEnded(engine) */ },
		onError: (e) => { /* 100/101/150 → next id via p.loadVideoById({videoId, startSeconds}); else close */ },
		onAutoplayBlocked: () => { /* status='tap-to-play' — hint BELOW the player, never over it */ }
	}
});
const engine = { play: () => p.playVideo(), pause: () => p.pauseVideo(), seek: (t: number) => p.seekTo(t, true) };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Embeds worked with a suppressed Referer | Error **153** without Referer / client identity | Documented in the 2025-2026 reference; widely hit mid/late 2025 [CITED: simonwillison.net 2025-12-01] | Keep the default referrer policy. WebViews must identify. |
| WebKit allowed audible `play()` in a hidden page | `RequireUserGestureToStartAudiblePlaybackWhenHidden` (default **true**, 10 s same-document grace; iframe audio doesn't count) | WebKit main **2026-09-30** (bug 310600); not yet in a shipping Safari [ASSUMED: ships in a later Safari] | The iOS hidden hand-back degrades to "paused at lock, resume from lock screen" |
| Mobile-web YouTube background play via browser tricks | Premium-only, enforced "across all platforms" | Jan 2026 [CITED: androidauthority] | No embed-side background fix exists |
| `modestbranding` | Deprecated, no effect | 2023-08-15 [VERIFIED: player_parameters revision history] | Don't pass it |
| `s.ytimg.com` widget script | `www.youtube.com/s/player/<build>/www-widgetapi.vflset/…` | observed 2026-10-04 [VERIFIED] | CSP (if ever added) needs only www.youtube.com |

**Deprecated/outdated:**
- `modestbranding` and `rel=0` ("no related videos"): since 2018, `rel=0` means same-channel related only [VERIFIED: player_parameters].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Capacitor `https://localhost` Referer is accepted by YouTube (no 153/152) | Q2, Q6 | APK must use the HLS fallback. The Wave-0 probe decides before any APK UI work. |
| A2 | Shipping iOS Safari allows the hidden `<audio>.play()` hand-back | Q1 | iOS shows "paused at lock" (already the documented degraded behaviour). Device check. |
| A3 | `www.youtube-nocookie.com` behaves identically for the API | Stack | One-constant switch to `www.youtube.com` |
| A4 | `getCurrentTime()` lags ≤ ~0.5 s (infoDelivery cadence) | Q5 | Slightly worse hand-off accuracy. Cosmetic. |
| A5 | Pre-roll ads report PLAYING/position for the ad | Pitfall 10 | Wrong-position seek after an ad. Guard with the video-id/duration check. |
| A6 | Embedding-disabled MVs are "common enough to handle" | Q4 | None. The candidate list is cheap either way. |
| A7 | Android WebView plays YouTube's VISIONOS HLS manifest in `<video>` | Q6 (fallback only) | The fallback itself would need the bridge page. Only matters if A1 fails. |
| A8 | The WebKit 2026-09-30 rule will ship in a future Safari | State of the Art | If it never ships, iOS keeps the seamless hand-back |

## Open Questions

1. **YT Music ATV tracks show static art in "Video".**
   - What we know: Songs-shelf ytmusic tracks are `MUSIC_VIDEO_TYPE_ATV` (fixture: all 8 rows). The lock says "YT Music tracks use their own videoId".
   - Unclear: whether the user wants the OMV for those (YTM's own Song↔Video switch uses the `next` counterpart).
   - Recommendation: ship the locked behaviour. Ask in discuss/verify whether ytmusic ATV tracks should also run the VID-02 search and prefer an OMV. That would be ~3 lines (the search already exists) plus a `videoType` field on the ytmusic Track.
2. **MV/audio time misalignment (Pitfall 7).**
   - Recommendation: the duration gate (±8 s) now. `segmentMap` (new `next` edge route) only if users complain.
3. **VID-03 intrusiveness.**
   - Auto-expanding NowPlaying when a ytmusic song fails is the only policy-compliant auto-play (the embed must be visible).
   - Recommendation: expand plus a one-line notice "Playing via YouTube". Confirm in UAT. The alternative is a toast with "Play video" (a gesture, also fixes iOS autoplay), which deviates from "auto-play".
4. **YouTube API ToS obligations.** The Developer Policies (III.A) require a link to YouTube ToS and to the Google Privacy Policy, plus a privacy-policy notice that the client uses YouTube API Services.
   - Recommendation: add the links and the line in Settings → About (cheap). Escalate the "agree to privacy policy before access" requirement to the human, consistent with the project's existing ToS posture (spike 006/008 flagged ToS as a human call).
5. **Video mode across tracks.**
   - Recommendation: per-track (track change closes video; re-tap for the next). Keeping it sticky would need a gesture-less re-open per track (iOS-hostile) and a search per track.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/test | ✓ | v24.13.0 (via `~/.nvm/versions/node/v24.13.0/bin`) | — |
| pnpm | build/test | ✓ | 8.15.5 | — |
| Android emulator `Pixel_3a_API_34` + adb | VID-05 Wave-0 probe, APK E2E | ✓ | adb 1.0.41 | Physical Android device (human) |
| JDK 21 | `pnpm apk` | ✓ | `/opt/homebrew/opt/openjdk@21` (must set JAVA_HOME; default is 20) | — |
| Dev server with ytmusic search | fixture capture, web E2E | ✓ (local vite; InnerTube search reachable from residential IP) | — | — |
| Real iPhone (Safari + home-screen PWA) | VID-04 iOS lock/background check, iOS autoplay UX | ✗ to the agent | — | **Human checkpoint** |
| Real Android phone (Chrome) | VID-04 lock-screen hand-back, notification ownership | ✗ to the agent | — | Emulator power-key (`adb shell input keyevent 26`) covers visibilitychange plus the notification. A final human check is recommended. |

**Missing dependencies with no fallback:** none blocking build. iOS behaviour is verifiable only by a human on a device.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.3, single **node** project, no jsdom (`vite.config.ts`). `*.svelte.test.ts` runs runes headless. |
| Config file | `vite.config.ts` (`test.projects[0]`, `requireAssertions: true`) |
| Quick run command | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm vitest --run src/lib/services/yt-video.test.ts src/lib/sources/ytmusic.test.ts` |
| Full suite command | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test && pnpm check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VID-02 | `parseSearchRows` extracts `musicVideoType` and `parseSearchEnvelope` output is unchanged | unit | `pnpm vitest --run src/lib/sources/ytmusic.test.ts` | ✅ (extend) |
| VID-02 | `pickVideoIds`: OMV>UGC, ATV excluded, CJK `【】` title match, variant rejection, artist alias, duration tie-break, invalid id dropped, top-3 | unit | `pnpm vitest --run src/lib/services/yt-video.test.ts` | ❌ Wave 0 |
| VID-02 | cache: hit 30 d / miss 1 d / cap 500 / hostile values rejected / node no-localStorage no-throw; ytmusic → own id with no fetch; same URL as name-rescue | unit | same file | ❌ Wave 0 |
| VID-01 | seam: `attachExternal` pauses audio deliberately + disarms stall; `toggle`/`seekFraction`/MS handlers route to engine; stale engine callbacks ignored; `play()` entry drops ext | unit (`player.svelte.test.ts`, `makeFakeAudio`) | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "external engine"` | ✅ (extend) |
| VID-01 | `extEnded` → `onTrackEnded` (sleep-stop beats repeat-one beats next); `extPlaying` → failure counters reset | unit | same | ✅ (extend) |
| VID-01 | `expireSleepTimer` in ext mode pauses the engine (Pitfall 3) | unit | same | ✅ (extend) |
| VID-03 | after `loadRetries`: foreground web ytmusic → `embedFallbackUid` set + `expanded` + no `runFallback`; hidden → `runFallback`; non-ytmusic unchanged; once per uid; `extFailed` → `runFallback` | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "loadRetries"` | ✅ (update the L6358 test, Pitfall 1) |
| VID-04 | `detachExternal(t,{play:true})` seats `<audio>` at t and plays; a rejected `play()` leaves `playing=false` + metadata written | unit | same | ✅ (extend) |
| i18n | new keys present in all 15 locales, double quotes | unit | `pnpm vitest --run src/lib/i18n/i18n.test.ts` | ✅ |
| VID-01/03 | embed renders ≥200×200, no overlap, autoplay on Chrome, position hand-off, 101/150 next-candidate, collapse → audio resumes | browser E2E (dev server, Chrome; note the hidden-pane rAF caveat in memory) | manual / CDP | manual |
| VID-04 | lock/background hand-back: Android Chrome (emulator power key), iOS Safari + PWA | device | — | human checkpoint |
| VID-05 | Wave-0 probe: embed in debug APK on `https://localhost` → plays or 153/152 | emulator + CDP | `pnpm apk` (JAVA_HOME=openjdk@21) + adb install + CDP | manual (Wave 0) |

### Sampling Rate
- **Per task commit:** the quick run command (touched test files).
- **Per wave merge:** `pnpm test && pnpm check`.
- **Phase gate:** full suite green + the VID-05 probe result recorded + the human device checklist (VID-04 iOS + Android) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/sources/__fixtures__/ytmusic-search-merged.json`: capture a real `{ytmusicMerged:[songs,videos]}` from the local dev route for one CJK artist (e.g. `周杰倫 告白氣球`) and one Latin one. One request each from the residential IP, never a burst against prod.
- [ ] `src/lib/services/yt-video.test.ts`: covers VID-02.
- [ ] VID-05 emulator probe (decides embed vs HLS on APK) before any APK-specific work.
- [ ] No framework install needed.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth (locked: no account / PoToken) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `VIDEO_ID` regex on every id (search rows AND localStorage reads) before it reaches the embed. Cache shape and length guards (name-rescue T-wa7-03 posture). Search text goes only to our fixed-URL route (existing open-relay guard T-27-02-01). |
| V6 Cryptography | no | — |
| V12/V14 Config (third-party script) | yes | Load `https://www.youtube.com/iframe_api` lazily and only on demand. No SRI is possible (the loader rotates the widget build). Do not weaken referrer policy. Keep CORS/SW posture unchanged (cross-origin bypass already). |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Poisoned localStorage videoId → arbitrary embed path | Tampering | `VIDEO_ID` regex on read; a miss on failure |
| Spoofed postMessage into our page | Spoofing | We add **no** message listener. The IFrame API filters by its host origin internally. (If the APK bridge is ever built: origin + `e.source` checks as in `turnstile-bridge.ts`.) |
| Clickjacking-style overlays on the YouTube player | (policy) | No overlays (RMF). Controls stay YouTube's. |
| Privacy leakage to Google on every open | Information disclosure | `youtube-nocookie` host, load only on explicit Video tap / fallback, ToS/Privacy links (Open Question 4) |
| Third-party script compromise | Tampering | Accept (Google-hosted, same as any embed). Lazy-loaded so it never runs for users who don't open video. |

## Sources

### Primary (HIGH confidence)
- developers.google.com/youtube/iframe_api_reference (updated 2026-09-29): errors 2/5/100/101/150/153, events incl. `onAutoplayBlocked`, states, `destroy`, `loadVideoById`/`startSeconds`, the 200×200 requirement
- developers.google.com/youtube/player_parameters (updated 2026-09-16): `origin`, `playsinline`, `start` keyframe note, `widget_referrer`, `rel`, `modestbranding` deprecation
- developers.google.com/youtube/terms/required-minimum-functionality (updated 2026-09-14): Referer identity, WebView guidance, 200×200, autoplay-visibility, overlay ban
- developers.google.com/youtube/terms/developer-policies (updated 2026-09-14): background-player ban, audio/video separation ban, ToS/privacy-policy obligations
- Live `https://www.youtube.com/iframe_api` + `www-widgetapi.js` build 8ab5c328 (fetched 2026-10-04): iframe `allow`, `referrerpolicy`, auto `origin`/`enablejsapi`/`widget_referrer`, `host` option
- WebKit main (fetched 2026-10-04): `MediaSessionManagerIOS.mm`, `MediaSessionManagerInterface.cpp`, `HTMLMediaElement.cpp`, `MediaElementSession.cpp`, `Document.cpp`, `MediaSession.cpp`, `WebPreferencesDefaultValues.cpp`, commit a09645c2 / bug 310600, `LayoutTests/media/media-playback-in-background-handover.html`
- Chromium main (fetched 2026-10-04): `media_session_impl.cc` (routing, OnPlayerPaused, DidReceiveAction), `web_media_player_impl.cc` (ShouldPausePlaybackWhenHidden, Play unlock), `render_frame_media_playback_options.{h,cc}`, `media_switches.cc`
- developer.chrome.com/blog/autoplay: sticky activation + `allow="autoplay"` delegation
- ytmusicapi main: `models/content/enums.py` VideoType, `navigation.py` NAVIGATION_VIDEO_TYPE
- Codebase (read this session): `player.svelte.ts` (attach/listeners/error/LOAD RETRY/MS/sleep/toggle/runFallback/seekFraction), `ytmusic.ts`, `name-rescue.ts`, `ytmusic/search/+server.ts`, `sw-cache.ts`, `service-worker.ts`, `hooks.server.ts`, `app.html`, `svelte.config.js`, `capacitor.config.ts`, `turnstile-bridge*.ts`, `(app)/+layout.svelte`, `NowPlaying.svelte`, `dedupe.ts`, `match-key.ts`, `score-match.ts`, `ytmusic-native.ts`, `node_modules/@capacitor/android/.../Bridge.java`, `__fixtures__/ytmusic-search.json`; prod headers via curl

### Secondary (MEDIUM confidence)
- github.com/tauri-apps/tauri/issues/14422 (2025-11-05): http://localhost works, custom scheme → 153
- simonwillison.net/2025/Dec/1/youtube-embed-153-error/: same-origin Referrer-Policy → 153
- androidauthority.com/youtube-background-play-broken-3636179 (2026-01-29): Google confirms Premium-only background play
- tech-ish.com (2025-12-08): Chrome 142 native HLS; mobile Chrome already played HLS

### Tertiary (LOW confidence)
- github.com/Cap-go/capacitor-youtube-player/issues/49: 152-4 ⇔ missing Referer in WKWebView
- sitelint.com Brave article (undated): "Embedded YouTube videos in the iframe elements do not play in the background"
- testmuai.com (2026-04-30): Chrome Android native HLS from 147; WebView shares the pipeline
- corsproxy.io blog (2025-12-28): 150/153 in WebViews

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No new deps. The API contract was read from official docs and the live widget script.
- Architecture: MEDIUM-HIGH. The seam follows existing player patterns and was traced through the real listeners. Exact line anchors may shift.
- Pitfalls: HIGH for the engine and policy ones (source-level). MEDIUM for ads and getCurrentTime lag (assumed).
- VID-04 device behaviour: MEDIUM. Engine rules are verified; the assembled behaviour still needs device checks.
- VID-05: MEDIUM. Resolved by the Wave-0 probe.

**Research date:** 2026-10-04
**Valid until:** ~2026-11-04 for the API/policy facts. Re-check WebKit release notes before the iOS device checkpoint, because the hidden-start rule is fast-moving.
