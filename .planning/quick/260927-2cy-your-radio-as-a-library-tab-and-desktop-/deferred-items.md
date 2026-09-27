# Deferred items (quick-260927-2cy)

## Radio tap: a CJK stub whose resolved title comes back in the other script is prepended, not anchored

- **Found during:** Task 3 E2E, step 2 (second run).
- **Observed:** the row "多遠都要在一起" (Traditional stub) resolved to "多远都要在一起" (Simplified). After `setListQueue(tracks, 'home-discovery')` the queue was 25 long: the resolved current sat at index 0 and the original stub stayed at index 2. `queueWithAnchor` falls back to "splice current at the front" because neither the uid nor `sameSongKey` matched. `dedupe.ts` `key()` does not fold Traditional and Simplified.
- **Why out of scope:** it lives in `player.setListQueue` → `queueWithAnchor` → `sameSongKey`, none of which this task touches. The home "Your Radio" shelf (`playRadioTrack`) and the deleted `/radio` page ran the same code. `RadioList.svelte` moved that code over unchanged.
- **Where to fix:** make `sameSongKey` / the dedupe `key()` fold script variants, for example through `zh-convert`. That is a change to dedupe behaviour and should get its own quick task and tests.
- **Also seen, not a bug:** SongRow shows titles through the `names` display alias (Traditional script lock), while `player.queue` holds the raw titles. A text comparison between rows and queue can therefore report a false mismatch on a raw Simplified title even when the queue order is right.
