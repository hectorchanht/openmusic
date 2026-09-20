---
phase: 38
slug: share-links-that-play-instantly-and-open-in-the-app
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-20
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `38-RESEARCH.md` § Validation Architecture (all values verified in-session).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` — single `server` project, `environment: 'node'`, NO jsdom |
| **Config file** | `vite.config.ts` (`test.projects[0]`), `expect.requireAssertions: true` |
| **Quick run command** | `pnpm test -- <touched file>` (e.g. `pnpm test -- share-arrival.test.ts`) |
| **Full suite command** | `pnpm test` (`vitest --run`, ~67 files) |
| **Typecheck gate** | `pnpm check` (`svelte-kit sync && svelte-check`) — the ONLY lint gate in this repo |
| **Estimated runtime** | quick ~2-5s · full suite ~30-60s |

---

## Sampling Rate

- **After every task commit:** `pnpm test -- <touched file>` **and** `pnpm check`
- **After every plan wave:** `pnpm test` (full suite)
- **Before `/gsd:verify-work`:** full suite green + `pnpm check` clean, THEN the on-device checklist below
- **Max feedback latency:** ~60 seconds (full suite)

---

## Per-Behaviour Verification Map

Task IDs are filled in by the planner; the behaviour → command mapping is fixed here.

| Behaviour | Wave | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|---|---|
| uid carrier emit/parse round-trip | 1 | T-38-01 | closed-enum source allowlist; unknown source → `null` | unit | `pnpm test -- share.test.ts` | ✅ extend | ⬜ pending |
| `arrivalMode` cold/warm decision | 1 | — | N/A | unit | `pnpm test -- share-arrival.test.ts` | ❌ W0 | ⬜ pending |
| stub builder from a uid param | 1 | T-38-01 | never constructs a URL from the carrier | unit | `pnpm test -- share-arrival.test.ts` | ❌ W0 | ⬜ pending |
| deep-link URL → path, host allowlist | 1 | T-38-02 | off-host URL rejected before `goto()` | unit | `pnpm test -- share-arrival.test.ts` | ❌ W0 | ⬜ pending |
| `spliceAndPlay` keeps queue shape; no-ops on current uid | 2 | — | N/A | unit | `pnpm test -- player.svelte.test.ts` | ✅ extend | ⬜ pending |
| `armTrack` never plays; cold+EMPTY queue produces NO audio | 2 | — | N/A (D-06 correctness) | unit | `pnpm test -- player.svelte.test.ts` | ✅ extend | ⬜ pending |
| i18n key parity for the new toast key | 2 | — | N/A | unit | `pnpm test -- i18n.test.ts` | ✅ automatic | ⬜ pending |
| `assetlinks.json` reachable + correct content-type | 3 | T-38-05 | https, own origin, no redirect | manual | `curl -i https://openmusic.lol/.well-known/assetlinks.json` | manual | ⬜ pending |
| App Links verified on device | 3 | T-38-02 | host+prefix restricted intent-filter | manual | `adb shell pm get-app-links com.openmusic.app` | manual | ⬜ pending |
| Cold-start deep link opens the app (NOT just warm) | 3 | — | `getLaunchUrl()` path exercised | manual | `adb shell am start -a android.intent.action.VIEW -d …` | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/share-arrival.test.ts` — the pure seam: `arrivalMode`, uid-stub builder, deep-link URL parse + host allowlist
- [x] No framework install needed — Vitest already configured
- [x] No new fixtures needed

---

## Manual-Only Verifications

Android App Links cannot be verified from the web build. These require a deployed
`assetlinks.json` AND a signed APK, so they are a human checkpoint, not an executor task.

| Behavior | Why Manual | Test Instructions |
|---|---|---|
| Release SHA256 fingerprint is correct | The release keystore is a GitHub secret, not on this machine (D-22) | User runs `keytool -list -v -keystore <release.keystore> -alias <alias>` and pastes the SHA256 |
| `assetlinks.json` served correctly in prod | Needs a real deploy | `curl -i https://openmusic.lol/.well-known/assetlinks.json` → expect `200`, `content-type: application/json`, no redirect |
| Android verifies the link association | OS-level, post-install | `adb shell pm get-app-links com.openmusic.app` → expect `verified` for `openmusic.lol` |
| Deep link opens the app — WARM (already running) | Device/emulator only | `adb shell am start -a android.intent.action.VIEW -d "https://openmusic.lol/song/…"` with the app open |
| Deep link opens the app — COLD (not running) | Device/emulator only; exercises `getLaunchUrl()`, a DIFFERENT code path from `appUrlOpen` | force-stop the app first, then the same `am start` |
| Instant-play felt latency | Perceptual | Tap a shared link on a device, confirm sound is immediate |

Emulator available: `Pixel_3a_API_34` AVD. `pnpm apk` requires `JAVA_HOME` set to Homebrew `openjdk@21`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`share-arrival.test.ts`)
- [ ] No watch-mode flags (`pnpm test` is `vitest --run`; do NOT use `pnpm test:unit`)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
