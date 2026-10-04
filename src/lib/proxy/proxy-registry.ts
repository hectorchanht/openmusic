// The ONLY place server proxy adapters are enumerated for the LEGACY path-based
// /api/[source]/[...path] catch-all route (DATA-04). Adding a source that uses the
// catch-all = a new proxy file + one import line. Sources with DEDICATED routes (e.g.
// `fivesing` at `/api/fivesing/search` + `/api/fivesing/url`) DON'T need an entry here:
// SvelteKit's explicit-route matching wins over the catch-all, so PROXIES is now a
// `Partial<Record<SourceId, ProxyAdapter>>` and the catch-all 404s any source id that
// isn't registered here.
// kuwo moved to dedicated routes (quick-261004-n1i) because its upstream needs a resolver fallback
// chain the passthrough cannot express — see $lib/proxy/kuwo.ts.
import type { ProxyAdapter } from './proxy-types';
import type { SourceId } from '../sources/types';
import { neteaseProxy } from './netease';
import { qqProxy } from './qq';
import { jooxProxy } from './joox';

export const PROXIES: Partial<Record<SourceId, ProxyAdapter>> = {
	netease: neteaseProxy,
	qq: qqProxy,
	joox: jooxProxy
};
