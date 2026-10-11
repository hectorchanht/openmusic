// 1962 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1962_US = {
  id: 'soy-1962-us',
  title: '1962 美國年選',
  titleEn: 'United States 1962',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1962,
  country: 'United States'
} as const;

export const SOY_1962: Record<string, PackSong[]> = {
  'United States': [
    { artist: "Acker Bilk", title: "Stranger on the Shore", note: "#1 Billboard 年終" },
    { artist: "Ray Charles", title: "I Can't Stop Loving You", note: "#2 Billboard 年終" },
    { artist: "Dee Dee Sharp", title: "Mashed Potato Time", note: "#3 Billboard 年終" },
    { artist: "Bobby Vinton", title: "Roses Are Red (My Love)", note: "#4 Billboard 年終" },
    { artist: "David Rose", title: "The Stripper", note: "#5 Billboard 年終" },
    { artist: "Shelley Fabares", title: "Johnny Angel", note: "#6 Billboard 年終" },
    { artist: "Little Eva", title: "The Loco-Motion", note: "#7 Billboard 年終" },
    { artist: "The Sensations", title: "Let Me In", note: "#8 Billboard 年終" },
    { artist: "Chubby Checker", title: "The Twist", note: "#9 Billboard 年終" },
    { artist: "The Shirelles", title: "Soldier Boy", note: "#10 Billboard 年終" },
    { artist: "Bruce Channel", title: "Hey! Baby", note: "#11 Billboard 年終" },
    { artist: "Dion", title: "The Wanderer", note: "#12 Billboard 年終" },
    { artist: "Gene Chandler", title: "Duke of Earl", note: "#13 Billboard 年終" },
    { artist: "Freddy Cannon", title: "Palisades Park", note: "#14 Billboard 年終" },
    { artist: "Neil Sedaka", title: "Breaking Up Is Hard to Do", note: "#15 Billboard 年終" },
    { artist: "Claude King", title: "Wolverton Mountain", note: "#16 Billboard 年終" },
    { artist: "Chubby Checker、Dee Dee Sharp", title: "Slow Twistin'", note: "#17 Billboard 年終" },
    { artist: "Johnny Tillotson", title: "It Keeps Right On a-Hurtin'", note: "#18 Billboard 年終" },
    { artist: "Mary Wells", title: "The One Who Really Loves You", note: "#19 Billboard 年終" },
    { artist: "Elvis Presley", title: "Good Luck Charm", note: "#20 Billboard 年終" },
    { artist: "Kenny Ball", title: "Midnight in Moscow", note: "#21 Billboard 年終" },
    { artist: "Tommy Roe", title: "Sheila", note: "#22 Billboard 年終" },
    { artist: "Sam Cooke", title: "Twistin' the Night Away", note: "#23 Billboard 年終" },
    { artist: "The Orlons", title: "The Wah-Watusi", note: "#24 Billboard 年終" },
    { artist: "Joey Dee、the Starliters", title: "Peppermint Twist", note: "#25 Billboard 年終" },
    { artist: "Brenda Lee", title: "Break It to Me Gently", note: "#26 Billboard 年終" },
    { artist: "The Marvelettes", title: "Playboy", note: "#27 Billboard 年終" },
    { artist: "Nat King Cole", title: "Ramblin' Rose", note: "#28 Billboard 年終" },
    { artist: "Brian Hyland", title: "Sealed with a Kiss", note: "#29 Billboard 年終" },
    { artist: "Jay、the Americans", title: "She Cried", note: "#30 Billboard 年終" },
    { artist: "Connie Francis", title: "Don't Break the Heart That Loves You", note: "#31 Billboard 年終" },
    { artist: "Gary U.S. Bonds", title: "Dear Lady Twist", note: "#32 Billboard 年終" },
    { artist: "Sue Thompson", title: "Norman", note: "#33 Billboard 年終" },
    { artist: "Ketty Lester", title: "Love Letters", note: "#34 Billboard 年終" },
    { artist: "Claudine Clark", title: "Party Lights", note: "#35 Billboard 年終" },
    { artist: "The Highwaymen", title: "Cotton Fields", note: "#36 Billboard 年終" },
    { artist: "Bent Fabric", title: "Alley Cat", note: "#37 Billboard 年終" },
    { artist: "The Isley Brothers", title: "Twist and Shout", note: "#38 Billboard 年終" },
    { artist: "Richard Chamberlain", title: "Theme from Dr. Kildare (Three Stars Will Shine Tonight)", note: "#39 Billboard 年終" },
    { artist: "Ace Cannon", title: "Tuff", note: "#40 Billboard 年終" },
    { artist: "Clyde McPhatter", title: "Lover Please", note: "#41 Billboard 年終" },
    { artist: "Barbara George", title: "I Know (You Don't Love Me No More)", note: "#42 Billboard 年終" },
    { artist: "Ricky Nelson", title: "Young World", note: "#43 Billboard 年終" },
    { artist: "The Shirelles", title: "Baby It's You", note: "#44 Billboard 年終" },
    { artist: "Pat Boone", title: "Speedy Gonzales", note: "#45 Billboard 年終" },
    { artist: "Burl Ives", title: "A Little Bitty Tear", note: "#46 Billboard 年終" },
    { artist: "The Everly Brothers", title: "Crying in the Rain", note: "#47 Billboard 年終" },
    { artist: "Emilio Pericoli", title: "Al di là", note: "#48 Billboard 年終" },
    { artist: "Ernie Maresca", title: "Shout! Shout! (Knock Yourself Out)", note: "#49 Billboard 年終" },
    { artist: "Don、Juan", title: "What's Your Name", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1962: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1962" }
};
