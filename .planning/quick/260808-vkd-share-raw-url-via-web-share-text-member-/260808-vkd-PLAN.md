---
phase: quick-260808-vkd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/TrackMenu.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/lib/services/share.test.ts
autonomous: true
requirements: [QUICK-260808-VKD]

must_haves:
  truths:
    - "A shared Chinese-titled song link arrives in the target app reading /song/PetPetShawn/喺呢到大, not %E5%96%BA%E5%91%A2%E5%88%B0%E5%A4%A7 (device-verifiable only — see honest limit)"
    - "No share target receives the link twice (once readable, once encoded) — the url member is gone, not duplicated alongside text"
    - "The clipboard fallback at all three sites is byte-identical to before (it already preserves raw CJK)"
  artifacts:
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "doShare passes the link as ShareData.text, no url member"
      contains: "text: url"
    - path: "src/routes/(app)/album/[name]/+page.svelte"
      provides: "shareAlbum passes the link as ShareData.text, no url member"
      contains: "text: url"
    - path: "src/routes/(app)/artist/[name]/+page.svelte"
      provides: "shareArtist passes the link as ShareData.text (replacing the redundant text: title), no url member"
      contains: "text: url"
    - path: "src/lib/services/share.test.ts"
      provides: "structural it.each guard: each nav.share call carries text: url and has NO bare url member"
      contains: "nav.share"
  key_links:
    - from: "src/lib/services/share.test.ts"
      to: "the three .svelte call sites"
      via: "readFileSync structural assertion (same technique as names.test.ts:206-233, quick-260808-urx)"
      pattern: "text: url"
---

<objective>
Move the share link out of `ShareData.url` and into `ShareData.text` at all three `navigator.share`
call sites, so raw CJK path segments survive the share sheet.

Purpose: The Web Share API spec URL-parses and re-serializes `data.url`; the WHATWG URL serializer
percent-encodes every path code point above U+007E, so `喺呢到大` becomes `%E5%96%BA…` no matter
what our encoder (quick-260807-vl1) emits. `data.text` is NOT URL-parsed and passes through
verbatim. Root cause is PROVED (node repro + spec) — do not re-investigate, do not touch
`encodePathSegment` or `share.ts` production code.

Output: three one-line edits + one structural test + comment blocks carrying quick-260808-vkd.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/components/TrackMenu.svelte
@src/routes/(app)/album/[name]/+page.svelte
@src/routes/(app)/artist/[name]/+page.svelte
@src/lib/services/share.test.ts
@.planning/quick/260808-urx-share-link-carries-display-language-name/260808-urx-SUMMARY.md

<interfaces>
<!-- Exact current call shapes (verified this session). These are the ONLY lines that change. -->

src/lib/components/TrackMenu.svelte:195
```
if (nav.share) await nav.share({ title: `${dTitle} • ${dArtist}`, url });
```

src/routes/(app)/album/[name]/+page.svelte:452
```
if (nav.share) await nav.share({ title: dArtist ? `${dName} • ${dArtist}` : dName, url });
```

src/routes/(app)/artist/[name]/+page.svelte:194
```
if (nav.share) await nav.share({ title, text: title, url });
```

