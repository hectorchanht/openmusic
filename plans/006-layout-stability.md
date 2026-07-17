# 006 — Layout Stability (Domain 5, LOW)

**Severity:** LOW
**Edited file:** `src/lib/components/NowPlaying.svelte` only.

## Executed item — tabular-nums on the time readout
`.times` renders `fmtTime` in proportional Inter; digit-width variance (`1:11` vs `1:44`) nudges the
left readout's right edge every second. `.st-readout`/`.st-badge` already use `tabular-nums`; the
main progress readout does not.

**Fix** (also applied as part of plan 002 Part D — idempotent; if 002 already added it, this is a
no-op verification): `.times` gains `font-variant-numeric: tabular-nums;` (line ~1601).

```css
	.times { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; font-variant-numeric: tabular-nums; }
```

## Deferred to manual review (LOW, not executed)
- **Error + sleep-timer row insertion shift.** `{#if player.error}` (line 1272) and
  `{#if sleepTimer.active}` (line 1287) insert in normal flow between meta and transport, shifting
  the transport down when toggled. Both are rare/transient. Reserving space (min-height or absolute
  overlay) risks disturbing the measured `halfOffset` math (`transportEl.getBoundingClientRect()`),
  which is load-bearing for the sheet snap. **Left for manual review** — not worth the snap-math
  risk for a rare transient shift.

## Verification
`pnpm check`. In app: the current-time readout no longer jitters horizontally as seconds tick.
