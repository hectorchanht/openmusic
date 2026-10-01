# Phase 40: Album download-all + cover re-rank + cloud-shared cover pick - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-30
**Phase:** 40-album-download-all-cover-re-rank-cloud-shared-cover-pick
**Areas discussed:** Album folder + platforms, Cover rank scope, Shared cover identity, Shared cover consensus

---

## Album folder + platforms

| Question | Options | Selected |
|---|---|---|
| Android location | `Music/OpenMusic/<Album>/` · `Music/OpenMusic/<Artist>/<Album>/` · flat | `<Artist>/<Album>/` |
| Web behaviour | one .zip · separate files · Android only | one .zip |
| Keep offline copy | yes (persist:true) · file only | yes |
| Progress | toast n/total · button progress · you decide | toast |
| Single-song location | stay flat · new singles nested · move existing | stay flat |
| Already-downloaded single | skip · copy into album folder | Other: "2, but move the file instead of copy" |

## Cover rank scope

| Question | Options | Selected |
|---|---|---|
| Where YTM covers show | picker grid · YTM-sourced songs · Now Playing/lists | Now Playing/lists; note: "ytmusic sourced track should keep its own thumbnail" |
| Auto order | QQ→iTunes→Deezer→CN→YTM · iTunes→QQ→… · QQ→…no YTM | QQ→iTunes→Deezer→other CN→YTM |
| Replace YTM inline covers | yes · replace every inline · no | no, keep inline covers |
| Picker order | current, QQ, iTunes, Deezer, CN, YTM · QQ+iTunes only | current, QQ, iTunes, Deezer, CN, YTM |

## Shared cover identity

| Question | Options | Selected |
|---|---|---|
| Key | name · uid · both (uid then name) | both |
| Precedence | pin>crowd>inline>chain · pin>inline>crowd>chain · crowd>pin>… | pin > crowd > inline > chain |
| Trigger | picker taps only · + auto-resolved | picker taps only |
| Fetch when | play/Now Playing only · every row | play/Now Playing only |

## Shared cover consensus

| Question | Options | Selected |
|---|---|---|
| Winner | most votes, one per user · latest · needs 2+ votes | most votes, one per user |
| URL allowlist | known cover hosts · any https | known cover hosts |
| Undo | re-pick replaces · reset withdraws | re-pick replaces |

## Claude's Discretion
- R2 prefix / route shape / zip writer / filename sanitization / toast wording / combined lookup.

## Deferred Ideas
- Re-file existing single downloads; withdraw-vote endpoint.
