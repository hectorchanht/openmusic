// 2013 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2013" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2013_US = {
  id: 'soy-2013-us',
  title: '2013 美國年選',
  titleEn: 'United States 2013',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2013,
  country: 'United States'
} as const;

export const SOY_2013: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Macklemore、Ryan Lewis ft. Wanz", title: "Thrift Shop", note: "#1 Billboard 年終" },
    { artist: "Robin Thicke ft. T.I.、Pharrell Williams", title: "Blurred Lines", note: "#2 Billboard 年終" },
    { artist: "Imagine Dragons", title: "Radioactive", note: "#3 Billboard 年終" },
    { artist: "Baauer", title: "Harlem Shake", note: "#4 Billboard 年終" },
    { artist: "Macklemore、Ryan Lewis ft. Ray Dalton", title: "Can't Hold Us", note: "#5 Billboard 年終" },
    { artist: "Justin Timberlake", title: "Mirrors", note: "#6 Billboard 年終" },
    { artist: "Pink ft. Nate Ruess", title: "Just Give Me a Reason", note: "#7 Billboard 年終" },
    { artist: "Bruno Mars", title: "When I Was Your Man", note: "#8 Billboard 年終" },
    { artist: "Florida Georgia Line ft. Nelly", title: "Cruise", note: "#9 Billboard 年終" },
    { artist: "Katy Perry", title: "Roar", note: "#10 Billboard 年終" },
    { artist: "Bruno Mars", title: "Locked Out of Heaven", note: "#11 Billboard 年終" },
    { artist: "The Lumineers", title: "Ho Hey", note: "#12 Billboard 年終" },
    { artist: "Rihanna ft. Mikky Ekko", title: "Stay", note: "#13 Billboard 年終" },
    { artist: "Daft Punk ft. Pharrell Williams", title: "Get Lucky", note: "#14 Billboard 年終" },
    { artist: "Lorde", title: "Royals", note: "#15 Billboard 年終" },
    { artist: "Taylor Swift", title: "I Knew You Were Trouble", note: "#16 Billboard 年終" },
    { artist: "Miley Cyrus", title: "We Can't Stop", note: "#17 Billboard 年終" },
    { artist: "Miley Cyrus", title: "Wrecking Ball", note: "#18 Billboard 年終" },
    { artist: "Avicii", title: "Wake Me Up", note: "#19 Billboard 年終" },
    { artist: "Justin Timberlake ft. Jay-Z", title: "Suit & Tie", note: "#20 Billboard 年終" },
    { artist: "Anna Kendrick", title: "Cups (Pitch Perfect's When I'm Gone)", note: "#21 Billboard 年終" },
    { artist: "Jay-Z ft. Justin Timberlake", title: "Holy Grail", note: "#22 Billboard 年終" },
    { artist: "Will.i.am ft. Britney Spears", title: "Scream & Shout", note: "#23 Billboard 年終" },
    { artist: "Zedd ft. Foxes", title: "Clarity", note: "#24 Billboard 年終" },
    { artist: "Awolnation", title: "Sail", note: "#25 Billboard 年終" },
    { artist: "Swedish House Mafia ft. John Martin", title: "Don't You Worry Child", note: "#26 Billboard 年終" },
    { artist: "Rihanna", title: "Diamonds", note: "#27 Billboard 年終" },
    { artist: "Icona Pop ft. Charli XCX", title: "I Love It", note: "#28 Billboard 年終" },
    { artist: "Capital Cities", title: "Safe and Sound", note: "#29 Billboard 年終" },
    { artist: "Bruno Mars", title: "Treasure", note: "#30 Billboard 年終" },
    { artist: "Ariana Grande ft. Mac Miller", title: "The Way", note: "#31 Billboard 年終" },
    { artist: "Drake", title: "Started from the Bottom", note: "#32 Billboard 年終" },
    { artist: "Selena Gomez", title: "Come & Get It", note: "#33 Billboard 年終" },
    { artist: "Drake ft. Majid Jordan", title: "Hold On, We're Going Home", note: "#34 Billboard 年終" },
    { artist: "Maroon 5", title: "Daylight", note: "#35 Billboard 年終" },
    { artist: "Pitbull ft. Christina Aguilera", title: "Feel This Moment", note: "#36 Billboard 年終" },
    { artist: "Lady Gaga", title: "Applause", note: "#37 Billboard 年終" },
    { artist: "Maroon 5", title: "One More Night", note: "#38 Billboard 年終" },
    { artist: "Lil Wayne ft. Drake、Future", title: "Love Me", note: "#39 Billboard 年終" },
    { artist: "Fall Out Boy", title: "My Songs Know What You Did in the Dark (Light Em Up)", note: "#40 Billboard 年終" },
    { artist: "ASAP Rocky ft. Drake, 2 Chainz、Kendrick Lamar", title: "Fuckin' Problems", note: "#41 Billboard 年終" },
    { artist: "Justin Bieber ft. Nicki Minaj", title: "Beauty and a Beat", note: "#42 Billboard 年終" },
    { artist: "Macklemore、Ryan Lewis ft. Mary Lambert", title: "Same Love", note: "#43 Billboard 年終" },
    { artist: "Calvin Harris ft. Florence Welch", title: "Sweet Nothing", note: "#44 Billboard 年終" },
    { artist: "Lana Del Rey、Cédric Gervais", title: "Summertime Sadness", note: "#45 Billboard 年終" },
    { artist: "Phillip Phillips", title: "Home", note: "#46 Billboard 年終" },
    { artist: "Imagine Dragons", title: "It's Time", note: "#47 Billboard 年終" },
    { artist: "J. Cole ft. Miguel", title: "Power Trip", note: "#48 Billboard 年終" },
    { artist: "Alicia Keys ft. Nicki Minaj", title: "Girl on Fire", note: "#49 Billboard 年終" },
    { artist: "Demi Lovato", title: "Heart Attack", note: "#50 Billboard 年終" },
  ]
};
