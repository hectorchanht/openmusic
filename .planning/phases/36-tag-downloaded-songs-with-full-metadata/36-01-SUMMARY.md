---
phase: 36-tag-downloaded-songs-with-full-metadata
plan: 01
subsystem: infra
tags: [node24, taglib-wasm, wasm, toolchain, pnpm, engine-strict, licensing, cloudflare-pages]

# Dependency graph
requires: []
provides:
  - Node 24 toolchain pinned across .nvmrc, package.json engines, and all three GitHub workflows
  - taglib-wasm 2.2.2 installed as an exact-pinned runtime dependency (the app's first tag codec)
  - TagLib LGPL-2.1 / MPL-1.1 attribution + licence link on the About page
affects: [36-02, 36-03, 36-04, 36-05]

# Tech tracking
tech-stack:
  added: [taglib-wasm@2.2.2, "@msgpack/msgpack@3.1.3 (transitive)"]
  patterns:
    - "Exact-pin (no caret/tilde) for any opaque binary dependency"
    - "Toolchain bumps gated on a full install/check/test/build BEFORE any feature code"
    - "Third-party licence notices live in the literal-English About page features list, not i18n"

key-files:
  created: []
  modified:
    - .nvmrc
    - package.json
    - pnpm-lock.yaml
    - .github/workflows/android-main.yml
    - .github/workflows/android-release.yml
    - .github/workflows/upstream-health.yml
    - src/routes/(app)/settings/about/+page.svelte

key-decisions:
  - "Bumped the toolchain to Node 24 rather than disabling engine-strict or vendoring the wasm: packageExtensions cannot override engines, and engine-strict=true correctly caught a real mismatch, so weakening it would hide future ones."
  - "Pinned taglib-wasm at exactly 2.2.2 with no range — a routine `pnpm update` must never swap a 686 kB opaque wasm binary unreviewed. NEVER auto-bump: a wasm version change is a review event requiring a fresh legitimacy round-trip."
  - "Kept .npmrc engine-strict=true unchanged."
  - "Fulfilled TagLib's weak-copyleft notice obligation on the About page because the npm tarball ships only the wrapper's MIT LICENSE and omits TagLib's COPYING.LGPL/COPYING.MPL. The wasm is consumed unmodified, so no contribute-back obligation attaches."

patterns-established:
  - "Toolchain gate: a Node major bump lands as its own commit with install+check+test+build green and zero feature code, so a later failure is unambiguously attributable."
  - "Dependency lands before its call sites: taglib-wasm is installed and smoke-imported but no app source imports it until 36-02's dynamic import."

requirements-completed: [D-01, D-04]

# Metrics
duration: 9min
completed: 2026-09-13
---

# Phase 36 Plan 01: Node 24 Toolchain + taglib-wasm Dependency Summary

**Node 24 pinned across .nvmrc / engines / all 3 CI workflows with a green install-check-test-build gate, unblocking taglib-wasm@2.2.2 at an exact pin plus its TagLib LGPL/MPL attribution.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-13T19:08:20Z
- **Completed:** 2026-09-13T19:17:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Cleared the one hard blocker for Phase 36: `taglib-wasm@2.2.2` declares `engines.node >= 24` and this repo runs `engine-strict=true`, so `pnpm add` failed on Node 22. The toolchain now says 24 everywhere Cloudflare Pages and GitHub Actions read it.
- Proved the Node 24 bump is safe with a four-command gate run *before* any tagging code existed, so any later breakage cannot be blamed on the toolchain.
- Installed the app's first-ever tag codec at an exact pin, with the supply-chain risk explicitly bounded (no range, lockfile committed, CI already runs `--frozen-lockfile`).
- Discharged the TagLib notice obligation the npm tarball leaves unfulfilled.

## Verification Evidence (observed, not assumed)

Task 1 gate, all four commands run in order on Node 24 (local shell `node v25.9.0`, which satisfies `>=24`):

| Command | Exit | Observed output |
|---|---|---|
| `pnpm install` | 0 | "Lockfile is up to date, resolution step is skipped / Already up to date", `svelte-kit sync` ran |
| `pnpm check` | 0 | `COMPLETED 4439 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| `pnpm test` | 0 | `Test Files 115 passed (115)` · `Tests 2117 passed (2117)` · 8.94s |
| `pnpm build` | 0 | `✓ built in 6.26s` · `Using @sveltejs/adapter-cloudflare ✔ done` · `.svelte-kit/cloudflare` exists |

**`pnpm build` on Node 24: PASSED.** No SvelteKit / adapter-cloudflare / wrangler incompatibility surfaced, so the RESEARCH fallback (vendor the wasm) is not needed.

Task 2:

- `pnpm add taglib-wasm@2.2.2` exit 0 — `Packages: +2` (`taglib-wasm 2.2.2` + `@msgpack/msgpack 3.1.3`).
- `package.json` contains the literal `"taglib-wasm": "2.2.2"`; the `grep` for a `^`/`~` on that entry returns nothing.
- `pnpm-lock.yaml` contains `/taglib-wasm@2.2.2(typescript@5.9.3):` and `/@msgpack/msgpack@3.1.3:`.
- Smoke import: `node -e "import('taglib-wasm/simple').then(m => process.exit(typeof m.readFormat === 'function' ? 0 : 1))"` **exit 0** — the module resolves and exposes `readFormat`.
- `grep -rl "from 'taglib-wasm" src/` returns nothing — no static import anywhere in app source, as required.
- About page contains `TagLib`, `LGPL-2.1`, `MPL-1.1`, `https://github.com/taglib/taglib`, and the `// 36-D-01` comment.
- **`pnpm check` after Task 2 exited 1 with 2 errors — both in a file this plan never touched.** See "Issues Encountered". Zero errors were reported in any 36-01 file.

## Task Commits

1. **Task 1: Bump the project toolchain to Node 24 and gate it** — `fbb556b` (chore)
2. **Task 2: Add taglib-wasm at an exact pin + TagLib licence attribution** — `8db38a3` (feat)

## Files Created/Modified

- `.nvmrc` — `22` → `24`. Cloudflare Pages reads this for its build image.
- `package.json` — `engines.node` `">=22"` → `">=24"`; `taglib-wasm: "2.2.2"` added to `dependencies`.
- `pnpm-lock.yaml` — gained `taglib-wasm@2.2.2` and its single transitive dep `@msgpack/msgpack@3.1.3`.
- `.github/workflows/android-main.yml`, `android-release.yml`, `upstream-health.yml` — `node-version: 22` → `24` (one occurrence each; zero `node-version: 22` remain).
- `src/routes/(app)/settings/about/+page.svelte` — `Tag` added to the existing per-icon `@lucide/svelte` import; `TAGLIB` const; a TagLib entry in the literal `features` array above a 4-line `// 36-D-01` comment explaining the weak-copyleft notice obligation; an `.item link` row "TagLib licence (LGPL / MPL)" → `https://github.com/taglib/taglib`. No i18n keys — this page is literal English by design.
- `.npmrc` — **deliberately untouched**; `engine-strict=true` stays.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one for future maintainers:

> **NEVER auto-bump `taglib-wasm`.** It is pinned at exactly `2.2.2` with no range. A version change swaps a ~686 kB opaque WebAssembly binary in the deployed supply chain (T-36-01) and is a *review event*: it requires a fresh legitimacy check, not a `pnpm update`. If review ever fails, the documented escape hatch is vendoring the wasm artefact into the repo.

## Deviations from Plan

None - plan executed exactly as written.

## Assumption Drift (advisory)

**1. `pnpm add` pinned exactly without a follow-up edit**
- **Found during:** Task 2
- **Planned:** run `pnpm add taglib-wasm@2.2.2` *then* edit `package.json` to strip a caret/tilde.
- **Actual:** pnpm wrote `"taglib-wasm": "2.2.2"` verbatim; no strip edit was needed.
- **Why it matters:** the required end state (exact pin, no range) was verified and holds. Noting it only so a future reader does not hunt for a "strip the caret" edit that never had to happen.

## Issues Encountered

**`pnpm check` is red on main from a concurrent phase — not from this plan, and deliberately not fixed here.**

After Task 2, `pnpm check` exited 1 with exactly 2 errors, both in `src/lib/backup/backup-logic.test.ts`:

```
24:8  Cannot find module './backup-logic' or its corresponding type declarations.
87:48 Parameter 'i' implicitly has an 'any' type.
```

That file is Phase 35's committed TDD **RED** test (`28d85a8 test(35-01): add failing tests for the backup envelope codec`); its `backup-logic.ts` implementation does not exist yet, which is the correct state for a RED gate. It landed on `main` from the concurrently-executing Phase 35 session *between* this plan's two check runs — Task 1's check saw **4439 files / 0 errors**, Task 2's check saw **4440 files / 2 errors**, and the one added file is that test.

Per the scope boundary this was logged, not fixed: `.planning/phases/36-tag-downloaded-songs-with-full-metadata/deferred-items.md`. Owner is Phase 35's GREEN plan. **Do not treat a red `pnpm check` from `src/lib/backup/**` as a Phase 36 regression.** Everything 36-01 touched is clean.

## User Setup Required

**One human dashboard action, non-blocking.**

Cloudflare Pages reads `.nvmrc` (now `24`) for its build image, which should be sufficient on its own. Belt-and-braces, the Pages project should *also* carry a `NODE_VERSION=24` environment variable:

> Cloudflare dashboard → Pages → project `openmusic` → Settings → Environment variables → set `NODE_VERSION` to `24` for Production **and** Preview.

This cannot be done from the repo, and local `wrangler` auth has no access to this Cloudflare account, so neither the executor nor the orchestrator can perform it. It was **not** treated as a blocker (RESEARCH A8).

Related deploy exposure, accepted by the user in advance: this repo auto-deploys production from `main` via the Pages native Git integration. The commits from this plan were **not** pushed by the executor. Whoever pushes should watch the first Pages build for a Node-24 image failure; the local four-command gate passed on Node 24, so the expected outcome is green.

## Next Phase Readiness

- **Wave 2 is unblocked.** `taglib-wasm` installs, resolves, and exposes `readFormat`; 36-02 can wire it behind a dynamic import.
- No app source imports the package yet, so the bundle is unchanged and nothing ships the wasm to users until 36-02 deliberately does.
- Carry forward into 36-02: the wasm must stay behind a *dynamic* import (a static one would pull ~686 kB into the main bundle), and `pnpm check` will remain red from `src/lib/backup/**` until Phase 35 lands its GREEN implementation.

---
*Phase: 36-tag-downloaded-songs-with-full-metadata*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 6 claimed files exist on disk; both task commits (`fbb556b`, `8db38a3`) exist in git.
