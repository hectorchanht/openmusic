# Phase 38: Share links that play instantly and open in the app - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning

<domain>
## Phase Boundary

A shared song link arrives ARMED and NATIVE. Two halves:

**(A)** The recipient's first tap starts sound immediately instead of paying the ~2.7s cold-resolve
gap, the shared song is visible as the now-playing starter, and the recipient's existing queue
shape survives.

**(B)** A share link tapped on a device with the OpenMusic APK installed opens the app, not the
browser (Android App Links).

NOT in scope: iOS Universal Links (no `ios/` directory exists — the native shell is Android-only),
reviving sender-side queue sharing, a redesigned share card.
</domain>

<decisions>
## Implementation Decisions

### Arrival behaviour — restored session vs shared song

The root layout runs `player.restore()` on EVERY route (`src/routes/+layout.svelte:37`), so a share
link almost always lands with a previous song already seated and paused in the nowbar. "Nothing
playing" therefore needs an explicit definition:

- **D-01:** A paused/restored song counts as **COLD**. Only real audio output counts as "already
  playing". The shared song takes the seat.
- **D-02:** On a cold arrival the restored queue is **KEPT** and the shared song splices in at the
  TOP — the same shape as a warm arrival. There is ONE queue-insert path for both arrivals, not two.
- **D-03:** Re-opening the same link while that song is already `player.current` is a **NO-OP** —
  never re-seat, never restart, never re-resolve. Reuse the existing guard from `relatedTapPlay`
  (`if (player.current?.uid === track.uid) return`).
- **D-04:** The armed-but-unplayed state **IS PERSISTED**. Whatever is seated is the session, so a
  reload / PWA reopen brings the shared song back armed rather than the previous one. No new storage
  key — it rides the existing persisted player blob that `restore()` reads.

### Arrival behaviour — the two cases

- **D-05:** COLD arrival (nothing producing audio): seat the shared song resolved + armed +
  **PAUSED**, one tap from sound. This is precisely the state `player.restore()` already builds
  (`player.svelte.ts:553` — sets `current`, seeds `resolvedCover` through the pinned → track →
  uid-cache → name-cache chain, `syncMetadata()`, resolves details, sets `audio.src`, never calls
  `play()`). Reuse that shape; do not invent a second "armed" concept.
- **D-06:** NO AUTOPLAY on a cold arrival. The share-link navigation is not an in-page gesture and
  mobile autoplay policy will reject it. `quick-260809-38i` removed autoplay deliberately; that
  stands. What this phase revisits is the **resolve**, not the playback.
- **D-07:** WARM arrival (something genuinely playing): `playNext(track, { pin: false })` then
  `play(track, { fresh: false })` — the exact `relatedTapPlay` composition
  (`src/lib/components/NpRelated.svelte:151`). Plays instantly (the element is already unlocked) and
  the queue shape survives: no history weave, no `upNextAnchorUid` re-anchor, no `removedUids`
  clear, no tail regeneration. `pin: false` so the shared song does not survive later queue resets.

### Share link payload

- **D-08:** ADD a song-identity carrier to the share URL, e.g. `?u=kuwo:123` (the `Track` uid,
  `${source}:${songid}`). With the artist/title already in the path, that is a complete stub — the
  recipient does a direct detail resolve instead of a name search. This is the single biggest lever
  on "instant" and it also means the recipient hears the SAME version the sender did.
- **D-09:** Carrier format is a **plain readable query param**, not an opaque base64url token.
  Debuggable in a URL bar and in the activity log, and it sits naturally next to the `?ci=` cover
  token already there. The readable CJK path (`quick-260807-vl1`, `OG-PATH-02`) is UNCHANGED.
- **D-10:** A dead / wrong / unresolvable carrier **silently falls back to the existing name
  resolve**. The carrier is a fast path, never the only path — a stale link degrades to today's
  behaviour, never to a dead page. Matches the isolate-and-degrade house strategy.
