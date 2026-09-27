// /turnstile-bridge — the page the Android app frames to get a Turnstile token on the real
// hostname (quick-260926-ot5). Why a route and not a static file: see
// $lib/proxy/turnstile-bridge-page.ts. THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS.

import type { RequestHandler } from './$types';
import { BRIDGE_PAGE_HTML, BRIDGE_HEADERS } from '$lib/proxy/turnstile-bridge-page';

export const GET: RequestHandler = () => new Response(BRIDGE_PAGE_HTML, { headers: BRIDGE_HEADERS });
