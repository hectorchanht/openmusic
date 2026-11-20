// download-save.ts — the anchor-download SAVE SEAM (DL-BUG-01, D-02/D-09).
//
// This REPLACES the buggy web save flow in TrackMenu.doDownload / album.downloadAlbum, which had
// two failure-prone paths this seam deliberately drops:
//   1. a File-System-Access save-picker that RE-PROMPTED on every download (D-02), and
//   2. a `catch` that navigated to the raw audio stream in a new tab on ANY failure (D-09) — the
//      "download opened a media page" bug (DL-BUG-01).
// Here a failure is a RETURN VALUE (`false`), never a navigation. The seam creates a same-origin
// `blob:` object URL, wires it onto a hidden `<a download>`, clicks it (the browser saves without
// leaving the page), and revokes the URL. It is DOM-thin but store-free and `doc`-injectable, so it
// runs in the single Vitest node project with a fake document (no jsdom).
//
// GUARDRAIL: this function's body MUST NOT re-introduce a new-tab navigation fallback nor a
// save-picker branch — those two paths ARE the bug. The co-located test greps this function's
// source to enforce their absence; keep the forbidden APIs out of the body so a future edit that
// re-adds them fails the test loudly instead of silently resurrecting DL-BUG-01.

/**
 * Save a blob to the user's Downloads via a hidden `<a download>` click. Returns `true` on a
 * successful click, `false` if the DOM / object-URL API is unavailable or the anchor throws — it
 * NEVER throws and NEVER navigates. `doc` is injectable (default `globalThis.document`) so callers
 * on the web pass nothing and the node test drives a fake document.
 */
export function saveBlobToDisk(
	blob: Blob,
	filename: string,
	doc: Document | undefined = globalThis.document
): boolean {
	// Resolve the object-URL API at call time from globalThis so the node test can stub it (and so
	// an SSR/native context without it degrades to `false` rather than throwing).
	const urlApi = globalThis.URL;
	if (
		!doc ||
		typeof doc.createElement !== 'function' ||
		!urlApi ||
		typeof urlApi.createObjectURL !== 'function'
	) {
		return false;
	}
	let href: string | null = null;
	try {
		const a = doc.createElement('a');
		href = urlApi.createObjectURL(blob);
		a.download = filename;
		a.href = href;
		a.click();
		return true;
	} catch {
		// DL-BUG-01: a failure degrades to `false` — the caller shows a toast and the song stays in
		// the library Downloads list (re-streams on tap). It does NOT navigate anywhere.
		return false;
	} finally {
		// Revoke on every exit (success or throw) so the object URL never leaks.
		if (href && typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(href);
	}
}
