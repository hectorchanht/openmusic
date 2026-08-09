---
phase: quick-260808-vzu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/share.test.ts
  - src/lib/stores/settings-persist.svelte.test.ts
  - src/lib/config/defaults.ts
  - src/lib/stores/settings.svelte.ts
  - src/routes/(app)/settings/general/+page.svelte
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
  - src/lib/components/TrackMenu.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
autonomous: true
requirements: [QUICK-260808-VZU]
tags: [share, web-share-api, settings, i18n]

must_haves:
  truths:
    - "With the setting OFF (the default), all three nav.share call sites send { text: url } only — no title member"
    - "With the setting ON, all three call sites send { title: '…', text: url }"
    - "The toggle appears on Settings → General, persists across reload, and resets with the General group"
    - "A corrupt persisted value (non-boolean) falls back to false on load"
    - "All 15 locales carry the two new keys; i18n key-set parity passes"
  artifacts:
    - path: "src/lib/config/defaults.ts"
      provides: "shareIncludeTitle: false in GENERAL_DEFAULTS"
      contains: "shareIncludeTitle"
    - path: "src/lib/stores/settings.svelte.ts"
      provides: "declaration + load guard + save payload + resetGeneral for shareIncludeTitle"
      contains: "shareIncludeTitle"
    - path: "src/routes/(app)/settings/general/+page.svelte"
      provides: "row-toggle switch for the setting"
      contains: "settings.shareIncludeTitle"
    - path: "src/lib/stores/settings-persist.svelte.test.ts"
      provides: "genuine load()/save() round-trip tests (browser=true mock + in-memory localStorage)"
      min_lines: 40
    - path: "src/lib/services/share.test.ts"
      provides: "structural it.each asserting title is GATED on settings.shareIncludeTitle at all 3 sites"
      contains: "shareIncludeTitle"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "settings.shareIncludeTitle"
      via: "ternary inside nav.share call"
      pattern: "nav\\.share\\(settings\\.shareIncludeTitle"
    - from: "src/lib/stores/settings.svelte.ts"
      to: "src/lib/config/defaults.ts"
      via: "GENERAL_DEFAULTS.shareIncludeTitle in field init, load fallback, resetGeneral"
      pattern: "GENERAL_DEFAULTS\\.shareIncludeTitle"
---

<objective>
Add a user-facing boolean setting `shareIncludeTitle` (default OFF) that controls whether the
Web Share payload carries the `Song • Artist` title line alongside the link. Today all three
`nav.share` call sites send `title` unconditionally, so concatenating targets (WhatsApp) render
two lines — the title, then the URL — and the OG card beneath the link ALREADY shows
`Song • Artist`, duplicating it. The user explicitly rejected deleting the title outright: some
users want the context inline, so it becomes a setting.

Purpose: default share message = the bare link with the OG card unfurling under it; opt-in restores the title line.
Output: setting plumbed through defaults → store → General settings UI → i18n (15 locales) → three share call sites, with genuinely-RED-first tests.

**Chosen name (use EVERYWHERE — defaults, store, save payload, UI, i18n keys, tests): `shareIncludeTitle`.**
i18n keys: `"settings.shareIncludeTitle"` (label) and `"settings.shareIncludeTitleDesc"` (description).
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/config/defaults.ts
@src/lib/stores/settings.svelte.ts
@src/routes/(app)/settings/general/+page.svelte
@src/lib/services/share.test.ts
@src/lib/components/TrackMenu.svelte
@src/routes/(app)/album/[name]/+page.svelte
@src/routes/(app)/artist/[name]/+page.svelte
@src/lib/stores/library.svelte.test.ts
@.planning/quick/260808-vkd-share-raw-url-via-web-share-text-member-/260808-vkd-SUMMARY.md

<interfaces>
<!-- Verified against the current tree — use directly, no exploration needed. -->

The `reduceMotion` boolean is the exact three-touchpoint store pattern to copy
(src/lib/stores/settings.svelte.ts):

