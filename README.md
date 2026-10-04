<p align="center">
  <img src="static/og.svg" alt="openmusic" width="640">
</p>

<h1 align="center">openmusic 🎧</h1>

<p align="center">
  <b>One search box. Eight music catalogs. Zero tab-hopping.</b><br>
  Tap a song, it plays. Lock your phone, it keeps playing.
</p>

<p align="center">
  <a href="https://openmusic.lol"><img alt="Open the web app" src="https://img.shields.io/badge/web-openmusic.lol-8b5cf6?style=for-the-badge"></a>
  <a href="https://github.com/hectorchanht/openmusic/releases/latest/download/openmusic-main.apk"><img alt="Download the Android APK" src="https://img.shields.io/badge/android-download%20APK-3ddc84?style=for-the-badge&logo=android&logoColor=white"></a>
  <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-555?style=for-the-badge"></a>
</p>

---

## ✨ The 30-second tour

🔎 **Search everything at once.** NetEase, QQ, Kuwo, JOOX, 5sing, Jamendo, Audius and YouTube Music,
all in one go. Duplicates get merged, and the best-quality copy wins.

🏠 **A home that knows what's hot.** Deezer's top hits, Last.fm shelves by genre and country,
and a see-all page behind every shelf. Rearrange it however you like.

▶️ **Music that doesn't stop.** A source goes down? It quietly tries another. The next song is
already loading. Up Next refills itself with songs that sound alike.

🎤 **Lyrics that behave.** Synced, scrolling, and polite enough to stop when you touch them.
Wrong lyrics? Pick others. Off by a beat? Nudge them, and everyone gets the fix.

🌏 **Read it in your language.** Translate the title, artist, lyrics and tags, each into a
different language if you like. 简 ↔ 繁 is built in.

💾 **Take it with you.** Download songs or whole albums, tagged with cover and lyrics, and play
them offline.

🖼️ **Covers by the crowd.** Real artwork from Deezer, then iTunes, then the Chinese platforms.
Ugly cover? Vote for a better one.

💬 **Talk about it.** Every song has its own comments.

😴 **Fall asleep to it.** Sleep timer with a gentle fade-out. Lock-screen controls on Android.

🗣️ **Speaks 15 languages.** English, 繁體中文, 简体中文, Español, Français, Deutsch, Português,
Italiano, Русский, Türkçe, العربية, हिन्दी, Bahasa Indonesia, Tiếng Việt and ไทย.

## 🎼 Where the music comes from

| Source | What you'll find | How we reach it |
|---|---|---|
| NetEase · QQ · Kuwo · JOOX | The big Chinese platforms | Unofficial third-party APIs |
| 5sing | Fan covers and backing tracks | Unofficial |
| Jamendo | Creative Commons indie | Open catalog |
| Audius | Indie and electronic on a decentralized network | Open network |
| YouTube Music | A bit of everything | Anonymous, no account (and never used for downloads) |

Every source can be switched on or off in **Settings → Playback**.

## 🛠️ How it's built

```
           ┌──────────── your phone / browser ────────────┐
           │  SvelteKit app · one <audio> · library saved │
           └─────────┬───────────────────────┬────────────┘
       search, lyrics│                       │ the actual music
                     ▼                       ▼
        openmusic.lol/api/*            each source's CDN
     (Cloudflare Pages proxy)         (straight to you)
```

- **SvelteKit 2 + Svelte 5** on **Cloudflare Pages**. The app and its `/api/*` proxy ship in
  one build.
- **Only metadata goes through the proxy.** Audio streams straight from each source's CDN.
  (YouTube Music on the web is the one exception: it's proxied at the edge.)
- **Adding a source = two files + one import.** A client adapter in `src/lib/sources/`, a proxy
  adapter in `src/lib/proxy/`, one line in `registry.ts`. Nothing else knows source names.
- **Android** is the same app in a **Capacitor** shell, talking to `https://openmusic.lol/api/*`.

<details>
<summary><b>Peek inside <code>src/lib</code></b></summary>

- `services/`: fan-out search, de-dupe and best match, discovery shelves, the cover chain,
  translation, downloads and tag writing (MP3 / M4A / FLAC).
- `stores/` (Svelte 5 runes): player (queue, prefetch, sleep timer), library, history and
  settings, all saved in the browser.
- Comments, crowd cover picks and lyric offsets live in a small R2 bucket (`DIAG`). Posting a
  comment needs a Turnstile check; cover votes and lyric offsets are throttled.

</details>

## 🚀 Run it yourself

You'll need **Node 22** and **pnpm**.

```bash
pnpm install
pnpm dev          # start hacking
pnpm test         # Vitest
pnpm check        # strict TypeScript via svelte-check
pnpm health       # are the music sources still answering?
```

<details>
<summary><b>More commands</b></summary>

```bash
pnpm build        # production build → .svelte-kit/cloudflare
pnpm preview      # run that build locally (secrets go in .dev.vars)
```

</details>

<details>
<summary><b>📱 Build the Android app</b></summary>

You need **JDK 21** (`brew install openjdk@21`, then
`export JAVA_HOME=/opt/homebrew/opt/openjdk@21`) and the Android SDK
(`export ANDROID_HOME=$HOME/Library/Android/sdk`).

```bash
pnpm apk    # static build → cap sync → assembleDebug
adb install -r --user 0 android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.openmusic.app/.MainActivity
```

- On Samsung phones with Secure Folder or dual apps, keep `--user 0`.
- The APK uses the live `/api/*`, so deploy the web app first if you changed the API.
- Too lazy to build? CI publishes a fresh APK on every push to `main`
  ([latest release](https://github.com/hectorchanht/openmusic/releases/latest)).

</details>

<details>
<summary><b>☁️ Deploy</b></summary>

Push to `main` and Cloudflare Pages deploys it (project `openmusic`). Set `JOOX_TOKEN` (required)
plus the optional Last.fm and translation keys in the Pages dashboard. Full setup and a manual
fallback (`pnpm run deploy`): [docs/DEPLOY.md](docs/DEPLOY.md).

</details>

## 🙋 The fine print

- The big Chinese platforms and 5sing are reached through unofficial APIs. They can change or
  slow down whenever they like, and sometimes they do.
- openmusic hosts no audio. All music belongs to its artists and platforms.
- Translations are best effort. If one fails, you get the original.

## 💜 Credits

openmusic began in June 2026 as *"what if [musicsquare](https://github.com/CharlesPikachu/musicsquare)
had a nicer mobile UI?"* It got a little carried away and was rebuilt from the ground up, but
musicsquare's source adapters showed the way for the first Chinese sources.
[musicdl](https://github.com/CharlesPikachu/musicdl) was the reference for the source list and
several API conventions. Thank you, CharlesPikachu!

Built with [GSD](https://github.com/glamboyosa/gsd); the roadmap lives in
[`.planning/`](.planning/).

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE).
