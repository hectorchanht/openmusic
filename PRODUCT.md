# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mobile-first web app / installable PWA, AND an Android APK. Both are first-class shipping targets. The APK is the same SvelteKit SPA in a Capacitor shell (Android WebView); it does not adopt a native design language, so the platform value stays `web`. Designs must still hold up inside the APK: system back gesture, edge-to-edge insets, lock-screen media controls, and Android's 48dp touch-target expectation.

## Users

Listeners worldwide, in many languages, who want one place to find and play a song no matter which catalog has it. Chinese-language music is a large share of the catalog, but it is not the whole audience: the UI ships in 15 languages and supports per-field translation (title, artist, lyrics, tags) and 简 ↔ 繁 conversion.

Primary situation: on a phone, often one-handed, often with the screen about to lock. Job: search a song, tap it, hear it immediately, and have the music keep going on its own.

## Product Purpose

openmusic searches many music catalogs at once (NetEase, QQ, Kuwo, Kugou, Migu, JOOX, 5sing, Bilibili, Jamendo, Internet Archive, Audius, YouTube Music), merges duplicates, picks the best-quality copy, and plays it. No account and no app-hopping.

Success: a tap leads to sound quickly, playback survives a screen lock, and when the queue runs out it refills with similar songs instead of stopping.

## Positioning

Two things together, and neither is enough without the other:

1. **One search box, every catalog.** Aggregation, de-duplication and best-copy selection across Chinese platforms and open/indie catalogs, with no account. A single-catalog service cannot truthfully claim this.
2. **Music that doesn't stop.** If a source fails, playback silently falls back to another one. The next track is already loading, and Up Next refills itself.

Aggregation is the means. "Tap it, it plays, it never stops" is what the user actually experiences.

## Operating Context

- Mobile browsers first (iOS Safari, Android Chrome), responsive up to desktop; installable PWA; Android APK with lock-screen media controls.
- Background audio and lock-screen playback are core to the product, not extras. iOS Safari background-audio and PWA quirks are known constraints.
- Typical flows: search → tap → play; browse the home shelves (Deezer top hits, Last.fm genre/country shelves, rearrangeable); library, downloads and offline play; synced lyrics; sleep timer.
- Community features: per-song comments (gated by Turnstile), crowd cover votes, shared lyric offset fixes.

## Capabilities and Constraints

- Sources are unofficial third-party APIs (Chinese platforms) plus open catalogs; upstream shapes change and outages happen without notice, so every surface has to degrade gracefully (partial results, gradient cover placeholder, fallback playback).
- Covers come from a chain: Deezer, then iTunes, then the Chinese platforms. A cover can always be missing, so every surface needs a non-image state.
- Lyrics: synced and scrolling, user-selectable alternatives, and adjustable offset.
- Downloads: songs and albums, tagged with cover and lyrics (MP3 / M4A / FLAC), playable offline.
- Translation of metadata and lyrics into a different language per field.
- Deployed on Cloudflare Pages + Workers (free/edge model); no third-party runtime UI dependencies beyond the icon set.
- Terminology: "Up Next", "source", "shelf", "library", "Now Playing".

## Brand Commitments

None binding. The current name styling (lowercase "openmusic"), the dark default (`#0b0b0f` in the manifest) and README's light, playful voice are what exists today, but the user has not committed to any of them.

## Evidence on Hand

- `README.md`: the product tour and source list.
- `static/og.svg`, `static/og.jpg`, `static/favicon.svg`, `static/icon-maskable.svg`, `static/icons/`: current logo and share art.
- Live app at https://openmusic.lol; Android APK on GitHub releases.
- No user testimonials, usage numbers, press, or reviews on hand. Do not invent any.

## Product Principles

1. **Tap means play.** Shorten the time between intent and sound; never put choices in front of the first play.
2. **Never stop.** Failure is handled quietly with a fallback, not shown as a dead end. Surface a notice only when the user has to act.
3. **Hide the plumbing.** Users care about the song, not which catalog it came from. Show source detail only where it helps a decision.
4. **Every language is first-class.** Layouts must hold up in long-word, CJK, RTL (Arabic) and Indic scripts, and in mixed-script titles.
5. **Thumb and lock screen first.** Design for one hand on a phone and for playback that continues off-screen.

## Accessibility & Inclusion

- RTL support is required (Arabic is a shipped locale).
- Respect reduced motion (tap feedback is already reduced-motion safe).
- Mixed-script and CJK text must stay legible and must not be truncated into meaninglessness.