Structural-test precedent to reuse (names.test.ts:206-233, quick-260808-urx): an `it.each` over the
three source file paths, `readFileSync(file, 'utf8')`, `expect(src).toMatch(present)` +
`expect(src).not.toMatch(absent)` — because `.svelte` handlers are not exported and there is no
jsdom project, structural assertion at the source is the one check that fails on a revert.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Share link via ShareData.text at all three nav.share sites, guarded by a structural test observed RED first</name>
  <files>src/lib/services/share.test.ts, src/lib/components/TrackMenu.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte</files>
  <behavior>
    Structural `it.each` in share.test.ts (new `describe('nav.share carries the link in text, not url (quick-260808-vkd)')`), modeled on names.test.ts:206-233:
    - Test 1 (per file, x3): source contains `text: url` inside its `nav.share({...})` call — assert with a regex anchored on the call, e.g. `/nav\.share\(\{[^)]*text: url/`.
    - Test 2 (per file, x3): source does NOT contain a bare `url` ShareData member — assert absence of `/nav\.share\(\{[^)]*[,{]\s*url\s*[}\)]/` (shorthand `url` as a member; `text: url` must not match this).
    - MANDATORY RED GATE: run `pnpm vitest --run src/lib/services/share.test.ts` against UNMODIFIED call sites and OBSERVE 3 failures before touching any .svelte file. The preceding task (quick-260808-urx) shipped a test that could not fail and had to replace it mid-execution — do not repeat that. If the new tests pass on arrival, the regexes are wrong; fix them until they are RED.
  </behavior>
  <action>
    After RED is observed, make exactly three edits (this is quick-260808-vkd; reference it in every new comment):

    1. TrackMenu.svelte:195 → `await nav.share({ title: \`${dTitle} • ${dArtist}\`, text: url });`
    2. album/[name]/+page.svelte:452 → `await nav.share({ title: dArtist ? \`${dName} • ${dArtist}\` : dName, text: url });`
    3. artist/[name]/+page.svelte:194 → `await nav.share({ title, text: url });` — the existing `text: title` was redundant with `title` and is replaced by the link.

    Do NOT send both `text` and `url`: many share targets concatenate them, putting the link in the message twice — once readable, once percent-encoded — worse than the bug. Do NOT touch any clipboard fallback branch (`navigator.clipboard.writeText(url)`) — it already preserves raw CJK; it stays byte-identical.

    Add a short comment block above each edited line (tagged quick-260808-vkd) stating: the Web Share API spec URL-parses and re-serializes `ShareData.url`, and the WHATWG URL serializer percent-encodes all non-ASCII path characters — so a `url` member undoes encodePathSegment's raw-CJK output (quick-260807-vl1) at the last step; `ShareData.text` is passed through verbatim; WhatsApp / iMessage / Slack auto-linkify a bare URL inside shared text and still fetch its OG card, so the preview is not lost. Without this comment someone WILL "fix" `text` back to `url`. In TrackMenu, ADD below the existing doShare comment block (lines 160-189) — every existing decision-ref comment (SHARE-02, OG-ZH-01, OG-EP-01, OG-PATH-02, quick-260723-r4p, quick-260808-urx) must survive intact. Same preservation rule for the album/artist comment blocks.

    Style: tabs, single quotes, no `as any`, keep the existing `nav` typed-cast pattern unchanged.
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/services/share.test.ts (new tests GREEN, all pre-existing pass) && pnpm test (89 files / 1531 tests, was 1528 + 3 per-file structural cases — count may differ if it.each reports differently; assert zero failures) && pnpm check (4368 files, 0 errors, 0 warnings) && pnpm build (exit 0) && pnpm build:native (exit 0)</automated>
  </verify>
  <done>
    - RED observed and recorded (3 structural failures against unmodified sources) BEFORE the .svelte edits; GREEN after.
    - All three nav.share calls carry `text: url` and have NO `url` member; clipboard fallbacks untouched (confirm via `git diff` — no writeText line changes).
    - Every pre-existing decision-ref comment in the three files survives; new quick-260808-vkd comments explain the url-parse/text-verbatim split and the OG-card-linkify point at all three sites.
    - Gates: full `pnpm test` green, `pnpm check` 0/0, both builds exit 0.
    - One atomic commit: `fix(share): carry the link in ShareData.text so raw CJK survives the share sheet (quick-260808-vkd)`.
    - HONEST LIMIT (record in SUMMARY, do not paper over): real share-sheet behavior CANNOT be verified in this environment — the change rests on the Web Share API spec plus the proved URL-serializer repro. The user must device-test: share a Chinese-titled song to WhatsApp and confirm the link reads 喺呢到大, not %E5%96%BA…. A curl cannot prove this. No deploy step in this plan; `pnpm deploy` is shadowed by pnpm's builtin — the working form is `pnpm run deploy`, and production verification is the user's.
  </done>
</task>

</tasks>

<verification>
- `grep -n 'nav.share' src/lib/components/TrackMenu.svelte 'src/routes/(app)/album/[name]/+page.svelte' 'src/routes/(app)/artist/[name]/+page.svelte'` → 3 lines, each with `text: url`, none with a `url` member.
- `git diff` shows zero changes to any `clipboard.writeText` line and zero deleted comment lines.
- Full gate set green (test / check / build / build:native).
</verification>

<success_criteria>
Three share call sites hand the raw-CJK link to the OS via `ShareData.text` with no `url` member; a
structural test that was observed RED against the old sources now guards against reverting; all four
gates match or exceed baseline (89 files / 1528+ tests, 4368 files 0/0, both builds exit 0). Device
UAT of the actual share sheet explicitly remains with the user.
</success_criteria>

<output>
Create `.planning/quick/260808-vkd-share-raw-url-via-web-share-text-member-/260808-vkd-SUMMARY.md` when done.
</output>
