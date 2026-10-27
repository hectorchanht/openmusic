# Phase 42: YouTube video + embed playback - Context

**Gathered:** 2026-10-04
**Status:** Ready for planning (decisions below are LOCKED — chosen by the user via AskUserQuestion)

<domain>
## Phase Boundary

Watch any song as its YouTube video from Now Playing, streamed by YouTube's own embed player from the
user's IP; and on web, play a YT Music track through the embed when the edge audio proxy fails.
Not in scope: YouTube account/library sync (legal-gated milestone, spike 008), PoToken generation,
third-party resolvers (Invidious/Piped/cobalt), proxying video bytes through the Worker.

</domain>

<background>
## Why (measured 2026-10-04, this session)

- YT Music audio now plays via the VISIONOS InnerTube client (5acc875c; ANDROID_VR became PoToken-gated,
  ~1 MB cap). The edge byte proxy works but YouTube bot-gates Cloudflare egress PER INVOCATION:
  ~25–50% of `/api/ytmusic/stream` requests return 502 "player not OK" (LOGIN_REQUIRED). All player
  calls inside one invocation share the verdict; fresh visitorData does not help. Prod's custom domain
  masks the Worker's 502 as Cloudflare's own `error code: 502`.
- Mitigations shipped: proxy 403 retry + no error-body relay (38961cce), player `loadRetries` registry
  flag (ytmusic = 2) re-attaching a fresh src before fallback (0be89f92).
- googlevideo urls are IP-locked (`ip` in sparams) — a redirect to the user cannot work on web; the
  browser cannot call InnerTube itself (no CORS). The ONLY way to stream YouTube from the user's own IP
  on web is YouTube's official embed (IFrame Player API). The APK already resolves on-device.
- VISIONOS returns NO muxed MP4 (`streamingData.formats` empty); video is available as HLS
  (`hlsManifestUrl`, 12 variants, avc1+mp4a, IP-locked to the caller) — usable on the APK only.

</background>

<decisions>
## Implementation Decisions (LOCKED)

### VID-01 — Where video shows: toggle in Now Playing
- A "Video" button on the Now Playing screen swaps the cover art for the YouTube embed, starting at the
  current playback position. The app's `<audio>` pauses while video shows; closing the video resumes
  audio at the position the video reached.

### VID-02 — Which songs: ANY song (search YouTube)
- YT Music tracks use their own videoId. Any other source searches YT Music by title + artist to find a
  matching video (reuse the existing ytmusic search route / `parseSearchEnvelope` / name-rescue
  machinery; one search per tap, cached). Wrong-match risk must be mitigated (match scoring via the
  existing scoreMatch / sameSongKey primitives; prefer the Videos shelf / official video).

