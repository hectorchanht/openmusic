// 1972 年選 — year-end charts (United States、United Kingdom).
// - United States: Billboard Year-End Hot 100 (rank order = published year-end rank).
// - United Kingdom: Official Charts Company End of Year Singles Chart (rank order = published year-end rank).
// Rendered as SongRow stubs; taps resolve through the normal multi-source
// search (resolveStub), so the pack ships no audio of its own.

import type { PackSong } from '$lib/data/cantopop-2026';

export const PACK_META_SOY_1972_US = {
  id: 'soy-1972-us',
  title: '1972 美國年選',
  titleEn: 'United States 1972',
  description: 'Billboard 年終百大 Top 50',
  free: true,
  year: 1972,
  country: 'United States'
} as const;

export const SOY_1972: Record<string, PackSong[]> = {
  'United States': [
    { artist: "data-sort-value=\"Flack\"| Roberta Flack", title: "data-sort-value=\"&quot;First Time\"| \"The First Time Ever I Saw Your Face", note: "#1 Billboard 年終" },
    { artist: "data-sort-value=\"Osullivan\"| Gilbert O'Sullivan", title: "Alone Again (Naturally)", note: "#2 Billboard 年終" },
    { artist: "data-sort-value=\"McLean\"| Don McLean", title: "American Pie", note: "#3 Billboard 年終" },
    { artist: "data-sort-value=\"Nilsson\"| Harry Nilsson", title: "Without You", note: "#4 Billboard 年終" },
    { artist: "data-sort-value=\"Davis, Sammy\"| Sammy Davis Jr.", title: "data-sort-value=\"&quot;Candy Man\"| \"The Candy Man", note: "#5 Billboard 年終" },
    { artist: "data-sort-value=\"Tex\"| Joe Tex", title: "I Gotcha", note: "#6 Billboard 年終" },
    { artist: "data-sort-value=\"Withers\"| Bill Withers", title: "Lean on Me", note: "#7 Billboard 年終" },
    { artist: "data-sort-value=\"Davis, Mac\"| Mac Davis", title: "data-sort-value=\"&quot;Baby Dont\"| \"Baby, Don't Get Hooked on Me", note: "#8 Billboard 年終" },
    { artist: "Melanie", title: "Brand New Key", note: "#9 Billboard 年終" },
    { artist: "data-sort-value=\"Newton\"| Wayne Newton", title: "Daddy Don't You Walk So Fast", note: "#10 Billboard 年終" },
    { artist: "data-sort-value=\"Green\"| Al Green", title: "Let's Stay Together", note: "#11 Billboard 年終" },
    { artist: "Looking Glass", title: "Brandy (You're a Fine Girl)", note: "#12 Billboard 年終" },
    { artist: "data-sort-value=\"Chi-Lites\"| The Chi-Lites", title: "Oh Girl", note: "#13 Billboard 年終" },
    { artist: "Gallery", title: "Nice to Be with You", note: "#14 Billboard 年終" },
    { artist: "data-sort-value=\"Berry\"| Chuck Berry", title: "My Ding-a-Ling", note: "#15 Billboard 年終" },
    { artist: "data-sort-value=\"Ingram\"| Luther Ingram", title: "data-sort-value=\"&quot;If Loving\"| \"(If Loving You Is Wrong) I Don't Want to Be Right", note: "#16 Billboard 年終" },
    { artist: "data-sort-value=\"Young\"| Neil Young", title: "Heart of Gold", note: "#17 Billboard 年終" },
    { artist: "data-sort-value=\"Stylistics\"| The Stylistics", title: "Betcha by Golly, Wow", note: "#18 Billboard 年終" },
    { artist: "data-sort-value=\"Staple Singers\"| The Staple Singers", title: "data-sort-value=\"&quot;Ill Take\"| \"I'll Take You There", note: "#19 Billboard 年終" },
    { artist: "data-sort-value=\"Jackson\"| Michael Jackson", title: "Ben", note: "#20 Billboard 年終" },
    { artist: "data-sort-value=\"John, Robert\"| Robert John", title: "data-sort-value=\"&quot;Lion Sleeps\"| \"The Lion Sleeps Tonight", note: "#21 Billboard 年終" },
    { artist: "data-sort-value=\"Preston\"| Billy Preston", title: "Outa-Space", note: "#22 Billboard 年終" },
    { artist: "War", title: "Slippin' into Darkness", note: "#23 Billboard 年終" },
    { artist: "data-sort-value=\"Hollies\"| The Hollies", title: "Long Cool Woman in a Black Dress", note: "#24 Billboard 年終" },
    { artist: "Mouth、MacNeal", title: "How Do You Do", note: "#25 Billboard 年終" },
    { artist: "data-sort-value=\"Diamond\"| Neil Diamond", title: "Song Sung Blue", note: "#26 Billboard 年終" },
    { artist: "America", title: "A Horse with No Name", note: "#27 Billboard 年終" },
    { artist: "Hot Butter", title: "Popcorn", note: "#28 Billboard 年終" },
    { artist: "data-sort-value=\"Main Ingredient\"| The Main Ingredient", title: "Everybody Plays the Fool", note: "#29 Billboard 年終" },
    { artist: "Climax", title: "Precious and Few", note: "#30 Billboard 年終" },
    { artist: "data-sort-value=\"Fifth Dimension\"| The 5th Dimension", title: "data-sort-value=\"&quot;Last Night\"| \"(Last Night) I Didn't Get to Sleep at All", note: "#31 Billboard 年終" },
    { artist: "data-sort-value=\"Moody Blues\"| The Moody Blues", title: "Nights in White Satin", note: "#32 Billboard 年終" },
    { artist: "Raspberries", title: "Go All the Way", note: "#33 Billboard 年終" },
    { artist: "Cornelius Brothers、Sister Rose", title: "Too Late to Turn Back Now", note: "#34 Billboard 年終" },
    { artist: "data-sort-value=\"Ojays\"| The O'Jays", title: "Back Stabbers", note: "#35 Billboard 年終" },
    { artist: "data-sort-value=\"Osmonds\"| The Osmonds", title: "Down by the Lazy River", note: "#36 Billboard 年終" },
    { artist: "data-sort-value=\"Edwards\"| Jonathan Edwards", title: "Sunshine", note: "#37 Billboard 年終" },
    { artist: "Mel、Tim", title: "Starting All Over Again", note: "#38 Billboard 年終" },
    { artist: "Badfinger", title: "Day After Day", note: "#39 Billboard 年終" },
    { artist: "data-sort-value=\"John, Elton\"| Elton John", title: "Rocket Man", note: "#40 Billboard 年終" },
    { artist: "data-sort-value=\"Jackson\"| Michael Jackson", title: "Rockin' Robin", note: "#41 Billboard 年終" },
    { artist: "data-sort-value=\"Boone\"| Daniel Boone", title: "Beautiful Sunday", note: "#42 Billboard 年終" },
    { artist: "data-sort-value=\"Coffey\"| Dennis Coffey", title: "Scorpio", note: "#43 Billboard 年終" },
    { artist: "data-sort-value=\"Stevens\"| Cat Stevens", title: "Morning Has Broken", note: "#44 Billboard 年終" },
    { artist: "data-sort-value=\"Guthrie\"| Arlo Guthrie", title: "City of New Orleans", note: "#45 Billboard 年終" },
    { artist: "data-sort-value=\"Nelson\"| Ricky Nelson", title: "Garden Party", note: "#46 Billboard 年終" },
    { artist: "data-sort-value=\"Nash\"| Johnny Nash", title: "I Can See Clearly Now", note: "#47 Billboard 年終" },
    { artist: "data-sort-value=\"Presley\"| Elvis Presley", title: "Burning Love", note: "#48 Billboard 年終" },
    { artist: "data-sort-value=\"Wright\"| Betty Wright", title: "Clean Up Woman", note: "#49 Billboard 年終" },
    { artist: "Argent", title: "Hold Your Head Up", note: "#50 Billboard 年終" },
  ],
  'United Kingdom': [
    { artist: "The Pipes、Drums、the Military Band of the Royal Scots Dragoon Guards", title: "Amazing Grace", note: "#1 Official Charts 年終" },
    { artist: "Lieutenant Pigeon", title: "Mouldy Old Dough", note: "#2 Official Charts 年終" },
    { artist: "Donny Osmond", title: "Puppy Love", note: "#3 Official Charts 年終" },
    { artist: "Nilsson", title: "Without You", note: "#4 Official Charts 年終" },
    { artist: "The New Seekers", title: "I'd Like to Teach the World to Sing (In Perfect Harmony)", note: "#5 Official Charts 年終" },
    { artist: "Chicory Tip", title: "Son of My Father", note: "#6 Official Charts 年終" },
    { artist: "Gary Glitter", title: "Rock and Roll (Parts 1 & 2)", note: "#7 Official Charts 年終" },
    { artist: "T. Rex", title: "Metal Guru", note: "#8 Official Charts 年終" },
    { artist: "Neil Reid", title: "Mother of Mine", note: "#9 Official Charts 年終" },
    { artist: "T. Rex", title: "Telegram Sam", note: "#10 Official Charts 年終" },
    { artist: "Don McLean", title: "American Pie", note: "#11 Official Charts 年終" },
    { artist: "Slade", title: "Mama Weer All Crazee Now", note: "#12 Official Charts 年終" },
    { artist: "Alice Cooper", title: "School's Out", note: "#13 Official Charts 年終" },
    { artist: "Rod Stewart", title: "You Wear It Well", note: "#14 Official Charts 年終" },
    { artist: "The New Seekers", title: "Beg, Steal or Borrow", note: "#15 Official Charts 年終" },
    { artist: "Don McLean", title: "Vincent", note: "#16 Official Charts 年終" },
    { artist: "Gilbert O'Sullivan", title: "Clair", note: "#17 Official Charts 年終" },
    { artist: "Chuck Berry", title: "My Ding-a-Ling", note: "#18 Official Charts 年終" },
    { artist: "David Cassidy", title: "How Can I Be Sure", note: "#19 Official Charts 年終" },
    { artist: "Dr. Hook、the Medicine Show", title: "Sylvia's Mother", note: "#20 Official Charts 年終" },
  ]
};

export const SOY_SOURCES_1972: Record<string, { name: string; url: string }> = {
  'United States': { name: "Billboard Year-End Hot 100", url: "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_1972" },
  'United Kingdom': { name: "Official Charts Company End of Year Singles Chart", url: "https://en.wikipedia.org/wiki/1972_in_British_music" }
};
