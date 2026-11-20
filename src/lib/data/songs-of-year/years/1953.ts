// 1953 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1953_US = {
  id: 'soy-1953-us',
  title: '1953 美國年選',
  titleEn: 'United States 1953',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1953,
  country: 'United States'
} as const;

export const SOY_1953: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Percy Faith ft. Felicia Sanders", title: "The Song from Moulin Rouge", note: "#1 Billboard 年終" },
    { artist: "Les Paul、Mary Ford", title: "Vaya con Dios", note: "#2 Billboard 年終" },
    { artist: "Patti Page", title: "(How Much Is) That Doggie in the Window?", note: "#3 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "I'm Walking Behind You", note: "#4 Billboard 年終" },
    { artist: "Ames Brothers、Hugo Winterhalter", title: "You, You, You", note: "#5 Billboard 年終" },
    { artist: "Teresa Brewer、Jack Pleis", title: "Till I Waltz Again with You", note: "#6 Billboard 年終" },
    { artist: "Les Baxter", title: "April in Portugal", note: "#7 Billboard 年終" },
    { artist: "Perry Como、Henri René", title: "No Other Love", note: "#8 Billboard 年終" },
    { artist: "Perry Como", title: "Don't Let the Stars Get in Your Eyes", note: "#9 Billboard 年終" },
    { artist: "Frankie Laine、Paul Weston", title: "I Believe", note: "#10 Billboard 年終" },
    { artist: "Pee Wee Hunt", title: "Oh", note: "#11 Billboard 年終" },
    { artist: "Frank Chacksfield", title: "Ebb Tide", note: "#12 Billboard 年終" },
    { artist: "Nat King Cole、Nelson Riddle", title: "Pretend", note: "#13 Billboard 年終" },
    { artist: "Richard Hayman", title: "Ruby", note: "#14 Billboard 年終" },
    { artist: "Stan Freberg", title: "St. George and the Dragonet", note: "#15 Billboard 年終" },
    { artist: "The Hilltoppers", title: "P.S. I Love You", note: "#16 Billboard 年終" },
    { artist: "The Gaylords", title: "Tell Me You're Mine", note: "#17 Billboard 年終" },
    { artist: "Julius La Rosa", title: "Eh, Cumpari!", note: "#18 Billboard 年終" },
    { artist: "Tony Bennett、Percy Faith", title: "Rags to Riches", note: "#19 Billboard 年終" },
    { artist: "Silvana Mangano", title: "Anna", note: "#20 Billboard 年終" },
    { artist: "Perry Como", title: "Say You're Mine Again", note: "#21 Billboard 年終" },
    { artist: "Ray Anthony", title: "Dragnet", note: "#22 Billboard 年終" },
    { artist: "Jimmy Boyd、Frankie Laine", title: "Tell Me a Story", note: "#23 Billboard 年終" },
    { artist: "June Valli", title: "Crying in the Chapel", note: "#24 Billboard 年終" },
    { artist: "Joni James、Lew Douglas", title: "Why Don't You Believe Me?", note: "#25 Billboard 年終" },
    { artist: "Joni James、Lew Douglas", title: "Your Cheatin' Heart", note: "#26 Billboard 年終" },
    { artist: "Frank Chacksfield", title: "Limelight (Terry's Theme)", note: "#27 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "With These Hands", note: "#28 Billboard 年終" },
    { artist: "Eartha Kitt、Henri René", title: "C'est si bon", note: "#29 Billboard 年終" },
    { artist: "Joni James、the Jack Halloran Choir、Lew Douglas", title: "Have You Heard?", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1953: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1953" }
};
