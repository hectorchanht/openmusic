package com.openmusic.app

import android.Manifest
import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.IntentSender
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Hand-written, local Capacitor plugin (NO npm/git dependency — T-999.1-07 mitigation) that writes
 * downloaded audio into the PUBLIC `Music/OpenMusic/` collection so it is visible to file managers
 * and other audio apps (D-11, resolved `public-music-mediastore` 2026-06-12).
 *
 * Android version branch (RESEARCH Pitfall 2 / scoped storage):
 *  - API 29+ (Android 10+, >95% install base): MediaStore.Audio.Media with RELATIVE_PATH +
 *    IS_PENDING. Writing the app's OWN MediaStore entries needs NO runtime permission.
 *  - API <=28 (Android 9 and older): legacy Environment.getExternalStoragePublicDirectory(
 *    DIRECTORY_MUSIC) + MediaScannerConnection; WRITE_EXTERNAL_STORAGE is declared in the manifest
 *    with maxSdkVersion="28" (a no-op on modern Android — T-999.1-18 mitigation).
 *
 * Both `saveToMusic` and `deleteFromMusic` wrap their bodies in try/catch -> call.reject(message);
 * the TS side maps a reject to the blob-store never-throws sentinel (put->false / del->void), so a
 * failed public-Music write degrades to CDN playback and never crashes the player (T-999.1-19).
 *
 * 34: the plugin is now READ + write. `requestReadAudio` asks for the audio-read permission at tap
 * time and `scanAudio` pages MediaStore.Audio rows under Music/ and Download/ (34-D-11) so the
 * user's own files can be imported as library entries. The scan reads COLUMNS ONLY — the system
 * media scanner already extracted the embedded tags, so no file bytes and no MediaMetadataRetriever
 * are involved. Playback still reads the file through Capacitor.convertFileSrc in blob-store.ts, so
 * audio bytes never cross the JS bridge in either direction.
 */
@CapacitorPlugin(
    name = "MediaStoreSaver",
    permissions = [
        // CR-03: WRITE_EXTERNAL_STORAGE is a runtime (dangerous) permission on API 23–28 and is the
        // ONLY way the legacy (API <=28) public-Music write can succeed. minSdk is 24, so API 24–28
        // devices are supported and MUST be able to request this at call time. API 29+ writes the
        // app's OWN MediaStore entries with NO runtime permission, so this alias is only consulted on
        // the legacy branch. (Declared with maxSdkVersion="28" in AndroidManifest.xml.)
        Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "publicMusic"),
        // 34: the READ side. TWO aliases because the annotation cannot express an SDK condition —
        // READ_MEDIA_AUDIO exists from API 33, READ_EXTERNAL_STORAGE is the API 29–32 spelling of
        // the same grant. The plugin picks the alias at call time (readAlias()), mirroring how
        // saveToMusic branches on SDK_INT.
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "readAudio33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "readAudioLegacy")
    ]
)
class MediaStoreSaverPlugin : Plugin() {

    private val relativePath = "${Environment.DIRECTORY_MUSIC}/OpenMusic/"

