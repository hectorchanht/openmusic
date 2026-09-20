---
phase: 38-share-links-that-play-instantly-and-open-in-the-app
plan: 08
subsystem: infra
tags: [android, app-links, digital-asset-links, release-signing, cloudflare-pages]

# Dependency graph
requires:
  - "38-03 — static/.well-known/assetlinks.json with the single DEBUG fingerprint"
provides:
  - "static/.well-known/assetlinks.json — two-entry sha256_cert_fingerprints covering BOTH the local debug key and the CI release keystore"
affects: [38-09 device App Links verification, android-main.yml rolling prerelease, android-release.yml signed releases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both signing identities listed in one Digital Asset Links statement — debug first, release second"

key-files:
  created: []
  modified:
    - static/.well-known/assetlinks.json

key-decisions:
  - "Release fingerprint was derived from a SIGNED RELEASE APK via `keytool -printcert -jarfile`, not from the keystore file directly (D-22). Same certificate either way — the provenance is recorded here so it can be re-derived without the keystore if needed."
  - "APPENDED as the second array element rather than replacing the debug entry: local `pnpm apk` debug builds must keep verifying alongside the installed release APKs."
  - "The keystore file and its passwords never entered the repo, a shell command, or shell history — only the PUBLIC fingerprint crossed the boundary (T-38-06 mitigated)."

patterns-established: []

requirements-completed: [38-B]

# Metrics
duration: 5min
completed: 2026-09-20
---

# Phase 38 Plan 08: Release cert fingerprint in assetlinks.json Summary

**`assetlinks.json` now carries BOTH signing identities — the machine-local debug key and the CI release keystore — so Android App Links verify for the APKs users actually install (rolling `latest` prerelease and `v*` releases), not just local debug builds.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-20
- **Completed:** 2026-09-20
- **Tasks:** 2 (Task 1 = human checkpoint, satisfied before this executor ran)
- **Files modified:** 1

## Accomplishments

- Release SHA256 `1B:70:46:…:82:34` appended as the SECOND element of `sha256_cert_fingerprints`. The debug entry from plan 03 is byte-identical and still first, so `pnpm apk` builds keep verifying.
- The diff is exactly 2 insertions / 1 deletion, all inside the fingerprints array — nothing else in the document moved (`relation`, `namespace`, `package_name` untouched).
- Validated by PARSING, not by eye: the plan's automated check (`JSON.parse` → array length 2 → both match `^([0-9A-F]{2}:){31}[0-9A-F]{2}$` → the two are distinct) passed.
- `pnpm build` succeeded (✓ built in 7.03s) and the two-fingerprint file lands byte-identical at `.svelte-kit/cloudflare/.well-known/assetlinks.json`, with `_routes.json` still listing `"/.well-known/assetlinks.json"` under `exclude` — Pages serves it as a static asset and the SvelteKit worker never sees it.
- Secret audit clean: `git grep -c "storepass" -- ':!*.md' ':!node_modules'` returns no occurrences; this plan introduced none.

## Task Commits

| Task | Name | Commit |
|------|------|--------|
| 1 | HUMAN — obtain release keystore SHA256 (D-22) | n/a — no file changes; user supplied the fingerprint |
| 2 | Append the release fingerprint and validate | `4473766` |

## Fingerprint Provenance (T-38-06)

The user did NOT have the keystore file to hand, so they used the sanctioned alternative from the
plan's `<how-to-verify>` step 3:

```
"$JAVA_HOME/bin/keytool" -printcert -jarfile "openmusic-main (1).apk" | grep -i 'SHA256:'
```

run against a downloaded **signed release APK**. This reads the certificate embedded in the APK — the
same certificate the `RELEASE_KEYSTORE` GitHub secret holds, so the fingerprint is identical to what
`-list -v -keystore` would print. Recording this because re-deriving it later does NOT require the
keystore: any signed release APK suffices.

No `-storepass` was passed on a command line, no keystore bytes and no password crossed into this
session or the repo. The fingerprint itself is public data — it is derivable from every shipped APK.

## Verification Performed

| Check | Command | Result |
|---|---|---|
| Fingerprint shape | regex `^([0-9A-F]{2}:){31}[0-9A-F]{2}$` on the pasted value | PASS (32 pairs, uppercase) |
| JSON valid + 2 distinct canonical entries | plan's `<verify><automated>` node one-liner | PASS (exit 0) |
| Diff scope | `git diff static/.well-known/assetlinks.json` | 2 insert / 1 delete, fingerprints array only |
| No secret material | `git grep -c "storepass" -- ':!*.md' ':!node_modules'` | no occurrences |
| Build ships the file | `pnpm build` + `cat .svelte-kit/cloudflare/.well-known/assetlinks.json` | both fingerprints present, byte-identical |
| Worker bypass preserved | `_routes.json` exclude array | `['/.well-known/assetlinks.json']` |
| No accidental deletions | `git diff --diff-filter=D HEAD~1 HEAD` | none |

`pnpm check` / `pnpm test` were NOT run: this plan changed one static JSON asset with no TypeScript,
Svelte, or test surface. The build (which is the gate that actually matters for a static asset) was
run instead and passed.

## Deviations from Plan

None — plan executed exactly as written. Task 1's human input was supplied before this executor
started, so the checkpoint was not re-raised.

## Known Stubs

None. `RELEASE_FINGERPRINT_PENDING` does NOT apply — the user supplied a real fingerprint rather than
answering "skip-release", so the file is complete for both signing identities.

## Notes for Plan 09

Plan 09 reads the OS-reported `Signatures:` from `pm get-app-links com.openmusic.app` and diffs it
against this JSON (T-38-05). The expected match on a **release**-signed install is
`1B:70:46:64:…:5A:05:82:34`; on a local `pnpm apk` **debug** install it is `37:30:88:C4:…:EB:8D:A2`.
A `verified` state requires the deployed `https://openmusic.lol/.well-known/assetlinks.json` to have
this commit live — this change is committed but NOT pushed, and pushing main auto-deploys production.

## Self-Check: PASSED

- `static/.well-known/assetlinks.json` exists with both fingerprints
- Commit `4473766` exists in git history
- This SUMMARY exists at the recorded path
