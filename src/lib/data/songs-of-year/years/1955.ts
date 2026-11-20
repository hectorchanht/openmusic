// 1955 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1955_US = {
  id: 'soy-1955-us',
  title: '1955 美國年選',
  titleEn: 'United States 1955',
  description: 'Billboard 年終 Top 30',
  free: true,
  year: 1955,
  country: 'United States'
} as const;

export const SOY_1955: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Perez Prado", title: "Cherry Pink And Apple Blossom White", note: "#1 Billboard 年終" },
    { artist: "Bill Haley、His Comets", title: "Rock Around the Clock", note: "#2 Billboard 年終" },
    { artist: "Mitch Miller", title: "The Yellow Rose of Texas", note: "#3 Billboard 年終" },
    { artist: "Roger Williams", title: "Autumn Leaves", note: "#4 Billboard 年終" },
    { artist: "Les Baxter", title: "Unchained Melody", note: "#5 Billboard 年終" },
    { artist: "Bill Hayes", title: "The Ballad of Davy Crockett", note: "#6 Billboard 年終" },
    { artist: "The Four Aces", title: "Love Is a Many-Splendored Thing", note: "#7 Billboard 年終" },
    { artist: "The McGuire Sisters", title: "Sincerely", note: "#8 Billboard 年終" },
    { artist: "Pat Boone", title: "Ain't That a Shame", note: "#9 Billboard 年終" },
    { artist: "Georgia Gibbs", title: "The Wallflower (Dance with Me, Henry)", note: "#10 Billboard 年終" },
    { artist: "Johnny Maddox", title: "The Crazy Otto Medley", note: "#11 Billboard 年終" },
    { artist: "Billy Vaughn", title: "Melody of Love", note: "#12 Billboard 年終" },
    { artist: "Tennessee Ernie Ford", title: "Sixteen Tons", note: "#13 Billboard 年終" },
    { artist: "Frank Sinatra", title: "Learnin' the Blues", note: "#14 Billboard 年終" },
    { artist: "The Fontane Sisters", title: "Hearts of Stone", note: "#15 Billboard 年終" },
    { artist: "Georgia Gibbs", title: "Tweedle Dee", note: "#16 Billboard 年終" },
    { artist: "The Four Lads", title: "Moments to Remember", note: "#17 Billboard 年終" },
    { artist: "The Chordettes", title: "Mr. Sandman", note: "#18 Billboard 年終" },
    { artist: "Joan Weber", title: "Let Me Go, Lover!", note: "#19 Billboard 年終" },
    { artist: "Nat King Cole", title: "A Blossom Fell", note: "#20 Billboard 年終" },
    { artist: "Al Hibbler", title: "Unchained Melody", note: "#21 Billboard 年終" },
    { artist: "Fess Parker", title: "The Ballad of Davy Crockett", note: "#22 Billboard 年終" },
    { artist: "Art Mooney", title: "Honey-Babe", note: "#23 Billboard 年終" },
    { artist: "Tennessee Ernie Ford", title: "The Ballad of Davy Crockett", note: "#24 Billboard 年終" },
    { artist: "Perry Como", title: "Ko Ko Mo (I Love You So)", note: "#25 Billboard 年終" },
    { artist: "Gisele MacKenzie", title: "Hard to Get", note: "#26 Billboard 年終" },
    { artist: "The Ames Brothers", title: "The Naughty Lady of Shady Lane", note: "#27 Billboard 年終" },
    { artist: "Jaye P. Morgan", title: "That's All I Want from You", note: "#28 Billboard 年終" },
    { artist: "The Platters", title: "Only You (And You Alone)", note: "#29 Billboard 年終" },
    { artist: "Somethin' Smith、the Redheads", title: "It's a Sin to Tell a Lie", note: "#30 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1955: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_30_singles_of_1955" }
};
