// bandcamp-health — the health gate for the Bandcamp upstream (autocomplete
// search via the /api/bandcamp/search route). Instance of the shared state
// machine in source-health.ts, wired from day one (43).
//
// FAILURE SHAPE (jamendo/ccmixter posture): Bandcamp is a Western indie
// catalogue, so for this app's dominant CN query class an empty rows[] is the
// NORMAL answer, not an outage. Counting dry results would keep the gate
// tripped almost permanently and effectively delete the source. So this gate
// counts only HARD failures:
//   - a fetch reject / non-ok status / non-JSON body, or
//   - a body missing the {rows: []} anchor (contract drift).
// A well-formed body, empty or not, is recordOk (instant recovery).
// Resolve is NOT wired: it does make a network call, but a per-track 503 means
// "this track is unstreamable" (no mp3-128 for it), not an upstream outage.
import { createHealthGate } from './source-health';

export const bandcampHealth = createHealthGate();
