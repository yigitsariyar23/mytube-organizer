#!/usr/bin/env bash
# Register the updater with every Chromium-family browser on this machine, so
# the dashboard's update banner can run `git pull` here instead of only printing
# it. One-time, per device. Re-run it if you move this checkout — what gets
# registered is an absolute path.
#
#   ./native-host/install.sh                install
#   ./native-host/install.sh --uninstall    remove
#   ./native-host/install.sh --dir <path>   a browser this script doesn't know
#   ./native-host/install.sh --id <id>      an extension id it computed wrong
#
# Runs on macOS, Linux, and Windows through Git Bash. Nothing here needs admin
# rights: every path is under the user's own profile, every registry write is
# under HKCU.
set -euo pipefail

HOST_NAME="com.mytube.organizer.updater"
HOST_DESC="Pulls MyTube Organizer updates for the checkout it lives in"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/mytube-updater.py"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# python3 on Unix; on Windows it's usually `py -3` or plain `python`.
if command -v python3 >/dev/null 2>&1; then PY="python3"
elif command -v py >/dev/null 2>&1; then PY="py -3"
elif command -v python >/dev/null 2>&1; then PY="python"
else echo "Python 3 is required but was not found." >&2; exit 1
fi

# An unpacked extension's id is derived from the absolute path it loads from:
# sha256 of the path, first 128 bits, hex digits mapped 0-9a-f -> a-p. Computing
# it here is why manifest.json carries no "key": pinning the id looks tidy, but
# adding a key *changes* the id, and the browser then treats it as a different
# extension with an empty chrome.storage — i.e. the whole library gone. The id
# is a per-device fact, so it belongs on the device, not in the manifest.
#
# The browser hashes the path in its native form, which on Windows means the
# UTF-16 bytes of a backslashed path — hence the encoding argument, and hence
# --id for when this guess doesn't match what chrome://extensions shows.
compute_extension_id() {
  $PY - "$1" "$2" <<'PY'
import hashlib, sys
digest = hashlib.sha256(sys.argv[1].encode(sys.argv[2])).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
PY
}

# Where a browser looks for a host manifest differs by platform: a directory in
# the profile on Unix, a registry value on Windows. Both lists are generous —
# a browser that isn't named here looks exactly like a failed install, and an
# entry for a browser that isn't installed is simply never read.
case "$(uname -s)" in
  Darwin)
    PLATFORM="unix"
    SUPPORT="$HOME/Library/Application Support"
    BROWSER_DIRS=(
      "$SUPPORT/Google/Chrome"
      "$SUPPORT/Google/Chrome Beta"
      "$SUPPORT/Google/Chrome Dev"
      "$SUPPORT/Google/Chrome Canary"
      "$SUPPORT/Chromium"
      "$SUPPORT/Vivaldi"
      "$SUPPORT/BraveSoftware/Brave-Browser"
      "$SUPPORT/Microsoft Edge"
      "$SUPPORT/com.operasoftware.Opera"
      "$SUPPORT/com.operasoftware.OperaGX"
      "$SUPPORT/Yandex/YandexBrowser"
      "$SUPPORT/Arc/User Data"
      "$SUPPORT/DiaBrowser"
    )
    ;;
  Linux)
    PLATFORM="unix"
    CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
    BROWSER_DIRS=(
      "$CONFIG/google-chrome"
      "$CONFIG/google-chrome-beta"
      "$CONFIG/chromium"
      "$CONFIG/vivaldi"
      "$CONFIG/BraveSoftware/Brave-Browser"
      "$CONFIG/microsoft-edge"
      "$CONFIG/opera"
      "$CONFIG/yandex-browser"
    )
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM="windows"
    WIN_VENDORS=(
      'Google\Chrome'
      'Chromium'
      'Vivaldi'
      'BraveSoftware\Brave-Browser'
      'Microsoft\Edge'
      'Yandex\YandexBrowser'
    )
    ;;
  *)
    echo "Unsupported platform: $(uname -s)." >&2
    exit 1
    ;;
esac

# Git Bash rewrites any argument that looks like a Unix path before handing it to
# a Windows program, which turns reg.exe's /ve /t /d /f switches into
# "C:/Program Files/Git/ve" and friends — reg answers "Invalid syntax" and the
# install fails on a machine where everything is actually fine. These two
# variables are the documented way to turn that off, and they're scoped to the
# call so nothing else in the script changes behavior.
reg_cmd() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' reg "$@"
}

# Escape hatch for a browser profile this script doesn't know about: point it at
# the directory that holds the browser's "Default" profile folder. (Unix only —
# on Windows the lookup is a registry key, not a path.)
if [[ "${1:-}" == "--dir" ]]; then
  [[ -n "${2:-}" ]] || { echo "--dir needs a path." >&2; exit 1; }
  [[ "$PLATFORM" == "unix" ]] || { echo "--dir is meaningless on Windows: browsers look the host up in the registry." >&2; exit 1; }
  BROWSER_DIRS=("$2")
  shift 2
