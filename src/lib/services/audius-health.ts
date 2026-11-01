// audius-health — the health gate for the Audius upstream (discovery-provider
// search via the /api/audius/search route). Instance of the shared state machine
// in source-health.ts, added in the universal-gate rollout (2026-11-01).
//
// FAILURE SHAPE (from the real paths): the search route wraps the discovery
// provider in cachedUpstreamJson with an empty fallback, BUT empty cannot be
// this gate's failure signal — Audius is a Western indie/UGC catalogue, so for
// this app's dominant CN query class an empty data[] is the NORMAL answer, not
// an outage. A dry-counting gate (the netease/kugou shape) would sit tripped
// almost permanently in real use and effectively delete the source. So this
// gate counts only HARD failures:
//   - a fetch reject / non-JSON body (route or provider unreachable), or
//   - a body missing the {data:[]} anchor (contract drift).
//   A well-formed body, empty or not, is recordOk (instant recovery). The
//   page>1 early return makes NO upstream call and records NOTHING. KNOWN
//   RESIDUAL, accepted: an outage the route's empty fallback masks as {data:[]}
//   does not trip this gate — the price of not false-tripping on CN queries.
// Resolve is NOT wired: its only hop is /api/stream-url — OUR OWN edge helper,
// whose failure silently keeps the proxy path and says nothing about the Audius
// upstream (the stream url is deterministic from the track id).
import { createHealthGate } from './source-health';

export const audiusHealth = createHealthGate();
