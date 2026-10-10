// 2010 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2010" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2010_US = {
  id: 'soy-2010-us',
  title: '2010 美國年選',
  titleEn: 'United States 2010',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2010,
  country: 'United States'
} as const;

export const SOY_2010: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Kesha", title: "Tik Tok", note: "#1 Billboard 年終" },
    { artist: "Lady Antebellum", title: "Need You Now", note: "#2 Billboard 年終" },
    { artist: "Train", title: "Hey, Soul Sister", note: "#3 Billboard 年終" },
    { artist: "Katy Perry ft. Snoop Dogg", title: "California Gurls", note: "#4 Billboard 年終" },
    { artist: "Usher ft. will.i.am", title: "OMG", note: "#5 Billboard 年終" },
    { artist: "B.o.B ft. Hayley Williams", title: "Airplanes", note: "#6 Billboard 年終" },
    { artist: "Eminem ft. Rihanna", title: "Love the Way You Lie", note: "#7 Billboard 年終" },
    { artist: "Lady Gaga", title: "Bad Romance", note: "#8 Billboard 年終" },
    { artist: "Taio Cruz", title: "Dynamite", note: "#9 Billboard 年終" },
    { artist: "Taio Cruz ft. Ludacris", title: "Break Your Heart", note: "#10 Billboard 年終" },
    { artist: "B.o.B ft. Bruno Mars", title: "Nothin' on You", note: "#11 Billboard 年終" },
    { artist: "Enrique Iglesias ft. Pitbull", title: "I Like It", note: "#12 Billboard 年終" },
    { artist: "Young Money ft. Lloyd", title: "BedRock", note: "#13 Billboard 年終" },
    { artist: "Jason Derulo", title: "In My Head", note: "#14 Billboard 年終" },
    { artist: "Rihanna", title: "Rude Boy", note: "#15 Billboard 年終" },
    { artist: "Lady Gaga ft. Beyoncé", title: "Telephone", note: "#16 Billboard 年終" },
    { artist: "Katy Perry", title: "Teenage Dream", note: "#17 Billboard 年終" },
    { artist: "Bruno Mars", title: "Just the Way You Are", note: "#18 Billboard 年終" },
    { artist: "Mike Posner", title: "Cooler Than Me", note: "#19 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "Imma Be", note: "#20 Billboard 年終" },
    { artist: "Jay-Z ft. Alicia Keys", title: "Empire State of Mind", note: "#21 Billboard 年終" },
    { artist: "Usher ft. Pitbull", title: "DJ Got Us Fallin' in Love", note: "#22 Billboard 年終" },
    { artist: "Travie McCoy ft. Bruno Mars", title: "Billionaire", note: "#23 Billboard 年終" },
    { artist: "Eminem", title: "Not Afraid", note: "#24 Billboard 年終" },
    { artist: "Iyaz", title: "Replay", note: "#25 Billboard 年終" },
    { artist: "David Guetta ft. Akon", title: "Sexy Bitch", note: "#26 Billboard 年終" },
    { artist: "The Script", title: "Breakeven", note: "#27 Billboard 年終" },
    { artist: "Kesha", title: "Your Love Is My Drug", note: "#28 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "I Gotta Feeling", note: "#29 Billboard 年終" },
    { artist: "Owl City", title: "Fireflies", note: "#30 Billboard 年終" },
    { artist: "Trey Songz ft. Fabolous", title: "Say Aah", note: "#31 Billboard 年終" },
    { artist: "Drake", title: "Find Your Love", note: "#32 Billboard 年終" },
    { artist: "Lady Gaga", title: "Alejandro", note: "#33 Billboard 年終" },
    { artist: "Jason Derulo", title: "Ridin' Solo", note: "#34 Billboard 年終" },
    { artist: "Nelly", title: "Just a Dream", note: "#35 Billboard 年終" },
    { artist: "Ludacris", title: "How Low", note: "#36 Billboard 年終" },
    { artist: "Far East Movement ft. The Cataracs、Dev", title: "Like a G6", note: "#37 Billboard 年終" },
    { artist: "Timbaland ft. Justin Timberlake", title: "Carry Out", note: "#38 Billboard 年終" },
    { artist: "Michael Bublé", title: "Haven't Met You Yet", note: "#39 Billboard 年終" },
    { artist: "Flo Rida ft. David Guetta", title: "Club Can't Handle Me", note: "#40 Billboard 年終" },
    { artist: "Jay Sean ft. Lil Wayne", title: "Down", note: "#41 Billboard 年終" },
    { artist: "La Roux", title: "Bulletproof", note: "#42 Billboard 年終" },
    { artist: "Jason Derulo", title: "Whatcha Say", note: "#43 Billboard 年終" },
    { artist: "Justin Bieber ft. Ludacris", title: "Baby", note: "#44 Billboard 年終" },
    { artist: "Adam Lambert", title: "Whataya Want from Me", note: "#45 Billboard 年終" },
    { artist: "Taylor Swift", title: "Mine", note: "#46 Billboard 年終" },
    { artist: "Rihanna", title: "Only Girl (In the World)", note: "#47 Billboard 年終" },
    { artist: "Kris Allen", title: "Live Like We're Dying", note: "#48 Billboard 年終" },
    { artist: "Rihanna ft. Jeezy", title: "Hard", note: "#49 Billboard 年終" },
    { artist: "Jay-Z ft. Mr Hudson", title: "Young Forever", note: "#50 Billboard 年終" },
  ]
};
