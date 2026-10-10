<script lang="ts">
	// /charts/songs-of-year/[year] — redirect to the hub with ?year= preselected
	// (the hub owns the year picker; this keeps a bare /2024 URL useful).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	onMount(() => {
		goto(`/charts/songs-of-year?year=${encodeURIComponent(page.params.year ?? '')}`, {
			replaceState: true
		});
	});
</script>
