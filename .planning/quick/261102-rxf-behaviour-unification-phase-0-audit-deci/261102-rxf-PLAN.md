---
quick_id: 261102-rxf
mode: quick
---
# Behaviour unification — Phase 0 audit (no behaviour change)

Audit 14 domains (identity, script, acceptance, ranking, source priority, cover,
quality, display names, lyrics, queue, download, gestures, failure, settings) and
write DECISIONS.md at the repo root: every implementation (file:line), what it decides,
divergences, the winning decider, convergence plan, persisted-key impacts, execution
order, golden-fixture → domain map, open product questions.

Task 1: fan out 5 read-only audit agents (domains grouped 1-2 / 3-5 / 6+8 / 7+9+11+14 / 10+12+13).
Task 2: integrate origin/main (cov1 + covgate commits the audit depends on) so line refs match.
Task 3: write DECISIONS.md. Verify: no src/ change; suite + svelte-check unchanged.
