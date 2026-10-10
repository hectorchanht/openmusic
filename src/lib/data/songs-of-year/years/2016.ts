// 2016 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2016" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2016_US = {
  id: 'soy-2016-us',
  title: '2016 美國年選',
  titleEn: 'United States 2016',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2016,
  country: 'United States'
} as const;

export const SOY_2016: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Justin Bieber", title: "Love Yourself", note: "#1 Billboard 年終" },
    { artist: "Justin Bieber", title: "Sorry", note: "#2 Billboard 年終" },
    { artist: "Drake ft. Wizkid、Kyla", title: "One Dance", note: "#3 Billboard 年終" },
    { artist: "Rihanna ft. Drake", title: "Work", note: "#4 Billboard 年終" },
    { artist: "Twenty One Pilots", title: "Stressed Out", note: "#5 Billboard 年終" },
    { artist: "Desiigner", title: "Panda", note: "#6 Billboard 年終" },
    { artist: "Adele", title: "Hello", note: "#7 Billboard 年終" },
    { artist: "The Chainsmokers ft. Daya", title: "Don't Let Me Down", note: "#8 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Can't Stop the Feeling!", note: "#9 Billboard 年終" },
    { artist: "The Chainsmokers ft. Halsey", title: "Closer", note: "#10 Billboard 年終" },
    { artist: "Sia ft. Sean Paul", title: "Cheap Thrills", note: "#11 Billboard 年終" },
    { artist: "Lukas Graham", title: "7 Years", note: "#12 Billboard 年終" },
    { artist: "Rihanna", title: "Needed Me", note: "#13 Billboard 年終" },
    { artist: "Flo Rida", title: "My House", note: "#14 Billboard 年終" },
    { artist: "Mike Posner", title: "I Took a Pill in Ibiza", note: "#15 Billboard 年終" },
    { artist: "Fifth Harmony ft. Ty Dolla Sign", title: "Work from Home", note: "#16 Billboard 年終" },
    { artist: "Calvin Harris ft. Rihanna", title: "This Is What You Came For", note: "#17 Billboard 年終" },
    { artist: "DNCE", title: "Cake by the Ocean", note: "#18 Billboard 年終" },
    { artist: "G-Eazy、Bebe Rexha", title: "Me, Myself & I", note: "#19 Billboard 年終" },
    { artist: "Twenty One Pilots", title: "Ride", note: "#20 Billboard 年終" },
    { artist: "Twenty One Pilots", title: "Heathens", note: "#21 Billboard 年終" },
    { artist: "Zayn", title: "Pillowtalk", note: "#22 Billboard 年終" },
    { artist: "Shawn Mendes", title: "Stitches", note: "#23 Billboard 年終" },
    { artist: "Drake", title: "Hotline Bling", note: "#24 Billboard 年終" },
    { artist: "Major Lazer ft. Justin Bieber、MØ", title: "Cold Water", note: "#25 Billboard 年終" },
    { artist: "Adele", title: "Send My Love (To Your New Lover)", note: "#26 Billboard 年終" },
    { artist: "The Chainsmokers ft. Rozes", title: "Roses", note: "#27 Billboard 年終" },
    { artist: "Shawn Mendes", title: "Treat You Better", note: "#28 Billboard 年終" },
    { artist: "Drake ft. Rihanna", title: "Too Good", note: "#29 Billboard 年終" },
    { artist: "Future ft. The Weeknd", title: "Low Life", note: "#30 Billboard 年終" },
    { artist: "Justin Bieber", title: "What Do You Mean?", note: "#31 Billboard 年終" },
    { artist: "The Weeknd", title: "The Hills", note: "#32 Billboard 年終" },
    { artist: "P!nk", title: "Just Like Fire", note: "#33 Billboard 年終" },
    { artist: "DRAM ft. Lil Yachty", title: "Broccoli", note: "#34 Billboard 年終" },
    { artist: "Bryson Tiller", title: "Don't", note: "#35 Billboard 年終" },
    { artist: "Ariana Grande", title: "Dangerous Woman", note: "#36 Billboard 年終" },
    { artist: "Drake、Future", title: "Jumpman", note: "#37 Billboard 年終" },
    { artist: "Gnash ft. Olivia O'Brien", title: "I Hate U, I Love U", note: "#38 Billboard 年終" },
    { artist: "Alessia Cara", title: "Here", note: "#39 Billboard 年終" },
    { artist: "Selena Gomez", title: "Same Old Love", note: "#40 Billboard 年終" },
    { artist: "Drake", title: "Controlla", note: "#41 Billboard 年終" },
    { artist: "Meghan Trainor ft. John Legend", title: "Like I'm Gonna Lose You", note: "#42 Billboard 年終" },
    { artist: "Charlie Puth", title: "One Call Away", note: "#43 Billboard 年終" },
    { artist: "James Bay", title: "Let It Go", note: "#44 Billboard 年終" },
    { artist: "Meghan Trainor", title: "No", note: "#45 Billboard 年終" },
    { artist: "Zara Larsson、MNEK", title: "Never Forget You", note: "#46 Billboard 年終" },
    { artist: "DJ Snake ft. Justin Bieber", title: "Let Me Love You", note: "#47 Billboard 年終" },
    { artist: "Kent Jones", title: "Don't Mind", note: "#48 Billboard 年終" },
    { artist: "Florida Georgia Line", title: "H.O.L.Y.", note: "#49 Billboard 年終" },
    { artist: "Charlie Puth ft. Selena Gomez", title: "We Don't Talk Anymore", note: "#50 Billboard 年終" },
  ]
};
