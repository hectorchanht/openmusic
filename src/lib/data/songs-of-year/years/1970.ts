// 1970 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1970_US = {
  id: 'soy-1970-us',
  title: '1970 美國年選',
  titleEn: 'United States 1970',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1970,
  country: 'United States'
} as const;

export const SOY_1970: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Simon、Garfunkel", title: "Bridge Over Troubled Water", note: "#1 Billboard 年終" },
    { artist: "The Carpenters", title: "(They Long to Be) Close to You", note: "#2 Billboard 年終" },
    { artist: "The Guess Who", title: "American Woman", note: "#3 Billboard 年終" },
    { artist: "B.J. Thomas", title: "Raindrops Keep Fallin' on My Head", note: "#4 Billboard 年終" },
    { artist: "Edwin Starr", title: "War", note: "#5 Billboard 年終" },
    { artist: "Diana Ross", title: "Ain't No Mountain High Enough", note: "#6 Billboard 年終" },
    { artist: "The Jackson 5", title: "I'll Be There", note: "#7 Billboard 年終" },
    { artist: "Rare Earth", title: "Get Ready", note: "#8 Billboard 年終" },
    { artist: "The Beatles", title: "Let It Be", note: "#9 Billboard 年終" },
    { artist: "Freda Payne", title: "Band of Gold", note: "#10 Billboard 年終" },
    { artist: "Three Dog Night", title: "Mama Told Me (Not to Come)", note: "#11 Billboard 年終" },
    { artist: "Ray Stevens", title: "Everything Is Beautiful", note: "#12 Billboard 年終" },
    { artist: "Bread", title: "Make It with You", note: "#13 Billboard 年終" },
    { artist: "Vanity Fare", title: "Hitchin' a Ride", note: "#14 Billboard 年終" },
    { artist: "The Jackson 5", title: "ABC", note: "#15 Billboard 年終" },
    { artist: "The Jackson 5", title: "The Love You Save", note: "#16 Billboard 年終" },
    { artist: "Neil Diamond", title: "Cracklin' Rosie", note: "#17 Billboard 年終" },
    { artist: "Dawn", title: "Candida", note: "#18 Billboard 年終" },
    { artist: "Sly、the Family Stone", title: "Thank You (Falettinme Be Mice Elf Agin)", note: "#19 Billboard 年終" },
    { artist: "Eric Burdon、War", title: "Spill the Wine", note: "#20 Billboard 年終" },
    { artist: "Five Stairsteps", title: "O-o-h Child", note: "#21 Billboard 年終" },
    { artist: "Norman Greenbaum", title: "Spirit in the Sky", note: "#22 Billboard 年終" },
    { artist: "Melanie", title: "Lay Down (Candles in the Rain)", note: "#23 Billboard 年終" },
    { artist: "The Temptations", title: "Ball of Confusion (That's What the World Is Today)", note: "#24 Billboard 年終" },
    { artist: "The Moments", title: "Love on a Two-Way Street", note: "#25 Billboard 年終" },
    { artist: "The Poppy Family", title: "Which Way You Goin' Billy?", note: "#26 Billboard 年終" },
    { artist: "Free", title: "All Right Now", note: "#27 Billboard 年終" },
    { artist: "The Jackson 5", title: "I Want You Back", note: "#28 Billboard 年終" },
    { artist: "Bobby Sherman", title: "Julie, Do Ya Love Me", note: "#29 Billboard 年終" },
    { artist: "Sugarloaf", title: "Green-Eyed Lady", note: "#30 Billboard 年終" },
    { artist: "Stevie Wonder", title: "Signed, Sealed, Delivered I'm Yours", note: "#31 Billboard 年終" },
    { artist: "Blues Image", title: "Ride Captain Ride", note: "#32 Billboard 年終" },
    { artist: "Shocking Blue", title: "Venus", note: "#33 Billboard 年終" },
    { artist: "John Lennon", title: "Instant Karma!", note: "#34 Billboard 年終" },
    { artist: "Clarence Carter", title: "Patches", note: "#35 Billboard 年終" },
    { artist: "Creedence Clearwater Revival", title: "Lookin' out My Back Door", note: "#36 Billboard 年終" },
    { artist: "Brook Benton", title: "Rainy Night in Georgia", note: "#37 Billboard 年終" },
    { artist: "Kenny Rogers、The First Edition", title: "Something's Burning", note: "#38 Billboard 年終" },
    { artist: "Chairmen of the Board", title: "Give Me Just a Little More Time", note: "#39 Billboard 年終" },
    { artist: "Edison Lighthouse", title: "Love Grows (Where My Rosemary Goes)", note: "#40 Billboard 年終" },
    { artist: "The Beatles", title: "The Long and Winding Road", note: "#41 Billboard 年終" },
    { artist: "Anne Murray", title: "Snowbird", note: "#42 Billboard 年終" },
    { artist: "Marmalade", title: "Reflections of My Life", note: "#43 Billboard 年終" },
    { artist: "Eddie Holman", title: "Hey There Lonely Girl", note: "#44 Billboard 年終" },
    { artist: "The Jaggerz", title: "The Rapper", note: "#45 Billboard 年終" },
    { artist: "The Hollies", title: "He Ain't Heavy, He's My Brother", note: "#46 Billboard 年終" },
    { artist: "Alive N Kickin'", title: "Tighter, Tighter", note: "#47 Billboard 年終" },
    { artist: "Badfinger", title: "Come and Get It", note: "#48 Billboard 年終" },
    { artist: "Simon、Garfunkel", title: "Cecilia", note: "#49 Billboard 年終" },
    { artist: "Charles Wright、the Watts 103rd Street Rhythm Band", title: "Love Land", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1970: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1970" }
};
