// 2005 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2005" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2005_US = {
  id: 'soy-2005-us',
  title: '2005 美國年選',
  titleEn: 'United States 2005',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2005,
  country: 'United States'
} as const;

export const SOY_2005: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Mariah Carey", title: "We Belong Together", note: "#1 Billboard 年終" },
    { artist: "Gwen Stefani", title: "Hollaback Girl", note: "#2 Billboard 年終" },
    { artist: "Mario", title: "Let Me Love You", note: "#3 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Since U Been Gone", note: "#4 Billboard 年終" },
    { artist: "Ciara ft. Missy Elliott", title: "1, 2 Step", note: "#5 Billboard 年終" },
    { artist: "Kanye West ft. Jamie Foxx", title: "Gold Digger", note: "#6 Billboard 年終" },
    { artist: "Green Day", title: "Boulevard of Broken Dreams", note: "#7 Billboard 年終" },
    { artist: "50 Cent ft. Olivia", title: "Candy Shop", note: "#8 Billboard 年終" },
    { artist: "The Pussycat Dolls ft. Busta Rhymes", title: "Don't Cha", note: "#9 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Behind These Hazel Eyes", note: "#10 Billboard 年終" },
    { artist: "50 Cent", title: "Disco Inferno", note: "#11 Billboard 年終" },
    { artist: "Lifehouse", title: "You and Me", note: "#12 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "Don't Phunk with My Heart", note: "#13 Billboard 年終" },
    { artist: "Missy Elliott ft. Ciara、Fatman Scoop", title: "Lose Control", note: "#14 Billboard 年終" },
    { artist: "Mariah Carey", title: "Shake It Off", note: "#15 Billboard 年終" },
    { artist: "The Killers", title: "Mr. Brightside", note: "#16 Billboard 年終" },
    { artist: "50 Cent", title: "Just a Lil Bit", note: "#17 Billboard 年終" },
    { artist: "Rihanna", title: "Pon de Replay", note: "#18 Billboard 年終" },
    { artist: "The Game ft. 50 Cent", title: "How We Do", note: "#19 Billboard 年終" },
    { artist: "Weezer", title: "Beverly Hills", note: "#20 Billboard 年終" },
    { artist: "Ciara ft. Ludacris", title: "Oh", note: "#21 Billboard 年終" },
    { artist: "Rob Thomas", title: "Lonely No More", note: "#22 Billboard 年終" },
    { artist: "Snoop Dogg ft. Pharrell", title: "Drop It Like It's Hot", note: "#23 Billboard 年終" },
    { artist: "The Game ft. 50 Cent", title: "Hate It or Love It", note: "#24 Billboard 年終" },
    { artist: "Lil Jon、the East Side Boyz ft. Usher、Ludacris", title: "Lovers & Friends", note: "#25 Billboard 年終" },
    { artist: "Destiny's Child ft. T.I.、Lil Wayne", title: "Soldier", note: "#26 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Breakaway", note: "#27 Billboard 年終" },
    { artist: "Will Smith", title: "Switch", note: "#28 Billboard 年終" },
    { artist: "Bow Wow ft. Omarion", title: "Let Me Hold You", note: "#29 Billboard 年終" },
    { artist: "Bow Wow ft. Ciara", title: "Like You", note: "#30 Billboard 年終" },
    { artist: "Gwen Stefani ft. Eve", title: "Rich Girl", note: "#31 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "My Humps", note: "#32 Billboard 年終" },
    { artist: "Frankie J ft. Baby Bash", title: "Obsession (No Es Amor)", note: "#33 Billboard 年終" },
    { artist: "Usher", title: "Caught Up", note: "#34 Billboard 年終" },
    { artist: "DHT ft. Edmee", title: "Listen to Your Heart", note: "#35 Billboard 年終" },
    { artist: "Papa Roach", title: "Scars", note: "#36 Billboard 年終" },
    { artist: "Gorillaz", title: "Feel Good Inc.", note: "#37 Billboard 年終" },
    { artist: "3 Doors Down", title: "Let Me Go", note: "#38 Billboard 年終" },
    { artist: "Green Day", title: "Holiday", note: "#39 Billboard 年終" },
    { artist: "Fall Out Boy", title: "Sugar, We're Goin Down", note: "#40 Billboard 年終" },
    { artist: "Pretty Ricky", title: "Grind with Me", note: "#41 Billboard 年終" },
    { artist: "Chris Brown ft. Juelz Santana", title: "Run It!", note: "#42 Billboard 年終" },
    { artist: "Nickelback", title: "Photograph", note: "#43 Billboard 年終" },
    { artist: "Akon", title: "Lonely", note: "#44 Billboard 年終" },
    { artist: "Howie Day", title: "Collide", note: "#45 Billboard 年終" },
    { artist: "Green Day", title: "Wake Me Up When September Ends", note: "#46 Billboard 年終" },
    { artist: "Bobby Valentino", title: "Slow Down", note: "#47 Billboard 年終" },
    { artist: "Nelly ft. Tim McGraw", title: "Over and Over", note: "#48 Billboard 年終" },
    { artist: "Trillville ft. Cutty", title: "Some Cut", note: "#49 Billboard 年終" },
    { artist: "Fat Joe ft. Nelly", title: "Get It Poppin'", note: "#50 Billboard 年終" },
  ]
};
