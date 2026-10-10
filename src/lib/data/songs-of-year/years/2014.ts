// 2014 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2014" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2014_US = {
  id: 'soy-2014-us',
  title: '2014 美國年選',
  titleEn: 'United States 2014',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2014,
  country: 'United States'
} as const;

export const SOY_2014: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Pharrell Williams", title: "Happy", note: "#1 Billboard 年終" },
    { artist: "Katy Perry ft. Juicy J", title: "Dark Horse", note: "#2 Billboard 年終" },
    { artist: "John Legend", title: "All of Me", note: "#3 Billboard 年終" },
    { artist: "Iggy Azalea ft. Charli XCX", title: "Fancy", note: "#4 Billboard 年終" },
    { artist: "OneRepublic", title: "Counting Stars", note: "#5 Billboard 年終" },
    { artist: "Jason Derulo ft. 2 Chainz", title: "Talk Dirty", note: "#6 Billboard 年終" },
    { artist: "Magic!", title: "Rude", note: "#7 Billboard 年終" },
    { artist: "Meghan Trainor", title: "All About That Bass", note: "#8 Billboard 年終" },
    { artist: "Ariana Grande ft. Iggy Azalea", title: "Problem", note: "#9 Billboard 年終" },
    { artist: "Sam Smith", title: "Stay with Me", note: "#10 Billboard 年終" },
    { artist: "Pitbull ft. Kesha", title: "Timber", note: "#11 Billboard 年終" },
    { artist: "Bastille", title: "Pompeii", note: "#12 Billboard 年終" },
    { artist: "Taylor Swift", title: "Shake It Off", note: "#13 Billboard 年終" },
    { artist: "Nico、Vinz", title: "Am I Wrong", note: "#14 Billboard 年終" },
    { artist: "DJ Snake、Lil Jon", title: "Turn Down for What", note: "#15 Billboard 年終" },
    { artist: "Eminem ft. Rihanna", title: "The Monster", note: "#16 Billboard 年終" },
    { artist: "A Great Big World、Christina Aguilera", title: "Say Something", note: "#17 Billboard 年終" },
    { artist: "Lorde", title: "Team", note: "#18 Billboard 年終" },
    { artist: "Passenger", title: "Let Her Go", note: "#19 Billboard 年終" },
    { artist: "Lorde", title: "Royals", note: "#20 Billboard 年終" },
    { artist: "Idina Menzel", title: "Let It Go", note: "#21 Billboard 年終" },
    { artist: "Avicii", title: "Wake Me Up", note: "#22 Billboard 年終" },
    { artist: "Imagine Dragons", title: "Demons", note: "#23 Billboard 年終" },
    { artist: "One Direction", title: "Story of My Life", note: "#24 Billboard 年終" },
    { artist: "Sia", title: "Chandelier", note: "#25 Billboard 年終" },
    { artist: "Iggy Azalea ft. Rita Ora", title: "Black Widow", note: "#26 Billboard 年終" },
    { artist: "Jessie J, Ariana Grande、Nicki Minaj", title: "Bang Bang", note: "#27 Billboard 年終" },
    { artist: "Disclosure ft. Sam Smith", title: "Latch", note: "#28 Billboard 年終" },
    { artist: "Maroon 5", title: "Maps", note: "#29 Billboard 年終" },
    { artist: "Chris Brown ft. Lil Wayne、French Montana or Too Short or Tyga", title: "Loyal", note: "#30 Billboard 年終" },
    { artist: "American Authors", title: "Best Day of My Life", note: "#31 Billboard 年終" },
    { artist: "Tove Lo", title: "Habits (Stay High)", note: "#32 Billboard 年終" },
    { artist: "Calvin Harris", title: "Summer", note: "#33 Billboard 年終" },
    { artist: "Charli XCX", title: "Boom Clap", note: "#34 Billboard 年終" },
    { artist: "Beyoncé ft. Jay-Z", title: "Drunk in Love", note: "#35 Billboard 年終" },
    { artist: "Nicki Minaj", title: "Anaconda", note: "#36 Billboard 年終" },
    { artist: "Ariana Grande ft. Zedd", title: "Break Free", note: "#37 Billboard 年終" },
    { artist: "Enrique Iglesias ft. Descemer Bueno、Gente de Zona", title: "Bailando", note: "#38 Billboard 年終" },
    { artist: "Ellie Goulding", title: "Burn", note: "#39 Billboard 年終" },
    { artist: "Jason Derulo ft. Snoop Dogg", title: "Wiggle", note: "#40 Billboard 年終" },
    { artist: "Clean Bandit ft. Jess Glynne", title: "Rather Be", note: "#41 Billboard 年終" },
    { artist: "Jeremih ft. YG", title: "Don't Tell 'Em", note: "#42 Billboard 年終" },
    { artist: "Kid Ink ft. Chris Brown", title: "Show Me", note: "#43 Billboard 年終" },
    { artist: "Miley Cyrus", title: "Wrecking Ball", note: "#44 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Not a Bad Thing", note: "#45 Billboard 年終" },
    { artist: "Katy Perry", title: "Roar", note: "#46 Billboard 年終" },
    { artist: "Paramore", title: "Ain't It Fun", note: "#47 Billboard 年終" },
    { artist: "Aloe Blacc", title: "The Man", note: "#48 Billboard 年終" },
    { artist: "Florida Georgia Line ft. Luke Bryan", title: "This Is How We Roll", note: "#49 Billboard 年終" },
    { artist: "MKTO", title: "Classic", note: "#50 Billboard 年終" },
  ]
};
