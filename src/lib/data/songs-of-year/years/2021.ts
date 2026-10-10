// 2021 美國年選 — Billboard Year-End Hot 100 Top 50.
// Source: Wikipedia "Billboard Year-End Hot 100 singles of 2021" (scraped 2026-10-10, rank order = year-end rank).
// Rendered as SongRow stubs; taps resolve via the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_2021_US = {
  id: 'soy-2021-us',
  title: '2021 美國年選',
  titleEn: 'United States 2021',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 2021,
  country: 'United States'
} as const;

export const SOY_2021: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Dua Lipa", title: "Levitating", note: "#1 Billboard 年終" },
    { artist: "The Weeknd、Ariana Grande", title: "Save Your Tears", note: "#2 Billboard 年終" },
    { artist: "The Weeknd", title: "Blinding Lights", note: "#3 Billboard 年終" },
    { artist: "24kGoldn ft. Iann Dior", title: "Mood", note: "#4 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Good 4 U", note: "#5 Billboard 年終" },
    { artist: "Doja Cat ft. SZA", title: "Kiss Me More", note: "#6 Billboard 年終" },
    { artist: "Silk Sonic (Bruno Mars、Anderson .Paak)", title: "Leave the Door Open", note: "#7 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Drivers License", note: "#8 Billboard 年終" },
    { artist: "Lil Nas X", title: "Montero (Call Me by Your Name)", note: "#9 Billboard 年終" },
    { artist: "Justin Bieber ft. Daniel Caesar、Giveon", title: "Peaches", note: "#10 Billboard 年終" },
    { artist: "BTS", title: "Butter", note: "#11 Billboard 年終" },
    { artist: "The Kid Laroi、Justin Bieber", title: "Stay", note: "#12 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Deja Vu", note: "#13 Billboard 年終" },
    { artist: "Ariana Grande", title: "Positions", note: "#14 Billboard 年終" },
    { artist: "Ed Sheeran", title: "Bad Habits", note: "#15 Billboard 年終" },
    { artist: "Glass Animals", title: "Heat Waves", note: "#16 Billboard 年終" },
    { artist: "The Kid Laroi", title: "Without You", note: "#17 Billboard 年終" },
    { artist: "Luke Combs", title: "Forever After All", note: "#18 Billboard 年終" },
    { artist: "Chris Brown、Young Thug", title: "Go Crazy", note: "#19 Billboard 年終" },
    { artist: "Masked Wolf", title: "Astronaut in the Ocean", note: "#20 Billboard 年終" },
    { artist: "Ariana Grande ft. Doja Cat、Megan Thee Stallion", title: "34+35", note: "#21 Billboard 年終" },
    { artist: "Pop Smoke", title: "What You Know Bout Love", note: "#22 Billboard 年終" },
    { artist: "Machine Gun Kelly ft. Blackbear", title: "My Ex's Best Friend", note: "#23 Billboard 年終" },
    { artist: "Lil Nas X、Jack Harlow", title: "Industry Baby", note: "#24 Billboard 年終" },
    { artist: "Billie Eilish", title: "Therefore I Am", note: "#25 Billboard 年終" },
    { artist: "Cardi B", title: "Up", note: "#26 Billboard 年終" },
    { artist: "Walker Hayes", title: "Fancy Like", note: "#27 Billboard 年終" },
    { artist: "Bad Bunny、Jhay Cortez", title: "Dakiti", note: "#28 Billboard 年終" },
    { artist: "Saweetie ft. Doja Cat", title: "Best Friend", note: "#29 Billboard 年終" },
    { artist: "Polo G", title: "Rapstar", note: "#30 Billboard 年終" },
    { artist: "Giveon", title: "Heartbreak Anniversary", note: "#31 Billboard 年終" },
    { artist: "Pop Smoke ft. Lil Baby、DaBaby", title: "For the Night", note: "#32 Billboard 年終" },
    { artist: "Lil Tjay、6lack", title: "Calling My Phone", note: "#33 Billboard 年終" },
    { artist: "Maroon 5 ft. Megan Thee Stallion", title: "Beautiful Mistakes", note: "#34 Billboard 年終" },
    { artist: "Justin Bieber ft. Chance the Rapper", title: "Holy", note: "#35 Billboard 年終" },
    { artist: "Lil Baby", title: "On Me", note: "#36 Billboard 年終" },
    { artist: "Tate McRae", title: "You Broke Me First", note: "#37 Billboard 年終" },
    { artist: "Olivia Rodrigo", title: "Traitor", note: "#38 Billboard 年終" },
    { artist: "Pooh Shiesty ft. Lil Durk", title: "Back in Blood", note: "#39 Billboard 年終" },
    { artist: "Gabby Barrett ft. Charlie Puth", title: "I Hope", note: "#40 Billboard 年終" },
    { artist: "BTS", title: "Dynamite", note: "#41 Billboard 年終" },
    { artist: "Moneybagg Yo", title: "Wockesha", note: "#42 Billboard 年終" },
    { artist: "Doja Cat、the Weeknd", title: "You Right", note: "#43 Billboard 年終" },
    { artist: "SpotemGottem ft. Pooh Shiesty / SpotemGottem ft. DaBaby", title: "Beat Box 2\" / \"Beat Box 3", note: "#44 Billboard 年終" },
    { artist: "Drake ft. Lil Durk", title: "Laugh Now Cry Later", note: "#45 Billboard 年終" },
    { artist: "Doja Cat", title: "Need to Know", note: "#46 Billboard 年終" },
    { artist: "Drake ft. Lil Baby", title: "Wants and Needs", note: "#47 Billboard 年終" },
    { artist: "Drake ft. Future、Young Thug", title: "Way 2 Sexy", note: "#48 Billboard 年終" },
    { artist: "Kali Uchis", title: "Telepatía", note: "#49 Billboard 年終" },
    { artist: "CJ", title: "Whoopty", note: "#50 Billboard 年終" },
  ]
};