    /** Infer an audio MIME type from the file extension; default audio/mpeg. */
    private fun mimeForFileName(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            "m4a", "aac" -> "audio/mp4"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            else -> "audio/mpeg"
        }
    }

    /** Open the caller-supplied source file (a file:// URI of the app-private offline copy). */
    private fun openSource(sourcePath: String): InputStream? {
        val srcUri = Uri.parse(sourcePath)
        return when (srcUri.scheme) {
            "content" -> context.contentResolver.openInputStream(srcUri)
            // file:// (the @capacitor/filesystem getUri result) or a bare path.
            else -> {
                val path = srcUri.path ?: sourcePath
                val f = File(path)
                if (f.exists()) f.inputStream() else null
            }
        }
    }

    /** Stream all bytes from `input` to `output` in chunks (no whole-file buffering). WR-02. */
    private fun streamCopy(input: InputStream, output: OutputStream) {
        input.use { src ->
            output.use { dst ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = src.read(buffer)
                    if (read < 0) break
                    dst.write(buffer, 0, read)
                }
                dst.flush()
            }
        }
    }

    /**
     * quick-260919-ejm: stream all bytes from `input` to `output`, closing NEITHER, returning the
     * byte count. `streamCopy` above cannot be reused for the in-place write: it wraps both streams
     * in `use`, and a descriptor that is already closed cannot be `sync()`ed — an fsync AFTER close
     * is not a durability barrier, it is a no-op. The in-place path must flush, sync, and only THEN
     * let the ParcelFileDescriptor close. Left `streamCopy` untouched for its existing callers.
     */
    private fun pumpBytes(input: InputStream, output: OutputStream): Long {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            total += read
        }
        return total
    }

    @PluginMethod
    fun saveToMusic(call: PluginCall) {
        val fileName = call.getString("fileName")
        if (fileName.isNullOrBlank()) {
            call.reject("fileName is required")
            return
        }
        val sourcePath = call.getString("sourcePath")
        if (sourcePath.isNullOrEmpty()) {
            call.reject("sourcePath is required")
            return
        }

        // CR-03: the legacy (API <=28) branch writes to public external storage, which requires the
        // WRITE_EXTERNAL_STORAGE runtime grant. Request it at call time before writing; on API 29+
        // no runtime permission is needed (app-owned MediaStore entry), so proceed directly.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            getPermissionState("publicMusic") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("publicMusic", call, "publicMusicPermsCallback")
            return
        }

        performSave(call, fileName, sourcePath)
    }

    @PermissionCallback
    private fun publicMusicPermsCallback(call: PluginCall) {
        if (getPermissionState("publicMusic") != PermissionState.GRANTED) {
            call.reject("WRITE_EXTERNAL_STORAGE permission denied")
            return
        }
        val fileName = call.getString("fileName")
        val sourcePath = call.getString("sourcePath")
        if (fileName.isNullOrBlank() || sourcePath.isNullOrEmpty()) {
            call.reject("fileName and sourcePath are required")
            return
        }
        performSave(call, fileName, sourcePath)
    }

    private fun performSave(call: PluginCall, fileName: String, sourcePath: String) {
        try {
            val mime = mimeForFileName(fileName)
            val input = openSource(sourcePath)
                ?: run {
                    call.reject("source file not found: $sourcePath")
                    return
                }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // API 29+: MediaStore RELATIVE_PATH + IS_PENDING write pattern. Stream the source
                // file straight into the entry (WR-02 — no whole-blob buffering).
                val resolver = context.contentResolver
                val collection =
                    MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val values = ContentValues().apply {
                    put(MediaStore.Audio.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Audio.Media.MIME_TYPE, mime)
                    put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)
                    put(MediaStore.Audio.Media.IS_PENDING, 1)
                }
                val uri: Uri = resolver.insert(collection, values)
                    ?: run {
                        input.close()
                        call.reject("MediaStore insert returned null")
                        return
                    }
                val output = resolver.openOutputStream(uri)
                if (output == null) {
                    input.close()
                    resolver.delete(uri, null, null)
                    call.reject("Could not open output stream for the MediaStore entry")
                    return
                }
                streamCopy(input, output)
                values.clear()
                values.put(MediaStore.Audio.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                call.resolve(JSObject().put("uri", uri.toString()))
            } else {
                // API <=28: legacy public-Music write + media scan so it is indexed.
                @Suppress("DEPRECATION")
                val musicDir =
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
                val targetDir = File(musicDir, "OpenMusic")
                if (!targetDir.exists()) targetDir.mkdirs()
                val outFile = File(targetDir, fileName)
                streamCopy(input, outFile.outputStream())
                // Index it so file managers / other audio apps see it immediately.
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(outFile.absolutePath),
                    arrayOf(mime),
                    null
                )
                call.resolve(JSObject().put("uri", Uri.fromFile(outFile).toString()))
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "saveToMusic failed")
        }
    }

    @PluginMethod
    fun deleteFromMusic(call: PluginCall) {
        try {
            val uriString = call.getString("uri")
            if (uriString.isNullOrBlank()) {
                // Nothing to delete — never crash the caller.
                call.resolve()
                return
            }
            val uri = Uri.parse(uriString)
            when (uri.scheme) {
                "content" -> {
                    // MediaStore content URI (API 29+ branch) — delete the entry the app created.
                    context.contentResolver.delete(uri, null, null)
                }
                "file" -> {
                    // Legacy file:// URI (API <=28 branch) — remove the file and re-scan.
                    uri.path?.let { path ->
                        val f = File(path)
                        if (f.exists()) f.delete()
                        MediaScannerConnection.scanFile(context, arrayOf(path), null, null)
                    }
                }
            }
            call.resolve()
        } catch (e: Exception) {
            // Not-found / any failure swallowed into resolve — parity with del() never-throws.
            call.resolve()
        }
    }

    // --- quick-260919-ejm: THE IN-PLACE REWRITE OF A FILE THIS APP DOES NOT OWN ------------------
    //
    // WHY THIS IS SAFE HERE, AND ONLY HERE. Every other write in this plugin creates a file the app
    // owns (`saveToMusic` inserts a NEW row under Music/OpenMusic/). This one opens a row the USER
    // owns and truncates it. It exists because editing an imported song's metadata has exactly two
    // honest outcomes — rewrite THEIR file, or make a duplicate of their music — and the duplicate
    // was rejected. The user authorised the rewrite on the condition that every failure short of a
    // process death mid-stream leaves the original byte-identical.
    //
    // THE FAILURE LADDER, in the order the rungs are checked below. Anything above rung 7 has not
    // opened a descriptor, so the user's file is untouched by construction:
    //   1. not a `content://media/...` uri          -> reject "precheck:not a media uri"
    //   2. API below Q                              -> reject "unsupported:api"
    //   3. the row's SIZE no longer matches         -> reject "precheck:target changed"
    //   4. the temp source is missing               -> reject "precheck:source missing"
    //   5. the temp source is zero-length           -> reject "precheck:source empty"
    //   6. no write access / user denies consent    -> reject "denied"
    //   7. the stream-over fails partway            -> reject "io:<message>"  (file may be partial)
    //   8. bytes landed, column update failed       -> resolve() anyway (D-8)
    //
    // THE REJECT-CODE CONTRACT IS LOAD-BEARING, not prose. `unsupported:` / `precheck:` / `denied`
    // mean NOTHING was written, so the TS side drops its pending-write journal entry and deletes
    // the temp file. `io:` means the descriptor was open and the bytes may be partial, so the TS
    // side KEEPS both and replays the temp file later. Renaming a code without changing blob-store.ts
    // turns a recoverable truncation into a permanent one.
    //
    // D-7 — NO RENAME, EVER. DISPLAY_NAME, RELATIVE_PATH and DATA are never written. Retagging a
    // song must not move or rename a file the user filed themselves; that capability was not asked
    // for and does not exist in this method.

    /** quick-260919-ejm: the consent launcher (rung 6). Null when registration failed — see `load`. */
    private var writeConsentLauncher: ActivityResultLauncher<IntentSenderRequest>? = null

    /** quick-260919-ejm: callbackId of the `writeInPlace` call parked on the consent dialog. */
    private var pendingWriteCallbackId: String? = null

    override fun load() {
        // quick-260919-ejm: registration MUST happen before the host activity is STARTED, which is
        // what `load()` guarantees and a lazy first-use registration would not. Wrapped because a
        // throw here would take the whole plugin — and therefore downloads, import and playback of
        // imported files — down with it. A null launcher is a DEGRADED feature (the consent rung
        // rejects "denied" and the user's file stays untouched), never a broken app.
        writeConsentLauncher = try {
            bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
                onWriteConsentResult(result)
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * quick-260919-ejm: rewrite the bytes of an EXISTING MediaStore row from a temp file.
     *
     * Params are all strings so no `PluginCall` numeric-accessor behaviour has to be guessed across
     * Capacitor versions: `uri`, `sourcePath` (a `file://` temp the app wrote), `expectedBytes`
     * (blank/absent = skip the precondition — the REPLAY path, where the target size no longer
     * matches by definition), plus optional `title` / `artist` / `album` for the column update.
     */
    @PluginMethod
    fun writeInPlace(call: PluginCall) {
        val uriString = call.getString("uri")
        if (uriString.isNullOrBlank()) {
            call.reject("precheck:uri is required")
            return
        }
        val sourcePath = call.getString("sourcePath")
        if (sourcePath.isNullOrBlank()) {
            call.reject("precheck:sourcePath is required")
            return
        }
        // Rung 1. A bridge method that can truncate an ARBITRARY uri is a capability nobody asked
        // for: the WebView could hand over a `file://` path or another app's provider. The only
        // caller passes `deviceContentUri(uid)`, which already refuses any id that is not /^\d+$/
        // (T-34-03), so this is the second independent half of T-ejm-01.
        val uri = Uri.parse(uriString)
        if (uri.scheme != "content" || uri.authority != "media") {
            call.reject("precheck:not a media uri")
            return
        }
        // Rung 2. The import that mints a device uid is API 29+ only (`requestReadAudio` resolves
        // 'unsupported' below Q), so nothing below Q can be holding one.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported:api")
            return
        }
        performWriteInPlace(call, allowConsent = true)
    }

    /**
     * quick-260919-ejm: rungs 3-8. `allowConsent` is the EXACTLY-ONCE retry flag (T-ejm-06) — the
     * post-consent re-entry passes false, so a provider that keeps throwing SecurityException
     * rejects instead of launching the dialog again in a loop.
     */
    private fun performWriteInPlace(call: PluginCall, allowConsent: Boolean) {
        val uri = Uri.parse(call.getString("uri") ?: "")
        val sourcePath = call.getString("sourcePath") ?: ""
        val resolver = context.contentResolver

        // Rung 3 (T-ejm-02). 34-D-02: a device uid is a MediaStore `_ID`, and an _ID is NOT a
        // permanent identity — a provider rebuild (factory reset, SD remount, "clear data" on the
        // media provider) renumbers rows, so a uid persisted in the library can come to point at a
        // DIFFERENT song. Size is the cheapest evidence the row is still the one the JS side just
        // read its bytes from. A mismatch means "do not touch anything", not "write anyway".
        val expected = call.getString("expectedBytes")?.trim()?.takeIf { it.isNotEmpty() }?.toLongOrNull()
        if (expected != null) {
            val actual = queryRowSize(resolver, uri)
            if (actual == null || actual != expected) {
                call.reject("precheck:target changed")
                return
            }
        }

        // Rungs 4-5. Measure the temp file BEFORE any descriptor is opened: a missing or empty
        // source must never be the thing that discovers itself halfway through a truncate.
        val sourceLength = sourceLengthOf(sourcePath)
        if (sourceLength == null) {
            call.reject("precheck:source missing")
            return
        }
        if (sourceLength == 0L) {
            call.reject("precheck:source empty")
            return
        }

        var written = 0L
        try {
            val input = openSource(sourcePath)
            if (input == null) {
                call.reject("precheck:source missing")
                return
            }
            input.use { src ->
                // THE ONE DESTRUCTIVE LINE IN THIS PLUGIN. Everything above it is a rung that
                // leaves the file alone; everything below it is committed.
                val pfd = resolver.openFileDescriptor(uri, "rwt")
                if (pfd == null) {
                    call.reject("io:could not open the file for writing")
                    return
                }
                pfd.use { descriptor ->
                    val output = FileOutputStream(descriptor.fileDescriptor)
                    // Belt-and-braces: "rwt" asks the provider to truncate, but a provider that
                    // ignores the `t` flag would leave a TAIL of the old file past the new bytes —
                    // a longer original re-tagged smaller would end with garbage that some decoders
                    // happily play as noise. Truncating explicitly costs nothing and removes the
                    // dependency on provider goodwill.
                    output.channel.truncate(0)
                    written = pumpBytes(src, output)
                    output.flush()
                    // fsync BEFORE anything closes (see pumpBytes): without it the bytes live in
                    // the page cache and a power loss seconds later loses a write the user was
                    // already told succeeded. NOT closing `output` is deliberate — the descriptor
                    // is closed by `pfd.use`, after the sync.
                    descriptor.fileDescriptor.sync()
                }
            }
        } catch (e: SecurityException) {
            // Rung 6 (T-ejm-04). Android, not this app, decides whether the user's file may be
            // written: the consent dialog is the transfer of that decision to its rightful owner.
            // The descriptor was NOT opened for write, so the file is untouched on every branch here.
            if (!allowConsent) {
                call.reject("denied")
                return
            }
            val sender = writeRequestSender(resolver, uri, e)
            val launcher = writeConsentLauncher
            if (sender == null || launcher == null) {
                call.reject("denied")
                return
            }
            try {
                bridge.saveCall(call)
                pendingWriteCallbackId = call.callbackId
                launcher.launch(IntentSenderRequest.Builder(sender).build())
            } catch (t: Exception) {
                pendingWriteCallbackId = null
                bridge.releaseCall(call)
                call.reject("denied")
            }
            return
        } catch (e: Exception) {
            // Rung 7. The descriptor WAS open, so the file may be partial. `io:` is what tells the
            // TS side to keep the journal entry and the temp file for a replay.
            call.reject("io:" + (e.message ?: "write failed"))
            return
        }

        // Rung 8 (D-8). The phone's music app renders the TITLE/ARTIST/ALBUM COLUMNS, not the
        // file's tags, so bytes-only would be an edit the user cannot see until the next media
        // scan. Best-effort and strictly AFTER the bytes landed: a column update that fails must
        // not fail a write that already succeeded, or the TS side would replay a finished job.
        // T-ejm-05: DISPLAY_NAME / RELATIVE_PATH / DATA are absent on purpose (D-7 — no rename,
        // no move). This is the ONE place columns are written, so that is enforceable by reading it.
        try {
            val values = ContentValues()
            call.getString("title")?.takeIf { it.isNotBlank() }?.let { values.put(MediaStore.Audio.Media.TITLE, it) }
            call.getString("artist")?.takeIf { it.isNotBlank() }?.let { values.put(MediaStore.Audio.Media.ARTIST, it) }
            call.getString("album")?.takeIf { it.isNotBlank() }?.let { values.put(MediaStore.Audio.Media.ALBUM, it) }
            values.put(MediaStore.Audio.Media.SIZE, written)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            // Swallowed: stale columns until the next media scan is a cosmetic lag, not a failure.
        }
        call.resolve()
    }

    /** quick-260919-ejm: the consent dialog's answer. RESULT_OK retries the write exactly once. */
    private fun onWriteConsentResult(result: ActivityResult) {
        val id = pendingWriteCallbackId
        pendingWriteCallbackId = null
        val call = if (id != null) bridge.getSavedCall(id) else null
        if (call == null) return
        bridge.releaseCall(call)
        if (result.resultCode != Activity.RESULT_OK) {
            // Includes RESULT_CANCELED — a back press or an explicit "Don't allow". Nothing was
            // written, which is exactly what `denied` promises the TS side.
            call.reject("denied")
            return
        }
        performWriteInPlace(call, allowConsent = false)
    }

    /** quick-260919-ejm: the row's current SIZE column, or null when the row is gone/unreadable. */
    private fun queryRowSize(resolver: ContentResolver, uri: Uri): Long? {
        return try {
            resolver.query(uri, arrayOf(MediaStore.Audio.Media.SIZE), null, null, null)?.use { c ->
                if (!c.moveToFirst()) {
                    null
                } else {
                    val idx = c.getColumnIndex(MediaStore.Audio.Media.SIZE)
                    if (idx < 0 || c.isNull(idx)) null else c.getLong(idx)
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * quick-260919-ejm: the temp source's length, or null when it is not there at all. A negative
     * length (an AssetFileDescriptor's UNKNOWN_LENGTH) passes through as "unknown, proceed" — the
     * only caller hands over a `file://` path from `Filesystem.getUri`, where the length is exact.
     */
    private fun sourceLengthOf(sourcePath: String): Long? {
        val srcUri = Uri.parse(sourcePath)
        return try {
            if (srcUri.scheme == "content") {
                context.contentResolver.openAssetFileDescriptor(srcUri, "r")?.use { it.length }
            } else {
                val f = File(srcUri.path ?: sourcePath)
                if (f.exists()) f.length() else null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * quick-260919-ejm: the IntentSender that asks the user for write access to `uri`.
     * API 30+ has the purpose-built `MediaStore.createWriteRequest`; API 29 only surfaces the
     * sender on the RecoverableSecurityException it just threw. Null means "cannot ask" — the
     * caller turns that into a clean `denied`, never a crash.
     */
    private fun writeRequestSender(resolver: ContentResolver, uri: Uri, e: SecurityException): IntentSender? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                MediaStore.createWriteRequest(resolver, listOf(uri)).intentSender
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                (e as? RecoverableSecurityException)?.userAction?.actionIntent?.intentSender
            } else {
                null
            }
        } catch (t: Exception) {
            null
        }
    }

    // --- 34 read side: permission + paged MediaStore scan ---------------------------------------

    /** The alias whose permission string this platform version actually uses. */
    private fun readAlias(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "readAudio33" else "readAudioLegacy"

    /** The Manifest permission behind readAlias() — needed for the rationale check. */
    private fun readPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }

    private fun hasReadAudio() = getPermissionState(readAlias()) == PermissionState.GRANTED

    /**
     * 34-D-14: request the audio-read grant AT TAP TIME (never at launch). Resolves one of
     * granted / denied / denied-permanently / unsupported; the TS side maps a reject to 'denied'.
     */
    @PluginMethod
    fun requestReadAudio(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // The scan is API 29+ only: below Q there is no RELATIVE_PATH column and the whole
            // legacy DATA-LIKE branch would exist for an install base that is effectively dead
            // (Phase 29 RESEARCH reached the same conclusion for its own legacy branch). Import is
            // simply unavailable there, and the UI says so rather than failing halfway.
            call.resolve(JSObject().put("state", "unsupported"))
            return
        }
        if (hasReadAudio()) {
            call.resolve(JSObject().put("state", "granted"))
            return
        }
        requestPermissionForAlias(readAlias(), call, "readAudioPermsCallback")
    }

    @PermissionCallback
    private fun readAudioPermsCallback(call: PluginCall) {
        if (hasReadAudio()) {
            call.resolve(JSObject().put("state", "granted"))
            return
        }
        // shouldShowRequestPermissionRationale is only unambiguous HERE: we just asked, so the
        // "never asked yet" case (which also returns false) is impossible. That is why the
        // permanent-denial state is decided inside the callback and not derived from
        // getPermissionState, which cannot tell "denied once" from "don't ask again".
        val soft = activity.shouldShowRequestPermissionRationale(readPermission())
        call.resolve(JSObject().put("state", if (soft) "denied" else "denied-permanently"))
    }

    /**
     * 34-D-11: one page of MediaStore.Audio rows under Music/ or Download/ (and their subfolders),
     * ordered `_ID ASC`. Resolves `{ rows, total }`; `total` is the full matching count so the TS
     * walker can stop at `offset >= total` and show progress.
     */
    @PluginMethod
    fun scanAudio(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(JSObject().put("rows", JSArray()).put("total", 0))
            return
        }
        if (!hasReadAudio()) {
            // A guard, not the flow — the TS side calls requestReadAudio first.
            call.reject("READ_MEDIA_AUDIO not granted")
            return
        }
        // V13: clamp both, so a compromised WebView cannot ask for a pathological page.
        val offset = (call.getInt("offset") ?: 0).coerceAtLeast(0)
        val limit = (call.getInt("limit") ?: 500).coerceIn(1, 1000)
        try {
            performScan(call, offset, limit)
        } catch (e: Exception) {
            call.reject(e.message ?: "scanAudio failed")
        }
    }

    private fun performScan(call: PluginCall, offset: Int, limit: Int) {
        // 34-D-02 / device-track.ts deviceContentUri CONTRACT: rows are queried through the
        // VOLUME_EXTERNAL union view and each row's uri is ContentUris.withAppendedId(collection,
        // id), i.e. exactly content://media/external/audio/media/<id>; the TS side reconstructs that
        // string from the uid and never persists it. Changing the collection here breaks playback of
        // every imported file.
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        // Every column below exists from API 29 (most from API 1). Do NOT add ALBUM_ARTIST / GENRE /
        // BITRATE — they are API 30 and query() throws IllegalArgumentException without them.
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.YEAR
        )
        // RELATIVE_PATH values carry a TRAILING slash ("Music/", "Music/OpenMusic/", "Download/"),
        // so "Music/%" covers the folder itself and every subfolder. Bound args, never string
        // interpolation (V13 / T-34-06).
        val selection =
            "(${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? OR ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?)"
        val selectionArgs = arrayOf(
            "${Environment.DIRECTORY_MUSIC}/%",
            "${Environment.DIRECTORY_DOWNLOADS}/%"
        )
        // Deterministic _ID ASC order is REQUIRED for paging coherence — without it two pages can
        // overlap or skip rows.
        val sortOrder = "${MediaStore.Audio.Media._ID} ASC"
        val resolver = context.contentResolver

        val queryArgs = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selectionArgs)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sortOrder)
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
                putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
            } else {
                // QUERY_ARG_LIMIT / QUERY_ARG_OFFSET are API 30. On API 29 an unknown Bundle key is
                // silently ignored, which would return the WHOLE table for every page — so paging
                // rides on the sort order there, the pre-R way (accepted because API 29's provider
                // has no strict-token check on sortOrder; API 30+ does, hence the branch).
                putString(
                    ContentResolver.QUERY_ARG_SQL_SORT_ORDER,
                    "$sortOrder LIMIT $limit OFFSET $offset"
                )
            }
        }

        val rows = JSArray()
        resolver.query(collection, projection, queryArgs, null)?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val nameCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val pathCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
            val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val mimeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val sizeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val trackCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
            val yearCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                // FLAT object only: Capacitor Android rejects nested arrays with
                // "JSONArray is not a valid type" (ionic-team/capacitor#7747).
                val row = JSObject()
                    .put("id", id.toString())
                    .put("uri", ContentUris.withAppendedId(collection, id).toString())
                    .put("displayName", c.getString(nameCol) ?: "")
                    .put("relativePath", c.getString(pathCol) ?: "")
                    .put("title", c.getString(titleCol) ?: "")
                    .put("artist", c.getString(artistCol) ?: "")
                    .put("album", c.getString(albumCol) ?: "")
                    .put("durationMs", if (c.isNull(durationCol)) 0L else c.getLong(durationCol))
                    .put("mimeType", c.getString(mimeCol) ?: "")
                    .put("size", if (c.isNull(sizeCol)) 0L else c.getLong(sizeCol))
                    .put("track", if (c.isNull(trackCol)) 0 else c.getInt(trackCol))
                    .put("year", if (c.isNull(yearCol)) 0 else c.getInt(yearCol))
                rows.put(row)
            }
        }

        // Full matching count: same selection, no limit/offset.
        val countArgs = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selectionArgs)
        }
        val total = resolver.query(
            collection,
            arrayOf(MediaStore.Audio.Media._ID),
            countArgs,
            null
        )?.use { it.count } ?: 0

        // Zero rows is a normal resolve, not a reject (parity with deleteFromMusic's not-found).
        call.resolve(JSObject().put("rows", rows).put("total", total))
    }
}
