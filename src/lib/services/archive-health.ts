// archive-health — the health gate for the Internet Archive upstream
// (advancedsearch + metadata fan-out behind the /api/archive/search route).
// Instance of the shared state machine in source-health.ts, added in the
// universal-gate rollout (2026-11-01).
//
// FAILURE SHAPE (from the real paths): the search route wraps archive.org in
// cachedUpstreamJson with an empty fallback, BUT empty cannot be this gate's
// failure signal — IA is a niche public-domain/CC catalogue (78rpm transfers,
// live tapes, netlabels), so an empty rows[] for a mainstream query is a
// NORMAL answer, not an outage. A dry-counting gate (the netease/kugou shape)
// would false-trip constantly and effectively delete the source. So this gate
// counts only HARD failures:
//   - a fetch reject / non-JSON body (route or archive.org unreachable), or
//   - a body missing the {rows:[]} anchor (contract drift).
//   A well-formed body, empty or not, is recordOk (instant recovery). KNOWN
//   RESIDUAL, accepted: an outage the route's empty fallback masks as
//   {rows:[]} does not trip this gate — the price of not false-tripping on a
//   legitimately sparse catalogue.
// Resolve is NOT wired: it makes no network call at all (the download url is
// deterministic from the songid's identifier/file pair), so it carries no
// health signal.
import { createHealthGate } from './source-health';

export const archiveHealth = createHealthGate();
