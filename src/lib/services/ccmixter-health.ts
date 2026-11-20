// ccmixter-health — the health gate for the ccMixter upstream (XSPF search API via
// the /api/ccmixter/search route). Instance of the shared state machine in
// source-health.ts, wired from day one (quick-261101-ccm).
//
// FAILURE SHAPE (mirrors jamendo-health — same reasoning, same catalogue class):
// ccMixter is a Western CC-remix catalogue, so for this app's dominant CN query
// class an empty rows[] is the NORMAL answer, not an outage. A dry-counting gate
// would sit tripped almost permanently and effectively delete the source. So
// this gate counts only HARD failures:
//   - a fetch reject / non-JSON body (route or upstream unreachable), or
//   - a body missing the {rows: []} anchor (contract drift).
// A well-formed body, empty or not, is recordOk (instant recovery). KNOWN
// RESIDUAL, accepted (same as jamendo): a pure upstream outage that the search
// route's empty fallback masks as {rows: []} does not trip this gate — the
// price of not false-tripping on every CN query.
// Resolve is NOT wired: it makes no network call (the stream URL is derived
// deterministically from the songid; the stream route re-derives the media URL
// server-side), so it carries no health signal.
import { createHealthGate } from './source-health';

export const ccmixterHealth = createHealthGate();