```typescript
// :163 — declaration
reduceMotion = $state<boolean>(GENERAL_DEFAULTS.reduceMotion);
// :265-266 — load branch (inside the `if (raw)` block)
this.reduceMotion =
	typeof v.reduceMotion === 'boolean' ? v.reduceMotion : GENERAL_DEFAULTS.reduceMotion;
// :365 — save payload entry
reduceMotion: this.reduceMotion,
// :427-434 — resetGeneral() ALSO touches it (a 4th touchpoint the task brief undercounts):
resetGeneral() {
	const d = DEFAULTS.general;
	this.appLang = d.appLang;
	this.accent = d.accent;
	this.reduceMotion = d.reduceMotion;
	this.theme = d.theme;
	this.save();
}
```

Persistence key: `const KEY = 'openmusic:settings:v1';` (settings.svelte.ts:56).
`load()` ends with `this.applyTheme()` (:327) and `save()` calls it too (:384) —
`applyTheme()` touches `document.documentElement` when `browser` is true, and load()'s
first-visit branch reads `navigator.language` — so the round-trip test MUST stub
`document` and `navigator` globals (see Task 1).

Current nav.share call shapes (what the new structural regexes must FAIL against today):

```typescript
// TrackMenu.svelte:204
if (nav.share) await nav.share({ title: `${dTitle} • ${dArtist}`, text: url });
// album/[name]/+page.svelte:460
if (nav.share) await nav.share({ title: dArtist ? `${dName} • ${dArtist}` : dName, text: url });
// artist/[name]/+page.svelte:203
if (nav.share) await nav.share({ title, text: url });
```

`settings` import status at the three sites: artist page ALREADY imports it (:11
`import { settings } from '$lib/stores/settings.svelte';`); TrackMenu.svelte and the album
page do NOT — both need that import added.

Browser-true test harness precedent (library.svelte.test.ts:10-25): `vi.mock('$app/environment',
() => ({ browser: true }))` + a `Map`-backed `Storage` stub via `vi.stubGlobal('localStorage', …)`.
The EXISTING settings.svelte.test.ts relies on browser=false (its applyTheme no-op test asserts
it) — do NOT add the browser mock there; the round-trip tests go in a NEW file.

vkd's structural it.each lives at share.test.ts:545-567. Its two current assertions
(`toMatch(/nav\.share\(\{[^)]*text: url/)` and the no-url-member not-match) will be REPLACED
by the gated-shape assertions — keep the describe, the file list, and the comment block.

