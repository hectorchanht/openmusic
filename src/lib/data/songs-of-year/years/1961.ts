// 1961 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1961_US = {
  id: 'soy-1961-us',
  title: '1961 美國年選',
  titleEn: 'United States 1961',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1961,
  country: 'United States'
} as const;

export const SOY_1961: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Bobby Lewis", title: "Tossin' and Turnin'", note: "#1 Billboard 年終" },
    { artist: "Patsy Cline", title: "I Fall to Pieces", note: "#2 Billboard 年終" },
    { artist: "The Highwaymen", title: "Michael", note: "#3 Billboard 年終" },
    { artist: "Roy Orbison", title: "Crying", note: "#4 Billboard 年終" },
    { artist: "Del Shannon", title: "Runaway", note: "#5 Billboard 年終" },
    { artist: "The Jive Five", title: "My True Story", note: "#6 Billboard 年終" },
    { artist: "Chubby Checker", title: "Pony Time", note: "#7 Billboard 年終" },
    { artist: "The String-A-Longs", title: "Wheels", note: "#8 Billboard 年終" },
    { artist: "Dee Clark", title: "Raindrops", note: "#9 Billboard 年終" },
    { artist: "Joe Dowell", title: "Wooden Heart", note: "#10 Billboard 年終" },
    { artist: "Lawrence Welk", title: "Calcutta", note: "#11 Billboard 年終" },
    { artist: "Bobby Vee", title: "Take Good Care of My Baby", note: "#12 Billboard 年終" },
    { artist: "Roy Orbison", title: "Running Scared", note: "#13 Billboard 年終" },
    { artist: "The Shirelles", title: "Dedicated to the One I Love", note: "#14 Billboard 年終" },
    { artist: "The Mar-Keys", title: "Last Night", note: "#15 Billboard 年終" },
    { artist: "The Shirelles", title: "Will You Love Me Tomorrow", note: "#16 Billboard 年終" },
    { artist: "Ferrante、Teicher", title: "Exodus", note: "#17 Billboard 年終" },
    { artist: "Connie Francis", title: "Where the Boys Are", note: "#18 Billboard 年終" },
    { artist: "Ray Charles", title: "Hit the Road Jack", note: "#19 Billboard 年終" },
    { artist: "Sue Thompson", title: "Sad Movies (Make Me Cry)", note: "#20 Billboard 年終" },
    { artist: "Ernie K-Doe", title: "Mother-in-Law", note: "#21 Billboard 年終" },
    { artist: "The Dovells", title: "Bristol Stomp", note: "#22 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Travelin' Man", note: "#23 Billboard 年終" },
    { artist: "The Miracles", title: "Shop Around", note: "#24 Billboard 年終" },
    { artist: "Brook Benton", title: "The Boll Weevil Song", note: "#25 Billboard 年終" },
    { artist: "Gene McDaniels", title: "A Hundred Pounds of Clay", note: "#26 Billboard 年終" },
    { artist: "Dick、Dee Dee", title: "The Mountain's High", note: "#27 Billboard 年終" },
    { artist: "Marty Robbins", title: "Don't Worry", note: "#28 Billboard 年終" },
    { artist: "Floyd Cramer", title: "On the Rebound", note: "#29 Billboard 年終" },
    { artist: "Steve Lawrence", title: "Portrait of My Love", note: "#30 Billboard 年終" },
    { artist: "Gary U.S. Bonds", title: "Quarter to Three", note: "#31 Billboard 年終" },
    { artist: "Barry Mann", title: "Who Put the Bomp (in the Bomp, Bomp, Bomp)", note: "#32 Billboard 年終" },
    { artist: "Neil Sedaka", title: "Calendar Girl", note: "#33 Billboard 年終" },
    { artist: "Chris Kenner", title: "I Like It Like That", note: "#34 Billboard 年終" },
    { artist: "Jørgen Ingmann", title: "Apache", note: "#35 Billboard 年終" },
    { artist: "Linda Scott", title: "Don't Bet Money Honey", note: "#36 Billboard 年終" },
    { artist: "Johnny Tillotson", title: "Without You", note: "#37 Billboard 年終" },
    { artist: "Ferlin Husky", title: "Wings of a Dove", note: "#38 Billboard 年終" },
    { artist: "Elvis Presley", title: "Little Sister", note: "#39 Billboard 年終" },
    { artist: "The Marcels", title: "Blue Moon", note: "#40 Billboard 年終" },
    { artist: "Shep、the Limelites", title: "Daddy's Home", note: "#41 Billboard 年終" },
    { artist: "Troy Shondell", title: "This Time", note: "#42 Billboard 年終" },
    { artist: "Clarence \"Frogman\" Henry", title: "(I Don't Know Why) But I Do", note: "#43 Billboard 年終" },
    { artist: "Kokomo", title: "Asia Minor", note: "#44 Billboard 年終" },
    { artist: "Faron Young", title: "Hello Walls", note: "#45 Billboard 年終" },
    { artist: "Dion", title: "Runaround Sue", note: "#46 Billboard 年終" },
    { artist: "Arthur Lyman", title: "Yellow Bird", note: "#47 Billboard 年終" },
    { artist: "Timi Yuro", title: "Hurt", note: "#48 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Hello Mary Lou", note: "#49 Billboard 年終" },
    { artist: "The Capris", title: "There's a Moon Out Tonight", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1961: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1961" }
};
