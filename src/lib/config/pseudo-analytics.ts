// pseudo-analytics — THE launch switch for pseudonymous analytics
// (quick-261122-pseudo; Hector's ruling 2026-11-20, superseding the 2026-11-18
// totals-only doctrine).
//
// ORDER OF OPERATIONS IS PART OF THE RULING: the published data promise must
// describe pseudonymous counting BEFORE any pseudonymous collection ships. This
// one constant couples the two so they can never drift apart:
//
//   false → the app shows the OLD (totals-only) promise, generates NO pseudo ID,
//           sends NO pseudo_id and NO new events (search_miss / play_failure /
//           lyrics_missing / session_start); the /api/analytics/event endpoint
//           refuses every write; the Settings → About reset control is hidden.
//   true  → the NEW promise copy renders on /free + Settings → About, the reset
//           control appears, and collection starts — in the SAME deploy.
//
// Flip to `true` ONLY after Hector has one-tap approved the promise copy (the
// `free.dataPromisePseudo` / `privacy.*` i18n keys) — public-facing correctness
// rule. The Free Port Data Promise card and OpenMovies /privacy must carry the
// same wording in the same release wave (they live in other repos).
//
// Read by BOTH the client (analytics.ts, pseudo-id.ts, /free, About) and the
// server (/api/analytics/event), so it must stay a plain dependency-free module.

export const PSEUDO_ANALYTICS_LIVE: boolean = false;
