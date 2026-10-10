// 2008 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2008" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2008_US = {
  id: 'soy-2008-us',
  title: '2008 美國年選',
  titleEn: 'United States 2008',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2008,
  country: 'United States'
} as const;

export const SOY_2008: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Flo Rida ft. T-Pain", title: "Low", note: "#1 Billboard 年終" },
    { artist: "Leona Lewis", title: "Bleeding Love", note: "#2 Billboard 年終" },
    { artist: "Alicia Keys", title: "No One", note: "#3 Billboard 年終" },
    { artist: "Lil Wayne ft. Static Major", title: "Lollipop", note: "#4 Billboard 年終" },
    { artist: "OneRepublic", title: "Apologize", note: "#5 Billboard 年終" },
    { artist: "Jordin Sparks、Chris Brown", title: "No Air", note: "#6 Billboard 年終" },
    { artist: "Sara Bareilles", title: "Love Song", note: "#7 Billboard 年終" },
    { artist: "Usher ft. Young Jeezy", title: "Love in This Club", note: "#8 Billboard 年終" },
    { artist: "Chris Brown", title: "With You", note: "#9 Billboard 年終" },
    { artist: "Chris Brown", title: "Forever", note: "#10 Billboard 年終" },
    { artist: "Ray J ft. Yung Berg", title: "Sexy Can I", note: "#11 Billboard 年終" },
    { artist: "Rihanna", title: "Take a Bow", note: "#12 Billboard 年終" },
    { artist: "Coldplay", title: "Viva la Vida", note: "#13 Billboard 年終" },
    { artist: "Katy Perry", title: "I Kissed a Girl", note: "#14 Billboard 年終" },
    { artist: "T.I.", title: "Whatever You Like", note: "#15 Billboard 年終" },
    { artist: "Rihanna", title: "Disturbia", note: "#16 Billboard 年終" },
    { artist: "Rihanna", title: "Don't Stop the Music", note: "#17 Billboard 年終" },
    { artist: "Natasha Bedingfield", title: "Pocketful of Sunshine", note: "#18 Billboard 年終" },
    { artist: "Chris Brown ft. T-Pain", title: "Kiss Kiss", note: "#19 Billboard 年終" },
    { artist: "Ne-Yo", title: "Closer", note: "#20 Billboard 年終" },
    { artist: "Colbie Caillat", title: "Bubbly", note: "#21 Billboard 年終" },
    { artist: "Mariah Carey", title: "Touch My Body", note: "#22 Billboard 年終" },
    { artist: "Madonna ft. Justin Timberlake、Timbaland", title: "4 Minutes", note: "#23 Billboard 年終" },
    { artist: "Pink", title: "So What", note: "#24 Billboard 年終" },
    { artist: "Finger Eleven", title: "Paralyzer", note: "#25 Billboard 年終" },
    { artist: "Fergie", title: "Clumsy", note: "#26 Billboard 年終" },
    { artist: "Jason Mraz", title: "I'm Yours", note: "#27 Billboard 年終" },
    { artist: "Jesse McCartney", title: "Leavin'", note: "#28 Billboard 年終" },
    { artist: "Kardinal Offishall ft. Akon", title: "Dangerous", note: "#29 Billboard 年終" },
    { artist: "Jordin Sparks", title: "Tattoo", note: "#30 Billboard 年終" },
    { artist: "Miley Cyrus", title: "See You Again", note: "#31 Billboard 年終" },
    { artist: "Metro Station", title: "Shake It", note: "#32 Billboard 年終" },
    { artist: "OneRepublic", title: "Stop and Stare", note: "#33 Billboard 年終" },
    { artist: "Sean Kingston", title: "Take You There", note: "#34 Billboard 年終" },
    { artist: "M.I.A.", title: "Paper Planes", note: "#35 Billboard 年終" },
    { artist: "Katy Perry", title: "Hot n Cold", note: "#36 Billboard 年終" },
    { artist: "T.I. ft. Rihanna", title: "Live Your Life", note: "#37 Billboard 年終" },
    { artist: "Plies ft. Ne-Yo", title: "Bust It Baby (Part 2)", note: "#38 Billboard 年終" },
    { artist: "Estelle ft. Kanye West", title: "American Boy", note: "#39 Billboard 年終" },
    { artist: "Lil Wayne ft. T-Pain", title: "Got Money", note: "#40 Billboard 年終" },
    { artist: "Taylor Swift", title: "Our Song", note: "#41 Billboard 年終" },
    { artist: "Danity Kane", title: "Damaged", note: "#42 Billboard 年終" },
    { artist: "Lil Wayne", title: "A Milli", note: "#43 Billboard 年終" },
    { artist: "Buckcherry", title: "Sorry", note: "#44 Billboard 年終" },
    { artist: "Webbie ft. Lil Boosie、Lil Phat", title: "Independent", note: "#45 Billboard 年終" },
    { artist: "T-Pain ft. Lil Wayne", title: "Can't Believe It", note: "#46 Billboard 年終" },
    { artist: "Alicia Keys", title: "Like You'll Never See Me Again", note: "#47 Billboard 年終" },
    { artist: "Taylor Swift", title: "Teardrops on My Guitar", note: "#48 Billboard 年終" },
    { artist: "Pussycat Dolls", title: "When I Grow Up", note: "#49 Billboard 年終" },
    { artist: "Snoop Dogg", title: "Sexual Eruption", note: "#50 Billboard 年終" },
  ]
};
