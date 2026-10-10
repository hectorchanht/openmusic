// 2000 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2000" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2000_US = {
  id: 'soy-2000-us',
  title: '2000 美國年選',
  titleEn: 'United States 2000',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2000,
  country: 'United States'
} as const;

export const SOY_2000: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Faith Hill", title: "Breathe", note: "#1 Billboard 年終" },
    { artist: "Santana ft. Rob Thomas", title: "Smooth", note: "#2 Billboard 年終" },
    { artist: "Santana ft. The Product G&B", title: "Maria Maria", note: "#3 Billboard 年終" },
    { artist: "Joe", title: "I Wanna Know", note: "#4 Billboard 年終" },
    { artist: "Vertical Horizon", title: "Everything You Want", note: "#5 Billboard 年終" },
    { artist: "Destiny's Child", title: "Say My Name", note: "#6 Billboard 年終" },
    { artist: "Savage Garden", title: "I Knew I Loved You", note: "#7 Billboard 年終" },
    { artist: "Lonestar", title: "Amazed", note: "#8 Billboard 年終" },
    { artist: "Matchbox Twenty", title: "Bent", note: "#9 Billboard 年終" },
    { artist: "Toni Braxton", title: "He Wasn't Man Enough", note: "#10 Billboard 年終" },
    { artist: "Creed", title: "Higher", note: "#11 Billboard 年終" },
    { artist: "Aaliyah", title: "Try Again", note: "#12 Billboard 年終" },
    { artist: "Destiny's Child", title: "Jumpin', Jumpin'", note: "#13 Billboard 年終" },
    { artist: "Sisqó", title: "Thong Song", note: "#14 Billboard 年終" },
    { artist: "3 Doors Down", title: "Kryptonite", note: "#15 Billboard 年終" },
    { artist: "Pink", title: "There You Go", note: "#16 Billboard 年終" },
    { artist: "Madonna", title: "Music", note: "#17 Billboard 年終" },
    { artist: "Janet", title: "Doesn't Really Matter", note: "#18 Billboard 年終" },
    { artist: "Christina Aguilera", title: "What a Girl Wants", note: "#19 Billboard 年終" },
    { artist: "Brian McKnight", title: "Back at One", note: "#20 Billboard 年終" },
    { artist: "NSYNC", title: "Bye Bye Bye", note: "#21 Billboard 年終" },
    { artist: "Marc Anthony", title: "You Sang to Me", note: "#22 Billboard 年終" },
    { artist: "Marc Anthony", title: "I Need to Know", note: "#23 Billboard 年終" },
    { artist: "Montell Jordan", title: "Get It On Tonite", note: "#24 Billboard 年終" },
    { artist: "Sisqó", title: "Incomplete", note: "#25 Billboard 年終" },
    { artist: "Macy Gray", title: "I Try", note: "#26 Billboard 年終" },
    { artist: "NSYNC", title: "It's Gonna Be Me", note: "#27 Billboard 年終" },
    { artist: "Celine Dion", title: "That's the Way It Is", note: "#28 Billboard 年終" },
    { artist: "Nelly", title: "Country Grammar (Hot Shit)", note: "#29 Billboard 年終" },
    { artist: "Blaque", title: "Bring It All to Me", note: "#30 Billboard 年終" },
    { artist: "Backstreet Boys", title: "Show Me the Meaning of Being Lonely", note: "#31 Billboard 年終" },
    { artist: "Missy Elliott ft. Nas, Eve、Q-Tip", title: "Hot Boyz", note: "#32 Billboard 年終" },
    { artist: "BBMak", title: "Back Here", note: "#33 Billboard 年終" },
    { artist: "Sonique", title: "It Feels So Good", note: "#34 Billboard 年終" },
    { artist: "Nine Days", title: "Absolutely (Story of a Girl)", note: "#35 Billboard 年終" },
    { artist: "Creed", title: "With Arms Wide Open", note: "#36 Billboard 年終" },
    { artist: "Enrique Iglesias", title: "Be with You", note: "#37 Billboard 年終" },
    { artist: "Christina Aguilera", title: "Come On Over Baby (All I Want Is You)", note: "#38 Billboard 年終" },
    { artist: "Ruff Endz", title: "No More", note: "#39 Billboard 年終" },
    { artist: "Blink-182", title: "All the Small Things", note: "#40 Billboard 年終" },
    { artist: "Faith Hill", title: "The Way You Love Me", note: "#41 Billboard 年終" },
    { artist: "Christina Aguilera", title: "I Turn to You", note: "#42 Billboard 年終" },
    { artist: "Third Eye Blind", title: "Never Let You Go", note: "#43 Billboard 年終" },
    { artist: "LeAnn Rimes", title: "I Need You", note: "#44 Billboard 年終" },
    { artist: "Mariah Carey ft. Joe、98 Degrees", title: "Thank God I Found You", note: "#45 Billboard 年終" },
    { artist: "Jagged Edge", title: "Let's Get Married", note: "#46 Billboard 年終" },
    { artist: "Whitney Houston", title: "My Love Is Your Love", note: "#47 Billboard 年終" },
    { artist: "Smash Mouth", title: "Then the Morning Comes", note: "#48 Billboard 年終" },
    { artist: "Eiffel 65", title: "Blue (Da Ba Dee)", note: "#49 Billboard 年終" },
    { artist: "Sting ft. Cheb Mami", title: "Desert Rose", note: "#50 Billboard 年終" },
  ]
};
