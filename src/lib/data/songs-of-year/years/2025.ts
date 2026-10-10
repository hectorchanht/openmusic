// 2025 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2025" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2025_US = {
  id: 'soy-2025-us',
  title: '2025 美國年選',
  titleEn: 'United States 2025',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2025,
  country: 'United States'
} as const;

export const SOY_2025: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Lady Gaga、Bruno Mars", title: "Die with a Smile", note: "#1 Billboard 年終" },
    { artist: "Kendrick Lamar、SZA", title: "Luther", note: "#2 Billboard 年終" },
    { artist: "Shaboozey", title: "A Bar Song (Tipsy)", note: "#3 Billboard 年終" },
    { artist: "Teddy Swims", title: "Lose Control", note: "#4 Billboard 年終" },
    { artist: "Billie Eilish", title: "Birds of a Feather", note: "#5 Billboard 年終" },
    { artist: "Benson Boone", title: "Beautiful Things", note: "#6 Billboard 年終" },
    { artist: "Alex Warren", title: "Ordinary", note: "#7 Billboard 年終" },
    { artist: "Post Malone ft. Morgan Wallen", title: "I Had Some Help", note: "#8 Billboard 年終" },
    { artist: "Rosé、Bruno Mars", title: "APT.", note: "#9 Billboard 年終" },
    { artist: "Chappell Roan", title: "Pink Pony Club", note: "#10 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Love Somebody", note: "#11 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Espresso", note: "#12 Billboard 年終" },
    { artist: "Morgan Wallen", title: "I'm the Problem", note: "#13 Billboard 年終" },
    { artist: "Gracie Abrams", title: "That's So True", note: "#14 Billboard 年終" },
    { artist: "Kendrick Lamar ft. Lefty Gunplay", title: "TV Off", note: "#15 Billboard 年終" },
    { artist: "The Weeknd、Playboi Carti", title: "Timeless", note: "#16 Billboard 年終" },
    { artist: "Kendrick Lamar", title: "Not Like Us", note: "#17 Billboard 年終" },
    { artist: "Morgan Wallen", title: "Just in Case", note: "#18 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Taste", note: "#19 Billboard 年終" },
    { artist: "Kendrick Lamar", title: "Squabble Up", note: "#20 Billboard 年終" },
    { artist: "SZA、Kendrick Lamar", title: "30 for 30", note: "#21 Billboard 年終" },
    { artist: "Leon Thomas", title: "Mutt", note: "#22 Billboard 年終" },
    { artist: "Shaboozey", title: "Good News", note: "#23 Billboard 年終" },
    { artist: "Drake", title: "Nokia", note: "#24 Billboard 年終" },
    { artist: "Huntrix: Ejae, Audrey Nuna、Rei Ami", title: "Golden", note: "#25 Billboard 年終" },
    { artist: "Billie Eilish", title: "Wildflower", note: "#26 Billboard 年終" },
    { artist: "Morgan Wallen ft. Tate McRae", title: "What I Want", note: "#27 Billboard 年終" },
    { artist: "Lola Young", title: "Messy", note: "#28 Billboard 年終" },
    { artist: "Myles Smith", title: "Stargazing", note: "#29 Billboard 年終" },
    { artist: "Ravyn Lenae", title: "Love Me Not", note: "#30 Billboard 年終" },
    { artist: "Chappell Roan", title: "Good Luck, Babe!", note: "#31 Billboard 年終" },
    { artist: "The Marías", title: "No One Noticed", note: "#32 Billboard 年終" },
    { artist: "BigXthaPlug ft. Bailey Zimmerman", title: "All the Way", note: "#33 Billboard 年終" },
    { artist: "Hozier", title: "Too Sweet", note: "#34 Billboard 年終" },
    { artist: "Riley Green", title: "Worst Way", note: "#35 Billboard 年終" },
    { artist: "Gigi Perez", title: "Sailor Song", note: "#36 Billboard 年終" },
    { artist: "Benson Boone", title: "Sorry I'm Here for Someone Else", note: "#37 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Manchild", note: "#38 Billboard 年終" },
    { artist: "Doechii", title: "Anxiety", note: "#39 Billboard 年終" },
    { artist: "Morgan Wallen", title: "I Got Better", note: "#40 Billboard 年終" },
    { artist: "Tyler, the Creator ft. GloRilla, Sexyy Red、Lil Wayne", title: "Sticky", note: "#41 Billboard 年終" },
    { artist: "Sombr", title: "Undressed", note: "#42 Billboard 年終" },
    { artist: "Zach Top", title: "I Never Lie", note: "#43 Billboard 年終" },
    { artist: "Sombr", title: "Back to Friends", note: "#44 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Bed Chem", note: "#45 Billboard 年終" },
    { artist: "Tate McRae", title: "Sports Car", note: "#46 Billboard 年終" },
    { artist: "Benson Boone", title: "Mystical Magical", note: "#47 Billboard 年終" },
    { artist: "GloRilla、Sexyy Red", title: "Whatchu Kno About Me", note: "#48 Billboard 年終" },
    { artist: "Sam Barber ft. Avery Anna", title: "Indigo", note: "#49 Billboard 年終" },
    { artist: "Sabrina Carpenter", title: "Please Please Please", note: "#50 Billboard 年終" },
  ]
};
