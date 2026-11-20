// 1950 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1950_US = {
  id: 'soy-1950-us',
  title: '1950 美國年選',
  titleEn: 'United States 1950',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1950,
  country: 'United States'
} as const;

export const SOY_1950: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Gordon Jenkins、The Weavers", title: "Goodnight Irene", note: "#1 Billboard 年終" },
    { artist: "Nat King Cole", title: "Mona Lisa", note: "#2 Billboard 年終" },
    { artist: "Anton Karas", title: "Third Man Theme", note: "#3 Billboard 年終" },
    { artist: "Gary、Bing Crosby、Matty Matlock", title: "Sam's Song", note: "#4 Billboard 年終" },
    { artist: "Gary、Bing Crosby、Matty Matlock", title: "Play a Simple Melody", note: "#5 Billboard 年終" },
    { artist: "Teresa Brewer", title: "Music, Music, Music", note: "#6 Billboard 年終" },
    { artist: "Guy Lombardo", title: "Third Man Theme", note: "#7 Billboard 年終" },
    { artist: "Red Foley", title: "Chattanoogie Shoe Shine Boy", note: "#8 Billboard 年終" },
    { artist: "Sammy Kaye", title: "Harbor Lights", note: "#9 Billboard 年終" },
    { artist: "Sammy Kaye、Don Cornell", title: "It Isn't Fair", note: "#10 Billboard 年終" },
    { artist: "Eileen Barton、Morty Craft", title: "If I Knew You Were Coming I'd have Baked a Cake", note: "#11 Billboard 年終" },
    { artist: "Kay Starr、Lou Busch", title: "Bonaparte's Retreat", note: "#12 Billboard 年終" },
    { artist: "Gordon Jenkins、The Weavers", title: "Tzena, Tzena, Tzena", note: "#13 Billboard 年終" },
    { artist: "Tony Martin、Henri René", title: "There's No Tomorrow", note: "#14 Billboard 年終" },
    { artist: "Phil Harris、Walter Scharf", title: "The Thing", note: "#15 Billboard 年終" },
    { artist: "Ames Brothers", title: "Sentimental Me", note: "#16 Billboard 年終" },
    { artist: "Andrews Sisters、Gordon Jenkins", title: "I Wanna Be Loved", note: "#17 Billboard 年終" },
    { artist: "Patti Page", title: "Tennessee Waltz", note: "#18 Billboard 年終" },
    { artist: "Andrews Sisters、Gordon Jenkins", title: "I Can Dream, Can't I", note: "#19 Billboard 年終" },
    { artist: "Kay Starr、Tennessee Ernie Ford", title: "I'll Never Be Free", note: "#20 Billboard 年終" },
    { artist: "Patti Page", title: "All My Love", note: "#21 Billboard 年終" },
    { artist: "Gordon Jenkins", title: "My Foolish Heart", note: "#22 Billboard 年終" },
    { artist: "Ames Brothers", title: "Rag Mop", note: "#23 Billboard 年終" },
    { artist: "Bill Snyder", title: "Bewitched", note: "#24 Billboard 年終" },
    { artist: "Perry Como、The Fontane Sisters、Mitchell Ayres", title: "Hoop-Dee-Doo", note: "#25 Billboard 年終" },
    { artist: "Gordon Jenkins", title: "Bewitched", note: "#26 Billboard 年終" },
    { artist: "Ames Brothers", title: "Can Anyone Explain?", note: "#27 Billboard 年終" },
    { artist: "Billy Eckstine", title: "My Foolish Heart", note: "#28 Billboard 年終" },
    { artist: "Bing Crosby、Judd Conlon、Perry Botkin", title: "Dear Hearts and Gentle People", note: "#29 Billboard 年終" },
    { artist: "Frankie Laine、Carl T. Fischer", title: "The Cry of the Wild Goose", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1950: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1950" }
};
