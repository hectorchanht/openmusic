// joox-health — the health gate for the JOOX upstream (apicx.asia via the /api/joox
// catch-all passthrough). Third instance of the shared state machine in source-health.ts
// (netease + kuwo came first), added in the universal-gate rollout (2026-11-01).
//
// WHY: apicx is a single fragile third-party proxy. When it dies the catch-all's upstream
// fetch throws at the edge and the route answers 504 with an empty body, or apicx itself
// answers an error envelope — either way every joox search in the fan-out pays a slow,
// doomed call, and every speculative resolve walk pays it again.
//
// FAILURE SHAPE (from the adapter's real paths, NOT a generic "network error"):
//   - search: a fetch reject / non-JSON body (the 504's empty body throws in res.json()),
//     or a body that is not the {code:200, data:{songs:[]}} anchor (contract drift).
//   - resolve: the initial detail fetch rejecting, or fetchJooxDetailData returning null
//     (code!==200 / no data) — the same code!==200 counting kuwo's resolve leg uses. The
//     identity self-heal's own fetches stay UNCOUNTED: they only run after a well-formed
//     detail already proved the upstream alive, and its graceful-unresolved return is an
//     identity outcome, not an outage.
//   A well-formed search body — INCLUDING an empty songs[] (a legit no-hit: JOOX answers
//   code 200 with zero rows for obscure queries, and no route converts its outages into
//   empty bodies) — is recordOk, instant recovery. This is deliberately NOT a dry gate
//   like netease/kugou: empty is normal here, outage arrives as a throw or a bad envelope.
//
// Resolve is consulted-but-not-gated (the kuwo rule): a gated window never refuses a
// track the user already chose; resolve outcomes still feed the gate.
import { createHealthGate } from './source-health';

export const jooxHealth = createHealthGate();
