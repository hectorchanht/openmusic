// 1957 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1957_US = {
  id: 'soy-1957-us',
  title: '1957 美國年選',
  titleEn: 'United States 1957',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1957,
  country: 'United States'
} as const;

export const SOY_1957: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Elvis Presley", title: "All Shook Up", note: "#1 Billboard 年終" },
    { artist: "Pat Boone", title: "Love Letters in the Sand", note: "#2 Billboard 年終" },
    { artist: "The Diamonds", title: "Little Darlin'", note: "#3 Billboard 年終" },
    { artist: "Tab Hunter", title: "Young Love", note: "#4 Billboard 年終" },
    { artist: "Jimmy Dorsey", title: "So Rare", note: "#5 Billboard 年終" },
    { artist: "Pat Boone", title: "Don't Forbid Me", note: "#6 Billboard 年終" },
    { artist: "Guy Mitchell", title: "Singing the Blues", note: "#7 Billboard 年終" },
    { artist: "Sonny James", title: "Young Love", note: "#8 Billboard 年終" },
    { artist: "Elvis Presley", title: "Too Much", note: "#9 Billboard 年終" },
    { artist: "Perry Como", title: "Round and Round", note: "#10 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Bye Bye Love", note: "#11 Billboard 年終" },
    { artist: "Debbie Reynolds", title: "Tammy", note: "#12 Billboard 年終" },
    { artist: "Buddy Knox", title: "Party Doll", note: "#13 Billboard 年終" },
    { artist: "Elvis Presley", title: "(Let Me Be Your) Teddy Bear", note: "#14 Billboard 年終" },
    { artist: "Harry Belafonte", title: "Day-O (The Banana Boat Song)", note: "#15 Billboard 年終" },
    { artist: "Elvis Presley", title: "Jailhouse Rock", note: "#16 Billboard 年終" },
    { artist: "Marty Robbins", title: "A White Sport Coat (and a Pink Carnation)", note: "#17 Billboard 年終" },
    { artist: "The Del-Vikings", title: "Come Go with Me", note: "#18 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Wake Up Little Susie", note: "#19 Billboard 年終" },
    { artist: "Sam Cooke", title: "You Send Me", note: "#20 Billboard 年終" },
    { artist: "The Coasters", title: "Searchin'", note: "#21 Billboard 年終" },
    { artist: "Chuck Berry", title: "School Days", note: "#22 Billboard 年終" },
    { artist: "Ferlin Husky", title: "Gone", note: "#23 Billboard 年終" },
    { artist: "Paul Anka", title: "Diana", note: "#24 Billboard 年終" },
    { artist: "Ricky Nelson", title: "A Teenager's Romance", note: "#25 Billboard 年終" },
    { artist: "The Tarriers", title: "The Banana Boat Song", note: "#26 Billboard 年終" },
    { artist: "Jimmie Rodgers", title: "Honeycomb", note: "#27 Billboard 年終" },
    { artist: "Jerry Lee Lewis", title: "Whole Lotta Shakin' Goin On", note: "#28 Billboard 年終" },
    { artist: "Gale Storm", title: "Dark Moon", note: "#29 Billboard 年終" },
    { artist: "Buddy Holly", title: "That'll Be the Day", note: "#30 Billboard 年終" },
    { artist: "Charlie Gracie", title: "Butterfly", note: "#31 Billboard 年終" },
    { artist: "Frankie Laine", title: "Moonlight Gambler", note: "#32 Billboard 年終" },
    { artist: "Tommy Sands", title: "Teen-Age Crush", note: "#33 Billboard 年終" },
    { artist: "Johnny Mathis", title: "It's Not for Me to Say", note: "#34 Billboard 年終" },
    { artist: "The Rays", title: "Silhouettes", note: "#35 Billboard 年終" },
    { artist: "Andy Williams", title: "Butterfly", note: "#36 Billboard 年終" },
    { artist: "The Easy Riders", title: "Marianne", note: "#37 Billboard 年終" },
    { artist: "Fats Domino", title: "I'm Walkin'", note: "#38 Billboard 年終" },
    { artist: "Johnny Mathis", title: "Chances Are", note: "#39 Billboard 年終" },
    { artist: "Nat King Cole", title: "Send for Me", note: "#40 Billboard 年終" },
    { artist: "Russ Hamilton", title: "Rainbow", note: "#41 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Be-Bop Baby", note: "#42 Billboard 年終" },
    { artist: "Larry Williams", title: "Short Fat Fannie", note: "#43 Billboard 年終" },
    { artist: "Jim Lowe", title: "Green Door", note: "#44 Billboard 年終" },
    { artist: "Billy Williams", title: "I'm Gonna Sit Right Down and Write Myself a Letter", note: "#45 Billboard 年終" },
    { artist: "Patti Page", title: "Old Cape Cod", note: "#46 Billboard 年終" },
    { artist: "The Bobbettes", title: "Mr. Lee", note: "#47 Billboard 年終" },
    { artist: "Fats Domino", title: "Blueberry Hill", note: "#48 Billboard 年終" },
    { artist: "The Del-Vikings", title: "Whispering Bells", note: "#49 Billboard 年終" },
    { artist: "Fats Domino", title: "Blue Monday", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1957: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_50_singles_of_1957" }
};
