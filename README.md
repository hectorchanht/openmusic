<p align="center">
  <img src="static/og.svg" alt="openmusic" width="640">
</p>

# openmusic

A mobile-first web music player that searches and streams tracks aggregated from **NetEase, QQ, Kuwo and JOOX** through a same-origin proxy, with **Last.fm-powered discovery**, **Deezer cover art**, a **customizable home**, and a **15-language UI**. Built with SvelteKit and deployed on Cloudflare Pages.

👉 **Live:** <https://openmusic.lol>

> Ground-up rebuild of the data layer from [`CharlesPikachu/musicsquare`](https://github.com/CharlesPikachu/musicsquare) into a SvelteKit mobile app. The original single-file desktop player lives in the `upstream` remote / git history (it was the porting reference for the source adapters).

---

## Tech stack

- **Svelte 5** (runes) + **SvelteKit 2** + **Vite 8**, **TypeScript** (strict)
- **@sveltejs/adapter-cloudflare** — deploys as a Cloudflare Pages project (`openmusic`)
- **@lucide/svelte** icons · **Vitest** unit tests
- Package manager: **pnpm**

## Architecture

- **Metadata proxy** — a SvelteKit endpoint `src/routes/api/[source]/[...path]/+server.ts` fronts each source's **search / detail / lyrics** calls (CORS, bounded retry) and injects the JOOX token from `platform.env` so it never reaches the client bundle. **Audio streams browser → source CDN directly** (not through the proxy) to stay within Cloudflare's free-tier limits.
- **Source-adapter registry** — client adapters in `src/lib/sources/` + matching proxy adapters in `src/lib/proxy/`, enumerated once in a registry. Adding a source = a new client file + a new proxy file + one import; aggregation/dispatch names no source.
- **Presentation-layer services** (`src/lib/services/`) — `catalog` (allSettled fan-out + interleave), `dedupe` (cross-source de-dupe + best-quality pick), `picks` (diverse top-picks builder), `lrc` (LRC parsing), `share`, `translate`, plus the discovery/cover stack: `lastfm` + `discovery` (charts / genre / region shelves + `resolveStub` re-search), `deezer` (chart source + cover/artist art via an edge proxy), `cover-cache` / `cover-backfill` / `itunes-cover` (the Deezer → iTunes → CN cover chain), `score-match` + `match-key` (best-match resolution), and `home-layout` (pure config resolution for the customizable home). Covered by **414 Vitest tests**.
- **Stores** (`src/lib/stores/`, Svelte 5 runes) — `player` (single app-wide `<audio>` + queue + gapless prefetch), `library` (liked / playlists / downloads), `history` (listen history), `settings`, `names` (per-part display-name translation cache), `overlays`, `searchSession` / `searchHistory`. All persist to `localStorage`, SSR-guarded.
- **Discovery proxies** — `api/lastfm/{info,discovery}` (charts/tags/geo, edge-cached, `LASTFM_KEY` edge-only) and `api/deezer/{search,chart}` (covers + the top-hits chart source; Deezer blocks browser CORS so it's proxied). All mirror the own-origin CORS + retry posture.
- **Translation** — `src/routes/api/translate/+server.ts` (Google, `sl=auto`) powers per-part name/lyrics translation across a wide target-language set; the **UI chrome** itself ships in **15 locales** (`src/lib/i18n/`).
- **Routing** — the `(app)` route group holds the mobile shell (home, search, library, settings, `/artist/[name]`, `/album/[name]`) with a persistent now-playing bar/overlay; the single `<audio>` lives in the root layout so playback survives navigation. `/spike` is a dev harness for the audio-egress test.

## Features

- Search across all sources, tap to play — with a first-load skeleton + a Go-button spinner while searching, and a "no more results" end note
- **Last.fm-powered home discovery** — top hits, top artists, and per-genre / per-region shelves; tap-to-play re-resolves each pick to the best playable match from the CN sources
- **Customizable home** (`/settings/home`) — drag-to-reorder & hide the shelves, pick which of ~22 genres / ~20 regions appear (drag the selected chips to reorder), items-per-shelf, default landing tab, tile density, and chrome toggles
- **Real cover art** — top hits/artists source from the Deezer chart (covers embedded); everything else backfills covers lazily via **Deezer → iTunes → CN**, with a gradient as last resort
- Full-screen now-playing: drag/expand, seekable progress, transport, draggable Up-Next / Lyrics / Related sub-nav
- Auto-advancing **and auto-growing** queue (never runs dry) + next-track prefetch for gapless-ish play
- Synced lyrics with smart auto-scroll (pauses on touch, resumes) + on-demand translation
- **Per-part translation** — independent target languages for artist / title / lyrics / Last.fm tags, with per-part source-skip whitelists (e.g. 简体 → 繁體)
- A Randomize button that genuinely varies the home (random chart page + shelf/tile shuffle)
- Long-press any song (home tiles, search, library) → context menu: Play next, Add to queue, Download, Like, Add to playlist, Go to album/artist, Share, Detail — with toast confirmation
- Local library with a **History** tab: liked songs, playlists, downloads, listen history
- Settings: per-part translation, default + **separate download** quality, source, accent color, reduce-motion, auto-expand, plus a **15-language app UI** (en / zh-Hant / zh-Hans / es / fr / de / pt / it / ru / tr / ar / hi / id / vi / th)
- Marquee-scrolling tile labels, Cloudflare Web Analytics, brand mark + favicon, web manifest, SEO meta + Open Graph / Twitter share card

## Getting started

```bash
pnpm install
pnpm dev          # dev server (Vite)
pnpm build        # production build (adapter-cloudflare → .svelte-kit/cloudflare)
pnpm preview      # serve the build locally via wrangler pages dev
pnpm check        # svelte-check (TypeScript, strict)
pnpm test         # run the Vitest suite (414 tests)
```

## Android APK (build & install)

The same SvelteKit app ships as a native Android shell via **Capacitor** — a static SPA build wrapped in a WebView, talking to the deployed `/api/*` proxy cross-origin.

### Prerequisites

- **Node 22** via nvm + **pnpm** — `nvm use 22` (or `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"`)
- **JDK 21** — `brew install openjdk@21`, then `export JAVA_HOME=/opt/homebrew/opt/openjdk@21` (JDK ≤ 20 fails the build with `invalid source release: 21`)
- **Android SDK** — `export ANDROID_HOME=$HOME/Library/Android/sdk` (platform 36 auto-downloads on the first build)
- `android/local.properties` (holds `sdk.dir`) is generated locally and is **gitignored** — never commit it.

### Build the APK

```bash
pnpm install
pnpm build:native          # static SPA build, bakes VITE_API_BASE=https://openmusic.lol
npx cap sync android       # copy the web build into the Android project
cd android && ./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Install to a phone

1. On the phone, enable **Developer options → USB debugging**, plug it in, and accept the **"Allow USB debugging?"** RSA prompt.
2. Install:
   ```bash
   adb install -r --user 0 android/app/build/outputs/apk/debug/app-debug.apk
   ```
   `--user 0` is required on Samsung devices with Secure Folder / dual-app profiles — a plain install can land in the wrong user.
3. Launch:
   ```bash
   adb shell am start -n com.openmusic.app/.MainActivity
   ```

### Important: the deployed server must be current

The APK loads its UI **locally** but calls `https://openmusic.lol/api/*` **cross-origin**. The deployed web app must include the current CORS hook, or every API call from the APK fails with a CORS error. Deploy is manual:

```bash
pnpm build && npx wrangler pages deploy .svelte-kit/cloudflare --project-name openmusic
```

## Deployment

Pushes to **`main`** auto-deploy to **Cloudflare Pages** (project `openmusic`,
<https://openmusic.lol>) via Cloudflare's **native Git integration** — no
GitHub Actions, no GitHub secrets, no manual `wrangler deploy`. The `/api/*` proxy
ships inside the same Pages build (`adapter-cloudflare` → `_worker.js`). Node 22 is
pinned via `.nvmrc` + `package.json` `engines.node`.

Production runtime secrets (`JOOX_TOKEN` **required**; `LASTFM_KEY` / `LASTFM_SECRET`
optional) must be set in the Pages dashboard, or `/api/*` breaks in production.

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the one-time dashboard setup, the exact
build settings, the full env-var reminder, and a manual `wrangler` fallback. Locally,
secrets go in a gitignored `.dev.vars` for `pnpm preview`.

## Project layout

```
src/
  app.html              # <head>: icons, manifest, theme-color
  app.css               # theme tokens (dark + violet)
  lib/
    i18n/               # 15 UI-chrome dictionaries (en/zh-Hant/zh-Hans + 12 world langs) + detect
    sources/            # client source adapters + registry + Track type   (data layer)
    proxy/              # per-source proxy adapters + http helper           (data layer)
    services/           # catalog, dedupe, picks, lrc, share, translate, lastfm, discovery,
                        #   deezer, cover-cache/-backfill, itunes-cover, score-match, home-layout
    stores/             # player, library, history, settings, names, overlays, search* (runes)
    components/         # NowPlaying, TrackMenu, TagChips, Logo
    actions/            # longpress, dragScroll, dragClose, marquee, chipReorder, dragReorder
  routes/
    +layout.svelte      # root: global <audio>, SEO head
    (app)/              # mobile shell: home, search, library, settings (general/home/translation/
                        #   playback/lastfm/data/about), artist, album
    api/[source]/...    # music metadata proxy
    api/lastfm/...       # Last.fm info + discovery (charts/tags/geo) proxy
    api/deezer/...       # Deezer cover search + chart proxy
    api/translate/      # lyric/name translation proxy
    spike/              # dev: browser-direct audio egress harness
static/                 # favicon.svg, icon-maskable.svg, og.svg, manifest.webmanifest, robots.txt, sitemap.xml
.planning/              # GSD planning docs (roadmap, phases, quick tasks)
```

## Scope & honesty notes

- Music is streamed from **unofficial third-party proxy APIs** (no SLA; they can change or rate-limit). This is a **demo / educational** project — copyrights belong to the original platforms.
- Audio is browser-direct; "Download" saves the file and references it in the library, but a web app can't replay an arbitrary saved file offline (the Downloads tab re-streams).
- Lyric/name translation uses an unofficial translation endpoint (best-effort, cached, falls back to originals).
- The product is being built with [GSD](https://github.com/glamboyosa/gsd); the formal roadmap (data-layer foundation → audio engine → library → UI shell → PWA service worker → iOS background audio → new sources/queue) lives in [`.planning/`](.planning/). Much of the live demo was built ahead of that sequence as `/gsd:quick` tasks.

## License

See [LICENSE](LICENSE). Upstream: [CharlesPikachu/musicsquare](https://github.com/CharlesPikachu/musicsquare).
