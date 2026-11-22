// promo-canon-extract — parse the promo copy deck's script into canon data (quick-261122-sharefeed).
//
// The promo copy deck （一按複製・推介訊息） is the message CANON for in-app sharing. The deck is a
// public page whose messages live in a plain <script> as `var LINK = "…"`, `var FULL = [ … ]` and
// `var SHORT = [ … ]` literals. This module turns that script text into the JSON the app reads
// (src/lib/services/promo-canon.json) WITHOUT evaluating it — the deck is fetched content, so it is
// parsed as data, never run.
//
// Used by:
//   - scripts/sync-promo-canon.mjs (the sync path: deck script → promo-canon.json)
//   - src/lib/services/promo-message.test.ts (the drift pin: the vendored deck snapshot and the
//     JSON the app ships must be identical)
//
// Plain ESM JS on purpose: the sync script runs under bare `node`, and vitest imports it as-is.

/**
 * Quote bare object keys (`lang: "…"` → `"lang": "…"`) OUTSIDE string literals only — the message
 * texts contain colons ("The best part: …") that a regex over the whole body would mangle.
 * @param {string} body
 */
function quoteBareKeys(body) {
	let out = '';
	let i = 0;
	while (i < body.length) {
		const ch = body[i];
		if (ch === '"') {
			// Copy the whole string literal verbatim (honouring backslash escapes).
			let j = i + 1;
			while (j < body.length && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
			out += body.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		const m = /^[A-Za-z_][A-Za-z0-9_]*(?=\s*:)/.exec(body.slice(i));
		if (m && !/[A-Za-z0-9_]/.test(body[i - 1] ?? '')) {
			out += `"${m[0]}"`;
			i += m[0].length;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/**
 * Pull one `var NAME = [ … ];` array literal out of the deck script and JSON-parse it.
 * @param {string} src
 * @param {string} name
 * @param {string} link
 */
function extractArray(src, name, link) {
	const start = src.indexOf(`var ${name} = [`);
	if (start < 0) throw new Error(`promo canon: \`var ${name}\` not found in deck script`);
	const open = src.indexOf('[', start);
	// The array closes at the first `];` after it — the literals hold no `];` inside a string.
	const close = src.indexOf('];', open);
	if (close < 0) throw new Error(`promo canon: \`var ${name}\` is not terminated`);
	let body = src.slice(open, close + 1);
	// Inline the link: the deck builds each message as "…" + LINK + "…".
	body = body.replace(/"\s*\+\s*LINK\s*\+\s*"/g, link).replace(/"\s*\+\s*LINK\b/g, `${link}"`);
	body = quoteBareKeys(body);
	// Drop trailing commas before a closing brace/bracket (JSON forbids them).
	body = body.replace(/,(\s*[}\]])/g, '$1');
	try {
		return JSON.parse(body);
	} catch (e) {
		throw new Error(`promo canon: \`var ${name}\` did not parse as data (${String(e)})`);
	}
}

/**
 * Deck script text → canon data. Throws on any shape drift so a sync can never silently ship a
 * half-parsed canon.
 * @param {string} src the deck's inline <script> text
 * @param {string} sourceUrl the public deck URL (recorded in the canon for provenance)
 */
export function extractPromoCanon(src, sourceUrl) {
	const m = /var LINK\s*=\s*"([^"]+)"/.exec(src);
	if (!m) throw new Error('promo canon: `var LINK` not found in deck script');
	const link = m[1];
	const full = extractArray(src, 'FULL', link);
	const short = extractArray(src, 'SHORT', link);
	for (const f of full) {
		if (typeof f.lang !== 'string' || typeof f.text !== 'string' || typeof f.generic !== 'string') {
			throw new Error('promo canon: a FULL entry lacks lang/text/generic');
		}
		if (!f.text.includes('{name}')) throw new Error(`promo canon: FULL ${f.lang} lacks the {name} slot`);
		if (!f.text.includes(link)) throw new Error(`promo canon: FULL ${f.lang} lacks the link`);
	}
	for (const s of short) {
		if (typeof s.lang !== 'string' || typeof s.text !== 'string') {
			throw new Error('promo canon: a SHORT entry lacks lang/text');
		}
	}
	return { source: sourceUrl, link, full, short };
}
