#!/usr/bin/env bash
# APK cold-play device test (todo apk-cold-play-samsung-device-test, fix e2aa2388 / ColdMediaLaunch.kt).
#
# Checks, on a REAL Samsung phone over adb, the two things the API 34 emulator could not:
#   1. Modes & Routines "Play music" lists OpenMusic and, with the app process dead, its command
#      (delivered through OpenMusicBrowserService, NOT a media key) starts playback.
#   2. The background activity start is allowed on the device without "Display over other apps";
#      if not, the same run is repeated with SYSTEM_ALERT_WINDOW granted.
# Also re-runs the media-key path (`cmd media_session dispatch play`) as a baseline.
#
# Usage:  scripts/device-test/apk-cold-play.sh [path/to/openmusic.apk]
#   No APK argument → downloads the latest GitHub release APK (CI builds + signs it on every push
#   to main; v2.83+ contain the fix). Needs: adb (Android platform-tools), USB debugging on.
# Output: a log dir under ./device-test-out/<timestamp>/ with logcat + dumpsys per scenario and a
#   summary.txt to paste back into the todo.
set -uo pipefail

PKG=com.openmusic.app
TAG=OpenMusicColdPlay
WAIT_SECS=${WAIT_SECS:-30}
APK=${1:-}
OUT="device-test-out/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { echo "$*" | tee -a "$SUMMARY"; }
pause() { read -r -p "   → $* [Enter] " _; }
ask_yn() { local a; read -r -p "   → $* [y/n] " a; [[ $a == y* || $a == Y* ]]; }

command -v adb >/dev/null || { echo "adb not found — install Android platform-tools (brew install --cask android-platform-tools)"; exit 1; }

# ---------- preflight ----------
say "Preflight"
n=$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
[[ $n == 1 ]] || { echo "need exactly one authorized device, found $n (adb devices):"; adb devices; exit 1; }
maker=$(adb shell getprop ro.product.manufacturer | tr -d '\r')
model=$(adb shell getprop ro.product.model | tr -d '\r')
sdk=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
oneui=$(adb shell getprop ro.build.version.oneui | tr -d '\r')
note "device: $maker $model  sdk=$sdk  oneui=${oneui:-n/a}"
[[ $(echo "$maker" | tr "[:upper:]" "[:lower:]") == samsung ]] || echo "   WARNING: not a Samsung device — the Modes & Routines part will not apply."

# ---------- install ----------
say "Install"
if [[ -z $APK ]]; then
	APK="$OUT/openmusic-main.apk"
	url=$(curl -s https://api.github.com/repos/hectorchanht/openmusic/releases/latest |
		python3 -I -c 'import json,sys;print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith(".apk")))')
	echo "   downloading $url"
	curl -sL -o "$APK" "$url" || { echo "download failed"; exit 1; }
fi
adb install -r "$APK" | tail -1
note "apk: $(adb shell dumpsys package $PKG | grep -m1 versionName | tr -d ' \r')"

# The system must resolve our MediaBrowserService — this is what music-app pickers query.
if adb shell cmd package query-services -a android.media.browse.MediaBrowserService | grep -q "$PKG/.OpenMusicBrowserService\|$PKG/$PKG.OpenMusicBrowserService"; then
	note "PASS  MediaBrowserService resolvable by the system"
else
	note "FAIL  OpenMusicBrowserService not resolvable — the routine picker cannot list OpenMusic"
fi

say "Seed a last-played track"
echo "   Open OpenMusic on the phone, play any song for ~10 s (so restore() has a track), then come back."
pause "song played for 10 s"

# ---------- helpers ----------
kill_app() {
	adb shell input keyevent KEYCODE_HOME
	sleep 1
	# stop-app (API 34+) kills the process WITHOUT the "stopped" state force-stop sets — a
	# force-stopped app gets no broadcasts/binds, which is not what a swipe-away does.
	if ((sdk >= 34)); then adb shell am stop-app $PKG >/dev/null 2>&1; else adb shell am kill $PKG; fi
	sleep 2
	if [[ -n $(adb shell pidof $PKG | tr -d '\r') ]]; then
		echo "   process still alive — swipe OpenMusic away in Recents now."
		pause "swiped away"
	fi
	[[ -z $(adb shell pidof $PKG | tr -d '\r') ]]
}

