# Audio tag fixtures (36-D-02 / 36-D-03)

Four tiny audio files used by `../audio-tags.test.ts` to prove the tag codec round-trips real bytes
for all three containers the app downloads. They are **inert**: Vitest only collects
`src/**/*.{test,spec}.{js,ts}` (`vite.config.ts`), and no app source imports them, so they never
enter a bundle.

They live here, next to the code under test, because this repo has no `tests/` directory — every
test is co-located with its source. Tests address them with
`readFileSync(new URL('./__fixtures__/tiny.m4a', import.meta.url))`, never a cwd-relative path.

## Licensing

**Synthetic and licensing-clean.** No third-party recording is involved: the m4a/flac come from
macOS's built-in `say` text-to-speech, and the mp3 is hand-built silent MPEG-1 Layer III frames.

## Regeneration recipe

The `say`/`afconvert`/`afinfo` steps are macOS-only (all three ship with the OS). A Linux
contributor can substitute any encoder — the tests only care that the bytes are a valid MP3 / MP4 /
FLAC, not what they sound like. The mp3 and non-faststart steps are plain `python3` and run anywhere.

```bash
# source audio — macOS text-to-speech, ~44 kB AIFF (not committed)
say -o src.aiff "test tone"

# tiny.m4a — ~8.3 kB, faststart layout (ftyp / moov / free / mdat)
afconvert -f m4af -d aac -b 32000 src.aiff tiny.m4a

# tiny.flac — ~22 kB
afconvert -f flac -d flac src.aiff tiny.flac

# tiny.mp3 — ~8.3 kB. 20 hand-built silent MPEG-1 Layer III frames
# (header FF FB 90 00 = 128 kbps / 44.1 kHz, then 413 zero bytes). No encoder needed.
python3 -c "open('tiny.mp3','wb').write((bytes([0xFF,0xFB,0x90,0x00])+b'\x00'*413)*20)"

# tiny-nonfaststart.m4a — ~5.2 kB, mdat BEFORE moov (see below), via the script printed underneath
python3 nonfaststart.py tiny.m4a tiny-nonfaststart.m4a

# check: the two m4a files must report the SAME duration and audio byte count
afinfo tiny.m4a tiny-nonfaststart.m4a   # both: estimated duration 0.917098 sec, audio bytes: 4228
```

## Why `tiny-nonfaststart.m4a` exists

It is the highest-value fixture in the suite. `afconvert` emits a *faststart* file
(`ftyp / moov / free / mdat`) where the metadata sits before the audio. Real-world downloads are
often the other way round (`ftyp / mdat / moov`), and a naive tagger that grows `moov` in that layout
shifts the audio without fixing the `stco` chunk-offset table — the file still opens and plays
silence or garbage. That is **silent corruption**, not a visible error, so it needs a fixture.

The script below rebuilds `tiny.m4a` as `ftyp / mdat / moov` and adds the byte delta of the moved
`mdat` payload to every 32-bit entry of every `stco` atom inside `moov`. For the current fixture the
`mdat` data offset moves 4096 → 36 (delta −4060) and the `free` padding atom is dropped.

```python
# nonfaststart.py
import struct, sys

CONTAINERS = {b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts', b'udta'}

def atoms(buf, start=0, end=None):
	end = len(buf) if end is None else end
	off, out = start, []
	while off + 8 <= end:
		size = struct.unpack('>I', buf[off:off + 4])[0]
		typ = bytes(buf[off + 4:off + 8])
		assert size >= 8, (size, typ)
		out.append((off, size, typ))
		off += size
	return out

def patch_stco(buf, delta):
	b = bytearray(buf)
	def walk(start, end):
		for off, size, typ in atoms(b, start, end):
			if typ == b'stco':
				n = struct.unpack('>I', b[off + 12:off + 16])[0]
				for i in range(n):
					p = off + 16 + 4 * i
					struct.pack_into('>I', b, p, struct.unpack('>I', b[p:p + 4])[0] + delta)
			elif typ == b'co64':
				raise SystemExit('co64 present - 64-bit offsets not handled')
			elif typ in CONTAINERS:
				walk(off + 8, off + size)
	walk(0, len(b))
	return bytes(b)

src, dst = sys.argv[1], sys.argv[2]
buf = open(src, 'rb').read()
by = {t: (o, s) for o, s, t in atoms(buf)}
ftyp_o, ftyp_s = by[b'ftyp']
moov_o, moov_s = by[b'moov']
mdat_o, mdat_s = by[b'mdat']
delta = (ftyp_s + 8) - (mdat_o + 8)          # new mdat data offset - old one
moov = patch_stco(buf[moov_o:moov_o + moov_s], delta)
open(dst, 'wb').write(buf[ftyp_o:ftyp_o + ftyp_s] + buf[mdat_o:mdat_o + mdat_s] + moov)
```

## Expected files

| File | Size | First bytes | Layout |
|---|---|---|---|
| `tiny.mp3` | ~8.3 kB | `FF FB` | 20 silent MPEG-1 Layer III frames |
| `tiny.m4a` | ~8.3 kB | `…ftyp` at offset 4 | `ftyp / moov / free / mdat` (faststart) |
| `tiny-nonfaststart.m4a` | ~5.2 kB | `…ftyp` at offset 4 | `ftyp / mdat / moov` |
| `tiny.flac` | ~22 kB | `fLaC` | STREAMINFO + audio frames |

Total committed size must stay well under ~50 kB. If you regenerate, keep them tiny.
