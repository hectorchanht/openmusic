---
quick_id: 260704-3df
slug: resync-stale-gsd-managed-blocks-in-claud
subsystem: docs / GSD-managed context files
status: complete
completed: 2026-07-04
commit: 4496315
files_modified:
  - CLAUDE.md
  - AGENTS.md
---

# Quick Task 260704-3df: Resync stale GSD-managed blocks in CLAUDE.md + AGENTS.md — Summary

Resynced the stale GSD-managed context blocks in `CLAUDE.md` and `AGENTS.md` from the freshly-remapped `.planning/codebase/*.md` sources: replaced the `stack`, `conventions`, and `architecture` block bodies with condensed, accurate SvelteKit 5 (runes) + Vite + TypeScript + pnpm + vitest + Cloudflare content, and light-edited the `project` block to fix the dead `index.html` markdown link — all while preserving the GSD delimiter contract and the `skills`/`workflow`/`profile` blocks byte-for-byte.

## What Changed

**`project` block (light edit, both files):**
- Fixed the dead `([index.html](index.html))` markdown link (index.html no longer exists in the repo).
- Reframed index.html as "a vanilla-JS original that no longer lives in this repo" — a single historical origin mention, no live-app claim.
- Kept the SvelteKit/Cloudflare framing and the entire Constraints sub-block (git push as `hectorchanht` via `github-b`, etc.) intact.

**`stack` block (full body replace, both files):**
- Replaced the vanilla-HTML/GitHub-Pages/"no build step"/"no test framework" description with the real stack: TypeScript ~5.9 (strict, bundler resolution), Svelte 5.56.2 (forced runes), SvelteKit 2.63.0, Vite 8.0.16, pnpm 8.15.5, Vitest ^4.1.3 (~67 co-located test files, single node project), dual adapter (`adapter-cloudflare` default / `adapter-static` on `BUILD_TARGET=native`) + Capacitor 8.4.0 Android shell, Node >=22, Cloudflare Workers edge runtime, edge-only secrets (`JOOX_TOKEN`/`LASTFM_*`), and the real `pnpm dev/build/check/test/apk/deploy` command set.

**`conventions` block (full body replace, both files):**
- Replaced the IIFE/no-libraries description with: TS strict everywhere, forced Svelte 5 runes (`$state`/`$derived`/`$effect`/`$props`), the `.svelte.ts` runes-store vs `.ts` pure-logic split, plain-field vs `$state` guard convention, the generation-guard idiom, never-throw service pattern + soft-fail-flag pattern, `import type` / `$lib` aliasing, zero `as any` in prod source, SSR `browser` guards, the i18n double-quotes rule, and the high-comment-density house style with quick-task/decision-ref tagging.

**`architecture` block (full body replace, both files):**
- Replaced the ~120-line stale component table (all `index.html` line numbers) with the real layered architecture: routes → components → stores → services → sources → api proxies → upstreams; the single `<audio>` mounted at `+layout.svelte`; the `Track` colon-uid shape; the playContext/queue model; the three-family cover cache + Deezer→iTunes→CN chain + `healCover` self-heal; the `playGen`/`queueGen`/`pendingGen`/`fallbackGen` guards; the audio playback lifecycle; known-debt anti-patterns (god-object `player.svelte.ts`, oversized `NowPlaying.svelte`, cover-cache write duplication); and isolate-and-degrade error handling.

**Preserved byte-for-byte (both files):**
- `skills`, `workflow` (GSD Workflow Enforcement), and `profile` (Developer Profile) block bodies. Note: AGENTS.md's `skills`/`profile` blocks carry Codex-flavored references (`.Codex/skills/`, `generate-Codex-profile`) distinct from CLAUDE.md's Claude-flavored ones (`.claude/skills`, `generate-claude-profile`) — each file's own block was left exactly as it was.
- All 14 `<!-- GSD:*-start ... -->` / `<!-- GSD:*-end -->` delimiter lines (7 pairs per file), same markers, same order.

## Verification (actual results)

| Check | Command | Expected | Actual |
|-------|---------|----------|--------|
| index.html references | `grep -c "index.html" CLAUDE.md AGENTS.md` | ≤2 each | **1 each** (the intentional historical origin mention) |
| GSD start markers | `grep -c "GSD:.*-start" …` | 7 each | **7 each** |
| GSD end markers | `grep -c "GSD:.*-end" …` | 7 each | **7 each** |
| Forbidden phrases | `grep -niE "no build step\|github pages\|no test framework\|no build system"` | none | **none found** |
| Stale JOOX claim | `grep -niE "JOOX_TOKEN.*index\.html\|index\.html:2165\|f84ao9lMF"` | none | **none found** |
| Positive content | `grep` `player.svelte.ts` / `vitest` / `pnpm` / `adapter-cloudflare` | present | **all present, both files** |
| Preserved blocks | `git diff … \| grep GSD:skills/workflow/profile bodies` | no edits | **no changes touched skills/workflow/profile lines** |
| Delimiter integrity | `git diff … \| grep "<!-- GSD:"` | none changed | **no delimiter lines changed** |
| Marker order | `grep -oE "GSD:[a-z]+-(start\|end)"` | project→stack→conventions→architecture→skills→workflow→profile | **exact order, both files** |

Baseline before edit was 74 `index.html` references each; now 1 each.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `4496315` — `docs(quick-260704-3df): resync stale GSD-managed blocks in CLAUDE.md + AGENTS.md` (2 files: CLAUDE.md, AGENTS.md; +314 / -356; no file deletions)

## Self-Check: PASSED

- `CLAUDE.md` — FOUND (modified, committed in 4496315)
- `AGENTS.md` — FOUND (modified, committed in 4496315)
- commit `4496315` — FOUND in `git log`
