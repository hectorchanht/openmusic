// 1969 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1969_US = {
  id: 'soy-1969-us',
  title: '1969 美國年選',
  titleEn: 'United States 1969',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1969,
  country: 'United States'
} as const;

export const SOY_1969: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Archies", title: "Sugar, Sugar", note: "#1 Billboard 年終" },
    { artist: "The 5th Dimension", title: "Aquarius/Let the Sunshine In", note: "#2 Billboard 年終" },
    { artist: "The Temptations", title: "I Can't Get Next to You", note: "#3 Billboard 年終" },
    { artist: "The Rolling Stones", title: "Honky Tonk Women", note: "#4 Billboard 年終" },
    { artist: "Sly、the Family Stone", title: "Everyday People", note: "#5 Billboard 年終" },
    { artist: "Tommy Roe", title: "Dizzy", note: "#6 Billboard 年終" },
    { artist: "Sly、the Family Stone", title: "Hot Fun in the Summertime", note: "#7 Billboard 年終" },
    { artist: "Tom Jones", title: "I'll Never Fall in Love Again", note: "#8 Billboard 年終" },
    { artist: "The Foundations", title: "Build Me Up Buttercup", note: "#9 Billboard 年終" },
    { artist: "Tommy James、the Shondells", title: "Crimson and Clover", note: "#10 Billboard 年終" },
    { artist: "Three Dog Night", title: "One", note: "#11 Billboard 年終" },
    { artist: "Tommy James、the Shondells", title: "Crystal Blue Persuasion", note: "#12 Billboard 年終" },
    { artist: "The Cowsills", title: "Hair", note: "#13 Billboard 年終" },
    { artist: "Marvin Gaye", title: "Too Busy Thinking About My Baby", note: "#14 Billboard 年終" },
    { artist: "Henry Mancini", title: "Love Theme from Romeo and Juliet", note: "#15 Billboard 年終" },
    { artist: "The Youngbloods", title: "Get Together", note: "#16 Billboard 年終" },
    { artist: "The Friends of Distinction", title: "Grazing in the Grass", note: "#17 Billboard 年終" },
    { artist: "Elvis Presley", title: "Suspicious Minds", note: "#18 Billboard 年終" },
    { artist: "Creedence Clearwater Revival", title: "Proud Mary", note: "#19 Billboard 年終" },
    { artist: "Jr. Walker、The All Stars", title: "What Does It Take (To Win Your Love)", note: "#20 Billboard 年終" },
    { artist: "The Isley Brothers", title: "It's Your Thing", note: "#21 Billboard 年終" },
    { artist: "Neil Diamond", title: "Sweet Caroline", note: "#22 Billboard 年終" },
    { artist: "Oliver", title: "Jean", note: "#23 Billboard 年終" },
    { artist: "Creedence Clearwater Revival", title: "Bad Moon Rising", note: "#24 Billboard 年終" },
    { artist: "The Beatles、Billy Preston", title: "Get Back", note: "#25 Billboard 年終" },
    { artist: "Zager、Evans", title: "In the Year 2525", note: "#26 Billboard 年終" },
    { artist: "Blood, Sweat、Tears", title: "Spinning Wheel", note: "#27 Billboard 年終" },
    { artist: "Andy Kim", title: "Baby, I Love You", note: "#28 Billboard 年終" },
    { artist: "The Friends of Distinction", title: "Going in Circles", note: "#29 Billboard 年終" },
    { artist: "The Lettermen", title: "Hurt So Bad", note: "#30 Billboard 年終" },
    { artist: "Creedence Clearwater Revival", title: "Green River", note: "#31 Billboard 年終" },
    { artist: "Stevie Wonder", title: "My Cherie Amour", note: "#32 Billboard 年終" },
    { artist: "Three Dog Night", title: "Easy to Be Hard", note: "#33 Billboard 年終" },
    { artist: "Smith", title: "Baby It's You", note: "#34 Billboard 年終" },
    { artist: "Elvis Presley", title: "In the Ghetto", note: "#35 Billboard 年終" },
    { artist: "Johnny Cash", title: "A Boy Named Sue", note: "#36 Billboard 年終" },
    { artist: "The Miracles", title: "Baby, Baby Don't Cry", note: "#37 Billboard 年終" },
    { artist: "Jerry Butler", title: "Only the Strong Survive", note: "#38 Billboard 年終" },
    { artist: "The Zombies", title: "Time of the Season", note: "#39 Billboard 年終" },
    { artist: "The 5th Dimension", title: "Wedding Bell Blues", note: "#40 Billboard 年終" },
    { artist: "Bobby Sherman", title: "Little Woman", note: "#41 Billboard 年終" },
    { artist: "Mercy", title: "Love (Can Make You Happy)", note: "#42 Billboard 年終" },
    { artist: "Oliver", title: "Good Morning Starshine", note: "#43 Billboard 年終" },
    { artist: "The Guess Who", title: "These Eyes", note: "#44 Billboard 年終" },
    { artist: "Blood, Sweat、Tears", title: "You've Made Me So Very Happy", note: "#45 Billboard 年終" },
    { artist: "Jackie DeShannon", title: "Put a Little Love in Your Heart", note: "#46 Billboard 年終" },
    { artist: "Charles Wright、the Watts 103rd Street Rhythm Band", title: "Do Your Thing", note: "#47 Billboard 年終" },
    { artist: "The Grass Roots", title: "I'd Wait a Million Years", note: "#48 Billboard 年終" },
    { artist: "The Doors", title: "Touch Me", note: "#49 Billboard 年終" },
    { artist: "Spiral Starecase", title: "More Today Than Yesterday", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1969: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1969" }
};
