// 1960 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1960_US = {
  id: 'soy-1960-us',
  title: '1960 美國年選',
  titleEn: 'United States 1960',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1960,
  country: 'United States'
} as const;

export const SOY_1960: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Percy Faith", title: "Theme from A Summer Place", note: "#1 Billboard 年終" },
    { artist: "Jim Reeves", title: "He'll Have to Go", note: "#2 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Cathy's Clown", note: "#3 Billboard 年終" },
    { artist: "Johnny Preston", title: "Running Bear", note: "#4 Billboard 年終" },
    { artist: "Mark Dinning", title: "Teen Angel", note: "#5 Billboard 年終" },
    { artist: "Brenda Lee", title: "I'm Sorry", note: "#6 Billboard 年終" },
    { artist: "Elvis Presley", title: "It's Now or Never", note: "#7 Billboard 年終" },
    { artist: "Jimmy Jones", title: "Handy Man", note: "#8 Billboard 年終" },
    { artist: "Elvis Presley", title: "Stuck on You", note: "#9 Billboard 年終" },
    { artist: "Chubby Checker", title: "The Twist", note: "#10 Billboard 年終" },
    { artist: "Connie Francis", title: "Everybody's Somebody's Fool", note: "#11 Billboard 年終" },
    { artist: "Bobby Rydell", title: "Wild One", note: "#12 Billboard 年終" },
    { artist: "The Brothers Four", title: "Greenfields", note: "#13 Billboard 年終" },
    { artist: "Jack Scott", title: "What in the World's Come Over You", note: "#14 Billboard 年終" },
    { artist: "Marty Robbins", title: "El Paso", note: "#15 Billboard 年終" },
    { artist: "The Hollywood Argyles", title: "Alley Oop", note: "#16 Billboard 年終" },
    { artist: "Connie Francis", title: "My Heart Has a Mind of Its Own", note: "#17 Billboard 年終" },
    { artist: "Brenda Lee", title: "Sweet Nothin's", note: "#18 Billboard 年終" },
    { artist: "Brian Hyland", title: "Itsy Bitsy Teenie Weenie Yellow Polkadot Bikini", note: "#19 Billboard 年終" },
    { artist: "Roy Orbison", title: "Only the Lonely", note: "#20 Billboard 年終" },
    { artist: "Dion、the Belmonts", title: "Where or When", note: "#21 Billboard 年終" },
    { artist: "Connie Stevens", title: "Sixteen Reasons", note: "#22 Billboard 年終" },
    { artist: "Paul Anka", title: "Puppy Love", note: "#23 Billboard 年終" },
    { artist: "Frankie Avalon", title: "Why", note: "#24 Billboard 年終" },
    { artist: "The Ventures", title: "Walk, Don't Run", note: "#25 Billboard 年終" },
    { artist: "The Drifters", title: "Save the Last Dance for Me", note: "#26 Billboard 年終" },
    { artist: "Dinah Washington、Brook Benton", title: "Baby (You've Got What It Takes)", note: "#27 Billboard 年終" },
    { artist: "Johnny Horton", title: "Sink the Bismarck", note: "#28 Billboard 年終" },
    { artist: "Sam Cooke", title: "Chain Gang", note: "#29 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Let It Be Me", note: "#30 Billboard 年終" },
    { artist: "Jimmy Jones", title: "Good Timin'", note: "#31 Billboard 年終" },
    { artist: "Bobby Darin", title: "Beyond the Sea", note: "#32 Billboard 年終" },
    { artist: "Jimmy Clanton", title: "Go, Jimmy, Go", note: "#33 Billboard 年終" },
    { artist: "Jackie Wilson", title: "Night", note: "#34 Billboard 年終" },
    { artist: "Jack Scott", title: "Burning Bridges", note: "#35 Billboard 年終" },
    { artist: "Toni Fisher", title: "The Big Hurt", note: "#36 Billboard 年終" },
    { artist: "Duane Eddy", title: "Because They're Young", note: "#37 Billboard 年終" },
    { artist: "Conway Twitty", title: "Lonely Blue Boy", note: "#38 Billboard 年終" },
    { artist: "Steve Lawrence", title: "Pretty Blue Eyes", note: "#39 Billboard 年終" },
    { artist: "Freddy Cannon", title: "Way Down Yonder in New Orleans", note: "#40 Billboard 年終" },
    { artist: "Anita Bryant", title: "Paper Roses", note: "#41 Billboard 年終" },
    { artist: "Larry Verne", title: "Mr. Custer", note: "#42 Billboard 年終" },
    { artist: "Brenda Lee", title: "I Want to Be Wanted", note: "#43 Billboard 年終" },
    { artist: "The Fendermen", title: "Mule Skinner Blues", note: "#44 Billboard 年終" },
    { artist: "Johnny Preston", title: "Cradle of Love", note: "#45 Billboard 年終" },
    { artist: "Marv Johnson", title: "You Got What It Takes", note: "#46 Billboard 年終" },
    { artist: "Hank Locklin", title: "Please Help Me, I'm Falling", note: "#47 Billboard 年終" },
    { artist: "Ron Holden", title: "Love You So", note: "#48 Billboard 年終" },
    { artist: "Hank Ballard、The Midnighters", title: "Finger Poppin' Time", note: "#49 Billboard 年終" },
    { artist: "The Platters", title: "Harbor Lights", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1960: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1960" }
};
