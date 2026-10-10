// 2003 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2003" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2003_US = {
  id: 'soy-2003-us',
  title: '2003 美國年選',
  titleEn: 'United States 2003',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2003,
  country: 'United States'
} as const;

export const SOY_2003: Record<string, PackSong[]> = {
  'United States': [
    { artist: "50 Cent", title: "In da Club", note: "#1 Billboard 年終" },
    { artist: "R. Kelly", title: "Ignition (Remix)", note: "#2 Billboard 年終" },
    { artist: "Sean Paul", title: "Get Busy", note: "#3 Billboard 年終" },
    { artist: "Beyoncé ft. Jay-Z", title: "Crazy in Love", note: "#4 Billboard 年終" },
    { artist: "3 Doors Down", title: "When I'm Gone", note: "#5 Billboard 年終" },
    { artist: "Matchbox Twenty", title: "Unwell", note: "#6 Billboard 年終" },
    { artist: "Chingy", title: "Right Thurr", note: "#7 Billboard 年終" },
    { artist: "Aaliyah", title: "Miss You", note: "#8 Billboard 年終" },
    { artist: "Kid Rock ft. Sheryl Crow or Allison Moorer", title: "Picture", note: "#9 Billboard 年終" },
    { artist: "Evanescence ft. Paul McCoy", title: "Bring Me to Life", note: "#10 Billboard 年終" },
    { artist: "Lil Jon、The East Side Boyz ft. Ying Yang Twins", title: "Get Low", note: "#11 Billboard 年終" },
    { artist: "Beyoncé ft. Sean Paul", title: "Baby Boy", note: "#12 Billboard 年終" },
    { artist: "Nelly, P. Diddy、Murphy Lee", title: "Shake Ya Tailfeather", note: "#13 Billboard 年終" },
    { artist: "50 Cent ft. Nate Dogg", title: "21 Questions", note: "#14 Billboard 年終" },
    { artist: "Jennifer Lopez ft. LL Cool J", title: "All I Have", note: "#15 Billboard 年終" },
    { artist: "Christina Aguilera", title: "Beautiful", note: "#16 Billboard 年終" },
    { artist: "Busta Rhymes、Mariah Carey ft. Flipmode Squad", title: "I Know What You Want", note: "#17 Billboard 年終" },
    { artist: "Avril Lavigne", title: "I'm with You", note: "#18 Billboard 年終" },
    { artist: "Uncle Kracker ft. Dobie Gray", title: "Drift Away", note: "#19 Billboard 年終" },
    { artist: "Lil' Kim ft. 50 Cent", title: "Magic Stick", note: "#20 Billboard 年終" },
    { artist: "50 Cent", title: "P.I.M.P.", note: "#21 Billboard 年終" },
    { artist: "B2K、P. Diddy", title: "Bump, Bump, Bump", note: "#22 Billboard 年終" },
    { artist: "Fabolous ft. Tamia or Ashanti", title: "Into You", note: "#23 Billboard 年終" },
    { artist: "Fabolous ft. Lil' Mo、Mike Shorey", title: "Can't Let You Go", note: "#24 Billboard 年終" },
    { artist: "Ja Rule ft. Ashanti", title: "Mesmerize", note: "#25 Billboard 年終" },
    { artist: "Black Eyed Peas", title: "Where Is the Love?", note: "#26 Billboard 年終" },
    { artist: "Santana ft. Michelle Branch", title: "The Game of Love", note: "#27 Billboard 年終" },
    { artist: "Eminem", title: "Lose Yourself", note: "#28 Billboard 年終" },
    { artist: "Ashanti", title: "Rock wit U (Awww Baby)", note: "#29 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Cry Me a River", note: "#30 Billboard 年終" },
    { artist: "Tyrese", title: "How You Gonna Act Like That", note: "#31 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Rock Your Body", note: "#32 Billboard 年終" },
    { artist: "Wayne Wonder", title: "No Letting Go", note: "#33 Billboard 年終" },
    { artist: "Pharrell ft. Jay-Z", title: "Frontin'", note: "#34 Billboard 年終" },
    { artist: "Dixie Chicks", title: "Landslide", note: "#35 Billboard 年終" },
    { artist: "Missy Elliott", title: "Work It", note: "#36 Billboard 年終" },
    { artist: "Jay-Z ft. Beyoncé", title: "'03 Bonnie & Clyde", note: "#37 Billboard 年終" },
    { artist: "Nivea ft. Jagged Edge", title: "Don't Mess with My Man", note: "#38 Billboard 年終" },
    { artist: "Monica", title: "So Gone", note: "#39 Billboard 年終" },
    { artist: "Nelly ft. Murphy Lee, Ali,、Kyjuan", title: "Air Force Ones", note: "#40 Billboard 年終" },
    { artist: "Lumidee", title: "Never Leave You (Uh Oooh, Uh Oooh)", note: "#41 Billboard 年終" },
    { artist: "Snoop Dogg ft. Pharrell、Charlie Wilson", title: "Beautiful", note: "#42 Billboard 年終" },
    { artist: "Missy Elliott ft. Ludacris", title: "Gossip Folks", note: "#43 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Miss Independent", note: "#44 Billboard 年終" },
    { artist: "Train", title: "Calling All Angels", note: "#45 Billboard 年終" },
    { artist: "YoungBloodZ ft. Lil Jon", title: "Damn!", note: "#46 Billboard 年終" },
    { artist: "Clay Aiken", title: "This Is the Night", note: "#47 Billboard 年終" },
    { artist: "John Mayer", title: "Your Body Is a Wonderland", note: "#48 Billboard 年終" },
    { artist: "Trapt", title: "Headstrong", note: "#49 Billboard 年終" },
    { artist: "Ginuwine", title: "In Those Jeans", note: "#50 Billboard 年終" },
  ]
};
