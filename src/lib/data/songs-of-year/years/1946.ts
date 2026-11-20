// 1946 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1946_US = {
  id: 'soy-1946-us',
  title: '1946 美國年選',
  titleEn: 'United States 1946',
  description: 'Billboard 年終 Top 41',
  free: true,
  year: 1946,
  country: 'United States'
} as const;

export const SOY_1946: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Perry Como", title: "Prisoner of Love", note: "#1 Billboard 年終" },
    { artist: "Eddy Howard", title: "To Each His Own", note: "#2 Billboard 年終" },
    { artist: "The Ink Spots", title: "The Gypsy", note: "#3 Billboard 年終" },
    { artist: "Frank Sinatra", title: "Five Minutes More", note: "#4 Billboard 年終" },
    { artist: "Frankie Carle", title: "Rumors Are Flying", note: "#5 Billboard 年終" },
    { artist: "Frankie Carle", title: "Oh! What It Seemed to Be", note: "#6 Billboard 年終" },
    { artist: "Johnny Mercer、The Pied Pipers", title: "Personality", note: "#7 Billboard 年終" },
    { artist: "Bing Crosby、The Andrews Sisters", title: "South America, Take It Away", note: "#8 Billboard 年終" },
    { artist: "Dinah Shore", title: "The Gypsy", note: "#9 Billboard 年終" },
    { artist: "Frank Sinatra", title: "Oh! What It Seemed to Be", note: "#10 Billboard 年終" },
    { artist: "Perry Como", title: "Surrender", note: "#11 Billboard 年終" },
    { artist: "Betty Hutton", title: "Doctor, Lawyer, Indian Chief", note: "#12 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Let It Snow! Let It Snow! Let It Snow!", note: "#13 Billboard 年終" },
    { artist: "Freddy Martin", title: "To Each His Own", note: "#14 Billboard 年終" },
    { artist: "Kay Kyser", title: "Ole Buttermilk Sky", note: "#15 Billboard 年終" },
    { artist: "The Ink Spots", title: "To Each His Own", note: "#16 Billboard 年終" },
    { artist: "Freddy Martin", title: "Symphony", note: "#17 Billboard 年終" },
    { artist: "Sammy Kaye", title: "The Old Lamp-Lighter", note: "#18 Billboard 年終" },
    { artist: "Bing Crosby、Carmen Cavallaro", title: "I Can't Begin to Tell You", note: "#19 Billboard 年終" },
    { artist: "Sammy Kaye", title: "I'm a Big Girl Now", note: "#19 Billboard 年終" },
    { artist: "Bing Crosby", title: "Symphony", note: "#20 Billboard 年終" },
    { artist: "Sammy Kaye", title: "The Gypsy", note: "#21 Billboard 年終" },
    { artist: "Dinah Shore、the Spade Cooley Orchestra", title: "Doin' What Comes Natur'lly", note: "#21 Billboard 年終" },
    { artist: "Dinah Shore", title: "Laughing on the Outside (Crying on the Inside)", note: "#22 Billboard 年終" },
    { artist: "Tex Beneke、the Glenn Miller Orchestra", title: "Five Minutes More", note: "#23 Billboard 年終" },
    { artist: "Andy Russell", title: "Laughing on the Outside (Crying on the Inside)", note: "#24 Billboard 年終" },
    { artist: "Tex Beneke、the Glenn Miller Orchestra", title: "Hey! Ba-Ba-Re-Bop", note: "#25 Billboard 年終" },
    { artist: "Perry Como", title: "They Say It's Wonderful", note: "#25 Billboard 年終" },
    { artist: "Tony Martin", title: "To Each His Own", note: "#25 Billboard 年終" },
    { artist: "Les Brown", title: "You Won't Be Satisfied (Until You Break My Heart)", note: "#26 Billboard 年終" },
    { artist: "Benny Goodman", title: "Symphony", note: "#27 Billboard 年終" },
    { artist: "Charlie Spivak", title: "Oh! What It Seemed to Be", note: "#28 Billboard 年終" },
    { artist: "Freddy Martin", title: "Doin' What Comes Natur'lly", note: "#28 Billboard 年終" },
    { artist: "Kay Kyser", title: "The Old Lamp-Lighter", note: "#28 Billboard 年終" },
    { artist: "Dick Haymes、Helen Forrest", title: "Oh! What It Seemed to Be", note: "#29 Billboard 年終" },
    { artist: "The Andrews Sisters、Les Paul Trio", title: "Rumors Are Flying", note: "#30 Billboard 年終" },
    { artist: "Perry Como", title: "Dig You Later (A Hubba-Hubba-Hubba)", note: "#31 Billboard 年終" },
    { artist: "Jo Stafford", title: "Symphony", note: "#32 Billboard 年終" },
    { artist: "The Modernaires、Paula Kelly", title: "To Each His Own", note: "#33 Billboard 年終" },
    { artist: "Bing Crosby、the Jesters", title: "Sioux City Sue", note: "#34 Billboard 年終" },
    { artist: "King Cole Trio", title: "(I Love You) For Sentimental Reasons", note: "#35 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1946: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_singles_of_1946" }
};
