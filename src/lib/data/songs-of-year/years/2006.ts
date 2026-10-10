// 2006 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2006" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2006_US = {
  id: 'soy-2006-us',
  title: '2006 美國年選',
  titleEn: 'United States 2006',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2006,
  country: 'United States'
} as const;

export const SOY_2006: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Daniel Powter", title: "Bad Day", note: "#1 Billboard 年終" },
    { artist: "Sean Paul", title: "Temperature", note: "#2 Billboard 年終" },
    { artist: "Nelly Furtado ft. Timbaland", title: "Promiscuous", note: "#3 Billboard 年終" },
    { artist: "James Blunt", title: "You're Beautiful", note: "#4 Billboard 年終" },
    { artist: "Shakira ft. Wyclef Jean", title: "Hips Don't Lie", note: "#5 Billboard 年終" },
    { artist: "Natasha Bedingfield", title: "Unwritten", note: "#6 Billboard 年終" },
    { artist: "Gnarls Barkley", title: "Crazy", note: "#7 Billboard 年終" },
    { artist: "Chamillionaire ft. Krayzie Bone", title: "Ridin'", note: "#8 Billboard 年終" },
    { artist: "Justin Timberlake ft. Timbaland", title: "SexyBack", note: "#9 Billboard 年終" },
    { artist: "Beyoncé ft. Slim Thug、Bun B", title: "Check on It", note: "#10 Billboard 年終" },
    { artist: "Mary J. Blige", title: "Be Without You", note: "#11 Billboard 年終" },
    { artist: "Nelly ft. Paul Wall、Ali、Gipp", title: "Grillz", note: "#12 Billboard 年終" },
    { artist: "The Fray", title: "Over My Head (Cable Car)", note: "#13 Billboard 年終" },
    { artist: "Cassie", title: "Me & U", note: "#14 Billboard 年終" },
    { artist: "Pussycat Dolls ft. Snoop Dogg", title: "Buttons", note: "#15 Billboard 年終" },
    { artist: "Chris Brown ft. Juelz Santana", title: "Run It!", note: "#16 Billboard 年終" },
    { artist: "Ne-Yo", title: "So Sick", note: "#17 Billboard 年終" },
    { artist: "Yung Joc ft. Nitti", title: "It's Goin' Down", note: "#18 Billboard 年終" },
    { artist: "Rihanna", title: "SOS", note: "#19 Billboard 年終" },
    { artist: "Panic! at the Disco", title: "I Write Sins Not Tragedies", note: "#20 Billboard 年終" },
    { artist: "The All-American Rejects", title: "Move Along", note: "#21 Billboard 年終" },
    { artist: "Fergie", title: "London Bridge", note: "#22 Billboard 年終" },
    { artist: "Red Hot Chili Peppers", title: "Dani California", note: "#23 Billboard 年終" },
    { artist: "Lil Jon ft. E-40、Sean Paul", title: "Snap Yo Fingers", note: "#24 Billboard 年終" },
    { artist: "Dem Franchize Boyz ft. Peanut、Charlay", title: "Lean wit It, Rock wit It", note: "#25 Billboard 年終" },
    { artist: "Rascal Flatts", title: "What Hurts the Most", note: "#26 Billboard 年終" },
    { artist: "The Fray", title: "How to Save a Life", note: "#27 Billboard 年終" },
    { artist: "Rihanna", title: "Unfaithful", note: "#28 Billboard 年終" },
    { artist: "Snow Patrol", title: "Chasing Cars", note: "#29 Billboard 年終" },
    { artist: "Hinder", title: "Lips of an Angel", note: "#30 Billboard 年終" },
    { artist: "Cascada", title: "Everytime We Touch", note: "#31 Billboard 年終" },
    { artist: "Christina Aguilera", title: "Ain't No Other Man", note: "#32 Billboard 年終" },
    { artist: "Fall Out Boy", title: "Dance, Dance", note: "#33 Billboard 年終" },
    { artist: "Kanye West ft. Jamie Foxx", title: "Gold Digger", note: "#34 Billboard 年終" },
    { artist: "Ludacris ft. Pharrell", title: "Money Maker", note: "#35 Billboard 年終" },
    { artist: "Bubba Sparxxx ft. Ying Yang Twins", title: "Ms. New Booty", note: "#36 Billboard 年終" },
    { artist: "Sean Paul ft. Keyshia Cole", title: "(When You Gonna) Give It Up to Me", note: "#37 Billboard 年終" },
    { artist: "Nickelback", title: "Photograph", note: "#38 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Because of You", note: "#39 Billboard 年終" },
    { artist: "Pussycat Dolls", title: "Stickwitu", note: "#40 Billboard 年終" },
    { artist: "T-Pain ft. Mike Jones", title: "I'm 'n Luv (wit a Stripper)", note: "#41 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "My Humps", note: "#42 Billboard 年終" },
    { artist: "Fort Minor ft. Holly Brook、Jonah Matranga", title: "Where'd You Go", note: "#43 Billboard 年終" },
    { artist: "Chris Brown", title: "Yo (Excuse Me Miss)", note: "#44 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Walk Away", note: "#45 Billboard 年終" },
    { artist: "D4L", title: "Laffy Taffy", note: "#46 Billboard 年終" },
    { artist: "T.I.", title: "What You Know", note: "#47 Billboard 年終" },
    { artist: "The All-American Rejects", title: "Dirty Little Secret", note: "#48 Billboard 年終" },
    { artist: "Nickelback", title: "Savin' Me", note: "#49 Billboard 年終" },
    { artist: "Mariah Carey", title: "Don't Forget About Us", note: "#50 Billboard 年終" },
  ]
};