i18n: en.ts is the reference locale (defines TranslationKey). Existing key placement:
`"settings.reduceMotion"` at en.ts:102, `"settings.reduceMotionDesc"` at en.ts:408. All 15
locale files (ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant — detect.ts/index.ts/tests
are NOT locales) use DOUBLE QUOTES for every key and value; i18n.test.ts guards key-set parity.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write the new tests and observe them RED against unmodified sources</name>
  <files>src/lib/services/share.test.ts, src/lib/stores/settings-persist.svelte.test.ts</files>
  <behavior>
    Structural (share.test.ts — REWRITE the assertions inside the existing vkd it.each; keep
    the describe, the 3-file list, and the load-bearing comment block; append a quick-260808-vzu
    note to that comment explaining the gate):
    - Test 1 (per file, 3 cases): `expect(src).toMatch(/nav\.share\(settings\.shareIncludeTitle\s*\?\s*\{\s*title[\s\S]*?text: url\s*\}\s*:\s*\{\s*text: url\s*\}\)/)`
      — title exists ONLY in the true branch of a ternary gated on the setting; the false
      branch is exactly `{ text: url }` (link-only, no placeholder title — `{ text: url }`
      alone satisfies the Web Share spec's at-least-one-member rule).
    - Test 2 (same cases): `expect(src).not.toMatch(/nav\.share\(\{/)` — NO direct
      object-literal call survives; every payload must route through the gate. This is the
      assertion that is unambiguously RED today (all 3 sites currently read `nav.share({ title`).
    - Test 3 (same cases): `expect(src).not.toMatch(/nav\.share\([^)]*[,{]\s*url\s*[,})]/)` —
      vkd's no-`url`-member invariant, re-anchored from `nav\.share\(\{` to `nav\.share\(` so
      it still binds after the ternary lands.
    Store round-trip (NEW file src/lib/stores/settings-persist.svelte.test.ts — genuine
    load()/save(), not guard-mirroring):
    - Test 4: fresh module, empty localStorage, `settings.load()` → `settings.shareIncludeTitle` is `false` (default).
    - Test 5: seed `openmusic:settings:v1` with `JSON.stringify({ appLang: 'en', shareIncludeTitle: true })`,
      fresh module, `load()` → `true` (an explicit persisted boolean wins).
    - Test 6: seed with `{ appLang: 'en', shareIncludeTitle: 'yes' }` (corrupt non-boolean),
      fresh module, `load()` → `false` (the `typeof === 'boolean'` guard).
    - Test 7: fresh module, set `settings.shareIncludeTitle = true; settings.save();` →
      `JSON.parse(localStorage.getItem('openmusic:settings:v1')!).shareIncludeTitle === true`.
    - Test 8: self-contained (own fresh module — do NOT share state with Test 7): set `true`,
      `save()`, then `settings.resetGeneral()` → field is `false` AND the persisted blob's
      `shareIncludeTitle` is `false`.
  </behavior>
  <action>
    Create `src/lib/stores/settings-persist.svelte.test.ts` (quick-260808-vzu). Harness — copy
    the library.svelte.test.ts:10-25 idiom: `vi.mock('$app/environment', () => ({ browser: true }))`,
    a `Map`-backed `Storage` stub via `vi.stubGlobal('localStorage', …)`, PLUS (settings-specific,
    because `load()` reads `navigator.language` when `appLang` is absent and both `load()` and
    `save()` end in `applyTheme()` which touches the DOM root):
    `vi.stubGlobal('navigator', { language: 'en-US' })` and
    `vi.stubGlobal('document', { documentElement: { style: { setProperty: () => {} }, dataset: {} } })`.
    Because `settings` is a module-scope singleton with a `loaded` once-guard, each load case
    needs a FRESH module: `vi.resetModules(); const { settings } = await import('./settings.svelte');`
    inside each test (registered `vi.mock` factories survive resetModules). Clear the Map in
    `beforeEach`. Add a header comment stating WHY this is a separate file from
    settings.svelte.test.ts: that file's cases depend on browser=false (its applyTheme no-op
    test would break under a browser-true mock). Seeds include `appLang: 'en'` so the
    `?? detectAppLang(navigator.language)` arm stays dormant. No `as any` — type the storage
    stub as `Storage` and, pre-implementation, access the not-yet-existing field via the typed
    singleton (esbuild strips types at test runtime; `pnpm check` runs only after Task 2 adds
    the field, so no check-gate conflict).

    Rewrite the assertion block inside share.test.ts's existing it.each (:553-566) to Tests 1-3
    above. Do not delete the vkd comment block (:546-552) — append 2-3 lines tagged
    quick-260808-vzu: the title line is now GATED on `settings.shareIncludeTitle` (default OFF)
    because concatenating targets (WhatsApp) render title + text as two lines, duplicating the
    OG card's own `Song • Artist`; Test 2 pins that no ungated object-literal call can return.

    **HARD GATE — RED before any production edit:** run
    `pnpm vitest --run src/lib/services/share.test.ts src/lib/stores/settings-persist.svelte.test.ts`
    against the UNMODIFIED production sources. Required outcome: the 3 structural cases FAIL
    (Test 1 has no `settings.shareIncludeTitle` to match; Test 2 sees `nav.share({`) and the
    5 round-trip cases FAIL (`shareIncludeTitle` is `undefined`, never `false`/`true`; the save
    payload lacks the key), while share.test.ts's other 55 cases still pass. Record the verbatim
    failure lines for the SUMMARY. If ANY new case passes against unmodified sources, the test
    is defective — fix the test before proceeding, do not touch production code.
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/services/share.test.ts src/lib/stores/settings-persist.svelte.test.ts 2>&1 | tail -20  # EXPECTED RED: 8 failed (3 structural + 5 round-trip), 55 passed</automated>
  </verify>
  <done>Both test files exist; the run shows exactly the 8 new cases failing and the 55 pre-existing share.test.ts cases passing; verbatim RED output captured; zero production files touched (git status confirms only the two test files changed).</done>
