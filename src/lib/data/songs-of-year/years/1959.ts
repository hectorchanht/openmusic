// 1959 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1959_US = {
  id: 'soy-1959-us',
  title: '1959 美國年選',
  titleEn: 'United States 1959',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1959,
  country: 'United States'
} as const;

export const SOY_1959: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Johnny Horton", title: "The Battle of New Orleans", note: "#1 Billboard 年終" },
    { artist: "Bobby Darin", title: "Mack the Knife", note: "#2 Billboard 年終" },
    { artist: "Lloyd Price", title: "Personality", note: "#3 Billboard 年終" },
    { artist: "Frankie Avalon", title: "Venus", note: "#4 Billboard 年終" },
    { artist: "Paul Anka", title: "Lonely Boy", note: "#5 Billboard 年終" },
    { artist: "Bobby Darin", title: "Dream Lover", note: "#6 Billboard 年終" },
    { artist: "The Browns", title: "The Three Bells", note: "#7 Billboard 年終" },
    { artist: "The Fleetwoods", title: "Come Softly to Me", note: "#8 Billboard 年終" },
    { artist: "Wilbert Harrison", title: "Kansas City", note: "#9 Billboard 年終" },
    { artist: "The Fleetwoods", title: "Mr. Blue", note: "#10 Billboard 年終" },
    { artist: "Santo、Johnny", title: "Sleep Walk", note: "#11 Billboard 年終" },
    { artist: "Paul Anka", title: "Put Your Head on My Shoulder", note: "#12 Billboard 年終" },
    { artist: "Lloyd Price", title: "Stagger Lee", note: "#13 Billboard 年終" },
    { artist: "Ritchie Valens", title: "Donna", note: "#14 Billboard 年終" },
    { artist: "Dodie Stevens", title: "Pink Shoe Laces", note: "#15 Billboard 年終" },
    { artist: "The Platters", title: "Smoke Gets in Your Eyes", note: "#16 Billboard 年終" },
    { artist: "The Coasters", title: "Charlie Brown", note: "#17 Billboard 年終" },
    { artist: "Martin Denny", title: "Quiet Village", note: "#18 Billboard 年終" },
    { artist: "Carl Dobkins Jr.", title: "My Heart Is an Open Book", note: "#19 Billboard 年終" },
    { artist: "The Everly Brothers", title: "(Till) I Kissed You", note: "#20 Billboard 年終" },
    { artist: "Phil Phillips", title: "Sea of Love", note: "#21 Billboard 年終" },
    { artist: "Dave Cortez", title: "The Happy Organ", note: "#22 Billboard 年終" },
    { artist: "Lloyd Price", title: "I'm Gonna Get Married", note: "#23 Billboard 年終" },
    { artist: "The Impalas", title: "Sorry (I Ran All the Way Home)", note: "#24 Billboard 年終" },
    { artist: "Dion、the Belmonts", title: "A Teenager in Love", note: "#25 Billboard 年終" },
    { artist: "The Crests", title: "16 Candles", note: "#26 Billboard 年終" },
    { artist: "Brook Benton", title: "It's Just a Matter of Time", note: "#27 Billboard 年終" },
    { artist: "Connie Francis", title: "Lipstick on Your Collar", note: "#28 Billboard 年終" },
    { artist: "The Drifters", title: "There Goes My Baby", note: "#29 Billboard 年終" },
    { artist: "Elvis Presley", title: "A Big Hunk o' Love", note: "#30 Billboard 年終" },
    { artist: "Johnny、the Hurricanes", title: "Red River Rock", note: "#31 Billboard 年終" },
    { artist: "Stonewall Jackson", title: "Waterloo", note: "#32 Billboard 年終" },
    { artist: "Sammy Turner", title: "Lavender Blue", note: "#33 Billboard 年終" },
    { artist: "Elvis Presley", title: "(Now and Then There's) A Fool Such as I", note: "#34 Billboard 年終" },
    { artist: "The Virtues", title: "Guitar Boogie Shuffle", note: "#35 Billboard 年終" },
    { artist: "Sandy Nelson", title: "Teen Beat", note: "#36 Billboard 年終" },
    { artist: "Edd Byrnes、Connie Stevens", title: "Kookie, Kookie (Lend Me Your Comb)", note: "#37 Billboard 年終" },
    { artist: "Thomas Wayne", title: "Tragedy", note: "#38 Billboard 年終" },
    { artist: "Connie Francis", title: "My Happiness", note: "#39 Billboard 年終" },
    { artist: "Freddy Cannon", title: "Tallahassee Lassie", note: "#40 Billboard 年終" },
    { artist: "Fabian", title: "Tiger", note: "#41 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Never Be Anyone Else But You", note: "#42 Billboard 年終" },
    { artist: "Della Reese", title: "Don't You Know?", note: "#43 Billboard 年終" },
    { artist: "Elvis Presley", title: "I Need Your Love Tonight", note: "#44 Billboard 年終" },
    { artist: "Dinah Washington", title: "What a Diff'rence a Day Makes", note: "#45 Billboard 年終" },
    { artist: "Bobby Bare", title: "The All American Boy", note: "#46 Billboard 年終" },
    { artist: "Jerry Wallace", title: "Primrose Lane", note: "#47 Billboard 年終" },
    { artist: "The Chipmunks", title: "Alvin's Harmonica", note: "#48 Billboard 年終" },
    { artist: "Andy Williams", title: "Lonely Street", note: "#49 Billboard 年終" },
    { artist: "Ray Charles", title: "What'd I Say", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1959: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1959" }
};
