// 1947 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1947_US = {
  id: 'soy-1947-us',
  title: '1947 美國年選',
  titleEn: 'United States 1947',
  description: 'Billboard 年終 Top 47',
  free: true,
  year: 1947,
  country: 'United States'
} as const;

export const SOY_1947: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Francis Craig", title: "Near You", note: "#1 Billboard 年終" },
    { artist: "The Harmonicats", title: "Peg o' My Heart", note: "#2 Billboard 年終" },
    { artist: "Ted Weems", title: "Heartaches", note: "#3 Billboard 年終" },
    { artist: "Ray Noble Orchestra、Buddy Clark", title: "Linda", note: "#4 Billboard 年終" },
    { artist: "Tex Williams", title: "Smoke! Smoke! Smoke! (That Cigarette)", note: "#4 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "I Wish I Didn't Love You So", note: "#5 Billboard 年終" },
    { artist: "The Three Suns", title: "Peg o' My Heart", note: "#6 Billboard 年終" },
    { artist: "Al Jolson", title: "The Anniversary Song", note: "#7 Billboard 年終" },
    { artist: "Larry Green Orchestra", title: "Near You", note: "#8 Billboard 年終" },
    { artist: "Sammy Kaye", title: "That's My Desire", note: "#9 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "Ballerina", note: "#10 Billboard 年終" },
    { artist: "Freddy Martin", title: "Managua, Nicaragua", note: "#11 Billboard 年終" },
    { artist: "Art Lund", title: "Mam'selle", note: "#11 Billboard 年終" },
    { artist: "Perry Como", title: "Chi-Baba, Chi-Baba (My Bambino Go to Sleep)", note: "#12 Billboard 年終" },
    { artist: "Red Ingle、The Natural Seven、Jo Stafford", title: "Temptation (Tim-Tayshun)", note: "#12 Billboard 年終" },
    { artist: "Ted Weems、Perry Como", title: "I Wonder Who's Kissing Her Now", note: "#13 Billboard 年終" },
    { artist: "The Andrews Sisters", title: "Near You", note: "#14 Billboard 年終" },
    { artist: "Sammy Kaye", title: "The Old Lamp-Lighter", note: "#15 Billboard 年終" },
    { artist: "Perry Como", title: "When You Were Sweet Sixteen", note: "#16 Billboard 年終" },
    { artist: "Jack Owens、Eddie Ballantine", title: "How Soon", note: "#17 Billboard 年終" },
    { artist: "Arthur Godfrey", title: "Too Fat Polka", note: "#18 Billboard 年終" },
    { artist: "Eddy Howard", title: "I Wonder, I Wonder, I Wonder", note: "#19 Billboard 年終" },
    { artist: "Eddy Howard", title: "My Adobe Hacienda", note: "#19 Billboard 年終" },
    { artist: "Hoagy Carmichael", title: "Huggin' and Chalkin'", note: "#20 Billboard 年終" },
    { artist: "King Cole Trio", title: "(I Love You) For Sentimental Reasons", note: "#21 Billboard 年終" },
    { artist: "Hoagy Carmichael", title: "Ole Buttermilk Sky", note: "#21 Billboard 年終" },
    { artist: "Dick Haymes", title: "Mam'selle", note: "#22 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "You Do", note: "#22 Billboard 年終" },
    { artist: "Guy Lombardo", title: "The Anniversary Song", note: "#23 Billboard 年終" },
    { artist: "Dinah Shore", title: "The Anniversary Song", note: "#24 Billboard 年終" },
    { artist: "Bing Crosby", title: "White Christmas", note: "#24 Billboard 年終" },
    { artist: "The Mills Brothers", title: "Across the Alley from the Alamo", note: "#25 Billboard 年終" },
    { artist: "Danny Kaye、The Andrews Sisters、Vic Schoen", title: "Civilization", note: "#26 Billboard 年終" },
    { artist: "Kay Kyser", title: "The Old Lamp-Lighter", note: "#27 Billboard 年終" },
    { artist: "Count Basie", title: "Open the Door, Richard!", note: "#28 Billboard 年終" },
    { artist: "Art Lund", title: "Peg o' My Heart", note: "#28 Billboard 年終" },
    { artist: "Margaret Whiting、Frank De Vol", title: "You Do", note: "#28 Billboard 年終" },
    { artist: "Dorothy Shay", title: "Feudin' and Fightin'", note: "#29 Billboard 年終" },
    { artist: "Charlie Spivak", title: "Linda", note: "#30 Billboard 年終" },
    { artist: "Tex Beneke、the Glenn Miller Orchestra", title: "The Anniversary Song", note: "#31 Billboard 年終" },
    { artist: "Guy Lombardo", title: "Managua, Nicaragua", note: "#31 Billboard 年終" },
    { artist: "Vaughn Monroe", title: "How Soon", note: "#32 Billboard 年終" },
    { artist: "Bing Crosby、Fred Waring", title: "The Whiffenpoof Song", note: "#32 Billboard 年終" },
    { artist: "Dusty Fletcher", title: "Open the Door, Richard!", note: "#33 Billboard 年終" },
    { artist: "Eddy Howard", title: "(I Love You) For Sentimental Reasons", note: "#34 Billboard 年終" },
    { artist: "Peggy Lee、Dave Barbour", title: "Golden Earrings", note: "#35 Billboard 年終" },
    { artist: "Kay Kyser", title: "Ole Buttermilk Sky", note: "#35 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1947: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_singles_of_1947" }
};
