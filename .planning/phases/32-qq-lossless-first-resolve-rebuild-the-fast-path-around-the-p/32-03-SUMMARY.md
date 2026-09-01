---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 03
status: complete-with-deferral
subsystem: planning-notes / phase-verification-criteria
tags: [measurement, latency, rtt, deferred, unverified, verification-criteria, qq, tang]
requires:
  - ".planning/notes/qq-lossless-first-resolve.md — the US-sandbox 'Measured' table whose caveat this plan was written to discharge"
provides:
  - "an on-record DEFERRED/UNVERIFIED status for the real-device tang RTT — the absence of the measurement is now an artifact, not a silent gap"
  - "the restated Phase 32 verification criterion: 'lossless by default with NO ADDED latency versus Phase 31', replacing the ROADMAP's absolute 'tap→audio in under a second'"
  - "a reproducible discharge procedure (two URLs, cold/warm, network type) that needs no phase re-run"
affects:
  - "/gsd:verify-work for Phase 32 — it MUST read the restated criterion from here and must NOT pass or fail the phase on the absolute sub-second number"
  - "ROADMAP.md Phase 32 headline — restatement stays PROVISIONAL until the measurement is taken (this plan deliberately did not edit ROADMAP wording)"
tech-stack:
  added: []
  patterns:
    - "record the ABSENCE of a measurement as a first-class artifact, so a missing number cannot be mistaken for a met bar"
    - "when a goal is unfalsifiable without an untaken measurement, restate the criterion to something falsifiable rather than letting verification guess"
key-files:
  created:
    - .planning/phases/32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p/32-03-SUMMARY.md
  modified:
    - .planning/notes/qq-lossless-first-resolve.md
decisions:
  - "user replied 'cannot measure now' to the Task 1 checkpoint; per the plan's own <resume-signal> that defers the measurement with the phase headline treated as UNVERIFIED — the checkpoint was NOT re-presented"
  - "the note's new table lists every row as NOT MEASURED rather than being omitted — an empty section would read as 'nothing to see', a table of explicit blanks reads as 'four numbers are owed'"
  - "verification criterion restated to 'no ADDED latency versus Phase 31' because the absolute sub-second number is unfalsifiable without the phone-side RTT; verification must not pass OR fail on an unfalsifiable bar"
  - "32-D-20's warm url path (Phase-31-measured 0.44s to playable, zero tang calls) recorded as the forward pointer — it is the only sub-second route that survives a bad measurement, so a pessimistic reading does not invalidate the phase"
  - "ROADMAP.md left untouched per the plan's explicit instruction; the restatement is carried in the note + this summary until a real number makes it permanent"
metrics:
  duration: ~4 min
  completed: 2026-08-31
requirements: [D-10b]
---

# Phase 32 Plan 03: Real-device RTT checkpoint — DEFERRED Summary

**This plan completed with its central measurement NOT taken.** Its entire purpose was to obtain a
real-device tang RTT before the implementation waves finished; the user replied "cannot measure now"
to the Task 1 checkpoint, so what got recorded is the deferral itself plus a falsifiable replacement
criterion for verification.

## Restated verification criterion — read this before verifying Phase 32

`/gsd:verify-work` must judge Phase 32 on:

> **lossless by default with NO ADDED latency versus Phase 31**

and **NOT** on the ROADMAP's absolute *"tap→audio in under a second"*.

Reason: every latency figure the phase was planned on (2.0–3.8s direct, 3.9–4.7s proxied, 0.44s
cached) was measured **US-sandbox → CN hosts**. Per 32-D-10b, sub-second is reachable only on the
D-08 path (mid already in hand) and only if the real tang RTT is itself sub-second — a fact nobody
has. The absolute number is therefore **unfalsifiable**, and verification must neither pass nor fail
the phase on it.

## What Was Built

**`.planning/notes/qq-lossless-first-resolve.md` — new `## Real-device RTT (Phase 32 checkpoint,
2026-08-31)` section.** It records, in the note's existing voice:

- **Status: UNVERIFIED — deferred at the user's request on 2026-08-31.** No real-device numbers exist.
- A table in the note's existing style with all four rows (direct cold/warm, proxied cold/warm) plus
  the network type marked **NOT MEASURED / NOT REPORTED**. Blanks are listed explicitly rather than
  omitted so the four owed numbers stay visible.
- An unambiguous statement that the note's earlier "Measured" table is US-sandbox → CN hosts, that a
  user near the upstream may see radically different numbers **in either direction**, and that
  **nothing in Phase 32 has been validated against a real client network**.
- The restated criterion above, addressed to `/gsd:verify-work`.
- The discharge procedure: open
  `https://tang.api.s01s.cn/music_open_api.php?type=json&mid=0039MnYb0qxYhV` and
  `https://openmusic.lol/api/qq/detail?type=json&mid=0039MnYb0qxYhV` on a real phone, cold and warm,
  note the network type; **order of magnitude (`<1s` / `1–2s` / `2s+`) is sufficient**.
- What the answer would change: per 32-D-10b, if the real floor is ≥1s the headline is restated
  **permanently** rather than provisionally and the absolute number leaves the ROADMAP.
- **Forward pointer to 32-D-20** (added mid-execution): the restored short-TTL `url` layer beside the
  permanent mid has a cache-hit path Phase 31 measured at **0.44s to playable** with **zero tang
  calls**, so it does not depend on tang RTT at all. It is the one route to sub-second that survives
  a bad measurement.

No source code was touched — this plan is documentation only.

## Task 1 is dischargeable later without re-running the phase

The measurement gates a **claim**, not any code. Nothing downstream in Phase 32 blocks on it: waves
2–4 proceeded on the D-08/D-10/D-20 design regardless of what the phone eventually reports. When a
real number arrives, append it to the note's table, flip the status line, and either confirm the
absolute headline or make the restatement permanent. No plan needs re-execution.

## Deviations from Plan

None — Task 2 executed exactly as written for the "cannot measure now" branch of Task 1's
`<resume-signal>`.

### Assumption Drift (advisory)

**Planned:** Task 2 would record real numbers and pick one of two verdict lines (sub-second confirmed
vs. "floor is {N}s"). **Actual:** neither verdict applies — the third state, "no number at all", was
only implied by the `<resume-signal>`, so the recorded verdict is a criterion restatement made
*without* a measured floor. **Why it matters:** the restatement is defensive rather than evidence-
backed, and stays provisional until the phone-side numbers exist. Advisory only; auto-continued.

## Verification

`grep -c "Real-device RTT" .planning/notes/qq-lossless-first-resolve.md` → **`1`** (plan's
`<automated>` check; passes at ≥1). Observed, not assumed.

**Not verified:** the tang RTT itself — that is the deferred item this whole summary is about.

## Self-Check: PASSED

- `.planning/notes/qq-lossless-first-resolve.md` — FOUND, contains `Real-device RTT` (1 match)
- `32-03-SUMMARY.md` — FOUND
- `git status --short src/` — empty; no source code touched
