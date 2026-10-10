// 2019 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2019" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2019_US = {
  id: 'soy-2019-us',
  title: '2019 美國年選',
  titleEn: 'United States 2019',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2019,
  country: 'United States'
} as const;

export const SOY_2019: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Lil Nas X ft. Billy Ray Cyrus", title: "Old Town Road", note: "#1 Billboard 年終" },
    { artist: "Post Malone、Swae Lee", title: "Sunflower", note: "#2 Billboard 年終" },
    { artist: "Halsey", title: "Without Me", note: "#3 Billboard 年終" },
    { artist: "Billie Eilish", title: "Bad Guy", note: "#4 Billboard 年終" },
    { artist: "Post Malone", title: "Wow", note: "#5 Billboard 年終" },
    { artist: "Marshmello、Bastille", title: "Happier", note: "#6 Billboard 年終" },
    { artist: "Ariana Grande", title: "7 Rings", note: "#7 Billboard 年終" },
    { artist: "Khalid", title: "Talk", note: "#8 Billboard 年終" },
    { artist: "Travis Scott", title: "Sicko Mode", note: "#9 Billboard 年終" },
    { artist: "Jonas Brothers", title: "Sucker", note: "#10 Billboard 年終" },
    { artist: "Panic! at the Disco", title: "High Hopes", note: "#11 Billboard 年終" },
    { artist: "Ariana Grande", title: "Thank U, Next", note: "#12 Billboard 年終" },
    { artist: "Lizzo", title: "Truth Hurts", note: "#13 Billboard 年終" },
    { artist: "Sam Smith、Normani", title: "Dancing with a Stranger", note: "#14 Billboard 年終" },
    { artist: "Shawn Mendes、Camila Cabello", title: "Señorita", note: "#15 Billboard 年終" },
    { artist: "Ed Sheeran、Justin Bieber", title: "I Don't Care", note: "#16 Billboard 年終" },
    { artist: "Benny Blanco, Halsey、Khalid", title: "Eastside", note: "#17 Billboard 年終" },
    { artist: "Meek Mill ft. Drake", title: "Going Bad", note: "#18 Billboard 年終" },
    { artist: "Lady Gaga、Bradley Cooper", title: "Shallow", note: "#19 Billboard 年終" },
    { artist: "Khalid", title: "Better", note: "#20 Billboard 年終" },
    { artist: "Chris Brown ft. Drake", title: "No Guidance", note: "#21 Billboard 年終" },
    { artist: "Maroon 5 ft. Cardi B", title: "Girls Like You", note: "#22 Billboard 年終" },
    { artist: "Ava Max", title: "Sweet but Psycho", note: "#23 Billboard 年終" },
    { artist: "DaBaby", title: "Suge", note: "#24 Billboard 年終" },
    { artist: "J. Cole", title: "Middle Child", note: "#25 Billboard 年終" },
    { artist: "Lil Baby、Gunna", title: "Drip Too Hard", note: "#26 Billboard 年終" },
    { artist: "Lewis Capaldi", title: "Someone You Loved", note: "#27 Billboard 年終" },
    { artist: "Lil Tecca", title: "Ransom", note: "#28 Billboard 年終" },
    { artist: "Shawn Mendes", title: "If I Can't Have You", note: "#29 Billboard 年終" },
    { artist: "Post Malone ft. Young Thug", title: "Goodbyes", note: "#30 Billboard 年終" },
    { artist: "Kodak Black ft. Travis Scott、Offset", title: "Zeze", note: "#31 Billboard 年終" },
    { artist: "Post Malone", title: "Better Now", note: "#32 Billboard 年終" },
    { artist: "5 Seconds of Summer", title: "Youngblood", note: "#33 Billboard 年終" },
    { artist: "Drake ft. Rick Ross", title: "Money in the Grave", note: "#34 Billboard 年終" },
    { artist: "Dan + Shay", title: "Speechless", note: "#35 Billboard 年終" },
    { artist: "Ariana Grande", title: "Break Up with Your Girlfriend, I'm Bored", note: "#36 Billboard 年終" },
    { artist: "Cardi B、Bruno Mars", title: "Please Me", note: "#37 Billboard 年終" },
    { artist: "Cardi B", title: "Money", note: "#38 Billboard 年終" },
    { artist: "Taylor Swift", title: "You Need to Calm Down", note: "#39 Billboard 年終" },
    { artist: "Lil Nas X", title: "Panini", note: "#40 Billboard 年終" },
    { artist: "A Boogie wit da Hoodie", title: "Look Back at It", note: "#41 Billboard 年終" },
    { artist: "21 Savage", title: "A Lot", note: "#42 Billboard 年終" },
    { artist: "Taylor Swift ft. Brendon Urie", title: "Me!", note: "#43 Billboard 年終" },
    { artist: "Bad Bunny ft. Drake", title: "Mia", note: "#44 Billboard 年終" },
    { artist: "Polo G ft. Lil Tjay", title: "Pop Out", note: "#45 Billboard 年終" },
    { artist: "Luke Combs", title: "Beautiful Crazy", note: "#46 Billboard 年終" },
    { artist: "Blueface", title: "Thotiana", note: "#47 Billboard 年終" },
    { artist: "Juice Wrld", title: "Lucid Dreams", note: "#48 Billboard 年終" },
    { artist: "Sheck Wes", title: "Mo Bamba", note: "#49 Billboard 年終" },
    { artist: "Ed Sheeran ft. Khalid", title: "Beautiful People", note: "#50 Billboard 年終" },
  ]
};
