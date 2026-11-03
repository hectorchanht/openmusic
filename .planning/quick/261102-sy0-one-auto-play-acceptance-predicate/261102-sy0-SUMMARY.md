---
quick_id: 261102-sy0
status: complete
---
# Summary — §3 auto-play acceptance converged

- `song-variant.ts isAutoAcceptable(target, cand)` = (sameSongStrings ∨ sameSongByCredit) ∧
  isAcceptableSubstitute ∧ isAutoAcceptableArtist; `rankAutoCandidates` = rankAcceptable over it.
- Consumers: fallback walkSource (was tryOneSource, now exported), catalog.resolveNameStub (now
  just the sequential walk over walkSource — same pool depth, candidate walk, verdicts),
  discovery attempt (gate before ranking; preferenceOrder instead of dedupeBest collapse; tier-1
  expansion counts only acceptable officials), JBSou pickJbsouRow (scoreMatch floor + matchKey
  identity removed), resolve-edge (first-matchKey-equal pick removed).
- New: SourceAdapter.health hook on all 14 gated adapters → a gated [] is `inconclusive`, not
  `empty`; runFallback/handleDefinitiveFailure no longer pre-mark a name stub's placeholder source;
  dedupe comparePreference/preferenceOrder (better() is its pairwise winner); sameSongStrings
  accepts either half of a bilingual title ("再愛你 - Zai Ai Ni" ≡ "Zai Ai Ni").
- Intended behaviour changes: 偏偏喜歡你 picks the clean cut, not the 320K ringtone; duet credits
  accepted by JBSou/edge; JBSou rescues a Live-only pool as last resort (was refused — product
  call: junk-only pools play); discovery runs the full fan-out when tier-1 has only unacceptable
  rows (+1 search on such misses).
- Deferred to §13: the player's FALLBACK_BUDGET_MS abort still skips fallback's inconclusive pass.
- Kept on purpose: discovery preferEligible weak-row veto (defensive for externally-built bests)
  and its `?? ineligible` ytmusic last resort.
- Suite 244 files / 5191 tests pass (device-filename backtracking probe flaked once under load,
  passes standalone); svelte-check 0 errors.
