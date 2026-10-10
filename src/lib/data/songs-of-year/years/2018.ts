// 2018 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2018" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2018_US = {
  id: 'soy-2018-us',
  title: '2018 美國年選',
  titleEn: 'United States 2018',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2018,
  country: 'United States'
} as const;

export const SOY_2018: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Drake", title: "God's Plan", note: "#1 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Perfect", note: "#2 Billboard 年終" },
    { artist: "Bebe Rexha ft. Florida Georgia Line", title: "Meant to Be", note: "#3 Billboard 年終" },
    { artist: "Camila Cabello ft. Young Thug", title: "Havana", note: "#4 Billboard 年終" },
    { artist: "Post Malone ft. 21 Savage", title: "Rockstar", note: "#5 Billboard 年終" },
    { artist: "Post Malone ft. Ty Dolla Sign", title: "Psycho", note: "#6 Billboard 年終" },
    { artist: "Cardi B, Bad Bunny、J Balvin", title: "I Like It", note: "#7 Billboard 年終" },
    { artist: "Zedd, Maren Morris、Grey", title: "The Middle", note: "#8 Billboard 年終" },
    { artist: "Drake", title: "In My Feelings", note: "#9 Billboard 年終" },
    { artist: "Maroon 5 ft. Cardi B", title: "Girls Like You", note: "#10 Billboard 年終" },
    { artist: "Drake", title: "Nice for What", note: "#11 Billboard 年終" },
    { artist: "Juice Wrld", title: "Lucid Dreams", note: "#12 Billboard 年終" },
    { artist: "Post Malone", title: "Better Now", note: "#13 Billboard 年終" },
    { artist: "Bruno Mars ft. Cardi B", title: "Finesse", note: "#14 Billboard 年終" },
    { artist: "Ella Mai", title: "Boo'd Up", note: "#15 Billboard 年終" },
    { artist: "Dua Lipa", title: "New Rules", note: "#16 Billboard 年終" },
    { artist: "XXXTentacion", title: "Sad!", note: "#17 Billboard 年終" },
    { artist: "Camila Cabello", title: "Never Be the Same", note: "#18 Billboard 年終" },
    { artist: "Khalid、Normani", title: "Love Lies", note: "#19 Billboard 年終" },
    { artist: "Ariana Grande", title: "No Tears Left to Cry", note: "#20 Billboard 年終" },
    { artist: "Bazzi", title: "Mine", note: "#21 Billboard 年終" },
    { artist: "Imagine Dragons", title: "Thunder", note: "#22 Billboard 年終" },
    { artist: "BlocBoy JB ft. Drake", title: "Look Alive", note: "#23 Billboard 年終" },
    { artist: "Taylor Swift", title: "Delicate", note: "#24 Billboard 年終" },
    { artist: "Lil Baby、Drake", title: "Yes Indeed", note: "#25 Billboard 年終" },
    { artist: "Marshmello、Anne-Marie", title: "Friends", note: "#26 Billboard 年終" },
    { artist: "Halsey", title: "Bad at Love", note: "#27 Billboard 年終" },
    { artist: "Tyga ft. Offset", title: "Taste", note: "#28 Billboard 年終" },
    { artist: "NF", title: "Let You Down", note: "#29 Billboard 年終" },
    { artist: "G-Eazy ft. ASAP Rocky、Cardi B", title: "No Limit", note: "#30 Billboard 年終" },
    { artist: "6ix9ine ft. Nicki Minaj、Murda Beatz", title: "Fefe", note: "#31 Billboard 年終" },
    { artist: "Dan + Shay", title: "Tequila", note: "#32 Billboard 年終" },
    { artist: "Portugal. The Man", title: "Feel It Still", note: "#33 Billboard 年終" },
    { artist: "Migos, Nicki Minaj、Cardi B", title: "MotorSport", note: "#34 Billboard 年終" },
    { artist: "Lauv", title: "I Like Me Better", note: "#35 Billboard 年終" },
    { artist: "5 Seconds of Summer", title: "Youngblood", note: "#36 Billboard 年終" },
    { artist: "Imagine Dragons", title: "Whatever It Takes", note: "#37 Billboard 年終" },
    { artist: "Offset、Metro Boomin", title: "Ric Flair Drip", note: "#38 Billboard 年終" },
    { artist: "Post Malone", title: "I Fall Apart", note: "#39 Billboard 年終" },
    { artist: "The Weeknd、Kendrick Lamar", title: "Pray for Me", note: "#40 Billboard 年終" },
    { artist: "Selena Gomez", title: "Back to You", note: "#41 Billboard 年終" },
    { artist: "Travis Scott", title: "Sicko Mode", note: "#42 Billboard 年終" },
    { artist: "Migos ft. Drake", title: "Walk It Talk It", note: "#43 Billboard 年終" },
    { artist: "Lil Pump", title: "Gucci Gang", note: "#44 Billboard 年終" },
    { artist: "G-Eazy、Halsey", title: "Him & I", note: "#45 Billboard 年終" },
    { artist: "Shawn Mendes", title: "In My Blood", note: "#46 Billboard 年終" },
    { artist: "Kendrick Lamar、SZA", title: "All the Stars", note: "#47 Billboard 年終" },
    { artist: "Migos", title: "Stir Fry", note: "#48 Billboard 年終" },
    { artist: "Sam Smith", title: "Too Good at Goodbyes", note: "#49 Billboard 年終" },
    { artist: "Kendrick Lamar ft. Zacari", title: "Love", note: "#50 Billboard 年終" },
  ]
};
