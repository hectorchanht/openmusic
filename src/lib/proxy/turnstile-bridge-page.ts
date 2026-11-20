// quick-260926-ot5 — the Turnstile bridge page the Android (Capacitor) app frames to post comments.
//
// WHY A BRIDGE: the APK's WebView origin is https://localhost, so a widget rendered there reports
// hostname "localhost", which the production siteverify allowlist (openmusic.lol only) rejects by
// design. Framing THIS page from https://openmusic.lol gives the widget the real hostname, and the
// token comes back to the app over postMessage. Rejected alternatives: allowlisting localhost in
// production (Cloudflare's Spin guidance forbids it — anyone could mint tokens from a local page)
// and changing Capacitor's server.hostname (a new WebView origin wipes every user's localStorage +
// IndexedDB: library, settings, downloaded audio).
//
// WHY A ROUTE, NOT static/turnstile-bridge.html: Cloudflare Pages 308-redirects `/x.html` to `/x`,
// and `/x` is not a static asset, so it fell through to the worker and 404'd (measured with
// `wrangler pages dev`). A +server.ts at /turnstile-bridge answers at one exact path, sets
// frame-ancestors in code (no `_headers` file whose path could stop matching), and builds the page
// from the app's own constants, so the sitekey, action and message names cannot drift.
//
// Plain `.ts` with no runes and no browser access at module top level, so the route can import it.

import { TURNSTILE_SITEKEY } from '$lib/services/turnstile-widget';
import { BRIDGE_MSG } from '$lib/services/turnstile-bridge';

/** The WebView origins allowed to frame the bridge AND to receive its token. */
export const BRIDGE_PARENTS = ['https://localhost', 'capacitor://localhost'] as const;

/** Must equal the server's expected siteverify action (routes/api/comments). */
export const BRIDGE_ACTION = 'comment';

export const BRIDGE_HEADERS: Record<string, string> = {
	'content-type': 'text/html; charset=utf-8',
	// Only the Capacitor WebView may frame this page (clickjacking / token farming via framing).
	// frame-ancestors supersedes X-Frame-Options, which cannot express an allowlist.
	'Content-Security-Policy': `frame-ancestors ${BRIDGE_PARENTS.join(' ')}`,
	'X-Robots-Tag': 'noindex',
	'Cache-Control': 'public, max-age=300'
};

// Every interpolated value is a compile-time constant, JSON-encoded so it is a valid JS literal.
const J = JSON.stringify;

/**
 * The bridge document. The handshake: the parent posts `hello`; the page remembers that parent's
 * window + origin (only if the origin is allowlisted AND the sender is window.parent) and sends
 * every token/clear ONLY to that origin — never a wildcard. `reset` from the same parent re-arms
 * the single-use widget. `omTsReady` is defined BEFORE the async api.js tag that calls it.
 */
export const BRIDGE_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Turnstile</title>
<style>html,body{margin:0;background:transparent;overflow:hidden}</style>
<script>
'use strict';
var ALLOWED = ${J(BRIDGE_PARENTS)};
var parentWin = null, parentOrigin = null, token = '', widgetId = null;
function send(msg) { if (parentWin && parentOrigin) parentWin.postMessage(msg, parentOrigin); }
window.addEventListener('message', function (e) {
	if (ALLOWED.indexOf(e.origin) < 0 || e.source !== window.parent) return;
	var d = e.data || {};
	if (d.type === ${J(BRIDGE_MSG.hello)}) {
		parentWin = e.source;
		parentOrigin = e.origin;
		if (token) send({ type: ${J(BRIDGE_MSG.token)}, token: token });
	} else if (d.type === ${J(BRIDGE_MSG.reset)} && e.source === parentWin && widgetId !== null && window.turnstile) {
		token = '';
		window.turnstile.reset(widgetId);
	}
});
window.omTsReady = function () {
	widgetId = window.turnstile.render('#ts', {
		sitekey: ${J(TURNSTILE_SITEKEY)},
		action: ${J(BRIDGE_ACTION)},
		theme: 'auto',
		size: 'flexible',
		callback: function (t) { token = t; send({ type: ${J(BRIDGE_MSG.token)}, token: t }); },
		'expired-callback': function () { token = ''; send({ type: ${J(BRIDGE_MSG.clear)} }); },
		'error-callback': function () { token = ''; send({ type: ${J(BRIDGE_MSG.clear)} }); }
	});
};
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=omTsReady" async defer></script>
</head>
<body><div id="ts"></div></body>
</html>
`;
