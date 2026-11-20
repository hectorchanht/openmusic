// 1965 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1965_US = {
  id: 'soy-1965-us',
  title: '1965 美國年選',
  titleEn: 'United States 1965',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1965,
  country: 'United States'
} as const;

export const SOY_1965: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Sam the Sham、the Pharaohs", title: "Wooly Bully", note: "#1 Billboard 年終" },
    { artist: "Four Tops", title: "I Can't Help Myself (Sugar Pie Honey Bunch)", note: "#2 Billboard 年終" },
    { artist: "The Rolling Stones", title: "(I Can't Get No) Satisfaction", note: "#3 Billboard 年終" },
    { artist: "We Five", title: "You Were on My Mind", note: "#4 Billboard 年終" },
    { artist: "The Righteous Brothers", title: "You've Lost That Lovin' Feelin'", note: "#5 Billboard 年終" },
    { artist: "Petula Clark", title: "Downtown", note: "#6 Billboard 年終" },
    { artist: "The Beatles", title: "Help!", note: "#7 Billboard 年終" },
    { artist: "Herman's Hermits", title: "Can't You Hear My Heartbeat", note: "#8 Billboard 年終" },
    { artist: "Elvis Presley", title: "Crying in the Chapel", note: "#9 Billboard 年終" },
    { artist: "The Temptations", title: "My Girl", note: "#10 Billboard 年終" },
    { artist: "The Beach Boys", title: "Help Me, Rhonda", note: "#11 Billboard 年終" },
    { artist: "Roger Miller", title: "King of the Road", note: "#12 Billboard 年終" },
    { artist: "Jewel Akens", title: "The Birds and the Bees", note: "#13 Billboard 年終" },
    { artist: "Mel Carter", title: "Hold Me, Thrill Me, Kiss Me", note: "#14 Billboard 年終" },
    { artist: "Junior Walker、the All Stars", title: "Shotgun", note: "#15 Billboard 年終" },
    { artist: "Sonny、Cher", title: "I Got You Babe", note: "#16 Billboard 年終" },
    { artist: "Gary Lewis、the Playboys", title: "This Diamond Ring", note: "#17 Billboard 年終" },
    { artist: "Ramsey Lewis Trio", title: "The 'In' Crowd", note: "#18 Billboard 年終" },
    { artist: "Herman's Hermits", title: "Mrs. Brown, You've Got a Lovely Daughter", note: "#19 Billboard 年終" },
    { artist: "The Supremes", title: "Stop! In the Name of Love", note: "#20 Billboard 年終" },
    { artist: "The Righteous Brothers", title: "Unchained Melody", note: "#21 Billboard 年終" },
    { artist: "Herman's Hermits", title: "Silhouettes", note: "#22 Billboard 年終" },
    { artist: "The Seekers", title: "I'll Never Find Another You", note: "#23 Billboard 年終" },
    { artist: "Jay、the Americans", title: "Cara Mia", note: "#24 Billboard 年終" },
    { artist: "The Byrds", title: "Mr. Tambourine Man", note: "#25 Billboard 年終" },
    { artist: "Sounds Orchestral", title: "Cast Your Fate to the Wind", note: "#26 Billboard 年終" },
    { artist: "Barbara Mason", title: "Yes, I'm Ready", note: "#27 Billboard 年終" },
    { artist: "Tom Jones", title: "What's New Pussycat?", note: "#28 Billboard 年終" },
    { artist: "Barry McGuire", title: "Eve of Destruction", note: "#29 Billboard 年終" },
    { artist: "The McCoys", title: "Hang On Sloopy", note: "#30 Billboard 年終" },
    { artist: "The Beatles", title: "Ticket to Ride", note: "#31 Billboard 年終" },
    { artist: "Bert Kaempfert", title: "Red Roses for a Blue Lady", note: "#32 Billboard 年終" },
    { artist: "James Brown", title: "Papa's Got a Brand New Bag", note: "#33 Billboard 年終" },
    { artist: "Wayne Fontana、The Mindbenders", title: "Game of Love", note: "#34 Billboard 年終" },
    { artist: "Shirley Ellis", title: "The Name Game", note: "#35 Billboard 年終" },
    { artist: "Petula Clark", title: "I Know a Place", note: "#36 Billboard 年終" },
    { artist: "The Supremes", title: "Back in My Arms Again", note: "#37 Billboard 年終" },
    { artist: "Barbara Lewis", title: "Baby I'm Yours", note: "#38 Billboard 年終" },
    { artist: "The Kingsmen", title: "The Jolly Green Giant", note: "#39 Billboard 年終" },
    { artist: "Patti Page", title: "Hush, Hush, Sweet Charlotte", note: "#40 Billboard 年終" },
    { artist: "Bob Dylan", title: "Like a Rolling Stone", note: "#41 Billboard 年終" },
    { artist: "Freddie、the Dreamers", title: "I'm Telling You Now", note: "#42 Billboard 年終" },
    { artist: "Gerry、the Pacemakers", title: "Ferry Cross the Mersey", note: "#43 Billboard 年終" },
    { artist: "The Righteous Brothers", title: "Just Once in My Life", note: "#44 Billboard 年終" },
    { artist: "Johnny Rivers", title: "The Seventh Son", note: "#45 Billboard 年終" },
    { artist: "Herman's Hermits", title: "I'm Henry the Eighth, I Am", note: "#46 Billboard 年終" },
    { artist: "Horst Jankowski", title: "A Walk in the Black Forest", note: "#47 Billboard 年終" },
    { artist: "The Yardbirds", title: "For Your Love", note: "#48 Billboard 年終" },
    { artist: "The Beach Boys", title: "California Girls", note: "#49 Billboard 年終" },
    { artist: "The Moody Blues", title: "Go Now", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1965: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1965" }
};
