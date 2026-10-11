// 1963 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1963_US = {
  id: 'soy-1963-us',
  title: '1963 美國年選',
  titleEn: 'United States 1963',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1963,
  country: 'United States'
} as const;

export const SOY_1963: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Beach Boys", title: "Surfin' U.S.A.", note: "#1 Billboard 年終" },
    { artist: "Skeeter Davis", title: "The End of the World", note: "#2 Billboard 年終" },
    { artist: "The Cascades", title: "Rhythm of the Rain", note: "#3 Billboard 年終" },
    { artist: "The Chiffons", title: "He's So Fine", note: "#4 Billboard 年終" },
    { artist: "Bobby Vinton", title: "Blue Velvet", note: "#5 Billboard 年終" },
    { artist: "Paul、Paula", title: "Hey Paula", note: "#6 Billboard 年終" },
    { artist: "Little Stevie Wonder", title: "Fingertips – Part 2", note: "#7 Billboard 年終" },
    { artist: "Andy Williams", title: "Can't Get Used to Losing You", note: "#8 Billboard 年終" },
    { artist: "The Angels", title: "My Boyfriend's Back", note: "#9 Billboard 年終" },
    { artist: "Kyu Sakamoto", title: "Sukiyaki", note: "#10 Billboard 年終" },
    { artist: "The Tymes", title: "So Much in Love", note: "#11 Billboard 年終" },
    { artist: "Peter, Paul、Mary", title: "Puff, the Magic Dragon", note: "#12 Billboard 年終" },
    { artist: "Peter, Paul、Mary", title: "Blowin' in the Wind", note: "#13 Billboard 年終" },
    { artist: "The Surfaris", title: "Wipe Out", note: "#14 Billboard 年終" },
    { artist: "Al Martino", title: "I Love You Because", note: "#15 Billboard 年終" },
    { artist: "The Rebels", title: "Wild Weekend", note: "#16 Billboard 年終" },
    { artist: "Bobby Darin", title: "You're the Reason I'm Living", note: "#17 Billboard 年終" },
    { artist: "The Four Seasons", title: "Walk Like a Man", note: "#18 Billboard 年終" },
    { artist: "Inez、Charlie Foxx", title: "Mockingbird", note: "#19 Billboard 年終" },
    { artist: "Little Peggy March", title: "I Will Follow Him", note: "#20 Billboard 年終" },
    { artist: "The Chantays", title: "Pipeline", note: "#21 Billboard 年終" },
    { artist: "Jan、Dean", title: "Surf City", note: "#22 Billboard 年終" },
    { artist: "Lesley Gore", title: "It's My Party", note: "#23 Billboard 年終" },
    { artist: "Eydie Gormé", title: "Blame It on the Bossa Nova", note: "#24 Billboard 年終" },
    { artist: "The Dovells", title: "You Can't Sit Down", note: "#25 Billboard 年終" },
    { artist: "Martha、the Vandellas", title: "Heat Wave", note: "#26 Billboard 年終" },
    { artist: "Randy、the Rainbows", title: "Denise", note: "#27 Billboard 年終" },
    { artist: "The Rooftop Singers", title: "Walk Right In", note: "#28 Billboard 年終" },
    { artist: "Jimmy Soul", title: "If You Wanna Be Happy", note: "#29 Billboard 年終" },
    { artist: "Trini Lopez", title: "If I Had a Hammer", note: "#30 Billboard 年終" },
    { artist: "The Essex", title: "Easier Said Than Done", note: "#31 Billboard 年終" },
    { artist: "Dion", title: "Ruby Baby", note: "#32 Billboard 年終" },
    { artist: "Ruby、the Romantics", title: "Our Day Will Come", note: "#33 Billboard 年終" },
    { artist: "Barbara Lewis", title: "Hello Stranger", note: "#34 Billboard 年終" },
    { artist: "The Ronettes", title: "Be My Baby", note: "#35 Billboard 年終" },
    { artist: "The Orlons", title: "South Street", note: "#36 Billboard 年終" },
    { artist: "Henry Mancini", title: "Days of Wine and Roses", note: "#37 Billboard 年終" },
    { artist: "Major Lance", title: "The Monkey Time", note: "#38 Billboard 年終" },
    { artist: "The Four Seasons", title: "Candy Girl", note: "#39 Billboard 年終" },
    { artist: "Jimmy Gilmer、the Fireballs", title: "Sugar Shack", note: "#40 Billboard 年終" },
    { artist: "Bill Anderson", title: "Still", note: "#41 Billboard 年終" },
    { artist: "Bobby Vinton", title: "Blue on Blue", note: "#42 Billboard 年終" },
    { artist: "Garnet Mimms、the Enchanters", title: "Cry Baby", note: "#43 Billboard 年終" },
    { artist: "Lou Christie", title: "Two Faces Have I", note: "#44 Billboard 年終" },
    { artist: "Ray Charles", title: "Busted", note: "#45 Billboard 年終" },
    { artist: "The Crystals", title: "Da Doo Ron Ron", note: "#46 Billboard 年終" },
    { artist: "The Shirelles", title: "Foolish Little Girl", note: "#47 Billboard 年終" },
    { artist: "Lonnie Mack", title: "Memphis", note: "#48 Billboard 年終" },
    { artist: "Roy Orbison", title: "In Dreams", note: "#49 Billboard 年終" },
    { artist: "Kai Winding", title: "More", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1963: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1963" }
};