fi

# …and for an id the path hash gets wrong (the extension was loaded through a
# symlink, a different mount, another checkout). Copy it from chrome://extensions.
EXTENSION_ID=""
if [[ "${1:-}" == "--id" ]]; then
  [[ -n "${2:-}" ]] || { echo "--id needs an extension id." >&2; exit 1; }
  EXTENSION_ID="$2"
  shift 2
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  removed=0
  if [[ "$PLATFORM" == "windows" ]]; then
    for vendor in "${WIN_VENDORS[@]}"; do
      key="HKCU\\Software\\$vendor\\NativeMessagingHosts\\$HOST_NAME"
      if reg_cmd query "$key" >/dev/null 2>&1; then
        reg_cmd delete "$key" /f >/dev/null
        echo "removed  $key"
        removed=$((removed + 1))
      fi
    done
    rm -f "$SCRIPT_DIR/$HOST_NAME.json" "$SCRIPT_DIR/mytube-updater.bat"
    echo "Removed $removed registry key(s)."
  else
    for dir in "${BROWSER_DIRS[@]}"; do
      target="$dir/NativeMessagingHosts/$HOST_NAME.json"
      if [[ -f "$target" ]]; then rm -f "$target"; echo "removed  $target"; removed=$((removed + 1)); fi
    done
    echo "Removed $removed host manifest(s)."
  fi
  exit 0
fi

if [[ ! -f "$HOST_PATH" ]]; then
  echo "Host script not found at $HOST_PATH" >&2
  exit 1
fi

installed=0

if [[ "$PLATFORM" == "windows" ]]; then
  command -v reg >/dev/null 2>&1 || { echo "reg.exe was not found — run this from Git Bash, not WSL." >&2; exit 1; }
  win_path() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || printf '%s' "$1"; }

  # Windows can't launch a .py the way Unix can (no shebang), so the manifest
  # points at a .bat that hands stdio straight to Python. Generated here rather
  # than committed: which Python launcher exists is a per-machine fact.
  BAT_PATH="$SCRIPT_DIR/mytube-updater.bat"
  printf '@echo off\r\n%s "%%~dp0mytube-updater.py"\r\n' "$PY" > "$BAT_PATH"

  [[ -n "$EXTENSION_ID" ]] || EXTENSION_ID="$(compute_extension_id "$(win_path "$REPO_DIR")" "utf-16-le")"

  # The registry value is a path to a manifest *file*, so unlike Unix there is
  # one manifest, kept beside the host it describes.
  MANIFEST_PATH="$SCRIPT_DIR/$HOST_NAME.json"
  bat_win="$(win_path "$BAT_PATH")"
  cat > "$MANIFEST_PATH" <<JSON
{
  "name": "$HOST_NAME",
  "description": "$HOST_DESC",
  "path": "${bat_win//\\/\\\\}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
JSON

  manifest_win="$(win_path "$MANIFEST_PATH")"
  for vendor in "${WIN_VENDORS[@]}"; do
    key="HKCU\\Software\\$vendor\\NativeMessagingHosts\\$HOST_NAME"
    reg_cmd add "$key" /ve /t REG_SZ /d "$manifest_win" /f >/dev/null
    echo "registered  $key"
    installed=$((installed + 1))
  done
else
  chmod +x "$HOST_PATH"
  [[ -n "$EXTENSION_ID" ]] || EXTENSION_ID="$(compute_extension_id "$REPO_DIR" "utf-8")"

  for dir in "${BROWSER_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue   # that browser isn't installed here
    target_dir="$dir/NativeMessagingHosts"
    mkdir -p "$target_dir"
    cat > "$target_dir/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "$HOST_DESC",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
JSON
    echo "installed  $target_dir/$HOST_NAME.json"
    installed=$((installed + 1))
  done

  if [[ $installed -eq 0 ]]; then
    {
      echo "No Chromium-family browser profile found — nothing installed."
      echo "Looked in:"
      printf '  %s\n' "${BROWSER_DIRS[@]}"
      echo
      echo "If your browser isn't listed, find the directory holding its \"Default\""
      echo "profile folder and pass it directly:"
      echo "  bash native-host/install.sh --dir \"/path/to/that/directory\""
    } >&2
    exit 1
  fi
fi

echo
echo "Installed for $installed browser(s)."
echo "  host script : $HOST_PATH"
echo "  repo pulled : $REPO_DIR"
echo "  extension id: $EXTENSION_ID"
echo
echo "Check that id against chrome://extensions — the browser only starts the"
echo "host for an id listed in the manifest. If it differs, re-run with:"
echo "  bash native-host/install.sh --id <the id shown there>"
echo
echo "Now restart the browser (it reads host manifests at startup), then reload"
echo "the extension. The update banner will show a “Pull & reload” button."
