// 1954 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1954_US = {
  id: 'soy-1954-us',
  title: '1954 美國年選',
  titleEn: 'United States 1954',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1954,
  country: 'United States'
} as const;

export const SOY_1954: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Kitty Kallen、Jack Pleis", title: "Little Things Mean a Lot", note: "#1 Billboard 年終" },
    { artist: "Perry Como、Hugo Winterhalter", title: "Wanted", note: "#2 Billboard 年終" },
    { artist: "Rosemary Clooney、Buddy Cole", title: "Hey There", note: "#3 Billboard 年終" },
    { artist: "The Crew-Cuts、David Carroll", title: "Sh-Boom", note: "#4 Billboard 年終" },
    { artist: "Jo Stafford、Paul Weston", title: "Make Love to Me", note: "#5 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "Oh! My Pa-Pa", note: "#6 Billboard 年終" },
    { artist: "The Four Knights", title: "(Oh Baby Mine) I Get So Lonely", note: "#7 Billboard 年終" },
    { artist: "The Four Aces ft. Al Alberts、Jack Pleis", title: "Three Coins in the Fountain", note: "#8 Billboard 年終" },
    { artist: "Doris Day、Ray Heindorf", title: "Secret Love", note: "#9 Billboard 年終" },
    { artist: "Archie Bleyer", title: "Hernando's Hideaway", note: "#10 Billboard 年終" },
    { artist: "Frank Sinatra", title: "Young at Heart", note: "#11 Billboard 年終" },
    { artist: "Rosemary Clooney、Buddy Cole", title: "This Ole House", note: "#12 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "I Need You Now", note: "#13 Billboard 年終" },
    { artist: "Patti Page", title: "Cross Over the Bridge", note: "#14 Billboard 年終" },
    { artist: "The Gaylords", title: "The Little Shoemaker", note: "#15 Billboard 年終" },
    { artist: "Dean Martin", title: "That's Amore", note: "#16 Billboard 年終" },
    { artist: "Frank Weir", title: "The Happy Wanderer", note: "#17 Billboard 年終" },
    { artist: "Nat King Cole", title: "Answer Me, My Love", note: "#18 Billboard 年終" },
    { artist: "Tony Bennett", title: "Stranger in Paradise", note: "#19 Billboard 年終" },
    { artist: "Doris Day", title: "If I Give My Heart to You", note: "#20 Billboard 年終" },
    { artist: "Kay Starr", title: "If You Love Me (Really Love Me)", note: "#21 Billboard 年終" },
    { artist: "Ralph Marterie", title: "Skokiaan", note: "#22 Billboard 年終" },
    { artist: "Don Cornell", title: "Hold My Hand", note: "#23 Billboard 年終" },
    { artist: "Patti Page", title: "Changing Partners", note: "#24 Billboard 年終" },
    { artist: "Perry Como", title: "Papa Loves Mambo", note: "#25 Billboard 年終" },
    { artist: "Bill Haley、His Comets", title: "Shake, Rattle and Roll", note: "#26 Billboard 年終" },
    { artist: "Tony Bennett、Percy Faith", title: "Rags to Riches", note: "#27 Billboard 年終" },
    { artist: "Kitty Kallen", title: "In the Chapel in the Moonlight", note: "#28 Billboard 年終" },
    { artist: "The Four Aces", title: "Stranger in Paradise", note: "#29 Billboard 年終" },
    { artist: "Tony Martin", title: "Here", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1954: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1954" }
};
