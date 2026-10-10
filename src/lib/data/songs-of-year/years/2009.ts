// 2009 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2009" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2009_US = {
  id: 'soy-2009-us',
  title: '2009 美國年選',
  titleEn: 'United States 2009',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2009,
  country: 'United States'
} as const;

export const SOY_2009: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Black Eyed Peas", title: "Boom Boom Pow", note: "#1 Billboard 年終" },
    { artist: "Lady Gaga", title: "Poker Face", note: "#2 Billboard 年終" },
    { artist: "Lady Gaga ft. Colby O'Donis", title: "Just Dance", note: "#3 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "I Gotta Feeling", note: "#4 Billboard 年終" },
    { artist: "Taylor Swift", title: "Love Story", note: "#5 Billboard 年終" },
    { artist: "Flo Rida", title: "Right Round", note: "#6 Billboard 年終" },
    { artist: "Jason Mraz", title: "I'm Yours", note: "#7 Billboard 年終" },
    { artist: "Beyoncé", title: "Single Ladies (Put a Ring on It)", note: "#8 Billboard 年終" },
    { artist: "Kanye West", title: "Heartless", note: "#9 Billboard 年終" },
    { artist: "The All-American Rejects", title: "Gives You Hell", note: "#10 Billboard 年終" },
    { artist: "Taylor Swift", title: "You Belong with Me", note: "#11 Billboard 年終" },
    { artist: "T.I. ft. Justin Timberlake", title: "Dead and Gone", note: "#12 Billboard 年終" },
    { artist: "The Fray", title: "You Found Me", note: "#13 Billboard 年終" },
    { artist: "Kings of Leon", title: "Use Somebody", note: "#14 Billboard 年終" },
    { artist: "Keri Hilson ft. Kanye West、Ne-Yo", title: "Knock You Down", note: "#15 Billboard 年終" },
    { artist: "Jamie Foxx ft. T-Pain", title: "Blame It", note: "#16 Billboard 年終" },
    { artist: "Pitbull", title: "I Know You Want Me (Calle Ocho)", note: "#17 Billboard 年終" },
    { artist: "T.I. ft. Rihanna", title: "Live Your Life", note: "#18 Billboard 年終" },
    { artist: "Soulja Boy Tell 'Em ft. Sammie", title: "Kiss Me thru the Phone", note: "#19 Billboard 年終" },
    { artist: "Jay Sean ft. Lil Wayne", title: "Down", note: "#20 Billboard 年終" },
    { artist: "Miley Cyrus", title: "The Climb", note: "#21 Billboard 年終" },
    { artist: "Drake", title: "Best I Ever Had", note: "#22 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "My Life Would Suck Without You", note: "#23 Billboard 年終" },
    { artist: "Beyoncé", title: "Halo", note: "#24 Billboard 年終" },
    { artist: "Katy Perry", title: "Hot n Cold", note: "#25 Billboard 年終" },
    { artist: "Shinedown", title: "Second Chance", note: "#26 Billboard 年終" },
    { artist: "Britney Spears", title: "Circus", note: "#27 Billboard 年終" },
    { artist: "Kid Cudi", title: "Day 'n' Nite", note: "#28 Billboard 年終" },
    { artist: "Miley Cyrus", title: "Party in the U.S.A.", note: "#29 Billboard 年終" },
    { artist: "3OH!3", title: "Don't Trust Me", note: "#30 Billboard 年終" },
    { artist: "Jay-Z ft. Rihanna、Kanye West", title: "Run This Town", note: "#31 Billboard 年終" },
    { artist: "Kevin Rudolf ft. Lil Wayne", title: "Let It Rock", note: "#32 Billboard 年終" },
    { artist: "Sean Kingston", title: "Fire Burning", note: "#33 Billboard 年終" },
    { artist: "Jason Derulo", title: "Whatcha Say", note: "#34 Billboard 年終" },
    { artist: "Lady Gaga", title: "LoveGame", note: "#35 Billboard 年終" },
    { artist: "Katy Perry", title: "Waking Up in Vegas", note: "#36 Billboard 年終" },
    { artist: "Jeremih", title: "Birthday Sex", note: "#37 Billboard 年終" },
    { artist: "Pink", title: "Sober", note: "#38 Billboard 年終" },
    { artist: "Britney Spears", title: "Womanizer", note: "#39 Billboard 年終" },
    { artist: "T.I.", title: "Whatever You Like", note: "#40 Billboard 年終" },
    { artist: "Mariah Carey", title: "Obsessed", note: "#41 Billboard 年終" },
    { artist: "Ne-Yo", title: "Mad", note: "#42 Billboard 年終" },
    { artist: "Cobra Starship ft. Leighton Meester", title: "Good Girls Go Bad", note: "#43 Billboard 年終" },
    { artist: "Kanye West", title: "Love Lockdown", note: "#44 Billboard 年終" },
    { artist: "Pink", title: "So What", note: "#45 Billboard 年終" },
    { artist: "Pitbull", title: "Hotel Room Service", note: "#46 Billboard 年終" },
    { artist: "Eminem, Dr. Dre、50 Cent", title: "Crack a Bottle", note: "#47 Billboard 年終" },
    { artist: "Beyoncé", title: "If I Were a Boy", note: "#48 Billboard 年終" },
    { artist: "Keri Hilson ft. Lil Wayne", title: "Turnin Me On", note: "#49 Billboard 年終" },
    { artist: "Pussycat Dolls", title: "I Hate This Part", note: "#50 Billboard 年終" },
  ]
};
