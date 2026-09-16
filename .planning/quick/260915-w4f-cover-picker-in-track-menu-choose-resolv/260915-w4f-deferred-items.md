# Deferred — quick-260915-w4f

- **Unpin / "reset to automatic" row in the picker** — not requested. Tapping another candidate
  replaces the pin, so the only unreachable state is "go back to letting the chain decide". Add a
  row if a user asks for it; `unpinCover(uid)` already exists and is tested.
- **Multi-hit iTunes tier in `collectCoverCandidates`** — `itunes-cover.ts` exposes only
  `itunesSongCover` (top-1); its `fetchTopArtwork` is private, so more iTunes hits would need a new
  fetch path. The Deezer tier already contributes up to 5 candidates, so the grid is not thin.
