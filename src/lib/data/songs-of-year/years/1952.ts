// 1952 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1952_US = {
  id: 'soy-1952-us',
  title: '1952 美國年選',
  titleEn: 'United States 1952',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1952,
  country: 'United States'
} as const;

export const SOY_1952: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Leroy Anderson", title: "Blue Tango", note: "#1 Billboard 年終" },
    { artist: "Kay Starr", title: "Wheel of Fortune", note: "#2 Billboard 年終" },
    { artist: "Johnnie Ray、The Four Lads", title: "Cry", note: "#3 Billboard 年終" },
    { artist: "Jo Stafford、Paul Weston", title: "You Belong to Me", note: "#4 Billboard 年終" },
    { artist: "Vera Lynn、Her Majesty's Forces、Roland Shaw", title: "Auf Wiederseh'n, Sweetheart", note: "#5 Billboard 年終" },
    { artist: "Rosemary Clooney、Percy Faith", title: "Half as Much", note: "#6 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "Wish You Were Here", note: "#7 Billboard 年終" },
    { artist: "Patti Page", title: "I Went to Your Wedding", note: "#8 Billboard 年終" },
    { artist: "Al Martino", title: "Here in My Heart", note: "#9 Billboard 年終" },
    { artist: "Percy Faith、Stan Freeman", title: "Delicado", note: "#10 Billboard 年終" },
    { artist: "Georgia Gibbs、Glenn Osser", title: "Kiss of Fire", note: "#11 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "Anytime", note: "#12 Billboard 年終" },
    { artist: "The Four Aces ft. Al Alberts", title: "Tell Me Why", note: "#13 Billboard 年終" },
    { artist: "Ella Mae Morse、Nelson Riddle", title: "The Blacksmith Blues", note: "#14 Billboard 年終" },
    { artist: "Jo Stafford、Paul Weston、The Norman Luboff Choir", title: "Jambalaya (On the Bayou)", note: "#15 Billboard 年終" },
    { artist: "Rosemary Clooney", title: "Botch-a-Me (Ba-Ba-Baciami Piccina)", note: "#16 Billboard 年終" },
    { artist: "Doris Day、Paul Weston", title: "A Guy Is a Guy", note: "#17 Billboard 年終" },
    { artist: "Johnnie Ray、The Four Lads", title: "The Little White Cloud That Cried", note: "#18 Billboard 年終" },
    { artist: "Frankie Laine", title: "High Noon", note: "#19 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "I'm Yours", note: "#20 Billboard 年終" },
    { artist: "The Mills Brothers、Hal McIntyre", title: "The Glow-Worm", note: "#21 Billboard 年終" },
    { artist: "Johnny Standley、Horace Heidt", title: "It's in the Book", note: "#22 Billboard 年終" },
    { artist: "Pee Wee King、Redd Stewart", title: "Slow Poke", note: "#23 Billboard 年終" },
    { artist: "Johnnie Ray、Buddy Cole", title: "Walkin' My Baby Back Home", note: "#24 Billboard 年終" },
    { artist: "Les Paul", title: "Meet Mister Callaghan", note: "#25 Billboard 年終" },
    { artist: "Don Cornell、Norman Leyden", title: "I'm Yours", note: "#26 Billboard 年終" },
    { artist: "Don Cornell、Norman Leyden", title: "I'll Walk Alone", note: "#27 Billboard 年終" },
    { artist: "Eddie Fisher、Hugo Winterhalter", title: "Tell Me Why", note: "#28 Billboard 年終" },
    { artist: "The Hilltoppers", title: "Trying", note: "#29 Billboard 年終" },
    { artist: "Johnnie Ray、The Four Lads", title: "Please, Mr. Sun", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1952: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1952" }
};
