// 2001 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2001" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2001_US = {
  id: 'soy-2001-us',
  title: '2001 美國年選',
  titleEn: 'United States 2001',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2001,
  country: 'United States'
} as const;

export const SOY_2001: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Lifehouse", title: "Hanging by a Moment", note: "#1 Billboard 年終" },
    { artist: "Alicia Keys", title: "Fallin'", note: "#2 Billboard 年終" },
    { artist: "Janet", title: "All for You", note: "#3 Billboard 年終" },
    { artist: "Train", title: "Drops of Jupiter (Tell Me)", note: "#4 Billboard 年終" },
    { artist: "Jennifer Lopez ft. Ja Rule", title: "I'm Real (Murder Remix)", note: "#5 Billboard 年終" },
    { artist: "Matchbox Twenty", title: "If You're Gone", note: "#6 Billboard 年終" },
    { artist: "Eve ft. Gwen Stefani", title: "Let Me Blow Ya Mind", note: "#7 Billboard 年終" },
    { artist: "Dido", title: "Thank You", note: "#8 Billboard 年終" },
    { artist: "Lenny Kravitz", title: "Again", note: "#9 Billboard 年終" },
    { artist: "Destiny's Child", title: "Independent Women Part I", note: "#10 Billboard 年終" },
    { artist: "Blu Cantrell", title: "Hit 'Em Up Style (Oops!)", note: "#11 Billboard 年終" },
    { artist: "Shaggy ft. Rikrok", title: "It Wasn't Me", note: "#12 Billboard 年終" },
    { artist: "Joe ft. Mystikal", title: "Stutter", note: "#13 Billboard 年終" },
    { artist: "Staind", title: "It's Been Awhile", note: "#14 Billboard 年終" },
    { artist: "Usher", title: "U Remind Me", note: "#15 Billboard 年終" },
    { artist: "Jagged Edge、Nelly", title: "Where the Party At", note: "#16 Billboard 年終" },
    { artist: "Shaggy ft. Rayvon", title: "Angel", note: "#17 Billboard 年終" },
    { artist: "Nelly ft. City Spud", title: "Ride wit Me", note: "#18 Billboard 年終" },
    { artist: "Uncle Kracker", title: "Follow Me", note: "#19 Billboard 年終" },
    { artist: "112", title: "Peaches & Cream", note: "#20 Billboard 年終" },
    { artist: "Incubus", title: "Drive", note: "#21 Billboard 年終" },
    { artist: "City High", title: "What Would You Do?", note: "#22 Billboard 年終" },
    { artist: "Destiny's Child", title: "Survivor", note: "#23 Billboard 年終" },
    { artist: "Christina Aguilera, Lil' Kim, Mýa、Pink", title: "Lady Marmalade", note: "#24 Billboard 年終" },
    { artist: "Outkast", title: "Ms. Jackson", note: "#25 Billboard 年終" },
    { artist: "Jennifer Lopez", title: "Love Don't Cost a Thing", note: "#26 Billboard 年終" },
    { artist: "Faith Hill", title: "The Way You Love Me", note: "#27 Billboard 年終" },
    { artist: "Dream", title: "He Loves U Not", note: "#28 Billboard 年終" },
    { artist: "Crazy Town", title: "Butterfly", note: "#29 Billboard 年終" },
    { artist: "Ja Rule ft. Lil' Mo、Vita", title: "Put It on Me", note: "#30 Billboard 年終" },
    { artist: "Mary J. Blige", title: "Family Affair", note: "#31 Billboard 年終" },
    { artist: "Lee Ann Womack", title: "I Hope You Dance", note: "#32 Billboard 年終" },
    { artist: "Moby ft. Gwen Stefani", title: "South Side", note: "#33 Billboard 年終" },
    { artist: "Madonna", title: "Don't Tell Me", note: "#34 Billboard 年終" },
    { artist: "Missy Elliott", title: "Get Ur Freak On", note: "#35 Billboard 年終" },
    { artist: "K-Ci、JoJo", title: "Crazy", note: "#36 Billboard 年終" },
    { artist: "Craig David", title: "Fill Me In", note: "#37 Billboard 年終" },
    { artist: "Janet", title: "Someone to Call My Lover", note: "#38 Billboard 年終" },
    { artist: "Creed", title: "With Arms Wide Open", note: "#39 Billboard 年終" },
    { artist: "Mýa", title: "Case of the Ex (Whatcha Gonna Do)", note: "#40 Billboard 年終" },
    { artist: "O-Town", title: "All or Nothing", note: "#41 Billboard 年終" },
    { artist: "Destiny's Child", title: "Bootylicious", note: "#42 Billboard 年終" },
    { artist: "Nelly Furtado", title: "I'm Like a Bird", note: "#43 Billboard 年終" },
    { artist: "3 Doors Down", title: "Kryptonite", note: "#44 Billboard 年終" },
    { artist: "R. Kelly ft. Jay-Z", title: "Fiesta", note: "#45 Billboard 年終" },
    { artist: "Sugar Ray", title: "When It's Over", note: "#46 Billboard 年終" },
    { artist: "Aerosmith", title: "Jaded", note: "#47 Billboard 年終" },
    { artist: "Jagged Edge", title: "Promise", note: "#48 Billboard 年終" },
    { artist: "Case", title: "Missing You", note: "#49 Billboard 年終" },
    { artist: "Ginuwine", title: "Differences", note: "#50 Billboard 年終" },
  ]
};