# Polls until the app's media session reports PLAYING (state=3) or WAIT_SECS elapse.
watch_play() {
	local name=$1 t=0 state=""
	while ((t < WAIT_SECS)); do
		state=$(adb shell dumpsys media_session | awk -v p="$PKG" '
			/package=/ { inpkg = index($0, p) > 0 }
			inpkg && /state=PlaybackState/ { match($0, /state=[0-9]+/); v = substr($0, RSTART+6, RLENGTH-6); if (v == 3 || last == "") last = v }
			END { print last }') # OpenMusicLauncher (STOPPED) + plugin session coexist: any PLAYING wins
		[[ $state == 3 ]] && break
		sleep 1
		((t++))
	done
	adb logcat -d -s "$TAG:*" ActivityTaskManager:I ActivityManager:I >"$OUT/$name.logcat.txt"
	adb shell dumpsys media_session >"$OUT/$name.media_session.txt"
	grep -E "$TAG|$PKG.*(START|BAL)|BAL_.*$PKG|Background activity start.*$PKG|Abort background activity" \
		"$OUT/$name.logcat.txt" | tail -8 | sed 's/^/     /'
	if [[ $state == 3 ]]; then
		note "PASS  $name — playing after ${t}s"
		return 0
	fi
	local alive=no
	[[ -n $(adb shell pidof $PKG | tr -d '\r') ]] && alive=yes
	note "FAIL  $name — not playing after ${WAIT_SECS}s (process alive: $alive, last state: ${state:-none})"
	return 1
}

overlay() { adb shell appops set $PKG SYSTEM_ALERT_WINDOW "$1"; }

run_routine() {
	local name=$1
	say "$name"
	kill_app || { note "SKIP  $name — could not kill the process"; return; }
	adb logcat -c
	echo "   Run the 'Play music' routine NOW (tap it in Modes & Routines, or fire its trigger)."
	watch_play "$name"
	ask_yn "did you HEAR the last song resume (and the app minimize)?" &&
		note "      $name: heard audio = yes" || note "      $name: heard audio = no"
}

# ---------- baseline: media key ----------
overlay default
say "Baseline: media PLAY key, process dead, no overlay permission"
if kill_app; then
	adb logcat -c
	adb shell cmd media_session dispatch play
	watch_play "media-key"
fi

# ---------- 1. routine picker ----------
say "Routine setup"
cat <<'EOF'
   On the phone: Modes & Routines → Routines → + → Then → Media → "Play music".
   Open its app picker.
EOF
if ask_yn "is OpenMusic listed in the app picker?"; then
	note "PASS  OpenMusic listed in the Routines 'Play music' app picker"
	echo "   Pick OpenMusic, save the routine with a manual trigger (e.g. 'Start manually')."
	pause "routine saved"
else
	note "FAIL  OpenMusic NOT in the Routines picker"
	adb shell cmd package query-services -a android.media.browse.MediaBrowserService >"$OUT/browser-services.txt"
	echo "   (saved the system's MediaBrowserService list to $OUT/browser-services.txt)"
fi

# ---------- 2. routine, cold, without then with overlay ----------
run_routine "routine-no-overlay"
if ! grep -q "PASS  routine-no-overlay" "$SUMMARY"; then
	overlay allow
	run_routine "routine-with-overlay"
	overlay default
fi

# ---------- optional: browser path without a routine ----------
cat <<'EOF'

Optional cross-check of the MediaBrowser path without Samsung's routine: install Google's
"Media Controller Test" app (github.com/googlesamples/android-media-controller releases),
kill OpenMusic, pick OpenMusic in it, tap Play. Same expectation: app starts and resumes.
EOF

say "Summary  ($SUMMARY)"
cat "$SUMMARY"
cat <<'EOF'

Reading it:
  - routine-no-overlay PASS            → fix verified; close the todo.
  - only routine-with-overlay PASS     → works but needs "Display over other apps":
                                         add an in-app prompt for that permission (UI → impeccable first).
  - both FAIL, media-key PASS          → the routine's browser connection gets no background-start
                                         allowance even with overlay; next step is the ExoPlayer-in-service
                                         upgrade path in the todo.
  - picker FAIL                        → Samsung filters on something beyond MediaBrowserService
                                         (check browser-services.txt; compare with YouTube Music's manifest).
EOF
