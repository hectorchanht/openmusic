// jamendo-health — the health gate for the Jamendo upstream (v3.0 tracks API via
// the /api/jamendo/search route). Instance of the shared state machine in
// source-health.ts, added in the universal-gate rollout (2026-11-01).
//
// FAILURE SHAPE (from the real paths): the search route wraps Jamendo in
// cachedUpstreamJson with an empty fallback, BUT empty cannot be this gate's
// failure signal — Jamendo is a Western CC-indie catalogue, so for this app's
// dominant CN query class an empty results[] is the NORMAL answer, not an outage.
// A dry-counting gate (the netease/kugou shape) would sit tripped almost
// permanently in real use and effectively delete the source. So this gate counts
// only HARD failures:
//   - a fetch reject / non-JSON body (route or upstream unreachable), or
//   - a body missing the {headers:{code:0}, results:[]} anchor (contract drift —
//     including a Jamendo error envelope, headers.code!==0).
//   A well-formed body, empty or not, is recordOk (instant recovery). KNOWN
//   RESIDUAL, accepted: a pure upstream outage that the route's empty fallback
//   masks as {code:0, results:[]} does not trip this gate — the price of not
//   false-tripping on every CN query.
// Resolve is NOT wired: it makes no network call (the audio url arrives at search
// time; resolve only stamps the quality tag), so it carries no health signal.
import { createHealthGate } from './source-health';

export const jamendoHealth = createHealthGate();