</task>

<task type="auto">
  <name>Task 2: Plumb the setting — defaults, store (4 touchpoints), General settings toggle, 15 locales</name>
  <files>src/lib/config/defaults.ts, src/lib/stores/settings.svelte.ts, src/routes/(app)/settings/general/+page.svelte, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/en.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    All production edits use tabs, single quotes (EXCEPT i18n files — double quotes), and carry
    a `quick-260808-vzu` comment where non-obvious. Do not remove any existing decision-ref comment.

    1. `src/lib/config/defaults.ts` — add to GENERAL_DEFAULTS (after `reduceMotion`), with a
       doc comment: share payload title line is opt-in; OFF by default because concatenating
       targets (WhatsApp) duplicate it against the OG card, which already renders `Song • Artist`
       (quick-260808-vzu). Entry: `shareIncludeTitle: false,`.

    2. `src/lib/stores/settings.svelte.ts` — FOUR touchpoints mirroring `reduceMotion` exactly
       (miss one and the setting silently fails to persist or reset):
       - declaration next to :163: `shareIncludeTitle = $state<boolean>(GENERAL_DEFAULTS.shareIncludeTitle);`
         with a one-line doc comment (`/** Include the `Song • Artist` title line in the Web Share payload (quick-260808-vzu). */`)
       - load branch next to :265: `this.shareIncludeTitle = typeof v.shareIncludeTitle === 'boolean' ? v.shareIncludeTitle : GENERAL_DEFAULTS.shareIncludeTitle;`
       - save payload next to :365: `shareIncludeTitle: this.shareIncludeTitle,`
       - `resetGeneral()` (:427): add `this.shareIncludeTitle = d.shareIncludeTitle;` and extend
         its doc comment ("app language, accent, reduce-motion, theme" → include share title).

    3. `src/routes/(app)/settings/general/+page.svelte` — copy the reduceMotion toggle idiom:
       add `Share2` to the existing `@lucide/svelte` import; add
       `function toggleShareTitle() { settings.shareIncludeTitle = !settings.shareIncludeTitle; settings.save(); }`;
       append a new `<section>` after the Playback & motion section — a `.row-toggle` button
       (`<span><Share2 size={16} /> {t('settings.shareIncludeTitle')}</span>` +
       `<span class="sw" class:on={settings.shareIncludeTitle}></span>`) followed by
       `<p class="muted">{t('settings.shareIncludeTitleDesc')}</p>`. No new `<h2>` heading —
       the row label is self-describing and a heading would force a third i18n key across 15
       locales for no information. No new styles — `.row-toggle`/`.sw` already exist in this file.

    4. i18n — add BOTH keys to ALL 15 locale files, DOUBLE QUOTES for keys and values, placed
       adjacent to the existing `settings.reduceMotion` / `settings.reduceMotionDesc` entries in
       each file (en.ts: label near :102, desc near :408; other locales mirror en's grouping).
       Use these translations verbatim (genuine, not English placeholders):
       - en: "Include title when sharing" / "Adds a title line (song • artist) above the link when you share. Off sends the link only — the link preview already shows the title."
       - zh-Hant: "分享時附上標題" / "分享時在連結上方加上一行標題（歌曲 • 歌手）。關閉時只傳送連結——連結預覽本身已會顯示標題。"
       - zh-Hans: "分享时附上标题" / "分享时在链接上方加上一行标题（歌曲 • 歌手）。关闭时只发送链接——链接预览本身已会显示标题。"
       - es: "Incluir el título al compartir" / "Añade una línea de título (canción • artista) encima del enlace al compartir. Desactivado envía solo el enlace: la vista previa ya muestra el título."
       - fr: "Inclure le titre lors du partage" / "Ajoute une ligne de titre (chanson • artiste) au-dessus du lien lors du partage. Désactivé, seul le lien est envoyé — l'aperçu du lien affiche déjà le titre."
       - de: "Titel beim Teilen einfügen" / "Fügt beim Teilen eine Titelzeile (Song • Künstler) über dem Link hinzu. Deaktiviert wird nur der Link gesendet — die Linkvorschau zeigt den Titel bereits."
       - pt: "Incluir o título ao compartilhar" / "Adiciona uma linha de título (música • artista) acima do link ao compartilhar. Desativado envia apenas o link — a prévia do link já mostra o título."
       - it: "Includi il titolo quando condividi" / "Aggiunge una riga di titolo (brano • artista) sopra il link quando condividi. Disattivato invia solo il link — l'anteprima del link mostra già il titolo."
       - ru: "Добавлять название при отправке" / "Добавляет строку с названием (песня • исполнитель) над ссылкой при отправке. Выключено — отправляется только ссылка: предпросмотр ссылки уже показывает название."
       - tr: "Paylaşırken başlığı ekle" / "Paylaşırken bağlantının üstüne bir başlık satırı (şarkı • sanatçı) ekler. Kapalıyken yalnızca bağlantı gönderilir — bağlantı önizlemesi başlığı zaten gösterir."
       - ar: "تضمين العنوان عند المشاركة" / "يضيف سطر عنوان (الأغنية • الفنان) فوق الرابط عند المشاركة. عند الإيقاف يُرسل الرابط فقط — فمعاينة الرابط تعرض العنوان بالفعل."
       - hi: "साझा करते समय शीर्षक शामिल करें" / "साझा करते समय लिंक के ऊपर एक शीर्षक पंक्ति (गाना • कलाकार) जोड़ता है। बंद होने पर केवल लिंक भेजा जाता है — लिंक प्रीव्यू में शीर्षक पहले से दिखता है।"
       - id: "Sertakan judul saat berbagi" / "Menambahkan baris judul (lagu • artis) di atas tautan saat berbagi. Jika nonaktif, hanya tautan yang dikirim — pratinjau tautan sudah menampilkan judulnya."
       - vi: "Kèm tiêu đề khi chia sẻ" / "Thêm một dòng tiêu đề (bài hát • nghệ sĩ) phía trên liên kết khi chia sẻ. Tắt thì chỉ gửi liên kết — bản xem trước liên kết đã hiển thị tiêu đề."
       - th: "แนบชื่อเพลงเมื่อแชร์" / "เพิ่มบรรทัดชื่อ (เพลง • ศิลปิน) เหนือลิงก์เมื่อแชร์ หากปิด จะส่งเฉพาะลิงก์ — ตัวอย่างลิงก์แสดงชื่อเพลงอยู่แล้ว"
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/stores/settings-persist.svelte.test.ts src/lib/i18n/i18n.test.ts src/lib/stores/settings.svelte.test.ts</automated>
  </verify>
  <done>Round-trip tests (Tasks 1 cases 4-8) GREEN; i18n key-set parity GREEN with both new keys in all 15 locales; pre-existing settings.svelte.test.ts untouched and green. The 3 structural share.test.ts cases are still RED at this point — expected, they gate Task 3.</done>
</task>

<task type="auto">
  <name>Task 3: Gate the title at the three nav.share call sites, then run the full phase gates</name>
  <files>src/lib/components/TrackMenu.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte</files>
  <action>
    At each site, replace ONLY the `nav.share({ … })` payload with the setting-gated ternary —
    the surrounding `if (nav.share) … else { clipboard fallback }` structure, every clipboard
    line, and every existing comment block (SHARE-02, OG-ZH-01, OG-EP-01, OG-PATH-02,
    quick-260723-r4p/ry1, quick-260808-urx, and the ENTIRE quick-260808-vkd block — why the
    link rides `text` not `url`) stay byte-identical:

    - TrackMenu.svelte:204 → `if (nav.share) await nav.share(settings.shareIncludeTitle ? { title: `${dTitle} • ${dArtist}`, text: url } : { text: url });`
    - album/[name]/+page.svelte:460 → `if (nav.share) await nav.share(settings.shareIncludeTitle ? { title: dArtist ? `${dName} • ${dArtist}` : dName, text: url } : { text: url });`
    - artist/[name]/+page.svelte:203 → `if (nav.share) await nav.share(settings.shareIncludeTitle ? { title, text: url } : { text: url });`

    Add `import { settings } from '$lib/stores/settings.svelte';` to TrackMenu.svelte and the
    album page (the artist page already has it at :11).

    Directly above each changed line, append a `quick-260808-vzu` comment block (below the vkd
    block, never replacing it) recording: (a) the title line is OFF by default because
    concatenating targets (WhatsApp) render `title` + `text` as two lines, duplicating the OG
    card, which already shows `Song • Artist`; (b) it is a SETTING rather than a deletion —
    the user explicitly rejected dropping it — because some users want the context inline;
    (c) the tradeoff: targets that use `title` as a subject line (email, some Slack surfaces)
    get a barer share when OFF; (d) no placeholder title when OFF — the Web Share spec needs
    at least one of title/text/url and `{ text: url }` satisfies it.

    Then run the full gates in order:
    1. `pnpm test` — expect 90 test files (89 baseline + settings-persist), ~1536 tests
       (1531 baseline + 5 round-trip; the 3 structural cases were modified in place, not added),
       0 failures.
    2. `pnpm check` — 0 errors 0 warnings (baseline 4368 files 0/0; the new test file makes it 4369).
    3. `pnpm build` — exit 0 (adapter-cloudflare).
    4. `pnpm build:native` — exit 0 (adapter-static).
    Do NOT deploy — production is ahead of this session's knowledge and its verification is the
    user's (`pnpm run deploy` is the working form if they ask later; `pnpm deploy` hits pnpm's builtin).
    Confirm constraint compliance via `git diff -U0` on the three files: removed-line set is
    exactly the three old `nav.share` lines; zero clipboard lines and zero comment lines removed.
  </action>
  <verify>
    <automated>pnpm vitest --run src/lib/services/share.test.ts && pnpm test && pnpm check && pnpm build && pnpm build:native</automated>
  </verify>
  <done>
    Structural cases GREEN (title gated at all 3 sites, no ungated `nav.share({`, no `url` member);
    full suite green at ~90 files / ~1536 tests; check 0 errors 0 warnings; both builds exit 0;
    `git diff -U0` shows no comment or clipboard-fallback lines removed.
    HONEST LIMIT (record verbatim in the SUMMARY): real share-sheet output CANNOT be verified in
    this environment — no OS share sheet exists here and no curl or unit test exercises one. The
    structural test proves the call shape only. Required device UAT (the user's): share from a
    real phone with the setting OFF → the message is the bare URL with the OG card unfurling
    beneath it; flip the setting ON in Settings → General → the `Song • Artist` line returns
    above the link.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage → settings.load() | persisted blob is user/extension-tamperable |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vzu-01 | Tampering | settings.load() shareIncludeTitle | mitigate | `typeof v.shareIncludeTitle === 'boolean'` guard → GENERAL_DEFAULTS fallback (Task 1 Test 6 proves it) |
| T-vzu-02 | Information Disclosure | nav.share payload | accept | payload carries only the already-public display title/artist and the share URL; no new data crosses the boundary — the change strictly REDUCES what is sent by default |
</threat_model>

<verification>
- RED gate observed and recorded before any production edit (Task 1) — 8 new cases fail against unmodified sources.
- `pnpm test` full suite green (~90 files / ~1536 tests, 0 failures).
- `pnpm check` 0 errors 0 warnings.
- `pnpm build` and `pnpm build:native` both exit 0.
- `git diff -U0` on the three call-site files: only the three `nav.share` lines removed; all decision-ref comments and clipboard fallbacks intact.
- No deploy performed.
</verification>

<success_criteria>
- Default (OFF): all three sites send `{ text: url }` — structurally proven; two-line WhatsApp message gone (device UAT pending, user's).
- ON: `{ title: …, text: url }` at all three sites — structurally proven.
- Setting persists (`openmusic:settings:v1`), survives corrupt values, resets with the General group — proven by genuine load()/save() round-trip tests.
- Toggle visible on Settings → General with translated label + description in all 15 locales; i18n parity green.
- vkd's `text`-not-`url` invariant still enforced by the test; every load-bearing comment survives.
</success_criteria>

<output>
Create `.planning/quick/260808-vzu-drop-title-from-navigator-share-so-the-s/260808-vzu-SUMMARY.md` when done.
</output>
