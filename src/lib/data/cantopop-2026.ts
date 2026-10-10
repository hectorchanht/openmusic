// 2026 廣東歌年選 — Cantopop 2026 pack. FREE for everyone (Hector 2026-10-10: the paid
// Gumroad plan is dropped; this lives in the app, no paywall).
//
// A curated, ordered list of the year's Cantopop hits. The page renders these as SongRow
// stubs; each tap resolves via the normal multi-source search (resolveStub), so the pack
// needs no audio of its own — artist + title is the whole record.
// - `note`: why it's here (chart champion, award buzz, breakthrough). Shown nowhere in v1;
//   kept so a future liner-notes view can use it.
//
// Research: 2026-10-10, verified against Wikipedia「2026年度香港各大電子傳媒機構冠軍歌曲列表」
// (weeks 1–41), RTHK/TVB chart pages. Ranked by chart dominance: 五台共同冠軍 → 四台 →
// 三台/雙台 → 單台 → Chill Club → 話題作. Notable: 姜濤 released nothing in 2026 (year off);
// 陳奕迅 had no verifiable 2026 single.

export interface PackSong {
	/** Artist as HK listeners write it, e.g. "Anson Lo 盧瀚霆", "姜濤". */
	artist: string;
	title: string;
	note?: string;
}

export const PACK_META = {
	id: 'cantopop-2026',
	title: '2026 廣東歌年選',
	titleEn: 'Cantopop 2026',
	description: '今年必聽廣東歌精選 · 免費',
	free: true,
	year: 2026
} as const;