- **D-11:** Do NOT revive sender-side queue sharing. `shareUrl()` / `encodeShare()` have no outbound
  caller left; only the home page still DECODES legacy `?play=` links. Keep the decoder (old links in
  the wild must keep working), never emit new ones. Importing the sender's queue directly
  contradicts D-02/D-07 (the RECIPIENT's queue shape is what survives).
- **D-12:** Re-point the legacy `?play=` decoder at the new insert path. Today
  `src/routes/(app)/+page.svelte:673` does `setQueue(...)` + `play(current, { fresh: true })` —
  exactly the queue-nuking this phase exists to stop. It must route through the same
  splice-in-top path as D-02/D-07.

### Prefetch timing

- **D-13:** The resolve fires **ON MOUNT, immediately**. With the D-08 carrier this is one cheap
  detail call, not the search fan-out. Anything later merely moves the wait — a recipient who taps
  play immediately (the common case) gains nothing from an interaction-gated prefetch, because their
  tap IS the first interaction.
- **D-14:** Warm-up goes as far as **resolve + set `audio.src`**, and no further. The browser's own
  default metadata peek is allowed; there is NO forced byte prefetch and NO blob pre-buffer — that
  shape caused the `api-fetch-flood-freeze`. Same depth as `restore()`.
- **D-15:** Legacy carrier-free links get the SAME treatment — the name resolve also fires at mount.
  One code path, and those links need the help most. Route it through the `apiFetch` governor
  (`src/lib/services/api-base.ts`) so it cannot flood.
- **D-16:** If the user taps play while the prefetch is still in flight, the tap **adopts the
  in-flight resolve** — never a second request. The `playGen` / `pendingGen` generation guards
  already exist for exactly this supersedence shape.

### Landing surface

- **D-17:** KEEP the share card and seat the song in the nowbar as well. The card stays the
  crawler/OG landing surface, SSR-safe by construction and structurally unchanged. The nowbar comes
  FREE — the share routes live under `(app)`, whose layout already mounts `Nowbar` + `NowPlaying`
  (`src/routes/(app)/+layout.svelte:362`). No new UI component.
- **D-18:** NowPlaying stays **COLLAPSED** on arrival. No auto-expand — the card already shows
  title/artist/cover, and the nowbar is the one-tap control.
- **D-19:** KEEP the "Play on openmusic" button, re-wired to the armed track. It is already the
  retry affordance and the real user gesture mobile autoplay policy requires; it now starts an
  already-armed element instead of beginning a resolve.
- **D-20:** A warm arrival **DOES show a toast** ("playing shared song, your queue is intact" —
  final wording TBD at planning). NOTE: this DEVIATES from `relatedTapPlay`, which deliberately emits
  no toast on tap ("the row becoming the playing track IS the feedback"). The justification is that a
  share arrival changes the music without the user having touched the player, which a related-row tap
  does not. Requires a new key in EVERY locale dictionary (`src/lib/i18n/*.ts`, DOUBLE QUOTES,
  `i18n.test.ts` guards key-set parity).

### Android App Links (B)

- **D-21:** Android only. No `ios/` directory exists, so Universal Links are out of scope.
- **D-22:** The release SHA256 fingerprint is obtained by **the user running `keytool` locally and
  pasting the value in**; it is committed as a constant in `static/.well-known/assetlinks.json`. The
  keystore itself lives only in GitHub secrets (`.github/workflows/android-release.yml:97`) and must
  never reach CI logs. The fingerprint is public data, not a secret. Include the DEBUG keystore
  fingerprint too so `pnpm apk` builds verify during development.
- **D-23:** Claim **`openmusic.lol` ONLY**. It is the one host `shareOrigin()` emits. `pages.dev` is
  not claimed.
- **D-24:** Intercept **share routes only** — `/song/*`, `/album/*`, `/artist/*`. Every other
  openmusic.lol URL still opens in a browser. Do not claim the whole host.
- **D-25:** An `appUrlOpen` arriving while the app is already running gets the **same treatment as
  the web warm arrival** — route the incoming URL through `goto()` so the identical splice-in-top +
  play path runs. One behaviour to reason about and test on both web and APK.
- **D-26:** Distribution is Obtainium / sideload, NOT Play Store — so there is no Play App Signing
  re-sign and the release keystore fingerprint is the stable, only identity. `launchMode="singleTask"`
  is already set on MainActivity, which is what App Links needs.

### Added during planning (post-research)

- **D-27:** An in-flight resolve counts as **WARM**. The cold/warm test is
  `player.playing || player.loading`, not `playing` alone. Rationale: a user with a resolve in
  flight has already committed to listening; arming over them would silently kill the track they
  just started. Both are existing `$state` fields. (Closes a gap in D-01 that research surfaced.)
- **D-28:** No UI-SPEC for this phase (`--skip-ui`). D-17..D-20 already ARE the visual contract and
  they are all "reuse what exists" — the only new pixel is the D-20 toast. The UI gate's keyword
  match ("PageOg", "landing page") was incidental.
- **D-29 (forced by research, not a user choice):** `playNext()` AUTOPLAYS when the queue is truly
  empty (`player.svelte.ts:2640` — `if (!this.current) this.play(t)`). A first-time visitor with no
  persisted blob hits exactly that path, so D-02's "one insert path for both arrivals" taken
  literally would VIOLATE D-06 (no autoplay on cold arrival). The cold branch must arm explicitly
  and must NOT route through `playNext`'s empty-queue fallback. D-06 wins — it is a mobile autoplay
  policy constraint, not a preference.
- **D-30:** Fix the stale source enum at `src/lib/services/share.ts:467` (missing `audius`,
  `ytmusic`) as part of this phase. The new `?u=` carrier's source allowlist is a V5 input-validation
  control (see RESEARCH § Security Domain) and it must not be built on a known-incomplete enum.

### Claude's Discretion
- Exact toast wording and its translation key name.
- The query-param letter for the uid carrier (`?u=` is a suggestion, not a lock).
- Whether the cold-arrival arm is a new `player` method or a parameterisation of the existing
  `restore()` internals — as long as the two do not diverge.
- Whether the legacy `/song/[slug]` route gets the same treatment or is deprecated (see open
  question in `<specifics>`).

### Folded Todos
- `.planning/todos/pending/song-share-stale-cover-comment.md` — FOLDED. Part 1 (correct the stale
  comment) is mandatory: this phase rewrites that page's mount behaviour, and CLAUDE.md treats a
  comment that contradicts the code as worse than none. Part 2 (render the cover) is already done.
</decisions>

<specifics>
## Specific Ideas

- "Play like how related songs are clicked" — this is literal, not an analogy. `relatedTapPlay`
  (`NpRelated.svelte:151`) is the reference implementation and its comment block explains exactly why
  `fresh: true` was wrong there. The same reasoning applies here.
- "One click away from playing" is the ceiling on web and is accepted, not a compromise to engineer
  around — mobile autoplay policy makes a zero-click share link impossible.

**Open question for the planner (not a user decision):** there are TWO song landing routes —
`/song/[slug]` (legacy, `?n=&a=&c=` carriers) and `/song/[artist]/[title]` (current, carrier-free,
the only one `songShareUrl` emits). Both currently carry near-identical resolve-and-play logic. The
plan must either give both the same treatment or explicitly deprecate `[slug]`. Silently fixing only
one leaves a live route on the old behaviour.

**Verification landmine for the researcher:** confirm that `static/.well-known/assetlinks.json`
actually survives the Vite/SvelteKit static copy AND the Cloudflare Pages deploy, and is served as
`application/json` over https with NO redirect. Dot-directories are filtered by some static
pipelines, and this fails SILENTLY — App Links verification just never succeeds.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The share link itself
- `src/lib/services/share.ts` — `songShareUrl` (the only live emitter, ~line 415), `shareOrigin`,
  `encodePathSegment`, `coverToken`, and the legacy `encodeShare`/`decodeShare` pair.
- `src/lib/components/TrackMenu.svelte:783` — the ONLY call site that emits a song share URL.

### Landing surfaces
- `src/routes/(app)/song/[artist]/[title]/+page.svelte` — current carrier-free landing page. Note the
  SSR-SAFETY contract in its header comment: NO top-level store import, player imported lazily inside
  `onMount` under a `browser` guard.
- `src/routes/(app)/song/[artist]/[title]/+page.ts` — OG build, `?ci=` read.
- `src/routes/(app)/song/[slug]/+page.svelte` — legacy landing page (see open question above).
- `src/routes/(app)/+page.svelte:673` — legacy `?play=` decoder that must be re-pointed (D-12).

### Player behaviour being reused
- `src/lib/components/NpRelated.svelte:151` — `relatedTapPlay`. The reference implementation for
  D-07, including the comment block explaining why `fresh: true` destroys the queue.
- `src/lib/stores/player.svelte.ts:553` — `restore()`. The reference shape for the D-05 armed state.
- `src/routes/+layout.svelte:24-37` — `attach()` + `restore()` inside `untrack()`. Read the comment:
  this is the fix for the restore-effect self-invalidation loop. Do not un-untrack it.
- `src/routes/(app)/+layout.svelte:362` — where `Nowbar` / `NowPlaying` mount for all `(app)` routes.
- `src/lib/services/api-base.ts` — the `apiFetch` governor all new `/api/*` traffic must route through.

### Android App Links
- `android/app/src/main/AndroidManifest.xml` — currently MAIN/LAUNCHER only;
  `launchMode="singleTask"` already present.
- `capacitor.config.ts` — `appId: com.openmusic.app` (LOCKED, D-12 of phase 999.1 — changing it
  breaks Obtainium update continuity).
- `.github/workflows/android-release.yml` — release signing; keystore is a GitHub secret.

### Project rules
- `CLAUDE.md` — conventions (tabs, runes, comment density, i18n double quotes, `apiFetch`, generation
  guards, SSR guards).
- `.planning/todos/pending/song-share-stale-cover-comment.md` — folded (see D above).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `relatedTapPlay` composition (`playNext(pin:false)` + `play(fresh:false)`) — the entire warm-arrival
  behaviour, already written and already reasoned about. ZERO store diff required.
- `player.restore()` — the entire cold-arrival armed state, already written.
- `Nowbar` / `NowPlaying` — already mounted on the share routes via the `(app)` layout. "Show the
  shared song in now playing" needs no new component.
- `apiFetch` governor, `combinedSignal`, `toast` store, `coverToken` / `shareOrigin` /
  `encodePathSegment` — all existing, all reusable.

### Established Patterns
- **SSR-safe-by-construction share pages.** Both landing pages forbid top-level store imports; the
  player is lazily imported inside `onMount` under a `browser` guard. Any prefetch code MUST preserve
  this or SSR pulls in the whole client graph.
- **Generation guards** (`playGen`, `pendingGen`, `queueGen`) protect every async path. The
  prefetch-then-tap race (D-16) is exactly what they are for.
- **Isolate-and-degrade.** No error stops the chain — the carrier miss (D-10) follows the same rule.
- **i18n:** double quotes, identical key set across every dictionary, `i18n.test.ts` guards parity.
- **Comments are load-bearing decision records.** New behaviour needs a `quick-` / decision-ref
  comment; existing decision-ref comments must not be deleted.

### Integration Points
- `share.ts` → the new uid carrier (emit side).
- Both `/song/…` landing routes → carrier read, mount-time resolve, arm-vs-play branch.
- `(app)/+page.svelte` legacy `?play=` handler → re-point to the shared insert path.
- `player` store → possibly one new entry point for "seat armed" vs "splice and play"; keep it thin
  and keep the pure decision logic testable under the node-only Vitest project.
- `AndroidManifest.xml` + new `static/.well-known/assetlinks.json` + a Capacitor `App.addListener('appUrlOpen')`
  handler (Capacitor code must be `isNativePlatform()`-guarded so the web build no-ops).
</code_context>

<deferred>
## Deferred Ideas

- **Revive sender-side queue sharing** (share your whole up-next, not one song) — rejected for this
  phase because it contradicts "the recipient's queue shape survives". Would need its own decision
  about whose queue wins.
- **iOS Universal Links** — no `ios/` directory exists; belongs with any future iOS shell.
- **Claim `openmusic.pages.dev` for App Links** — deliberately not claimed (D-23).
- **Auto-expand NowPlaying on share arrival** — considered and rejected (D-18).
- **Delete `shareUrl`/`encodeShare` as dead code** — out of scope; D-11 keeps the decoder and simply
  stops emitting.

### Reviewed Todos (not folded)
- `.planning/todos/pending/pageog-hardcoded-site-origin.md` — adjacent but not required. D-23 claims
  only `openmusic.lol`, which is what PageOg already pins, so the App Links work does not depend on
  fixing the pages.dev origin leak.
- `.planning/todos/pending/artist-page-hyphenated-lookup-key.md` — matched on weak keywords; unrelated
  to share links.
- `.planning/todos/pending/og-artist-tier-picture-xl-oversize.md` — matched on weak keywords; an
  `/api/og` payload-size issue, not a share-link behaviour issue.
</deferred>

---

*Phase: 38-share-links-that-play-instantly-and-open-in-the-app*
*Context gathered: 2026-09-20*
