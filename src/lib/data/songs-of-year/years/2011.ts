// 2011 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2011" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2011_US = {
  id: 'soy-2011-us',
  title: '2011 美國年選',
  titleEn: 'United States 2011',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2011,
  country: 'United States'
} as const;

export const SOY_2011: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Adele", title: "Rolling in the Deep", note: "#1 Billboard 年終" },
    { artist: "LMFAO ft. Lauren Bennett、GoonRock", title: "Party Rock Anthem", note: "#2 Billboard 年終" },
    { artist: "Katy Perry", title: "Firework", note: "#3 Billboard 年終" },
    { artist: "Katy Perry ft. Kanye West", title: "E.T.", note: "#4 Billboard 年終" },
    { artist: "Pitbull ft. Ne-Yo, Afrojack、Nayer", title: "Give Me Everything", note: "#5 Billboard 年終" },
    { artist: "Bruno Mars", title: "Grenade", note: "#6 Billboard 年終" },
    { artist: "CeeLo Green", title: "Fuck You (Forget You)", note: "#7 Billboard 年終" },
    { artist: "Nicki Minaj", title: "Super Bass", note: "#8 Billboard 年終" },
    { artist: "Maroon 5 ft. Christina Aguilera", title: "Moves like Jagger", note: "#9 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "Just Can't Get Enough", note: "#10 Billboard 年終" },
    { artist: "Jennifer Lopez ft. Pitbull", title: "On the Floor", note: "#11 Billboard 年終" },
    { artist: "Rihanna", title: "S&M", note: "#12 Billboard 年終" },
    { artist: "Foster the People", title: "Pumped Up Kicks", note: "#13 Billboard 年終" },
    { artist: "Katy Perry", title: "Last Friday Night (T.G.I.F.)", note: "#14 Billboard 年終" },
    { artist: "Bruno Mars", title: "Just the Way You Are", note: "#15 Billboard 年終" },
    { artist: "Enrique Iglesias ft. Ludacris、DJ Frank E", title: "Tonight (I'm Lovin' You)", note: "#16 Billboard 年終" },
    { artist: "Pink", title: "Raise Your Glass", note: "#17 Billboard 年終" },
    { artist: "Lady Gaga", title: "Born This Way", note: "#18 Billboard 年終" },
    { artist: "Pink", title: "Fuckin' Perfect", note: "#19 Billboard 年終" },
    { artist: "Rihanna ft. Drake", title: "What's My Name?", note: "#20 Billboard 年終" },
    { artist: "Chris Brown ft. Lil Wayne、Busta Rhymes", title: "Look at Me Now", note: "#21 Billboard 年終" },
    { artist: "Jeremih ft. 50 Cent", title: "Down on Me", note: "#22 Billboard 年終" },
    { artist: "Lil Wayne", title: "How to Love", note: "#23 Billboard 年終" },
    { artist: "Adele", title: "Someone Like You", note: "#24 Billboard 年終" },
    { artist: "OneRepublic", title: "Good Life", note: "#25 Billboard 年終" },
    { artist: "Bruno Mars", title: "The Lazy Song", note: "#26 Billboard 年終" },
    { artist: "Britney Spears", title: "Till the World Ends", note: "#27 Billboard 年終" },
    { artist: "Lupe Fiasco", title: "The Show Goes On", note: "#28 Billboard 年終" },
    { artist: "Lady Gaga", title: "The Edge of Glory", note: "#29 Billboard 年終" },
    { artist: "Kesha", title: "We R Who We R", note: "#30 Billboard 年終" },
    { artist: "Wiz Khalifa", title: "Black and Yellow", note: "#31 Billboard 年終" },
    { artist: "Hot Chelle Rae", title: "Tonight Tonight", note: "#32 Billboard 年終" },
    { artist: "Kesha", title: "Blow", note: "#33 Billboard 年終" },
    { artist: "Bad Meets Evil ft. Bruno Mars", title: "Lighters", note: "#34 Billboard 年終" },
    { artist: "The Band Perry", title: "If I Die Young", note: "#35 Billboard 年終" },
    { artist: "Gym Class Heroes ft. Adam Levine", title: "Stereo Hearts", note: "#36 Billboard 年終" },
    { artist: "The Black Eyed Peas", title: "The Time (Dirty Bit)", note: "#37 Billboard 年終" },
    { artist: "Diddy – Dirty Money ft. Skylar Grey", title: "Coming Home", note: "#38 Billboard 年終" },
    { artist: "Pitbull ft. T-Pain", title: "Hey Baby (Drop It to the Floor)", note: "#39 Billboard 年終" },
    { artist: "Rihanna", title: "Only Girl (In the World)", note: "#40 Billboard 年終" },
    { artist: "Lil Wayne ft. Cory Gunz", title: "6 Foot 7 Foot", note: "#41 Billboard 年終" },
    { artist: "Lady Antebellum", title: "Just a Kiss", note: "#42 Billboard 年終" },
    { artist: "Jason Aldean", title: "Dirt Road Anthem", note: "#43 Billboard 年終" },
    { artist: "Taio Cruz", title: "Dynamite", note: "#44 Billboard 年終" },
    { artist: "Waka Flocka Flame ft. Wale、Roscoe Dash", title: "No Hands", note: "#45 Billboard 年終" },
    { artist: "Britney Spears", title: "I Wanna Go", note: "#46 Billboard 年終" },
    { artist: "DJ Khaled ft. Drake, Rick Ross、Lil Wayne", title: "I'm on One", note: "#47 Billboard 年終" },
    { artist: "Cobra Starship ft. Sabi", title: "You Make Me Feel...", note: "#48 Billboard 年終" },
    { artist: "Chris Brown", title: "Yeah 3x", note: "#49 Billboard 年終" },
    { artist: "Nicki Minaj ft. Drake", title: "Moment 4 Life", note: "#50 Billboard 年終" },
  ]
};
