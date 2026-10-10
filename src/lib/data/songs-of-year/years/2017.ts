// 2017 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2017" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2017_US = {
  id: 'soy-2017-us',
  title: '2017 美國年選',
  titleEn: 'United States 2017',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2017,
  country: 'United States'
} as const;

export const SOY_2017: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Ed Sheeran", title: "Shape of You", note: "#1 Billboard 年終" },
    { artist: "Luis Fonsi、Daddy Yankee ft. Justin Bieber", title: "Despacito (Remix)", note: "#2 Billboard 年終" },
    { artist: "Bruno Mars", title: "That's What I Like", note: "#3 Billboard 年終" },
    { artist: "Kendrick Lamar", title: "Humble", note: "#4 Billboard 年終" },
    { artist: "The Chainsmokers、Coldplay", title: "Something Just Like This", note: "#5 Billboard 年終" },
    { artist: "Migos ft. Lil Uzi Vert", title: "Bad and Boujee", note: "#6 Billboard 年終" },
    { artist: "The Chainsmokers ft. Halsey", title: "Closer", note: "#7 Billboard 年終" },
    { artist: "Sam Hunt", title: "Body Like a Back Road", note: "#8 Billboard 年終" },
    { artist: "Imagine Dragons", title: "Believer", note: "#9 Billboard 年終" },
    { artist: "Post Malone ft. Quavo", title: "Congratulations", note: "#10 Billboard 年終" },
    { artist: "James Arthur", title: "Say You Won't Let Go", note: "#11 Billboard 年終" },
    { artist: "DJ Khaled ft. Justin Bieber, Quavo, Chance the Rapper、Lil Wayne", title: "I'm the One", note: "#12 Billboard 年終" },
    { artist: "Lil Uzi Vert", title: "XO Tour Llif3", note: "#13 Billboard 年終" },
    { artist: "Future", title: "Mask Off", note: "#14 Billboard 年終" },
    { artist: "French Montana ft. Swae Lee", title: "Unforgettable", note: "#15 Billboard 年終" },
    { artist: "Bruno Mars", title: "24K Magic", note: "#16 Billboard 年終" },
    { artist: "Zedd、Alessia Cara", title: "Stay", note: "#17 Billboard 年終" },
    { artist: "DJ Khaled ft. Rihanna、Bryson Tiller", title: "Wild Thoughts", note: "#18 Billboard 年終" },
    { artist: "Rae Sremmurd ft. Gucci Mane", title: "Black Beatles", note: "#19 Billboard 年終" },
    { artist: "The Weeknd ft. Daft Punk", title: "Starboy", note: "#20 Billboard 年終" },
    { artist: "Khalid", title: "Location", note: "#21 Billboard 年終" },
    { artist: "Charlie Puth", title: "Attention", note: "#22 Billboard 年終" },
    { artist: "Shawn Mendes", title: "There's Nothing Holdin' Me Back", note: "#23 Billboard 年終" },
    { artist: "Cardi B", title: "Bodak Yellow", note: "#24 Billboard 年終" },
    { artist: "Childish Gambino", title: "Redbone", note: "#25 Billboard 年終" },
    { artist: "Zayn、Taylor Swift", title: "I Don't Wanna Live Forever", note: "#26 Billboard 年終" },
    { artist: "Kygo、Selena Gomez", title: "It Ain't Me", note: "#27 Billboard 年終" },
    { artist: "Kyle ft. Lil Yachty", title: "iSpy", note: "#28 Billboard 年終" },
    { artist: "Julia Michaels", title: "Issues", note: "#29 Billboard 年終" },
    { artist: "Alessia Cara", title: "Scars to Your Beautiful", note: "#30 Billboard 年終" },
    { artist: "Logic ft. Alessia Cara、Khalid", title: "1-800-273-8255", note: "#31 Billboard 年終" },
    { artist: "Niall Horan", title: "Slow Hands", note: "#32 Billboard 年終" },
    { artist: "Rihanna", title: "Love on the Brain", note: "#33 Billboard 年終" },
    { artist: "The Weeknd ft. Daft Punk", title: "I Feel It Coming", note: "#34 Billboard 年終" },
    { artist: "Big Sean", title: "Bounce Back", note: "#35 Billboard 年終" },
    { artist: "Liam Payne ft. Quavo", title: "Strip That Down", note: "#36 Billboard 年終" },
    { artist: "Drake", title: "Fake Love", note: "#37 Billboard 年終" },
    { artist: "Maroon 5 ft. Kendrick Lamar", title: "Don't Wanna Know", note: "#38 Billboard 年終" },
    { artist: "Taylor Swift", title: "Look What You Made Me Do", note: "#39 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Castle on the Hill", note: "#40 Billboard 年終" },
    { artist: "Machine Gun Kelly、Camila Cabello", title: "Bad Things", note: "#41 Billboard 年終" },
    { artist: "The Chainsmokers", title: "Paris", note: "#42 Billboard 年終" },
    { artist: "Ariana Grande ft. Nicki Minaj", title: "Side to Side", note: "#43 Billboard 年終" },
    { artist: "Clean Bandit ft. Sean Paul、Anne-Marie", title: "Rockabye", note: "#44 Billboard 年終" },
    { artist: "Portugal. The Man", title: "Feel It Still", note: "#45 Billboard 年終" },
    { artist: "DJ Snake ft. Justin Bieber", title: "Let Me Love You", note: "#46 Billboard 年終" },
    { artist: "Demi Lovato", title: "Sorry Not Sorry", note: "#47 Billboard 年終" },
    { artist: "21 Savage", title: "Bank Account", note: "#48 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Can't Stop the Feeling!", note: "#49 Billboard 年終" },
    { artist: "J Balvin、Willy William ft. Beyoncé", title: "Mi Gente", note: "#50 Billboard 年終" },
  ]
};
