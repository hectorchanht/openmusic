package com.openmusic.app

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
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
