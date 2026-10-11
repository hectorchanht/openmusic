// 1951 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1951_US = {
  id: 'soy-1951-us',
  title: '1951 美國年選',
  titleEn: 'United States 1951',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1951,
  country: 'United States'
} as const;

export const SOY_1951: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Nat King Cole、Les Baxter", title: "Too Young", note: "#1 Billboard 年終" },
    { artist: "Tony Bennett、Percy Faith", title: "Because of You", note: "#2 Billboard 年終" },
    { artist: "Les Paul、Mary Ford", title: "How High the Moon", note: "#3 Billboard 年終" },
    { artist: "Rosemary Clooney", title: "Come On-a My House", note: "#4 Billboard 年終" },
    { artist: "Mario Lanza、Ray Sinatra、Jeff Alexander", title: "Be My Love", note: "#5 Billboard 年終" },
    { artist: "The Weavers、Terry Gilkyson、Vic Schoen", title: "On Top of Old Smoky", note: "#6 Billboard 年終" },
    { artist: "Tony Bennett、Percy Faith", title: "Cold, Cold Heart", note: "#7 Billboard 年終" },
    { artist: "Perry Como、Mitchell Ayres", title: "If", note: "#8 Billboard 年終" },
    { artist: "Mario Lanza", title: "The Loveliest Night of the Year", note: "#9 Billboard 年終" },
    { artist: "Patti Page", title: "Tennessee Waltz", note: "#10 Billboard 年終" },
    { artist: "Frankie Laine、The Norman Luboff Choir、Mitch Miller", title: "Jezebel", note: "#11 Billboard 年終" },
    { artist: "Tony Martin、Henri René", title: "I Get Ideas", note: "#12 Billboard 年終" },
    { artist: "Les Paul、Mary Ford", title: "Mockin' Bird Hill", note: "#13 Billboard 年終" },
    { artist: "Patti Page", title: "Mockin' Bird Hill", note: "#14 Billboard 年終" },
    { artist: "Guy Mitchell、Mitch Miller", title: "My Heart Cries for You", note: "#15 Billboard 年終" },
    { artist: "Eddy Howard", title: "(It's No) Sin", note: "#16 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Sound Off", note: "#17 Billboard 年終" },
    { artist: "Dinah Shore、Henri René", title: "Sweet Violets", note: "#18 Billboard 年終" },
    { artist: "Les Paul、Mary Ford", title: "The World Is Waiting for the Sunrise", note: "#19 Billboard 年終" },
    { artist: "Guy Mitchell、Mitch Miller", title: "My Truly, Truly Fair", note: "#20 Billboard 年終" },
    { artist: "The Four Aces", title: "(It's No) Sin", note: "#21 Billboard 年終" },
    { artist: "Debbie Reynolds、Carleton Carpenter、Georgie Stoll", title: "Aba Daba Honeymoon", note: "#22 Billboard 年終" },
    { artist: "Frankie Laine、The Norman Luboff Choir、Paul Weston", title: "Rose, Rose, I Love You", note: "#23 Billboard 年終" },
    { artist: "Del Wood", title: "Down Yonder", note: "#24 Billboard 年終" },
    { artist: "Billy Eckstine", title: "I Apologize", note: "#25 Billboard 年終" },
    { artist: "Patti Page", title: "Would I Love You (Love You, Love You)", note: "#26 Billboard 年終" },
    { artist: "Perry Como、The Fontane Sisters、Mitchell Ayres", title: "You're Just in Love", note: "#27 Billboard 年終" },
    { artist: "Ames Brothers、The Les Brown Orchestra", title: "Undecided", note: "#28 Billboard 年終" },
    { artist: "Phil Harris、Walter Scharf", title: "The Thing", note: "#29 Billboard 年終" },
    { artist: "Les Baxter", title: "Because of You", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1951: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1951" }
};
