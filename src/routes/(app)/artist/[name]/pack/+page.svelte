<script lang="ts">
	// quick-261023-discmerge: the Discography Pack page is MERGED into /artist/[name]/albums
	// (the single album entrance). This route stays as a redirect so old links / deep links
	// don't die. The app is an SPA (ssr=false), so a client-side redirect is enough.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	$effect(() => {
		const n = page.params.name ?? '';
		goto(`/artist/${encodeURIComponent(n)}/albums`, { replaceState: true });
	});
</script>
