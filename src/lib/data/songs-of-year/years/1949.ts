// 1949 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1949_US = {
  id: 'soy-1949-us',
  title: '1949 美國年選',
  titleEn: 'United States 1949',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1949,
  country: 'United States'
} as const;

export const SOY_1949: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Vaughn Monroe", title: "Riders in the Sky", note: "#1 Billboard 年終" },
    { artist: "Frankie Laine", title: "That Lucky Old Sun", note: "#2 Billboard 年終" },
    { artist: "Vic Damone", title: "You're Breaking My Heart", note: "#3 Billboard 年終" },
    { artist: "Perry Como", title: "Some Enchanted Evening", note: "#4 Billboard 年終" },
    { artist: "Jimmy Wakely、Margaret Whiting", title: "Slippin' Around", note: "#5 Billboard 年終" },
    { artist: "The Andrews Sisters、Gordon Jenkins", title: "I Can Dream, Can't I?", note: "#6 Billboard 年終" },
    { artist: "Russ Morgan Orchestra", title: "Cruising Down the River", note: "#7 Billboard 年終" },
    { artist: "Evelyn Knight、the Stardusters", title: "A Little Bird Told Me", note: "#8 Billboard 年終" },
    { artist: "Frankie Laine", title: "Mule Train", note: "#9 Billboard 年終" },
    { artist: "Al Morgan", title: "Jealous Heart", note: "#10 Billboard 年終" },
    { artist: "Blue Barron Orchestra", title: "Cruising Down the River", note: "#11 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Someday", note: "#12 Billboard 年終" },
    { artist: "Doris Day", title: "Again", note: "#13 Billboard 年終" },
    { artist: "Russ Morgan", title: "Forever and Ever", note: "#14 Billboard 年終" },
    { artist: "Perry Como、Mitchell Ayres", title: "Forever and Ever", note: "#15 Billboard 年終" },
    { artist: "Gordon Jenkins Orchestra", title: "Don't Cry, Joe", note: "#16 Billboard 年終" },
    { artist: "Sammy Kaye", title: "Room Full of Roses", note: "#17 Billboard 年終" },
    { artist: "Bing Crosby、Ken Darby Choir", title: "Far Away Places", note: "#18 Billboard 年終" },
    { artist: "Dinah Shore", title: "Buttons and Bows", note: "#19 Billboard 年終" },
    { artist: "Bing Crosby", title: "Galway Bay", note: "#20 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Red Roses for a Blue Lady", note: "#21 Billboard 年終" },
    { artist: "Russ Morgan", title: "So Tired", note: "#22 Billboard 年終" },
    { artist: "Evelyn Knight、the Stardusters", title: "Powder Your Face with Sunshine", note: "#23 Billboard 年終" },
    { artist: "Margaret Whiting、Johnny Mercer", title: "Baby, It's Cold Outside", note: "#24 Billboard 年終" },
    { artist: "Jo Stafford、Gordon MacRae、Paul Weston", title: "Whispering Hope", note: "#25 Billboard 年終" },
    { artist: "Dick Haymes", title: "Maybe It's Because", note: "#26 Billboard 年終" },
    { artist: "Sammy Kaye Orchestra", title: "Careless Hands", note: "#27 Billboard 年終" },
    { artist: "Perry Como、The Fontane Sisters", title: "'A' You're Adorable", note: "#28 Billboard 年終" },
    { artist: "Tommy Dorsey Orchestra、Charlie Shavers", title: "The Hucklebuck", note: "#29 Billboard 年終" },
    { artist: "Gordon Jenkins Orchestra、the Stardusters", title: "I Don't See Me in Your Eyes Anymore", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1949: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1949" }
};
