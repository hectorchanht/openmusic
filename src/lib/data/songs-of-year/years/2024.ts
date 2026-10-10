// 2024 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2024" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2024_US = {
  id: 'soy-2024-us',
  title: '2024 美國年選',
  titleEn: 'United States 2024',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2024,
  country: 'United States'
} as const;

export const SOY_2024: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Teddy Swims", title: "Lose Control", note: "#1 Billboard 年終" },
    { artist: "Shaboozey", title: "A Bar Song (Tipsy)", note: "#2 Billboard 年終" },
    { artist: "Benson Boone", title: "Beautiful Things", note: "#3 Billboard 年終" },
    { artist: "Post Malone ft. Morgan Wallen", title: "I Had Some Help", note: "#4 Billboard 年終" },
    { artist: "Jack Harlow", title: "Lovin on Me", note: "#5 Billboard 年終" },
    { artist: "Kendrick Lamar", title: "Not Like Us", note: "#6 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Espresso", note: "#7 Billboard 年終" },
    { artist: "Tommy Richman", title: "Million Dollar Baby", note: "#8 Billboard 年終" },
    { artist: "Zach Bryan ft. Kacey Musgraves", title: "I Remember Everything", note: "#9 Billboard 年終" },
    { artist: "Hozier", title: "Too Sweet", note: "#10 Billboard 年終" },
    { artist: "Noah Kahan", title: "Stick Season", note: "#11 Billboard 年終" },
    { artist: "Taylor Swift", title: "Cruel Summer", note: "#12 Billboard 年終" },
    { artist: "Tate McRae", title: "Greedy", note: "#13 Billboard 年終" },
    { artist: "Future, Metro Boomin、Kendrick Lamar", title: "Like That", note: "#14 Billboard 年終" },
    { artist: "Billie Eilish", title: "Birds of a Feather", note: "#15 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Please Please Please", note: "#16 Billboard 年終" },
    { artist: "Doja Cat", title: "Agora Hills", note: "#17 Billboard 年終" },
    { artist: "Chappell Roan", title: "Good Luck, Babe!", note: "#18 Billboard 年終" },
    { artist: "SZA", title: "Saturn", note: "#19 Billboard 年終" },
    { artist: "SZA", title: "Snooze", note: "#20 Billboard 年終" },
    { artist: "Doja Cat", title: "Paint the Town Red", note: "#21 Billboard 年終" },
    { artist: "Taylor Swift ft. Post Malone", title: "Fortnight", note: "#22 Billboard 年終" },
    { artist: "Luke Combs", title: "Fast Car", note: "#23 Billboard 年終" },
    { artist: "Tyla", title: "Water", note: "#24 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Feather", note: "#25 Billboard 年終" },
    { artist: "Ariana Grande", title: "We Can't Be Friends (Wait for Your Love)", note: "#26 Billboard 年終" },
    { artist: "Dasha", title: "Austin", note: "#27 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Last Night", note: "#28 Billboard 年終" },
    { artist: "Morgan Wallen ft. Ernest", title: "Cowgirls", note: "#29 Billboard 年終" },
    { artist: "Zach Bryan", title: "Pink Skies", note: "#30 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Thinkin' Bout Me", note: "#31 Billboard 年終" },
    { artist: "Beyoncé", title: "Texas Hold 'Em", note: "#32 Billboard 年終" },
    { artist: "Taylor Swift", title: "Is It Over Now?", note: "#33 Billboard 年終" },
    { artist: "Marshmello、Kane Brown", title: "Miles on It", note: "#34 Billboard 年終" },
    { artist: "Taylor Swift", title: "I Can Do It with a Broken Heart", note: "#35 Billboard 年終" },
    { artist: "Jessie Murph、Jelly Roll", title: "Wild Ones", note: "#36 Billboard 年終" },
    { artist: "Luke Combs", title: "Ain't No Love in Oklahoma", note: "#37 Billboard 年終" },
    { artist: "¥$ (Kanye West、Ty Dolla Sign) ft. Rich the Kid、Playboi Carti", title: "Carnival", note: "#38 Billboard 年終" },
    { artist: "Eminem", title: "Houdini", note: "#39 Billboard 年終" },
    { artist: "GloRilla、Megan Thee Stallion", title: "Wanna Be", note: "#40 Billboard 年終" },
    { artist: "Benson Boone", title: "Slow It Down", note: "#41 Billboard 年終" },
    { artist: "21 Savage", title: "Redrum", note: "#42 Billboard 年終" },
    { artist: "Dua Lipa", title: "Houdini", note: "#43 Billboard 年終" },
    { artist: "GloRilla", title: "Yeah Glo!", note: "#44 Billboard 年終" },
    { artist: "Drake ft. Sexyy Red、SZA", title: "Rich Baby Daddy", note: "#45 Billboard 年終" },
    { artist: "Billie Eilish", title: "What Was I Made For?", note: "#46 Billboard 年終" },
    { artist: "Djo", title: "End of Beginning", note: "#47 Billboard 年終" },
    { artist: "Billie Eilish", title: "Lunch", note: "#48 Billboard 年終" },
    { artist: "Flo Milli", title: "Never Lose Me", note: "#49 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Lies Lies Lies", note: "#50 Billboard 年終" },
  ]
};
