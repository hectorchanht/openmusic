// 2012 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2012" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2012_US = {
  id: 'soy-2012-us',
  title: '2012 美國年選',
  titleEn: 'United States 2012',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2012,
  country: 'United States'
} as const;

export const SOY_2012: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Gotye ft. Kimbra", title: "Somebody That I Used to Know", note: "#1 Billboard 年終" },
    { artist: "Carly Rae Jepsen", title: "Call Me Maybe", note: "#2 Billboard 年終" },
    { artist: "Fun ft. Janelle Monáe", title: "We Are Young", note: "#3 Billboard 年終" },
    { artist: "Maroon 5 ft. Wiz Khalifa", title: "Payphone", note: "#4 Billboard 年終" },
    { artist: "Ellie Goulding", title: "Lights", note: "#5 Billboard 年終" },
    { artist: "The Wanted", title: "Glad You Came", note: "#6 Billboard 年終" },
    { artist: "Kelly Clarkson", title: "Stronger (What Doesn't Kill You)", note: "#7 Billboard 年終" },
    { artist: "Rihanna ft. Calvin Harris", title: "We Found Love", note: "#8 Billboard 年終" },
    { artist: "Nicki Minaj", title: "Starships", note: "#9 Billboard 年終" },
    { artist: "One Direction", title: "What Makes You Beautiful", note: "#10 Billboard 年終" },
    { artist: "Flo Rida ft. Sia", title: "Wild Ones", note: "#11 Billboard 年終" },
    { artist: "Adele", title: "Set Fire to the Rain", note: "#12 Billboard 年終" },
    { artist: "LMFAO", title: "Sexy and I Know It", note: "#13 Billboard 年終" },
    { artist: "Fun", title: "Some Nights", note: "#14 Billboard 年終" },
    { artist: "Katy Perry", title: "Wide Awake", note: "#15 Billboard 年終" },
    { artist: "Flo Rida", title: "Good Feeling", note: "#16 Billboard 年終" },
    { artist: "Flo Rida", title: "Whistle", note: "#17 Billboard 年終" },
    { artist: "Maroon 5", title: "One More Night", note: "#18 Billboard 年終" },
    { artist: "Train", title: "Drive By", note: "#19 Billboard 年終" },
    { artist: "Drake ft. Lil Wayne", title: "The Motto", note: "#20 Billboard 年終" },
    { artist: "Rihanna", title: "Where Have You Been", note: "#21 Billboard 年終" },
    { artist: "Neon Trees", title: "Everybody Talks", note: "#22 Billboard 年終" },
    { artist: "Drake ft. Rihanna", title: "Take Care", note: "#23 Billboard 年終" },
    { artist: "David Guetta ft. Sia", title: "Titanium", note: "#24 Billboard 年終" },
    { artist: "Jason Mraz", title: "I Won't Give Up", note: "#25 Billboard 年終" },
    { artist: "Bruno Mars", title: "It Will Rain", note: "#26 Billboard 年終" },
    { artist: "Kanye West, Big Sean, Pusha T、2 Chainz", title: "Mercy", note: "#27 Billboard 年終" },
    { artist: "Justin Bieber", title: "Boyfriend", note: "#28 Billboard 年終" },
    { artist: "LMFAO ft. Lauren Bennett、GoonRock", title: "Party Rock Anthem", note: "#29 Billboard 年終" },
    { artist: "Alex Clare", title: "Too Close", note: "#30 Billboard 年終" },
    { artist: "Katy Perry", title: "Part of Me", note: "#31 Billboard 年終" },
    { artist: "Snoop Dogg、Wiz Khalifa ft. Bruno Mars", title: "Young, Wild & Free", note: "#32 Billboard 年終" },
    { artist: "Taylor Swift", title: "We Are Never Ever Getting Back Together", note: "#33 Billboard 年終" },
    { artist: "Justin Bieber ft. Big Sean", title: "As Long as You Love Me", note: "#34 Billboard 年終" },
    { artist: "David Guetta ft. Nicki Minaj", title: "Turn Me On", note: "#35 Billboard 年終" },
    { artist: "Maroon 5 ft. Christina Aguilera", title: "Moves like Jagger", note: "#36 Billboard 年終" },
    { artist: "Pink", title: "Blow Me (One Last Kiss)", note: "#37 Billboard 年終" },
    { artist: "Owl City、Carly Rae Jepsen", title: "Good Time", note: "#38 Billboard 年終" },
    { artist: "Demi Lovato", title: "Give Your Heart a Break", note: "#39 Billboard 年終" },
    { artist: "Jay-Z、Kanye West", title: "Niggas in Paris", note: "#40 Billboard 年終" },
    { artist: "Katy Perry", title: "The One That Got Away", note: "#41 Billboard 年終" },
    { artist: "Calvin Harris", title: "Feel So Close", note: "#42 Billboard 年終" },
    { artist: "Adele", title: "Someone like You", note: "#43 Billboard 年終" },
    { artist: "Usher", title: "Scream", note: "#44 Billboard 年終" },
    { artist: "Tyga", title: "Rack City", note: "#45 Billboard 年終" },
    { artist: "Jessie J", title: "Domino", note: "#46 Billboard 年終" },
    { artist: "Psy", title: "Gangnam Style", note: "#47 Billboard 年終" },
    { artist: "Pitbull ft. Chris Brown", title: "International Love", note: "#48 Billboard 年終" },
    { artist: "Phillip Phillips", title: "Home", note: "#49 Billboard 年終" },
    { artist: "David Guetta ft. Usher", title: "Without You", note: "#50 Billboard 年終" },
  ]
};
