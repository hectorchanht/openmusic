// 1966 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1966_US = {
  id: 'soy-1966-us',
  title: '1966 美國年選',
  titleEn: 'United States 1966',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1966,
  country: 'United States'
} as const;

export const SOY_1966: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Mamas、the Papas", title: "California Dreamin'", note: "#1 Billboard 年終" },
    { artist: "?、the Mysterians", title: "96 Tears", note: "#2 Billboard 年終" },
    { artist: "Jimmy Ruffin", title: "What Becomes of the Brokenhearted", note: "#3 Billboard 年終" },
    { artist: "The Monkees", title: "Last Train to Clarksville", note: "#4 Billboard 年終" },
    { artist: "Four Tops", title: "Reach Out I'll Be There", note: "#5 Billboard 年終" },
    { artist: "Nancy Sinatra", title: "These Boots Are Made for Walkin'", note: "#6 Billboard 年終" },
    { artist: "The Association", title: "Cherish", note: "#7 Billboard 年終" },
    { artist: "Frank Sinatra", title: "Strangers in the Night", note: "#8 Billboard 年終" },
    { artist: "Paul Revere、the Raiders", title: "Kicks", note: "#9 Billboard 年終" },
    { artist: "Barry Sadler", title: "The Ballad of the Green Berets", note: "#10 Billboard 年終" },
    { artist: "The Young Rascals", title: "Good Lovin'", note: "#11 Billboard 年終" },
    { artist: "The Righteous Brothers", title: "(You're My) Soul and Inspiration", note: "#12 Billboard 年終" },
    { artist: "The Supremes", title: "You Can't Hurry Love", note: "#13 Billboard 年終" },
    { artist: "Bobby Hebb", title: "Sunny", note: "#14 Billboard 年終" },
    { artist: "The Happenings", title: "See You in September", note: "#15 Billboard 年終" },
    { artist: "Sam the Sham、the Pharaohs", title: "Li'l Red Riding Hood", note: "#16 Billboard 年終" },
    { artist: "Lou Christie", title: "Lightnin' Strikes", note: "#17 Billboard 年終" },
    { artist: "Johnny Rivers", title: "Poor Side of Town", note: "#18 Billboard 年終" },
    { artist: "Lee Dorsey", title: "Working in the Coal Mine", note: "#19 Billboard 年終" },
    { artist: "The Mindbenders", title: "A Groovy Kind of Love", note: "#20 Billboard 年終" },
    { artist: "Dusty Springfield", title: "You Don't Have to Say You Love Me", note: "#21 Billboard 年終" },
    { artist: "Donovan", title: "Sunshine Superman", note: "#22 Billboard 年終" },
    { artist: "Sandy Posey", title: "Born a Woman", note: "#23 Billboard 年終" },
    { artist: "The Mamas、the Papas", title: "Monday, Monday", note: "#24 Billboard 年終" },
    { artist: "The Cyrkle", title: "Red Rubber Ball", note: "#25 Billboard 年終" },
    { artist: "Roger Williams", title: "Born Free", note: "#26 Billboard 年終" },
    { artist: "The Left Banke", title: "Walk Away Renée", note: "#27 Billboard 年終" },
    { artist: "The Capitols", title: "Cool Jerk", note: "#28 Billboard 年終" },
    { artist: "Carla Thomas", title: "B-A-B-Y", note: "#29 Billboard 年終" },
    { artist: "Tommy James、the Shondells", title: "Hanky Panky", note: "#30 Billboard 年終" },
    { artist: "Percy Sledge", title: "When a Man Loves a Woman", note: "#31 Billboard 年終" },
    { artist: "The Outsiders", title: "Time Won't Let Me", note: "#32 Billboard 年終" },
    { artist: "The Hollies", title: "Bus Stop", note: "#33 Billboard 年終" },
    { artist: "The Rolling Stones", title: "Paint It Black", note: "#34 Billboard 年終" },
    { artist: "The Lovin' Spoonful", title: "Summer in the City", note: "#35 Billboard 年終" },
    { artist: "B. J. Thomas、the Triumphs", title: "I'm So Lonesome I Could Cry", note: "#36 Billboard 年終" },
    { artist: "Petula Clark", title: "My Love", note: "#37 Billboard 年終" },
    { artist: "The Lovin' Spoonful", title: "Daydream", note: "#38 Billboard 年終" },
    { artist: "The Temptations", title: "Ain't Too Proud to Beg", note: "#39 Billboard 年終" },
    { artist: "The Troggs", title: "Wild Thing", note: "#40 Billboard 年終" },
    { artist: "Bob Lind", title: "Elusive Butterfly", note: "#41 Billboard 年終" },
    { artist: "Simon、Garfunkel", title: "I Am a Rock", note: "#42 Billboard 年終" },
    { artist: "The Standells", title: "Dirty Water", note: "#43 Billboard 年終" },
    { artist: "Tommy Roe", title: "Hooray for Hazel", note: "#44 Billboard 年終" },
    { artist: "Ray Charles", title: "Crying Time", note: "#45 Billboard 年終" },
    { artist: "Tommy Roe", title: "Sweet Pea", note: "#46 Billboard 年終" },
    { artist: "Johnny Rivers", title: "Secret Agent Man", note: "#47 Billboard 年終" },
    { artist: "The Lovin' Spoonful", title: "Did You Ever Have to Make Up Your Mind?", note: "#48 Billboard 年終" },
    { artist: "The Beatles", title: "We Can Work It Out", note: "#49 Billboard 年終" },
    { artist: "Simon、Garfunkel", title: "Homeward Bound", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1966: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1966" }
};
