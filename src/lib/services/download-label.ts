// quick-261001-grb: the one place the `artist - title` download-toast grammar lives. Callers pass
// DISPLAY-language names from names.dnArtist / names.dnTitle (stores/services stay i18n-free per
// CLAUDE.md); a blank artist yields the bare title so the toast never shows a dangling " - ".
export function downloadLabel(artist: string, title: string): string {
	return artist.trim() ? `${artist} - ${title}` : title;
}
