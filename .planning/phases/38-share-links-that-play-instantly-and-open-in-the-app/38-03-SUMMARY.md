---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 03
subsystem: infra
tags: [android, app-links, digital-asset-links, capacitor, cloudflare-pages, deep-links]

# Dependency graph
requires: []
provides:
  - "static/.well-known/assetlinks.json — Digital Asset Links statement for com.openmusic.app with the machine-local DEBUG SHA256 fingerprint"
  - "AndroidManifest.xml autoVerify VIEW intent-filter claiming https://openmusic.lol /song, /album, /artist"
affects: [38-08 release fingerprint checkpoint, 38 deep-link handler plans, android APK builds]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Android App Links verified via a static Pages asset (never the SvelteKit worker)"

key-files:
  created:
    - static/.well-known/assetlinks.json
  modified:
    - android/app/src/main/AndroidManifest.xml

key-decisions:
  - "Only the DEBUG fingerprint is committed; the release fingerprint is a human keytool step in plan 38-08 (D-22). No placeholder entry was added — a fake string in sha256_cert_fingerprints would break verification for the debug key too."
  - "Plain static/.well-known/ path used with no workaround route or _headers entry — RESEARCH §1 proved it survives both adapters and lands in _routes.json's exclude array."
  - "Host openmusic.lol ONLY, three pathPrefix values ONLY (D-23/D-24); pages.dev not claimed, whole host not claimed."
  - "https scheme only — shareOrigin() can never emit http."

patterns-established:
  - "Capacitor-generated android/ files follow their own 4-space indentation, not the project tab convention"

requirements-completed: [38-B]

# Metrics
duration: 8min
completed: 2026-09-20
---

# Phase 38 Plan 03: Android App Links static halves Summary

**Ships the Digital Asset Links statement for `com.openmusic.app` (debug fingerprint) and the `autoVerify` VIEW intent-filter claiming `https://openmusic.lol` `/song`, `/album`, `/artist` — the two static halves the OS needs before any deep-link handler can run.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-20
- **Completed:** 2026-09-20
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `static/.well-known/assetlinks.json` created with the REAL debug SHA256 read from this machine's `~/.android/debug.keystore` this session — it matched RESEARCH §2a byte for byte, so no discrepancy to report.
- Proved the pipeline on this tree, not just in research: `pnpm build` copies the file byte-identical into `.svelte-kit/cloudflare/.well-known/assetlinks.json` and `_routes.json` lists `"/.well-known/assetlinks.json"` under `exclude` (Pages serves it as a static asset; the SvelteKit worker never sees it).
- MainActivity now carries a second `<intent-filter android:autoVerify="true">` with VIEW + DEFAULT + BROWSABLE and exactly three `https://openmusic.lol` path prefixes, preceded by a decision-record comment covering D-23/D-24/D-26, the per-HOST verification subtlety, the `/song` vs `/songbook` prefix hazard, and the https-only rationale.
- Nothing else in the manifest moved: the MAIN/LAUNCHER block at lines 20-23 is byte-identical (md5 `fece1b9446dd36e1314a978400ea0082` before and after), the `<provider>` and every `<uses-permission>` are untouched, and no tab characters were introduced.

## Task Commits

1. **Task 1: Create static/.well-known/assetlinks.json with the debug fingerprint** — `3e3f35d` (feat)
2. **Task 2: Add the autoVerify VIEW intent-filter to MainActivity** — `4bf94c1` (feat)

## Files Created/Modified

- `static/.well-known/assetlinks.json` — Digital Asset Links statement: one `delegate_permission/common.handle_all_urls` entry for `android_app` / `com.openmusic.app` with a single SHA256 fingerprint. 2-space indent, trailing newline.
- `android/app/src/main/AndroidManifest.xml` — +23 lines inside the existing `<activity .MainActivity>`, after the MAIN/LAUNCHER filter: the App Links comment block and the `autoVerify` intent-filter. 4-space indent to match the file.

