// 2023 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2023" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2023_US = {
  id: 'soy-2023-us',
  title: '2023 美國年選',
  titleEn: 'United States 2023',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2023,
  country: 'United States'
} as const;

export const SOY_2023: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Morgan Wallen", title: "Last Night", note: "#1 Billboard 年終" },
    { artist: "Miley Cyrus", title: "Flowers", note: "#2 Billboard 年終" },
    { artist: "SZA", title: "Kill Bill", note: "#3 Billboard 年終" },
    { artist: "Taylor Swift", title: "Anti-Hero", note: "#4 Billboard 年終" },
    { artist: "Metro Boomin, the Weeknd、21 Savage", title: "Creepin", note: "#5 Billboard 年終" },
    { artist: "Rema、Selena Gomez", title: "Calm Down", note: "#6 Billboard 年終" },
    { artist: "The Weeknd、Ariana Grande", title: "Die for You", note: "#7 Billboard 年終" },
    { artist: "Luke Combs", title: "Fast Car", note: "#8 Billboard 年終" },
    { artist: "SZA", title: "Snooze", note: "#9 Billboard 年終" },
    { artist: "David Guetta、Bebe Rexha", title: "I'm Good (Blue)", note: "#10 Billboard 年終" },
    { artist: "Sam Smith、Kim Petras", title: "Unholy", note: "#11 Billboard 年終" },
    { artist: "Morgan Wallen", title: "You Proof", note: "#12 Billboard 年終" },
    { artist: "Zach Bryan", title: "Something in the Orange", note: "#13 Billboard 年終" },
    { artist: "Drake、21 Savage", title: "Rich Flex", note: "#14 Billboard 年終" },
    { artist: "Harry Styles", title: "As It Was", note: "#15 Billboard 年終" },
    { artist: "Bailey Zimmerman", title: "Rock and a Hard Place", note: "#16 Billboard 年終" },
    { artist: "Chris Brown", title: "Under the Influence", note: "#17 Billboard 年終" },
    { artist: "Taylor Swift", title: "Cruel Summer", note: "#18 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Thinkin' Bout Me", note: "#19 Billboard 年終" },
    { artist: "PinkPantheress、Ice Spice", title: "Boy's a Liar Pt. 2", note: "#20 Billboard 年終" },
    { artist: "Toosii", title: "Favorite Song", note: "#21 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Thought You Should Know", note: "#22 Billboard 年終" },
    { artist: "Kane Brown、Katelyn Brown", title: "Thank God", note: "#23 Billboard 年終" },
    { artist: "Miguel", title: "Sure Thing", note: "#24 Billboard 年終" },
    { artist: "Lil Durk ft. J. Cole", title: "All My Life", note: "#25 Billboard 年終" },
    { artist: "Eslabon Armado、Peso Pluma", title: "Ella Baila Sola", note: "#26 Billboard 年終" },
    { artist: "Taylor Swift ft. Ice Spice", title: "Karma", note: "#27 Billboard 年終" },
    { artist: "Lil Uzi Vert", title: "Just Wanna Rock", note: "#28 Billboard 年終" },
    { artist: "Beyoncé", title: "Cuff It", note: "#29 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Vampire", note: "#30 Billboard 年終" },
    { artist: "Gunna", title: "FukUMean", note: "#31 Billboard 年終" },
    { artist: "Taylor Swift", title: "Lavender Haze", note: "#32 Billboard 年終" },
    { artist: "Coi Leray", title: "Players", note: "#33 Billboard 年終" },
    { artist: "Jelly Roll", title: "Need a Favor", note: "#34 Billboard 年終" },
    { artist: "Dua Lipa", title: "Dance the Night", note: "#35 Billboard 年終" },
    { artist: "Luke Combs", title: "Love You Anyway", note: "#36 Billboard 年終" },
    { artist: "Morgan Wallen", title: "One Thing at a Time", note: "#37 Billboard 年終" },
    { artist: "Metro Boomin, Future、Chris Brown", title: "Superhero (Heroes & Villains)", note: "#38 Billboard 年終" },
    { artist: "Steve Lacy", title: "Bad Habit", note: "#39 Billboard 年終" },
    { artist: "Yng Lvcas、Peso Pluma", title: "La Bebé", note: "#40 Billboard 年終" },
    { artist: "Jvke", title: "Golden Hour", note: "#41 Billboard 年終" },
    { artist: "Bailey Zimmerman", title: "Religiously", note: "#42 Billboard 年終" },
    { artist: "Drake、21 Savage", title: "Spin Bout U", note: "#43 Billboard 年終" },
    { artist: "Fifty Fifty", title: "Cupid", note: "#44 Billboard 年終" },
    { artist: "Drake", title: "Search & Rescue", note: "#45 Billboard 年終" },
    { artist: "Nicki Minaj、Ice Spice、Aqua", title: "Barbie World", note: "#46 Billboard 年終" },
    { artist: "Jordan Davis", title: "Next Thing You Know", note: "#47 Billboard 年終" },
    { artist: "Raye ft. 070 Shake", title: "Escapism", note: "#48 Billboard 年終" },
    { artist: "Grupo Frontera、Bad Bunny", title: "Un x100to", note: "#49 Billboard 年終" },
    { artist: "Stephen Sanchez", title: "Until I Found You", note: "#50 Billboard 年終" },
  ]
};
