// 1956 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1956_US = {
  id: 'soy-1956-us',
  title: '1956 美國年選',
  titleEn: 'United States 1956',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1956,
  country: 'United States'
} as const;

export const SOY_1956: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Elvis Presley", title: "Heartbreak Hotel", note: "#1 Billboard 年終" },
    { artist: "Elvis Presley", title: "Don't Be Cruel", note: "#2 Billboard 年終" },
    { artist: "Nelson Riddle", title: "Lisbon Antigua", note: "#3 Billboard 年終" },
    { artist: "The Platters", title: "My Prayer", note: "#4 Billboard 年終" },
    { artist: "Gogi Grant", title: "The Wayward Wind", note: "#5 Billboard 年終" },
    { artist: "Elvis Presley", title: "Hound Dog", note: "#6 Billboard 年終" },
    { artist: "Les Baxter", title: "The Poor People of Paris", note: "#7 Billboard 年終" },
    { artist: "Doris Day", title: "Que Sera, Sera (Whatever Will Be, Will Be)", note: "#8 Billboard 年終" },
    { artist: "Dean Martin", title: "Memories Are Made of This", note: "#9 Billboard 年終" },
    { artist: "Kay Starr", title: "(The) Rock and Roll Waltz", note: "#10 Billboard 年終" },
    { artist: "Morris Stoloff", title: "Moonglow and Theme from Picnic", note: "#11 Billboard 年終" },
    { artist: "The Platters", title: "The Great Pretender", note: "#12 Billboard 年終" },
    { artist: "Pat Boone", title: "I Almost Lost My Mind", note: "#13 Billboard 年終" },
    { artist: "Elvis Presley", title: "I Want You, I Need You, I Love You", note: "#14 Billboard 年終" },
    { artist: "Elvis Presley", title: "Love Me Tender", note: "#15 Billboard 年終" },
    { artist: "Perry Como", title: "Hot Diggity (Dog Ziggity Boom)", note: "#16 Billboard 年終" },
    { artist: "Eddie Heywood、Hugo Winterhalter", title: "Canadian Sunset", note: "#17 Billboard 年終" },
    { artist: "Carl Perkins", title: "Blue Suede Shoes", note: "#18 Billboard 年終" },
    { artist: "Jim Lowe", title: "Green Door", note: "#19 Billboard 年終" },
    { artist: "The Four Lads", title: "No, Not Much", note: "#20 Billboard 年終" },
    { artist: "Bill Doggett", title: "Honky Tonk", note: "#21 Billboard 年終" },
    { artist: "Tennessee Ernie Ford", title: "Sixteen Tons", note: "#22 Billboard 年終" },
    { artist: "Johnnie Ray", title: "Just Walkin' in the Rain", note: "#23 Billboard 年終" },
    { artist: "Patti Page", title: "Allegheny Moon", note: "#24 Billboard 年終" },
    { artist: "Fats Domino", title: "I'm in Love Again", note: "#25 Billboard 年終" },
    { artist: "Patience、Prudence", title: "Tonight You Belong to Me", note: "#26 Billboard 年終" },
    { artist: "Gene Vincent", title: "Be-Bop-A-Lula", note: "#27 Billboard 年終" },
    { artist: "Frankie Lymon、the Teenagers", title: "Why Do Fools Fall in Love", note: "#28 Billboard 年終" },
    { artist: "The Four Lads", title: "Standing on the Corner", note: "#29 Billboard 年終" },
    { artist: "Buchanan、Goodman", title: "The Flying Saucer", note: "#30 Billboard 年終" },
    { artist: "George Cates", title: "Moonglow and Theme from Picnic", note: "#31 Billboard 年終" },
    { artist: "Cathy Carr", title: "Ivory Tower", note: "#32 Billboard 年終" },
    { artist: "Bill Haley、His Comets", title: "See You Later Alligator", note: "#33 Billboard 年終" },
    { artist: "Pat Boone", title: "I'll Be Home", note: "#34 Billboard 年終" },
    { artist: "Vic Damone", title: "On the Street Where You Live", note: "#35 Billboard 年終" },
    { artist: "The Platters", title: "(You've Got) The Magic Touch", note: "#36 Billboard 年終" },
    { artist: "The Chordettes", title: "Born to Be with You", note: "#37 Billboard 年終" },
    { artist: "Don Cherry", title: "Band of Gold", note: "#38 Billboard 年終" },
    { artist: "Perry Como", title: "More", note: "#39 Billboard 年終" },
    { artist: "Guy Mitchell", title: "Singing the Blues", note: "#40 Billboard 年終" },
    { artist: "Fats Domino", title: "Blueberry Hill", note: "#41 Billboard 年終" },
    { artist: "Sanford Clark", title: "The Fool", note: "#42 Billboard 年終" },
    { artist: "Don Robertson", title: "The Happy Whistler", note: "#43 Billboard 年終" },
    { artist: "Bing Crosby、Grace Kelly", title: "True Love", note: "#44 Billboard 年終" },
    { artist: "Little Richard", title: "Long Tall Sally", note: "#45 Billboard 年終" },
    { artist: "Teresa Brewer", title: "A Sweet Old Fashioned Girl", note: "#46 Billboard 年終" },
    { artist: "Nervous Norvus", title: "Transfusion", note: "#47 Billboard 年終" },
    { artist: "The Ames Brothers", title: "It Only Hurts for a Little While", note: "#48 Billboard 年終" },
    { artist: "Teresa Brewer", title: "A Tear Fell", note: "#49 Billboard 年終" },
    { artist: "Lonnie Donegan", title: "Rock Island Line", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1956: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_50_singles_of_1956" }
};
