// 1968 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1968_US = {
  id: 'soy-1968-us',
  title: '1968 美國年選',
  titleEn: 'United States 1968',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1968,
  country: 'United States'
} as const;

export const SOY_1968: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Beatles", title: "Hey Jude", note: "#1 Billboard 年終" },
    { artist: "Paul Mauriat", title: "Love is Blue", note: "#2 Billboard 年終" },
    { artist: "Bobby Goldsboro", title: "Honey", note: "#3 Billboard 年終" },
    { artist: "Otis Redding", title: "(Sittin' On) The Dock of the Bay", note: "#4 Billboard 年終" },
    { artist: "The Rascals", title: "People Got to Be Free", note: "#5 Billboard 年終" },
    { artist: "Cream", title: "Sunshine of Your Love", note: "#6 Billboard 年終" },
    { artist: "Herb Alpert", title: "This Guy's in Love with You", note: "#7 Billboard 年終" },
    { artist: "Hugo Montenegro", title: "The Good, the Bad and the Ugly", note: "#8 Billboard 年終" },
    { artist: "Simon、Garfunkel", title: "Mrs. Robinson", note: "#9 Billboard 年終" },
    { artist: "Archie Bell、the Drells", title: "Tighten Up", note: "#10 Billboard 年終" },
    { artist: "Jeannie C. Riley", title: "Harper Valley PTA", note: "#11 Billboard 年終" },
    { artist: "O. C. Smith", title: "Little Green Apples", note: "#12 Billboard 年終" },
    { artist: "Tommy James、the Shondells", title: "Mony Mony", note: "#13 Billboard 年終" },
    { artist: "The Doors", title: "Hello, I Love You", note: "#14 Billboard 年終" },
    { artist: "Gary Puckett、The Union Gap", title: "Young Girl", note: "#15 Billboard 年終" },
    { artist: "The Box Tops", title: "Cry Like a Baby", note: "#16 Billboard 年終" },
    { artist: "The 5th Dimension", title: "Stoned Soul Picnic", note: "#17 Billboard 年終" },
    { artist: "Hugh Masekela", title: "Grazing in the Grass", note: "#18 Billboard 年終" },
    { artist: "The Grass Roots", title: "Midnight Confessions", note: "#19 Billboard 年終" },
    { artist: "Sly、the Family Stone", title: "Dance to the Music", note: "#20 Billboard 年終" },
    { artist: "Cliff Nobles", title: "The Horse", note: "#21 Billboard 年終" },
    { artist: "The Temptations", title: "I Wish It Would Rain", note: "#22 Billboard 年終" },
    { artist: "The Delfonics", title: "La-La (Means I Love You)", note: "#23 Billboard 年終" },
    { artist: "The Vogues", title: "Turn Around, Look at Me", note: "#24 Billboard 年終" },
    { artist: "John Fred、His Playboy Band", title: "Judy in Disguise (With Glasses)", note: "#25 Billboard 年終" },
    { artist: "Classics IV", title: "Spooky", note: "#26 Billboard 年終" },
    { artist: "The Supremes", title: "Love Child", note: "#27 Billboard 年終" },
    { artist: "Merrilee Rush", title: "Angel of the Morning", note: "#28 Billboard 年終" },
    { artist: "Georgie Fame", title: "The Ballad of Bonnie and Clyde", note: "#29 Billboard 年終" },
    { artist: "Mary Hopkin", title: "Those Were the Days", note: "#30 Billboard 年終" },
    { artist: "Steppenwolf", title: "Born to Be Wild", note: "#31 Billboard 年終" },
    { artist: "The Intruders", title: "Cowboys to Girls", note: "#32 Billboard 年終" },
    { artist: "1910 Fruitgum Company", title: "Simon Says", note: "#33 Billboard 年終" },
    { artist: "Gary Puckett、The Union Gap", title: "Lady Willpower", note: "#34 Billboard 年終" },
    { artist: "The Rascals", title: "A Beautiful Morning", note: "#35 Billboard 年終" },
    { artist: "Sérgio Mendes、Brasil '66", title: "The Look of Love", note: "#36 Billboard 年終" },
    { artist: "Johnny Nash", title: "Hold Me Tight", note: "#37 Billboard 年終" },
    { artist: "Ohio Express", title: "Yummy Yummy Yummy", note: "#38 Billboard 年終" },
    { artist: "The Crazy World of Arthur Brown", title: "Fire", note: "#39 Billboard 年終" },
    { artist: "The Troggs", title: "Love Is All Around", note: "#40 Billboard 年終" },
    { artist: "Gene、Debbe", title: "Playboy", note: "#41 Billboard 年終" },
    { artist: "Dionne Warwick", title: "(Theme from) Valley of the Dolls", note: "#42 Billboard 年終" },
    { artist: "Mason Williams", title: "Classical Gas", note: "#43 Billboard 年終" },
    { artist: "Clarence Carter", title: "Slip Away", note: "#44 Billboard 年終" },
    { artist: "The O'Kaysions", title: "Girl Watcher", note: "#45 Billboard 年終" },
    { artist: "Aretha Franklin", title: "(Sweet Sweet Baby) Since You've Been Gone", note: "#46 Billboard 年終" },
    { artist: "The Lemon Pipers", title: "Green Tambourine", note: "#47 Billboard 年終" },
    { artist: "1910 Fruitgum Company", title: "1, 2, 3, Red Light", note: "#48 Billboard 年終" },
    { artist: "Friend、Lover", title: "Reach Out of the Darkness", note: "#49 Billboard 年終" },
    { artist: "The Rolling Stones", title: "Jumpin' Jack Flash", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1968: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1968" }
};
