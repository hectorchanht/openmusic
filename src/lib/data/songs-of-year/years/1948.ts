// 1948 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1948_US = {
  id: 'soy-1948-us',
  title: '1948 美國年選',
  titleEn: 'United States 1948',
  description: 'Billboard 年終 Top 39',
  free: true,
  year: 1948,
  country: 'United States'
} as const;

export const SOY_1948: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Pee Wee Hunt", title: "Twelfth Street Rag", note: "#1 Billboard 年終" },
    { artist: "Peggy Lee、Dave Barbour", title: "Mañana (Is Soon Enough for Me)", note: "#2 Billboard 年終" },
    { artist: "Bing Crosby、Ken Darby", title: "Now Is the Hour", note: "#3 Billboard 年終" },
    { artist: "Margaret Whiting", title: "A Tree in the Meadow", note: "#4 Billboard 年終" },
    { artist: "Jon、Sondra Steele", title: "My Happiness", note: "#5 Billboard 年終" },
    { artist: "Ken Griffin、Jerry Wayne", title: "You Can't Be True, Dear", note: "#6 Billboard 年終" },
    { artist: "Dick Haymes、Gordon Jenkins", title: "Little White Lies", note: "#7 Billboard 年終" },
    { artist: "Al Trace、Bob Vincent", title: "You Call Everybody Darlin'", note: "#8 Billboard 年終" },
    { artist: "The Pied Pipers", title: "My Happiness", note: "#9 Billboard 年終" },
    { artist: "Art Mooney", title: "I'm Looking over a Four Leaf Clover", note: "#10 Billboard 年終" },
    { artist: "Doris Day", title: "It's Magic", note: "#11 Billboard 年終" },
    { artist: "Gordon Jenkins", title: "Maybe You'll Be There", note: "#12 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Ballerina", note: "#13 Billboard 年終" },
    { artist: "King Cole、Frank De Vol", title: "Nature Boy", note: "#14 Billboard 年終" },
    { artist: "Kay Kyser、Gloria Wood", title: "Woody Woodpecker", note: "#15 Billboard 年終" },
    { artist: "Doris Day、Buddy Clark、George Siravo", title: "Love Somebody", note: "#16 Billboard 年終" },
    { artist: "Gracie Fields、Phil Green", title: "Now Is the Hour", note: "#17 Billboard 年終" },
    { artist: "Francis Craig", title: "Beg Your Pardon", note: "#18 Billboard 年終" },
    { artist: "Ken Griffin", title: "You Can't Be True, Dear", note: "#19 Billboard 年終" },
    { artist: "The Andrews Sisters、Vic Schoen", title: "Toolie Oolie Doolie", note: "#20 Billboard 年終" },
    { artist: "Dinah Shore", title: "Buttons and Bows", note: "#21 Billboard 年終" },
    { artist: "Peggy Lee、Dave Barbour", title: "Golden Earrings", note: "#22 Billboard 年終" },
    { artist: "Art Mooney", title: "Baby Face", note: "#23 Billboard 年終" },
    { artist: "Arthur Godfrey、Archie Bleyer", title: "Too Fat Polka", note: "#23 Billboard 年終" },
    { artist: "Perry Como、Russ Case", title: "Because", note: "#24 Billboard 年終" },
    { artist: "Ella Fitzgerald、the Song Spinners", title: "My Happiness", note: "#24 Billboard 年終" },
    { artist: "Sammy Kaye", title: "Serenade of the Bells", note: "#25 Billboard 年終" },
    { artist: "Tommy Dorsey", title: "Until", note: "#26 Billboard 年終" },
    { artist: "Spike Jones", title: "William Tell Overture", note: "#27 Billboard 年終" },
    { artist: "Frankie Carle", title: "Beg Your Pardon", note: "#28 Billboard 年終" },
    { artist: "Tex Beneke", title: "St. Louis Blues March", note: "#29 Billboard 年終" },
    { artist: "Primo Scala", title: "Underneath the Arches", note: "#29 Billboard 年終" },
    { artist: "Kay Kyser", title: "On a Slow Boat to China", note: "#30 Billboard 年終" },
    { artist: "The Sportsmen、Mel Blanc", title: "Woody Woodpecker", note: "#30 Billboard 年終" },
    { artist: "Ray Noble、Buddy Clark", title: "I'll Dance at Your Wedding", note: "#31 Billboard 年終" },
    { artist: "Freddy Martin", title: "The Dicky-Bird Song", note: "#32 Billboard 年終" },
    { artist: "Russ Morgan、Milt Herth", title: "I'm Looking Over a Four Leaf Clover", note: "#33 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "How Soon", note: "#34 Billboard 年終" },
    { artist: "Jo Stafford", title: "Serenade of the Bells", note: "#35 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1948: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_singles_of_1948" }
};
