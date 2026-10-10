// 2022 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2022" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2022_US = {
  id: 'soy-2022-us',
  title: '2022 美國年選',
  titleEn: 'United States 2022',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2022,
  country: 'United States'
} as const;

export const SOY_2022: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Glass Animals", title: "Heat Waves", note: "#1 Billboard 年終" },
    { artist: "Harry Styles", title: "As It Was", note: "#2 Billboard 年終" },
    { artist: "The Kid Laroi、Justin Bieber", title: "Stay", note: "#3 Billboard 年終" },
    { artist: "Adele", title: "Easy on Me", note: "#4 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Shivers", note: "#5 Billboard 年終" },
    { artist: "Jack Harlow", title: "First Class", note: "#6 Billboard 年終" },
    { artist: "Latto", title: "Big Energy", note: "#7 Billboard 年終" },
    { artist: "Justin Bieber", title: "Ghost", note: "#8 Billboard 年終" },
    { artist: "Kodak Black", title: "Super Gremlin", note: "#9 Billboard 年終" },
    { artist: "Elton John、Dua Lipa", title: "Cold Heart (Pnau Remix)", note: "#10 Billboard 年終" },
    { artist: "Future ft. Drake、Tems", title: "Wait for U", note: "#11 Billboard 年終" },
    { artist: "Lizzo", title: "About Damn Time", note: "#12 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Bad Habits", note: "#13 Billboard 年終" },
    { artist: "Lil Nas X", title: "Thats What I Want", note: "#14 Billboard 年終" },
    { artist: "Imagine Dragons、JID", title: "Enemy", note: "#15 Billboard 年終" },
    { artist: "Lil Nas X、Jack Harlow", title: "Industry Baby", note: "#16 Billboard 年終" },
    { artist: "Gayle", title: "ABCDEFU", note: "#17 Billboard 年終" },
    { artist: "Doja Cat", title: "Need to Know", note: "#18 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Wasted on You", note: "#19 Billboard 年終" },
    { artist: "Bad Bunny、Chencho Corleone", title: "Me Porto Bonito", note: "#20 Billboard 年終" },
    { artist: "Doja Cat", title: "Woman", note: "#21 Billboard 年終" },
    { artist: "Bad Bunny", title: "Tití Me Preguntó", note: "#22 Billboard 年終" },
    { artist: "Kate Bush", title: "Running Up That Hill (A Deal with God)", note: "#23 Billboard 年終" },
    { artist: "Carolina Gaitán, Mauro Castillo, Adassa, Rhenzy Feliz, Diane Guerrero, Stephanie Beatriz、the Encanto cast", title: "We Don't Talk About Bruno", note: "#24 Billboard 年終" },
    { artist: "Harry Styles", title: "Late Night Talking", note: "#25 Billboard 年終" },
    { artist: "Post Malone ft. Doja Cat", title: "I Like You (A Happier Song)", note: "#26 Billboard 年終" },
    { artist: "Morgan Wallen", title: "You Proof", note: "#27 Billboard 年終" },
    { artist: "Steve Lacy", title: "Bad Habit", note: "#28 Billboard 年終" },
    { artist: "Nicky Youre、Dazy", title: "Sunroof", note: "#29 Billboard 年終" },
    { artist: "Post Malone、the Weeknd", title: "One Right Now", note: "#30 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Good 4 U", note: "#31 Billboard 年終" },
    { artist: "Em Beihold", title: "Numb Little Bug", note: "#32 Billboard 年終" },
    { artist: "Drake ft. 21 Savage", title: "Jimmy Cooks", note: "#33 Billboard 年終" },
    { artist: "Cody Johnson", title: "'Til You Can't", note: "#34 Billboard 年終" },
    { artist: "Walker Hayes", title: "Fancy Like", note: "#35 Billboard 年終" },
    { artist: "Luke Combs", title: "The Kind of Love We Make", note: "#36 Billboard 年終" },
    { artist: "OneRepublic", title: "I Ain't Worried", note: "#37 Billboard 年終" },
    { artist: "Beyoncé", title: "Break My Soul", note: "#38 Billboard 年終" },
    { artist: "Zach Bryan", title: "Something in the Orange", note: "#39 Billboard 年終" },
    { artist: "The Weeknd、Ariana Grande", title: "Save Your Tears", note: "#40 Billboard 年終" },
    { artist: "Silk Sonic (Bruno Mars、Anderson .Paak)", title: "Smokin out the Window", note: "#41 Billboard 年終" },
    { artist: "Dua Lipa", title: "Levitating", note: "#42 Billboard 年終" },
    { artist: "Lil Baby", title: "In a Minute", note: "#43 Billboard 年終" },
    { artist: "Bad Bunny", title: "Moscow Mule", note: "#44 Billboard 年終" },
    { artist: "Doja Cat、the Weeknd", title: "You Right", note: "#45 Billboard 年終" },
    { artist: "Cole Swindell", title: "She Had Me at Heads Carolina", note: "#46 Billboard 年終" },
    { artist: "Doja Cat", title: "Vegas", note: "#47 Billboard 年終" },
    { artist: "Gunna、Future ft. Young Thug", title: "Pushin P", note: "#48 Billboard 年終" },
    { artist: "Jordan Davis、Luke Bryan", title: "Buy Dirt", note: "#49 Billboard 年終" },
    { artist: "SZA", title: "I Hate U", note: "#50 Billboard 年終" },
  ]
};
