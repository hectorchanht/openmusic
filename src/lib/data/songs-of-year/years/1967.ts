// 1967 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1967_US = {
  id: 'soy-1967-us',
  title: '1967 美國年選',
  titleEn: 'United States 1967',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1967,
  country: 'United States'
} as const;

export const SOY_1967: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Lulu", title: "To Sir With Love", note: "#1 Billboard 年終" },
    { artist: "The Box Tops", title: "The Letter", note: "#2 Billboard 年終" },
    { artist: "Bobbie Gentry", title: "Ode to Billie Joe", note: "#3 Billboard 年終" },
    { artist: "The Association", title: "Windy", note: "#4 Billboard 年終" },
    { artist: "The Monkees", title: "I'm a Believer", note: "#5 Billboard 年終" },
    { artist: "The Doors", title: "Light My Fire", note: "#6 Billboard 年終" },
    { artist: "Frank、Nancy Sinatra", title: "Somethin' Stupid", note: "#7 Billboard 年終" },
    { artist: "The Turtles", title: "Happy Together", note: "#8 Billboard 年終" },
    { artist: "The Young Rascals", title: "Groovin'", note: "#9 Billboard 年終" },
    { artist: "Frankie Valli", title: "Can't Take My Eyes Off You", note: "#10 Billboard 年終" },
    { artist: "The Music Explosion", title: "Little Bit O' Soul", note: "#11 Billboard 年終" },
    { artist: "Tommy James、the Shondells", title: "I Think We're Alone Now", note: "#12 Billboard 年終" },
    { artist: "Aretha Franklin", title: "Respect", note: "#13 Billboard 年終" },
    { artist: "Stevie Wonder", title: "I Was Made to Love Her", note: "#14 Billboard 年終" },
    { artist: "Bobby Vee", title: "Come Back When You Grow Up", note: "#15 Billboard 年終" },
    { artist: "The Buckinghams", title: "Kind of a Drag", note: "#16 Billboard 年終" },
    { artist: "Arthur Conley", title: "Sweet Soul Music", note: "#17 Billboard 年終" },
    { artist: "Soul Survivors", title: "Expressway to Your Heart", note: "#18 Billboard 年終" },
    { artist: "Sam、Dave", title: "Soul Man", note: "#19 Billboard 年終" },
    { artist: "The Association", title: "Never My Love", note: "#20 Billboard 年終" },
    { artist: "Jay、the Techniques", title: "Apples, Peaches, Pumpkin Pie", note: "#21 Billboard 年終" },
    { artist: "Every Mother's Son", title: "Come On Down to My Boat", note: "#22 Billboard 年終" },
    { artist: "Strawberry Alarm Clock", title: "Incense and Peppermints", note: "#23 Billboard 年終" },
    { artist: "The Rolling Stones", title: "Ruby Tuesday", note: "#24 Billboard 年終" },
    { artist: "Vikki Carr", title: "It Must Be Him", note: "#25 Billboard 年終" },
    { artist: "The Supremes", title: "Love Is Here and Now You're Gone", note: "#26 Billboard 年終" },
    { artist: "Buffalo Springfield", title: "For What It's Worth", note: "#27 Billboard 年終" },
    { artist: "Brenton Wood", title: "Gimme Little Sign", note: "#28 Billboard 年終" },
    { artist: "The Supremes", title: "The Happening", note: "#29 Billboard 年終" },
    { artist: "The Beatles", title: "All You Need Is Love", note: "#30 Billboard 年終" },
    { artist: "Engelbert Humperdinck", title: "Release Me", note: "#31 Billboard 年終" },
    { artist: "Marvin Gaye、Tammi Terrell", title: "Your Precious Love", note: "#32 Billboard 年終" },
    { artist: "Jefferson Airplane", title: "Somebody to Love", note: "#33 Billboard 年終" },
    { artist: "The Esquires", title: "Get on Up", note: "#34 Billboard 年終" },
    { artist: "Van Morrison", title: "Brown Eyed Girl", note: "#35 Billboard 年終" },
    { artist: "Martha、the Vandellas", title: "Jimmy Mack", note: "#36 Billboard 年終" },
    { artist: "The Happenings", title: "I Got Rhythm", note: "#37 Billboard 年終" },
    { artist: "Procol Harum", title: "A Whiter Shade of Pale", note: "#38 Billboard 年終" },
    { artist: "The Buckinghams", title: "Don't You Care", note: "#39 Billboard 年終" },
    { artist: "The Casinos", title: "Then You Can Tell Me Goodbye", note: "#40 Billboard 年終" },
    { artist: "The Supremes", title: "Reflections", note: "#41 Billboard 年終" },
    { artist: "The Hollies", title: "On a Carousel", note: "#42 Billboard 年終" },
    { artist: "Bobby Vinton", title: "Please Love Me Forever", note: "#43 Billboard 年終" },
    { artist: "Dionne Warwick", title: "Alfie", note: "#44 Billboard 年終" },
    { artist: "The Tremeloes", title: "Silence Is Golden", note: "#45 Billboard 年終" },
    { artist: "Ed Ames", title: "My Cup Runneth Over", note: "#46 Billboard 年終" },
    { artist: "The 5th Dimension", title: "Up, Up and Away", note: "#47 Billboard 年終" },
    { artist: "Scott McKenzie", title: "San Francisco (Be Sure to Wear Flowers in Your Hair)", note: "#48 Billboard 年終" },
    { artist: "The Cowsills", title: "The Rain, the Park & Other Things", note: "#49 Billboard 年終" },
    { artist: "Herman's Hermits", title: "There's a Kind of Hush", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1967: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1967" }
};
