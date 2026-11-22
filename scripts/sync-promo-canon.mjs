#!/usr/bin/env node
// sync-promo-canon — the ONE sync path from the promo copy deck to the app (quick-261122-sharefeed).
//
// The deck （一按複製・推介訊息, public URL below) is the message CANON. The app never carries a
// hand-edited second copy: src/lib/services/promo-canon.json is GENERATED from the deck's script by
// this tool, and promo-message.test.ts fails if the JSON and the vendored deck snapshot disagree.
//
// To re-sync after the deck changes:
//   1. Open the deck URL in a browser, open devtools on the deck frame, and save the text of its
//      inline <script> (the one declaring `var LINK`, `var FULL`, `var SHORT`) to a file.
//      (The deck renders inside a sandboxed cross-origin frame, so a plain HTTP fetch of the page
//      returns only the Muse wrapper — the script has to be taken from the rendered frame.)
//   2. node scripts/sync-promo-canon.mjs <saved-script-file>
//      → rewrites src/lib/services/__fixtures__/promo-deck-script.txt (the snapshot) and
//        src/lib/services/promo-canon.json (what the app ships).
//   3. pnpm test — the drift pin and the render pins must stay green.
import { readFileSync, writeFileSync } from 'node:fs';
import { extractPromoCanon } from './promo-canon-extract.mjs';

export const DECK_URL =
	'https://muse.ai/s/yi-an-fu-zhi-tui-jie-xun-xi-ov7fxa7xmxrbkxc/A0G4C0ZgXkjYJdjOYNPhXUJMWOnMmZD-pBjZxGH0BVo';

const input = process.argv[2];
if (!input) {
	console.error('usage: node scripts/sync-promo-canon.mjs <deck-script-file>');
	process.exit(2);
}
const src = readFileSync(input, 'utf-8');
const canon = extractPromoCanon(src, DECK_URL); // throws on any shape drift
writeFileSync('src/lib/services/__fixtures__/promo-deck-script.txt', src);
writeFileSync('src/lib/services/promo-canon.json', JSON.stringify(canon, null, '\t') + '\n');
console.log(`promo canon synced: ${canon.full.length} full + ${canon.short.length} short messages`);
