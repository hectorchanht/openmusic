---
quick_id: 261102-u9i
status: complete
---
# Summary — Phase 3 invariant suite

`src/lib/invariants.test.ts` (11 tests, all green): same song ⇒ same cover on row / now bar / song
page and the same OG gate; same pool ⇒ same top pick in search, auto-pick, discovery and the
VersionPicker; 繁/簡 queries ⇒ one upstream search; covers-only pool ⇒ discovery null + walker
`rejected`; duet credit ⇒ accepted (whole segments); a reorder / prev / anchor removal ⇒ current
still visible. DECISIONS.md gained the per-domain converged / still-open table.
Final: 249 files / 5207 tests pass; svelte-check 0 errors, 31 warnings (pre-existing CSS).
