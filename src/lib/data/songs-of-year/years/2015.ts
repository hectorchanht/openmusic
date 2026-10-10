// 2015 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2015" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2015_US = {
  id: 'soy-2015-us',
  title: '2015 美國年選',
  titleEn: 'United States 2015',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2015,
  country: 'United States'
} as const;

export const SOY_2015: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Mark Ronson ft. Bruno Mars", title: "Uptown Funk", note: "#1 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Thinking Out Loud", note: "#2 Billboard 年終" },
    { artist: "Wiz Khalifa ft. Charlie Puth", title: "See You Again", note: "#3 Billboard 年終" },
    { artist: "Fetty Wap", title: "Trap Queen", note: "#4 Billboard 年終" },
    { artist: "Maroon 5", title: "Sugar", note: "#5 Billboard 年終" },
    { artist: "Walk the Moon", title: "Shut Up and Dance", note: "#6 Billboard 年終" },
    { artist: "Taylor Swift", title: "Blank Space", note: "#7 Billboard 年終" },
    { artist: "Silentó", title: "Watch Me", note: "#8 Billboard 年終" },
    { artist: "The Weeknd", title: "Earned It", note: "#9 Billboard 年終" },
    { artist: "The Weeknd", title: "The Hills", note: "#10 Billboard 年終" },
    { artist: "OMI", title: "Cheerleader (Felix Jaehn Remix)", note: "#11 Billboard 年終" },
    { artist: "The Weeknd", title: "Can't Feel My Face", note: "#12 Billboard 年終" },
    { artist: "Ellie Goulding", title: "Love Me Like You Do", note: "#13 Billboard 年終" },
    { artist: "Hozier", title: "Take Me to Church", note: "#14 Billboard 年終" },
    { artist: "Taylor Swift ft. Kendrick Lamar", title: "Bad Blood", note: "#15 Billboard 年終" },
    { artist: "Major Lazer、DJ Snake ft. MØ", title: "Lean On", note: "#16 Billboard 年終" },
    { artist: "Jason Derulo", title: "Want to Want Me", note: "#17 Billboard 年終" },
    { artist: "Taylor Swift", title: "Shake It Off", note: "#18 Billboard 年終" },
    { artist: "Jack Ü ft. Justin Bieber", title: "Where Are Ü Now", note: "#19 Billboard 年終" },
    { artist: "Rachel Platten", title: "Fight Song", note: "#20 Billboard 年終" },
    { artist: "Fetty Wap ft. Remy Boyz", title: "679", note: "#21 Billboard 年終" },
    { artist: "Meghan Trainor", title: "Lips Are Movin", note: "#22 Billboard 年終" },
    { artist: "Fifth Harmony ft. Kid Ink", title: "Worth It", note: "#23 Billboard 年終" },
    { artist: "Omarion ft. Chris Brown、Jhené Aiko", title: "Post to Be", note: "#24 Billboard 年終" },
    { artist: "Andy Grammer", title: "Honey, I'm Good", note: "#25 Billboard 年終" },
    { artist: "Sam Smith", title: "I'm Not the Only One", note: "#26 Billboard 年終" },
    { artist: "Selena Gomez ft. ASAP Rocky", title: "Good for You", note: "#27 Billboard 年終" },
    { artist: "Meghan Trainor", title: "All About That Bass", note: "#28 Billboard 年終" },
    { artist: "Taylor Swift", title: "Style", note: "#29 Billboard 年終" },
    { artist: "Drake", title: "Hotline Bling", note: "#30 Billboard 年終" },
    { artist: "David Guetta ft. Nicki Minaj, Bebe Rexha、Afrojack", title: "Hey Mama", note: "#31 Billboard 年終" },
    { artist: "Flo Rida ft. Sage the Gemini、Lookas", title: "G.D.F.R.", note: "#32 Billboard 年終" },
    { artist: "Justin Bieber", title: "What Do You Mean?", note: "#33 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Photograph", note: "#34 Billboard 年終" },
    { artist: "Adele", title: "Hello", note: "#35 Billboard 年終" },
    { artist: "Shawn Mendes", title: "Stitches", note: "#36 Billboard 年終" },
    { artist: "Tove Lo", title: "Talking Body", note: "#37 Billboard 年終" },
    { artist: "Nick Jonas", title: "Jealous", note: "#38 Billboard 年終" },
    { artist: "Pitbull、Ne-Yo", title: "Time of Our Lives", note: "#39 Billboard 年終" },
    { artist: "R. City ft. Adam Levine", title: "Locked Away", note: "#40 Billboard 年終" },
    { artist: "Natalie La Rose ft. Jeremih", title: "Somebody", note: "#41 Billboard 年終" },
    { artist: "Rihanna, Kanye West、Paul McCartney", title: "FourFiveSeconds", note: "#42 Billboard 年終" },
    { artist: "Fall Out Boy", title: "Centuries", note: "#43 Billboard 年終" },
    { artist: "Fetty Wap ft. Monty", title: "My Way", note: "#44 Billboard 年終" },
    { artist: "Sam Hunt", title: "Take Your Time", note: "#45 Billboard 年終" },
    { artist: "Maroon 5", title: "Animals", note: "#46 Billboard 年終" },
    { artist: "Big Sean ft. E-40", title: "I Don't Fuck with You", note: "#47 Billboard 年終" },
    { artist: "Rihanna", title: "Bitch Better Have My Money", note: "#48 Billboard 年終" },
    { artist: "Rich Homie Quan", title: "Flex (Ooh, Ooh, Ooh)", note: "#49 Billboard 年終" },
    { artist: "T-Wayne", title: "Nasty Freestyle", note: "#50 Billboard 年終" },
  ]
};
