// suyin-health — the health gate for the Suyin （溯音） upstream (oiapi.net, Kuwo's
// catalogue via a public no-key aggregator). Instance of the shared state machine in
// source-health.ts, added in the universal-gate rollout (2026-11-01).
//
// WHY: oiapi is a single free aggregator with no SLA, and suyin is a full member of
// the search fan-out — when oiapi dies, every search pays its timeout before the
// fan-out can settle.
//
// FAILURE SHAPE (from the adapter's real paths): the search goes BROWSER-DIRECT to
// oiapi (CORS *), no edge route, so no route converts an outage into an empty body:
//   - a fetch reject / non-JSON body (oiapi down or answering an HTML error page),
//   - a body that is not an object (the adapter's existing contract-drift guard), or
//   - an object WITHOUT the `data` payload (an oiapi error envelope, e.g. code!==1) —
//     counted, though the search still returns [] as it always has: the envelope is
//     also oiapi's shape for some no-hit answers, so the adapter does not throw on
//     it; the gate's threshold absorbs the ambiguity.
//   A well-formed body WITH data — even if every row is later filtered out for a
//   missing rid/title — is recordOk (instant recovery). Empty RESULTS are not
//   counted dry: oiapi returns a data-less or empty answer for genuinely unfindable
//   queries too, and there is no observed dry-spell pathology on this pipe.
// Resolve is NOT wired: it makes no upstream call at all (the search response already
// carries the playable url; resolve is a pass-through stamp), so it carries no health
// signal — the same reason jamendo/archive resolves stay uncounted.
import { createHealthGate } from './source-health';

export const suyinHealth = createHealthGate();
