<script lang="ts">
	// quick-261023-albumurl: the 2-segment album route now renders the REAL album page
	// (Hector: in-app nav + the address bar use /album/{artist}/{name}, matching the share
	// links). No code duplication: it reuses the one implementation at ../../[name]/+page.svelte.
	// The artist rides path segment 1 here, so that component reads the loader-decoded
	// `data.artist` first and falls back to the legacy `?artist=` carrier (old links keep working).
	//
	// SSR-SAFETY: the imported component's module top has no store/window/document access
	// (audited 24-04 for its own route), so importing it keeps this route's SSR OG head intact —
	// the loader below still emits the carrier-free crawler card from the path segments.
	import AlbumPage from '../../[name]/+page.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AlbumPage data={data} />
