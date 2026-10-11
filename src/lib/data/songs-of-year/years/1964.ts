// 1964 年選 — year-end charts (United States).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1964_US = {
  id: 'soy-1964-us',
  title: '1964 美國年選',
  titleEn: 'United States 1964',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1964,
  country: 'United States'
} as const;

export const SOY_1964: Record<string, PackSong[]> = {
  'United States': [
    { artist: "The Beatles", title: "I Want to Hold Your Hand", note: "#1 Billboard 年終" },
    { artist: "The Beatles", title: "She Loves You", note: "#2 Billboard 年終" },
    { artist: "Louis Armstrong", title: "Hello, Dolly!", note: "#3 Billboard 年終" },
    { artist: "Roy Orbison", title: "Oh, Pretty Woman", note: "#4 Billboard 年終" },
    { artist: "The Beach Boys", title: "I Get Around", note: "#5 Billboard 年終" },
    { artist: "Dean Martin", title: "Everybody Loves Somebody", note: "#6 Billboard 年終" },
    { artist: "Mary Wells", title: "My Guy", note: "#7 Billboard 年終" },
    { artist: "Gale Garnett", title: "We'll Sing in the Sunshine", note: "#8 Billboard 年終" },
    { artist: "J. Frank Wilson、the Cavaliers", title: "Last Kiss", note: "#9 Billboard 年終" },
    { artist: "The Supremes", title: "Where Did Our Love Go", note: "#10 Billboard 年終" },
    { artist: "Barbra Streisand", title: "People", note: "#11 Billboard 年終" },
    { artist: "Al Hirt", title: "Java", note: "#12 Billboard 年終" },
    { artist: "The Beatles", title: "A Hard Day's Night", note: "#13 Billboard 年終" },
    { artist: "The Beatles", title: "Love Me Do", note: "#14 Billboard 年終" },
    { artist: "Manfred Mann", title: "Do Wah Diddy Diddy", note: "#15 Billboard 年終" },
    { artist: "The Beatles", title: "Please Please Me", note: "#16 Billboard 年終" },
    { artist: "Martha、the Vandellas", title: "Dancing in the Street", note: "#17 Billboard 年終" },
    { artist: "Billy J. Kramer、The Dakotas", title: "Little Children", note: "#18 Billboard 年終" },
    { artist: "The Ray Charles Singers", title: "Love Me with All Your Heart (Cuando Calienta El Sol)", note: "#19 Billboard 年終" },
    { artist: "The Drifters", title: "Under the Boardwalk", note: "#20 Billboard 年終" },
    { artist: "The Dixie Cups", title: "Chapel of Love", note: "#21 Billboard 年終" },
    { artist: "Terry Stafford", title: "Suspicion", note: "#22 Billboard 年終" },
    { artist: "The Dave Clark Five", title: "Glad All Over", note: "#23 Billboard 年終" },
    { artist: "The Four Seasons", title: "Rag Doll", note: "#24 Billboard 年終" },
    { artist: "The Four Seasons", title: "Dawn (Go Away)", note: "#25 Billboard 年終" },
    { artist: "The Newbeats", title: "Bread and Butter", note: "#26 Billboard 年終" },
    { artist: "Gene Pitney", title: "It Hurts to Be in Love", note: "#27 Billboard 年終" },
    { artist: "Jan、Dean", title: "Dead Man's Curve", note: "#28 Billboard 年終" },
    { artist: "Jay、the Americans", title: "Come a Little Bit Closer", note: "#29 Billboard 年終" },
    { artist: "Peter、Gordon", title: "A World Without Love", note: "#30 Billboard 年終" },
    { artist: "The Honeycombs", title: "Have I the Right?", note: "#31 Billboard 年終" },
    { artist: "The Serendipity Singers", title: "Don't Let the Rain Come Down (Crooked Little Man)", note: "#32 Billboard 年終" },
    { artist: "The Supremes", title: "Baby Love", note: "#33 Billboard 年終" },
    { artist: "Betty Everett、Jerry Butler", title: "Let It Be Me", note: "#34 Billboard 年終" },
    { artist: "Dusty Springfield", title: "Wishin' and Hopin'", note: "#35 Billboard 年終" },
    { artist: "Lesley Gore", title: "You Don't Own Me", note: "#36 Billboard 年終" },
    { artist: "Dionne Warwick", title: "Walk On By", note: "#37 Billboard 年終" },
    { artist: "The Animals", title: "The House of the Rising Sun", note: "#38 Billboard 年終" },
    { artist: "Ronny、the Daytonas", title: "G.T.O.", note: "#39 Billboard 年終" },
    { artist: "The Beatles", title: "Twist and Shout", note: "#40 Billboard 年終" },
    { artist: "Johnny Rivers", title: "Memphis", note: "#41 Billboard 年終" },
    { artist: "Danny Williams", title: "White on White", note: "#42 Billboard 年終" },
    { artist: "The Rip Chords", title: "Hey Little Cobra", note: "#43 Billboard 年終" },
    { artist: "Betty Everett", title: "The Shoop Shoop Song (It's in His Kiss)", note: "#44 Billboard 年終" },
    { artist: "The Dave Clark Five", title: "Bits and Pieces", note: "#45 Billboard 年終" },
    { artist: "Millie Small", title: "My Boy Lollipop", note: "#46 Billboard 年終" },
    { artist: "Major Lance", title: "Um, Um, Um, Um, Um, Um", note: "#47 Billboard 年終" },
    { artist: "Jan、Dean", title: "The Little Old Lady (from Pasadena)", note: "#48 Billboard 年終" },
    { artist: "Gerry、the Pacemakers", title: "Don't Let the Sun Catch You Crying", note: "#49 Billboard 年終" },
    { artist: "Chad、Jeremy", title: "A Summer Song", note: "#50 Billboard 年終" },
  ]
};

export const SOY_SOURCES_1964: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1964" }
};