### VID-03 — Web fallback: auto-play via the embed
- On WEB, a YT Music track whose edge audio proxy still fails after its `loadRetries` budget plays
  through the YouTube embed (from the user's IP) instead of falling to cross-source fallback / skip.

### VID-04 — "Fix the caveat": lock-screen / background audio for embed playback
- The user explicitly asked to FIX the caveat that embed playback has no lock-screen/background audio
  on mobile web. Research must establish what is actually achievable (iOS Safari + Android Chrome +
  installed PWA), with evidence, and implement the best achievable behaviour. If a full fix is
  impossible, the plan must say so explicitly and implement the best mitigation (e.g. hand back to the
  `<audio>` proxy path when the page is hidden/locked, Media Session metadata from our page, resume on
  return) — never silently ship the caveat.

### VID-05 — APK
- The APK resolves on-device already (VISIONOS from the phone's IP). Research decides whether video on
  the APK uses the WebView embed (check Referer / error 152/153 on origin https://localhost) or
  device-side HLS from `hlsManifestUrl` in a `<video>` element.

### Post-research decisions (2026-10-04, user via AskUserQuestion — LOCKED)
- **VID-04 resolved:** a full background/lock-screen fix is IMPOSSIBLE and must be stated in the plan
  (YouTube developer policy 2026-09-14 forbids background embed playback; WebKit + Chromium pause hidden
  audible video; YT background play is Premium-only on mobile web since 2026-01). Implement the best
  achievable: whenever the embed stops being visible (video toggled off, Now Playing collapsed, page
  hidden/locked) capture its position, destroy() it, and hand playback back to the app's `<audio>` at
  that position (lock-screen capable). Never auto-return to the embed on foreground.
- **VID-06 — Art tracks:** a YT Music Songs-shelf result whose `musicVideoType` is an art track (ATV,
  static album art) searches for the real music video (same title+artist search as CN songs); fall back
  to its own videoId only if nothing matches. (Amends VID-02's "YT tracks use their own videoId" for
  art tracks only; OMV/UGC/official-source YT tracks keep their own videoId.)
- **VID-07 — Auto-expand for VID-03:** the web fallback expands Now Playing and shows the embed in the
  cover slot (the only policy-compliant autoplay: ≥200×200, >50% visible). Once per song, foreground
  only; if the embed fails, the existing runFallback chain continues. iOS needs the user's tap on
  YouTube's own play button (no scripted sound) — accepted.
- **VID-08 — Position sync:** sync the embed start / audio hand-back position only when the video and
  song durations match within ±8 s; otherwise the video starts at 0 and audio resumes where it paused.
- **VID-09 — YouTube terms:** add links to YouTube's Terms of Service and Google's Privacy Policy in
  Settings → About (YouTube API Services terms disclosure). i18n in all 16 locales.
- **Defaults accepted from research:** video mode ends when the track changes; match titles WITHOUT
  `norm()` (it strips 【…】 where CN MV titles carry the song name); exclude ATV rows when searching
  for a video; one search per tap, cached under `openmusic:<domain>:v1`.

### Claude's Discretion
- Component structure (a child of NowPlaying, not more lines in the ~2000-line NowPlaying.svelte —
  see CLAUDE.md anti-patterns), store shape, i18n keys (all 16 locales, double quotes), loading/error
  states, embedding-disabled handling (errors 101/150 → hide/disable the toggle for that song).

</decisions>

<research_questions>
## Must be settled by research
1. Embed playback in background / locked screen: iOS Safari, Android Chrome, installed PWA. Can our
   page's Media Session control an iframe? Does YouTube's player pause on visibilitychange?
2. YouTube embed Referer/origin requirement (errors 152/153 since 2025) vs our `referrerpolicy` /
   `_headers` Referrer-Policy and the Capacitor origin; required `origin` playerVar.
3. CSP: does the app set a Content-Security-Policy (frame-src / script-src for www.youtube.com /
   youtube-nocookie.com)? `_headers`, `hooks.server.ts`, service worker.
4. Embedding-disabled videos (101/150) — frequency for official music videos; detection + UX.
5. IFrame API position sync: seekTo/getCurrentTime handoff accuracy; autoplay-with-sound rules on a
   user tap (gesture) vs the auto-fallback (VID-03, no gesture → may need muted start).
6. APK: WebView embed vs device-side HLS `<video>` (VID-05).

</research_questions>

<canonical_refs>
## Canonical References
- `.claude/skills` none; spike skill `spike-findings-openmusic` (ytmusic source spikes 005–008)
- Memory: ytmusic-two-walls-player-gate-vs-googlevideo-403 (edge gate findings 2026-10-04)
- `src/lib/sources/ytmusic.ts`, `src/lib/services/ytmusic-native.ts`, `src/lib/proxy/ytmusic-innertube.ts`,
  `src/routes/api/ytmusic/stream/[videoId]/+server.ts`, `src/lib/services/name-rescue.ts`,
  `src/lib/stores/player.svelte.ts` (error handler LOAD RETRY branch), `src/lib/components/NowPlaying.svelte`
- yt-dlp `yt_dlp/extractor/youtube/_base.py` INNERTUBE_CLIENTS (client map)

</canonical_refs>
