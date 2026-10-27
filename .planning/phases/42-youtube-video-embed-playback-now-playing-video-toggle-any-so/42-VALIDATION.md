---
phase: 42
slug: youtube-video-embed-playback-now-playing-video-toggle-any-so
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-04
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 42-RESEARCH.md "## Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.3 — single node project, no jsdom (`*.svelte.test.ts` runs runes headless) |
| **Config file** | `vite.config.ts` (`test.projects[0]`, `requireAssertions: true`) |
| **Quick run command** | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm exec vitest --run <touched test files>` |
| **Full suite command** | `PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH pnpm test && pnpm check` |
| **Estimated runtime** | ~25 s full suite; ~2 s per touched file |

Known flake (unrelated): `src/lib/services/device-filename.test.ts` "catastrophically-backtracking pattern … bounded" times out under full-suite load; passes alone. Re-run alone before treating as red.

---

## Sampling Rate

- **After every task commit:** quick run command on the touched test files
- **After every plan wave:** full suite command
- **Before `/gsd:verify-work`:** full suite green + VID-05 probe result recorded + human device checklist (VID-04)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Task IDs are filled by the planner; requirement rows are the contract.

| Requirement | Behavior | Threat Ref | Test Type | Automated Command | File Exists | Status |
|-------------|----------|------------|-----------|-------------------|-------------|--------|
| VID-02 | `parseSearchRows` exposes `musicVideoType`; `parseSearchEnvelope` output unchanged | — | unit | `pnpm exec vitest --run src/lib/sources/ytmusic.test.ts` | ✅ extend | ⬜ pending |
| VID-02 / VID-06 | `pickVideoIds`: OMV>UGC, ATV excluded (art tracks search for the MV), CJK `【】` title match without `norm()`, variant rejection, artist alias, duration tie-break, invalid id dropped, top-3 | T-42-01 | unit | `pnpm exec vitest --run src/lib/services/yt-video.test.ts` | ❌ W0 | ⬜ pending |
| VID-02 | cache hit/miss TTLs, cap, hostile values rejected (VIDEO_ID regex on read), node no-localStorage no-throw; same search URL as name-rescue | T-42-01 | unit | same file | ❌ W0 | ⬜ pending |
| VID-01 | external-engine seam: attach pauses `<audio>` deliberately + disarms stall; toggle/seek/Media Session route to engine; stale engine callbacks ignored; `play()` drops the engine; video mode ends on track change | — | unit | `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts -t "external engine"` | ✅ extend | ⬜ pending |
| VID-01 | engine `ended` → shared `onTrackEnded` (sleep-stop > repeat-one > next); engine `playing` resets failure counters | — | unit | same | ✅ extend | ⬜ pending |
| VID-01 | sleep-timer expiry in engine mode pauses the engine | — | unit | same | ✅ extend | ⬜ pending |
| VID-03 / VID-07 | after `loadRetries`: foreground web ytmusic → embed fallback + Now Playing expanded + no `runFallback`; hidden → `runFallback`; non-ytmusic unchanged; once per uid; embed failure → `runFallback` | — | unit | `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts -t "loadRetries"` | ✅ update L~6358 test | ⬜ pending |
| VID-04 | hand-back: detach at t with play → `<audio>` seated at t and playing; rejected `play()` leaves `playing=false` + metadata written | — | unit | same | ✅ extend | ⬜ pending |
| VID-08 | position sync only when |videoDur − songDur| ≤ 8 s, else video from 0 / audio from its own position | — | unit | yt-video / player test | ❌ W0 | ⬜ pending |
| VID-09 / i18n | new keys (video toggle, errors, ToS/Privacy links) in all locales, double quotes | — | unit | `pnpm exec vitest --run src/lib/i18n/i18n.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/sources/__fixtures__/ytmusic-search-merged.json` — one real `{ytmusicMerged:[songs,videos]}` capture each for a CJK and a Latin query, from the LOCAL dev route (residential IP), one request each — never a burst against prod/edge
- [ ] `src/lib/services/yt-video.test.ts` — stubs for VID-02 / VID-06 / VID-08
- [ ] VID-05 emulator probe (debug APK on `https://localhost`: embed plays vs error 152/153) — decides embed vs device-side HLS before any APK-specific work (`pnpm apk` with JAVA_HOME=openjdk@21, Pixel_3a_API_34 AVD + CDP)

*No framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Embed renders ≥200×200 in the cover slot, nothing overlays it, autoplay on Chrome, position hand-off, 101/150 → next candidate, collapse → audio resumes | VID-01, VID-03, VID-07 | Real IFrame API + real YouTube; the Browser pane is hidden (rAF frozen) so transitions/visibility autoplay are unreliable there | Dev server in Chrome (or the pane with a forced render): toggle Video on a CN song and a YT song; force an embedding-disabled id; collapse Now Playing |
| Lock/background hand-back to `<audio>` | VID-04 | Needs a real device lock screen | Android Chrome (emulator power key) + iOS Safari + installed PWA: play video, lock → audio continues (or pauses on iOS with the 2026-09-30 WebKit rule) at the video's position; unlock → stays on audio |
| APK video path | VID-05 | Needs the APK WebView | Wave-0 probe result recorded in SUMMARY; then the chosen path plays on the emulator |
| Settings → About ToS/Privacy links | VID-09 | Visual | Links open youtube.com/t/terms and policies.google.com/privacy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
