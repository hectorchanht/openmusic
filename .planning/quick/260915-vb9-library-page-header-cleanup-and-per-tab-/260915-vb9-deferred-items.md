# quick-260915-vb9 — deferred items

Candidates from the task spec's section 3 that are NOT in `260915-vb9-PLAN.md`. Rule applied: include only items that are a one-or-two-line call onto a `library.*` / `player.*` / `history.*` method that already exists (the per-list clears are the single exception — a `removeX` loop would re-serialise the whole library once per row).

| Item | Why deferred | What it would take |
|------|--------------|--------------------|
| Multi-select (checkbox mode + bottom bar: Remove / Add to playlist / Download selected) | Needs new selection state (`Set<string>`), a checkbox render in all four track-row templates, a new fixed bottom bar with its own CSS, and a playlist-picker for "Add selected". That is a plan of its own, not a row in this one — and half-building it (state with no bar) is worse than not shipping it. | Own quick task: `selected = $state(new Set<string>())`, a `.bulk-bar` mounted beside `TrackMenu`, reuse `library.toggleLike / removeDownload / removeFromPlaylist / addToPlaylist` per uid; Download selected via `mapWithConcurrency(sel, 2, downloadTrack)`. |
| Sort (recently added / title / artist) | No sort state or sorted view exists on the store; a per-tab persisted sort is new state (`openmusic:library:sort`) plus a `$derived` sort over four lists. | Own quick task; decide persisted vs session-only first. |
| Download all (liked + playlist tabs) | The call itself is one line (`mapWithConcurrency(tabList, 2, downloadTrack)`) but the web save path is an `<a download>` click PER FILE — N native save dialogs on iOS Safari is hostile — so it needs a native/web fork and a cancel affordance. Not a one-liner once it is correct. | Native-only row gated on `Capacitor.isNativePlatform()`, concurrency 2, a cancel via AbortSignal threaded into `downloadTrack`. |
| Rename playlist | No `library.renamePlaylist` exists. | 3-line store method + `prompt()` row in the detail-view sheet; trivial follow-up. |
| Share list | No list-share URL exists (`share.ts` is song-only; `/song/{artist}/{title}` is the only OG surface). | Needs a list share format + server OG route — a feature, not a menu row. |

Included instead (see the plan): Add to queue, Play next, Delete playlist (detail view), Clear all (per tab, confirm-gated), Play, Shuffle, Edit (existing mode).

Orphaned i18n keys left in place on purpose (no unused-key test; deleting from 15 files is churn): `library.heading`, `history.clear`.