export const CANTOPOP_2026: PackSong[] = [
	{ artist: "林奕匡", title: "那些不愛我的人", note: "五台共同冠軍歌" },
	{ artist: "泳兒", title: "散光", note: "五台共同冠軍歌" },
	{ artist: "陳柏宇", title: "舊酒新瓶", note: "五台共同冠軍歌" },
	{ artist: "郭富城", title: "衝衝衝", note: "五台共同冠軍歌" },
	{ artist: "MIRROR", title: "同往", note: "四台冠軍歌" },
	{ artist: "曾比特", title: "雪出個未來", note: "四台冠軍歌" },
	{ artist: "炎明熹", title: "風旅", note: "四台冠軍歌" },
	{ artist: "MC張天賦", title: "男人怎可以", note: "四台冠軍歌" },
	{ artist: "VIVA", title: "BABY Savage", note: "四台冠軍歌" },
	{ artist: "許志安", title: "信天翁", note: "四台冠軍，2026復出" },
	{ artist: "林家謙", title: "冬季限定", note: "四台冠軍歌" },
	{ artist: "容祖兒", title: "等等等等", note: "三台冠軍歌" },
	{ artist: "Pandora", title: "時光之灰", note: "三台冠軍歌" },
	{ artist: "張學友", title: "陽光普照", note: "兩台冠軍，2026復出" },
	{ artist: "MIRROR", title: "ATTENTION", note: "叱咤+新城雙冠軍" },
	{ artist: "洪嘉豪", title: "穿波鞋的惡魔", note: "港台+ViuTV冠軍" },
	{ artist: "陳健安", title: "課題分離", note: "903+新城雙冠軍" },
	{ artist: "林奕匡", title: "特務占士匡 Mad World", note: "903+新城雙冠軍" },
	{ artist: "黃妍", title: "枇杷", note: "903+新城雙冠軍" },
	{ artist: "張敬軒", title: "放棄的界限", note: "903冠軍歌" },
	{ artist: "Edan 呂爵安", title: "壞人一個", note: "903冠軍歌" },
	{ artist: "Gareth.T 湯令山、MC張天賦", title: "金童子", note: "903冠軍歌" },
	{ artist: "黃淑蔓", title: "Hey Feanna", note: "903冠軍歌" },
	{ artist: "柳應廷", title: "今繼", note: "2025年底派台，2026叱咤冠軍" },
	{ artist: "Gordon Flanders", title: "溝之口 沒有 藤井風", note: "903冠軍，黃偉文詞" },
	{ artist: "雲浩影", title: "我想和你虛度光陰", note: "903冠軍歌" },
	{ artist: "Nowhere Boys", title: "給勝利者的一封信", note: "903冠軍歌" },
	{ artist: "康堤", title: "新人一樣", note: "903冠軍，叱咤生力軍女金" },
	{ artist: "林暐竣", title: "取消追蹤", note: "903冠軍，Chill Club新人男金" },
	{ artist: "麗英", title: "蝴蝶與花園", note: "903冠軍歌" },
	{ artist: "CY 陳宗澤", title: "急口令", note: "903冠軍歌" },
	{ artist: "馮允謙", title: "人間缺憾美", note: "龍虎榜冠軍歌" },
	{ artist: "陳柏宇", title: "一天", note: "龍虎榜冠軍歌" },
	{ artist: "Gareth.T 湯令山", title: "玻璃", note: "龍虎榜冠軍歌" },
	{ artist: "Amy Lo 盧慧敏", title: "藍染", note: "新城冠軍，Chill Club新人女金" },
	{ artist: "方皓玟", title: "我想過一個怎樣的人生？", note: "新城冠軍歌" },
	{ artist: "Fatboy 梁業、姜濤", title: "獅虎流", note: "2025年底首唱，2026新城冠軍" },
	{ artist: "Ian 陳卓賢", title: "傷口上灑辣椒醬", note: "新城冠軍歌" },
	{ artist: "姚焯菲", title: "想飛之內心獨白", note: "勁歌金榜冠軍" },
	{ artist: "張與辰", title: "獨居的儀式感", note: "勁歌金榜冠軍" },
	{ artist: "柯雨霏", title: "直覺型美學", note: "勁歌金榜冠軍" },
	{ artist: "黃博", title: "靈魂上演", note: "勁歌金榜冠軍" },
	{ artist: "譚輝智", title: "娛初", note: "勁歌金榜冠軍" },
	{ artist: "Honey Punch", title: "樓上的姐姐", note: "勁歌金榜冠軍" },
	{ artist: "Edan 呂爵安、蔡俊彥", title: "1206", note: "Chill Club冠軍歌" },
	{ artist: "Anson Lo 盧瀚霆", title: "Charisma", note: "Chill Club冠軍歌" },
	{ artist: "Ian 陳卓賢", title: "Growth!", note: "Chill Club冠軍，個唱主題曲" },
	{ artist: "Jeremy 李駿傑", title: "Away", note: "Chill Club冠軍歌" },
	{ artist: "Anson Kong 江𤒹生", title: "攬緊處理", note: "Chill Club冠軍歌" },
	{ artist: "晚安莉莉", title: "唯獨不可敗給名為「我」的你", note: "Chill Club冠軍歌" },
	{ artist: "sica 何洛瑤", title: "大團圓結局", note: "Chill Club冠軍歌" },
	{ artist: "Anson Lo 盧瀚霆", title: "最後一個降落傘", note: "廣泛討論話題作" },
	{ artist: "Jer 柳應廷", title: "跌在地上的怪獸", note: "冰島拍MV，2026頭炮" },
	{ artist: "Jer 柳應廷", title: "魔笛", note: "陳蕾曲，梁栢堅詞" },
	{ artist: "Jeremy 李駿傑", title: "黑蛇傳", note: "903星空音樂會話題" },
	{ artist: "MIRROR", title: "Fight Club", note: "亞博演唱會主題曲" },
	{ artist: "MIRROR小組 (Alton/AK/Frankie/Lokman)", title: "BRO!", note: "演唱會前新歌" },
	{ artist: "ERROR", title: "我們不分", note: "回應解散傳聞團歌" },
	{ artist: "COLLAR", title: "SKSKZAZA", note: "《PERSONA》主打團歌" },
	{ artist: "COLLAR", title: "淚光", note: "《PERSONA》頭炮團歌" },
	{ artist: "陳蕾", title: "完整的我", note: "加拿大至HIT冠軍" },
	{ artist: "Serrini", title: "成日受傷的女人", note: "903上榜話題作" },
	{ artist: "蘇雅琳", title: "給你一隻大口仔", note: "COLLAR單飛首作" },
];
