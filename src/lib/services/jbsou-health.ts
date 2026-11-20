// jbsou-health — the health gate for the JBSou fallback resolve pipe (quick-261101-jbs).
//
// WHY: JBSou (www.jbsou.cn) is a single third-party hobby aggregator. It exists in the app for
// exactly one job: rescuing a netease/qq resolve whose primary pipe yielded no playable URL
// (the qijieya Meting type=url dry spell). It is only ever consulted on that failure path —
// but a DEAD JBSou would then tax every rescued resolve with its full cookie+search+redirect
// chain (~3-4s) before failing anyway. The gate caps that tax: after a run of failures the
// pipe is skipped for a bounded window, then auto-probes back (source-health.ts semantics).
//
// FAILURE SHAPE (defined at the client seam, src/lib/services/jbsou-fallback.ts — the route
// deliberately distinguishes a dead pipe from a live one):
//   - recordFail: the /api/jbsou/resolve route is unreachable, answers non-200 (its 503 means
//     the upstream cookie/search/redirect chain failed), answers a non-JSON body, a body with
//     no `url` field, or a `url` that is not an https string.
//   - recordOk: a well-formed route answer — INCLUDING `{ url: null }` (JBSou is alive, the
//     song simply is not in its rows). A no-match is a healthy pipe, never a failure.
//   - A caller abort (superseded resolve) is neither — it is not evidence about the pipe.
import { createHealthGate } from './source-health';

export const jbsouHealth = createHealthGate();
