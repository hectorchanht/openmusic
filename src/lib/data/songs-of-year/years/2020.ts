// 2020 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2020" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2020_US = {
  id: 'soy-2020-us',
  title: '2020 美國年選',
  titleEn: 'United States 2020',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2020,
  country: 'United States'
} as const;

export const SOY_2020: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Weeknd", title: "Blinding Lights", note: "#1 Billboard 年終" },
    { artist: "Post Malone", title: "Circles", note: "#2 Billboard 年終" },
    { artist: "Roddy Ricch", title: "The Box", note: "#3 Billboard 年終" },
    { artist: "Dua Lipa", title: "Don't Start Now", note: "#4 Billboard 年終" },
    { artist: "DaBaby ft. Roddy Ricch", title: "Rockstar", note: "#5 Billboard 年終" },
    { artist: "Harry Styles", title: "Adore You", note: "#6 Billboard 年終" },
    { artist: "Future ft. Drake", title: "Life Is Good", note: "#7 Billboard 年終" },
    { artist: "Maroon 5", title: "Memories", note: "#8 Billboard 年終" },
    { artist: "Maren Morris", title: "The Bones", note: "#9 Billboard 年終" },
    { artist: "Lewis Capaldi", title: "Someone You Loved", note: "#10 Billboard 年終" },
    { artist: "Doja Cat", title: "Say So", note: "#11 Billboard 年終" },
    { artist: "Gabby Barrett ft. Charlie Puth", title: "I Hope", note: "#12 Billboard 年終" },
    { artist: "Jack Harlow ft. DaBaby, Tory Lanez、Lil Wayne", title: "Whats Poppin", note: "#13 Billboard 年終" },
    { artist: "Tones and I", title: "Dance Monkey", note: "#14 Billboard 年終" },
    { artist: "Megan Thee Stallion ft. Beyoncé", title: "Savage", note: "#15 Billboard 年終" },
    { artist: "Arizona Zervas", title: "Roxanne", note: "#16 Billboard 年終" },
    { artist: "Justin Bieber ft. Quavo", title: "Intentions", note: "#17 Billboard 年終" },
    { artist: "Billie Eilish", title: "Everything I Wanted", note: "#18 Billboard 年終" },
    { artist: "Saint Jhn", title: "Roses (Imanbek remix)", note: "#19 Billboard 年終" },
    { artist: "Harry Styles", title: "Watermelon Sugar", note: "#20 Billboard 年終" },
    { artist: "Lewis Capaldi", title: "Before You Go", note: "#21 Billboard 年終" },
    { artist: "Trevor Daniel", title: "Falling", note: "#22 Billboard 年終" },
    { artist: "Dan + Shay、Justin Bieber", title: "10,000 Hours", note: "#23 Billboard 年終" },
    { artist: "Cardi B ft. Megan Thee Stallion", title: "WAP", note: "#24 Billboard 年終" },
    { artist: "Mustard、Roddy Ricch", title: "Ballin'", note: "#25 Billboard 年終" },
    { artist: "Blackbear", title: "Hot Girl Bummer", note: "#26 Billboard 年終" },
    { artist: "Lil Mosey", title: "Blueberry Faygo", note: "#27 Billboard 年終" },
    { artist: "The Weeknd", title: "Heartless", note: "#28 Billboard 年終" },
    { artist: "DaBaby", title: "Bop", note: "#29 Billboard 年終" },
    { artist: "Selena Gomez", title: "Lose You to Love Me", note: "#30 Billboard 年終" },
    { artist: "Lizzo", title: "Good as Hell", note: "#31 Billboard 年終" },
    { artist: "Drake", title: "Toosie Slide", note: "#32 Billboard 年終" },
    { artist: "Dua Lipa", title: "Break My Heart", note: "#33 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Chasin' You", note: "#34 Billboard 年終" },
    { artist: "Jawsh 685、Jason Derulo", title: "Savage Love (Laxed – Siren Beat)", note: "#35 Billboard 年終" },
    { artist: "Chris Brown ft. Drake", title: "No Guidance", note: "#36 Billboard 年終" },
    { artist: "Camila Cabello ft. DaBaby", title: "My Oh My", note: "#37 Billboard 年終" },
    { artist: "BTS", title: "Dynamite", note: "#38 Billboard 年終" },
    { artist: "Chris Brown、Young Thug", title: "Go Crazy", note: "#39 Billboard 年終" },
    { artist: "Roddy Ricch ft. Mustard", title: "High Fashion", note: "#40 Billboard 年終" },
    { artist: "Drake ft. Lil Durk", title: "Laugh Now Cry Later", note: "#41 Billboard 年終" },
    { artist: "Lil Baby", title: "Woah", note: "#42 Billboard 年終" },
    { artist: "Powfu ft. Beabadoobee", title: "Death Bed", note: "#43 Billboard 年終" },
    { artist: "Shawn Mendes、Camila Cabello", title: "Señorita", note: "#44 Billboard 年終" },
    { artist: "Travis Scott", title: "Highest in the Room", note: "#45 Billboard 年終" },
    { artist: "Billie Eilish", title: "Bad Guy", note: "#46 Billboard 年終" },
    { artist: "24kGoldn ft. Iann Dior", title: "Mood", note: "#47 Billboard 年終" },
    { artist: "Lady Gaga、Ariana Grande", title: "Rain on Me", note: "#48 Billboard 年終" },
    { artist: "Pop Smoke ft. Lil Baby、DaBaby", title: "For the Night", note: "#49 Billboard 年終" },
    { artist: "Black Eyed Peas、J Balvin", title: "Ritmo (Bad Boys for Life)", note: "#50 Billboard 年終" },
  ]
};
