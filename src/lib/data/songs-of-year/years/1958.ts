// 1958 年選 — year-end charts (United States).
// - United States: Billboard Year-End Singles Chart (pre-Hot-100 era) (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1958_US = {
  id: 'soy-1958-us',
  title: '1958 美國年選',
  titleEn: 'United States 1958',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1958,
  country: 'United States'
} as const;

export const SOY_1958: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Domenico Modugno", title: "Volare (Nel blu dipinto di blu)", note: "#1 Billboard 年終" },
    { artist: "The Everly Brothers", title: "All I Have to Do Is Dream\" / \"Claudette", note: "#2 Billboard 年終" },
    { artist: "Elvis Presley", title: "Don't\" / \"I Beg of You", note: "#3 Billboard 年終" },
    { artist: "Ross Bagdasarian", title: "Witch Doctor", note: "#4 Billboard 年終" },
    { artist: "Perez Prado", title: "Patricia", note: "#5 Billboard 年終" },
    { artist: "Billy Vaughn", title: "Sail Along, Silv'ry Moon\" / \"Raunchy", note: "#6 Billboard 年終" },
    { artist: "Perry Como", title: "Catch a Falling Star\" / \"Magic Moments", note: "#7 Billboard 年終" },
    { artist: "The Champs", title: "Tequila", note: "#8 Billboard 年終" },
    { artist: "Tommy Edwards", title: "It's All in the Game", note: "#9 Billboard 年終" },
    { artist: "Dean Martin", title: "Return to Me", note: "#10 Billboard 年終" },
    { artist: "Conway Twitty", title: "It's Only Make Believe", note: "#11 Billboard 年終" },
    { artist: "Sheb Wooley", title: "The Purple People Eater", note: "#12 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Bird Dog\" / \"Devoted to You", note: "#13 Billboard 年終" },
    { artist: "The Silhouettes", title: "Get a Job", note: "#14 Billboard 年終" },
    { artist: "The Elegants", title: "Little Star", note: "#15 Billboard 年終" },
    { artist: "The Platters", title: "Twilight Time", note: "#16 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Stood Up\" / \"Waitin' in School", note: "#17 Billboard 年終" },
    { artist: "Laurie London", title: "He's Got the Whole World in His Hands", note: "#18 Billboard 年終" },
    { artist: "Jimmie Rodgers", title: "Secretly", note: "#19 Billboard 年終" },
    { artist: "Danny、the Juniors", title: "At the Hop", note: "#20 Billboard 年終" },
    { artist: "The Coasters", title: "Yakety Yak", note: "#21 Billboard 年終" },
    { artist: "Elvis Presley", title: "Wear My Ring Around Your Neck\" / \"Doncha' Think It's Time", note: "#22 Billboard 年終" },
    { artist: "Bobby Day", title: "Rockin' Robin\" / \"Over and Over", note: "#23 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Poor Little Fool", note: "#24 Billboard 年終" },
    { artist: "Pat Boone", title: "A Wonderful Time Up There\" / \"It's Too Soon to Know", note: "#25 Billboard 年終" },
    { artist: "Jimmy Clanton", title: "Just a Dream", note: "#26 Billboard 年終" },
    { artist: "The McGuire Sisters", title: "Sugartime", note: "#27 Billboard 年終" },
    { artist: "The Kingston Trio", title: "Tom Dooley", note: "#28 Billboard 年終" },
    { artist: "Chuck Berry", title: "Sweet Little Sixteen", note: "#29 Billboard 年終" },
    { artist: "Cozy Cole", title: "Topsy II\" / \"Topsy I", note: "#30 Billboard 年終" },
    { artist: "Nat King Cole", title: "Looking Back\" / \"Do I Like It", note: "#31 Billboard 年終" },
    { artist: "The Monotones", title: "Book of Love", note: "#32 Billboard 年終" },
    { artist: "Tommy Dorsey Orchestra、Warren Covington", title: "Tea for Two Cha Cha", note: "#33 Billboard 年終" },
    { artist: "Little Anthony、the Imperials", title: "Tears on My Pillow", note: "#34 Billboard 年終" },
    { artist: "The Royal Teens", title: "Short Shorts", note: "#35 Billboard 年終" },
    { artist: "Jerry Lee Lewis", title: "Great Balls of Fire", note: "#36 Billboard 年終" },
    { artist: "The Chordettes", title: "Lollipop", note: "#37 Billboard 年終" },
    { artist: "Bobby Darin", title: "Splish Splash", note: "#38 Billboard 年終" },
    { artist: "Connie Francis", title: "Who's Sorry Now?", note: "#39 Billboard 年終" },
    { artist: "Jack Scott", title: "My True Love\" / \"Leroy", note: "#40 Billboard 年終" },
    { artist: "Jody Reynolds", title: "Endless Sleep", note: "#41 Billboard 年終" },
    { artist: "Bobby Freeman", title: "Do You Want to Dance", note: "#42 Billboard 年終" },
    { artist: "The Kalin Twins", title: "When", note: "#43 Billboard 年終" },
    { artist: "The Teddy Bears", title: "To Know Him Is to Love Him", note: "#44 Billboard 年終" },
    { artist: "Pat Boone", title: "April Love", note: "#45 Billboard 年終" },
    { artist: "Duane Eddy", title: "Rebel-'Rouser", note: "#46 Billboard 年終" },
    { artist: "The Crescendos", title: "Oh Julie", note: "#47 Billboard 年終" },
    { artist: "The Diamonds", title: "The Stroll", note: "#48 Billboard 年終" },
    { artist: "Elvis Presley", title: "Hard Headed Woman\" / \"Don't Ask Me Why", note: "#49 Billboard 年終" },
    { artist: "Buddy Holly", title: "Peggy Sue", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1958: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Singles Chart", url: "https://en.wikipedia.org/wiki/Billboard_year-end_top_50_singles_of_1958" }
};