## Verification Performed (observed output, not inferred)

| Check | Observed |
|---|---|
| `keytool -list -v ~/.android/debug.keystore` | `SHA256: 37:30:88:C4:7F:83:64:6F:83:D8:B3:C7:E1:58:FB:37:F5:8D:17:7C:1B:27:00:3F:BF:1A:5E:AD:87:EB:8D:A2` — identical to RESEARCH §2a |
| JSON shape assertion (array, package_name, relation, namespace, 1 fingerprint matching `^([0-9A-F]{2}:){31}[0-9A-F]{2}$`) | exit 0, printed `JSON SHAPE OK` |
| `pnpm build` | `✓ built in 6.66s`, `Using @sveltejs/adapter-cloudflare ✔ done` |
| `cmp static/… .svelte-kit/cloudflare/…` | exit 0 |
| `grep -c '"/.well-known/assetlinks.json"' _routes.json` | `1` |
| `git status --short static/` | only `?? static/.well-known/` |
| `xmllint --noout AndroidManifest.xml` | exit 0 |
| intent-filter / autoVerify / pathPrefix / BROWSABLE / LAUNCHER counts | `2 / 1 / 3 / 1 / 1` |
| DEFAULT category / `pages.dev` / tab chars / `scheme="http"` | `1 / 0 / 0 / 0` |
| `android:host="openmusic.lol"` and `android:scheme="https"` | `3` each (one per `<data>`) |
| MAIN/LAUNCHER block `sed -n 20,23p \| md5` | unchanged |

**Not verified here (out of scope for this plan):** on-device App Links verification. It cannot succeed until `assetlinks.json` is live on `openmusic.lol` (RESEARCH §1 ordering hazard — the JSON must be deployed BEFORE an APK carrying the filter is installed, because Android ≤14 verifies at install/update time only). This plan deliberately does not push.

## Decisions Made

- **No release-fingerprint placeholder.** The plan allowed an obviously non-functional slot; I shipped a single-element array instead. A junk string inside `sha256_cert_fingerprints` is not inert — Google's verifier rejects the whole statement on a malformed entry, which would break the debug key too. Plan 38-08 appends a second array element, a one-line diff either way.
- **No JSON comment carrier.** JSON cannot hold comments, so the "this is a MACHINE-LOCAL debug key; other developers' `pnpm apk` builds will not verify" note lives in the task-1 commit message and here, as the plan directed.
- **`singleTask` grep returns 2, not 1** — the second hit is my comment referencing it (38-D-26). The attribute itself is still declared exactly once on MainActivity.

## Deviations from Plan

None — plan executed exactly as written. (The release-fingerprint choice above is a selection among options the plan explicitly offered, not a deviation.)

## Assumption Drift (advisory)

None material.

## Issues Encountered

None.

## Threat Flags

None — no new network endpoint, auth path, or schema. The one new trust boundary (the OS verifier reading `assetlinks.json`) is the plan's own T-38-05 and is served from our https origin with the SHA256 pinning the signing identity.

## User Setup Required

None in this plan. Two follow-ups are already scheduled elsewhere in the phase:
- The release SHA256 must be produced by the user with `keytool` against the release keystore and appended (plan 38-08, D-22).
- `assetlinks.json` must be deployed to `openmusic.lol` before any APK carrying this intent-filter is installed.

## Next Phase Readiness

- The static halves are in place; a deep-link handler plan can now assume the OS will route `https://openmusic.lol/song|album|artist/*` into MainActivity once the JSON is live and a correctly-signed APK is installed.
- Reminder for whoever cuts the next APK: RESEARCH §1 also notes the service worker now precaches the 171-byte file (harmless) and that `aaptOptions.ignoreAssetsPattern` strips dot-directories from the APK (correct — verification fetches from the web host, not the APK). Neither needs a fix.

---
*Phase: 38-share-links-that-play-instantly-and-open-in-the-app*
*Completed: 2026-09-20*
