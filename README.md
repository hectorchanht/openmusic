<p align="center">
  <img src="static/og.svg" alt="openmusic" width="640">
</p>

# openmusic

One search box for music from eight catalogs. Tap a song and it plays, on the web or as an Android
app, and it keeps playing when the screen locks.

- **Web:** <https://openmusic.lol> (installable as an app)
- **Android:** [download the APK](https://github.com/hectorchanht/openmusic/releases/latest/download/openmusic-main.apk) · [all releases](https://github.com/hectorchanht/openmusic/releases)

## What it does

**Find music**
- Searches eight sources at once, merges duplicates and keeps the best-quality copy. Turn any
  source on or off in Settings → Playback.
- Home shows the Deezer top-hits chart plus Last.fm shelves by genre and region. Every shelf opens
  a see-all page; country and tag charts too.
- Song, artist and album pages with shareable links.
- Make the home yours: reorder or hide shelves, pick genres and regions, set density and the
  landing tab.

**Listen**
- Full-screen player with Up Next, Lyrics, Related and Comments.
- The music doesn't stop: if a source fails it tries another, the next track is fetched ahead,
  and Up Next refills itself with similar songs.
- Synced lyrics that pause auto-scroll while you touch them. Pick different lyrics, or fix their
  timing — fixes are shared, so everyone gets the listeners' agreed offset.
- Translate the artist, title, lyrics and tags, each into its own language; Simplified ↔
  Traditional Chinese built in.
- Sleep timer with fade-out; lock-screen controls on Android.

**Keep**
- Library: liked songs, playlists, downloads, listening history and Your Radio.
- Download songs or whole albums at their own quality setting. Files carry their tags, cover
  and lyrics, and downloaded songs play offline.
- Real cover art from Deezer, then iTunes, then the Chinese platforms. Listeners can vote for a
  better cover, and the crowd's pick is shown to everyone.

**Talk**
- Comments on every song.

**Your way**
- App in 15 languages: English, 繁體中文, 简体中文, Español, Français, Deutsch, Português, Italiano,
  Русский, Türkçe, العربية, हिन्दी, Bahasa Indonesia, Tiếng Việt, ไทย.
- Accent colour, reduce motion, lyric highlight position.

## Sources

| Source | Catalog | Access |
|---|---|---|
| NetEase, QQ, Kuwo, JOOX | Mainstream Chinese platforms | Unofficial third-party APIs |
| 5sing | Kugou user uploads (covers, backing tracks) | Unofficial |
| Jamendo | Creative Commons indie | Open catalog |
| Audius | Decentralized indie / electronic | Open network |
| YouTube Music | Global | Anonymous (no account); never used for downloads |

## How it works

- **SvelteKit 2 + Svelte 5** on **Cloudflare Pages**. The same build serves the app and its
  `/api/*` proxy (`@sveltejs/adapter-cloudflare`).
- **Metadata goes through the proxy; audio does not.** Search, details and lyrics hit
  `src/routes/api/[source]/[...path]` (CORS, retries, secrets kept server-side). Audio streams
  from each source's CDN straight to the browser, except YouTube Music on the web, which is
  proxied at the edge.
- **Source adapters**: a client adapter in `src/lib/sources/` and a proxy adapter in
  `src/lib/proxy/`, listed once in `src/lib/sources/registry.ts`. A new source = two files and one
  import; nothing else names a source.
- **Services** (`src/lib/services/`): fan-out search, de-dupe and best-match, discovery shelves,
  the cover chain, translation, downloads and tag writing (MP3 / M4A / FLAC).
- **Stores** (`src/lib/stores/`, Svelte 5 runes): player (one app-wide `<audio>`, queue,
  prefetch, sleep timer), library, history, settings — saved in the browser.
- **Shared bits** (comments, crowd cover picks, lyric offsets) live in a small R2 bucket
  (`DIAG`). Posting a comment needs a Turnstile check; cover votes and lyric offsets are throttled.
- **Android** is the same app as a static build inside **Capacitor**, calling
  `https://openmusic.lol/api/*`.

## Develop

Node 22 and pnpm.

```bash
pnpm install
pnpm dev          # Vite dev server
pnpm check        # svelte-check (strict TypeScript)
pnpm test         # Vitest
pnpm build        # production build → .svelte-kit/cloudflare
pnpm preview      # run the build with wrangler pages dev (secrets in .dev.vars)
pnpm health       # check the upstream sources are answering
```

## Android

Prerequisites: Node 22, **JDK 21** (`brew install openjdk@21`,
`export JAVA_HOME=/opt/homebrew/opt/openjdk@21`) and the Android SDK
(`export ANDROID_HOME=$HOME/Library/Android/sdk`). `android/local.properties` is local only.

```bash
pnpm apk    # static build (API base https://openmusic.lol) → cap sync → assembleDebug
adb install -r --user 0 android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.openmusic.app/.MainActivity
```

`--user 0` matters on Samsung phones with Secure Folder or dual apps. The APK calls the live
`/api/*`, so deploy the web app first when the API changes.

CI builds the APK on every push to `main` (the rolling `latest` release); `android-release.yml`
makes signed releases.

## Deploy

Pushes to `main` deploy to Cloudflare Pages (project `openmusic`) through Cloudflare's Git
integration. Set `JOOX_TOKEN` (required) and the optional Last.fm and translation keys in the
Pages dashboard. Setup, build settings, every variable and a manual fallback
(`pnpm run deploy`): [docs/DEPLOY.md](docs/DEPLOY.md).

## Notes

- The mainstream Chinese platforms and 5sing are reached through unofficial APIs with no
  guarantees; they can change or rate-limit at any time. Jamendo and Audius are open catalogs.
- All music rights belong to the artists and platforms. openmusic hosts no audio.
- Translation uses unofficial endpoints, best effort; originals are shown when it fails.
- Built with [GSD](https://github.com/glamboyosa/gsd); the roadmap and phase plans are in
  [`.planning/`](.planning/).

## Credits

openmusic started in June 2026 as a mobile interface for
[CharlesPikachu/musicsquare](https://github.com/CharlesPikachu/musicsquare), a single-file desktop
player whose source adapters were the porting reference for the first Chinese sources. It has
since been rebuilt from the ground up. The source list and several API conventions (e.g. 5sing
search parameters) were informed by
[CharlesPikachu/musicdl](https://github.com/CharlesPikachu/musicdl), used as a reference. Thanks to
both.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
