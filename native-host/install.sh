#!/usr/bin/env bash
# Register the updater with every Chromium-family browser on this machine, so
# the dashboard's update banner can run `git pull` here instead of only printing
# it. One-time, per device. Re-run it if you move this checkout — the host
# manifest stores an absolute path.
#
#   ./native-host/install.sh                install
#   ./native-host/install.sh --uninstall    remove
#   ./native-host/install.sh --dir <path>   a browser this script doesn't know
#   ./native-host/install.sh --id <id>      an extension id it computed wrong
#
# Nothing here needs root: every path is under the user's own profile directory.
set -euo pipefail

HOST_NAME="com.mytube.organizer.updater"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/mytube-updater.py"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# An unpacked extension's id is derived from the absolute path it loads from:
# sha256 of the path, first 128 bits, hex digits mapped 0-9a-f -> a-p. Computing
# it here is why manifest.json carries no "key": pinning the id looks tidy, but
# adding a key *changes* the id, and the browser then treats it as a different
# extension with an empty chrome.storage — i.e. the whole library gone. The id
# is a per-device fact, so it belongs on the device, not in the manifest.
compute_extension_id() {
  python3 - "$1" <<'PY'
import hashlib, sys
digest = hashlib.sha256(sys.argv[1].encode("utf-8")).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
PY
}

# Every Chromium-family browser reads host manifests from its own profile dir.
# Missing ones are simply skipped, so this list can be generous — and it has to
# be: "Chromium-family" is a much longer list than Chrome, and a browser that
# isn't named here looks exactly like a failed install. --dir covers the rest.
case "$(uname -s)" in
  Darwin)
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
  *)
    echo "Unsupported platform: $(uname -s). On Windows the host manifest goes in the registry — see README." >&2
    exit 1
    ;;
esac

# Escape hatch for a browser profile this script doesn't know about: point it at
# the directory that holds the browser's "Default" profile folder.
if [[ "${1:-}" == "--dir" ]]; then
  [[ -n "${2:-}" ]] || { echo "--dir needs a path." >&2; exit 1; }
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
  for dir in "${BROWSER_DIRS[@]}"; do
    target="$dir/NativeMessagingHosts/$HOST_NAME.json"
    if [[ -f "$target" ]]; then rm -f "$target"; echo "removed  $target"; removed=$((removed + 1)); fi
  done
  echo "Removed $removed host manifest(s)."
  exit 0
fi

if [[ ! -f "$HOST_PATH" ]]; then
  echo "Host script not found at $HOST_PATH" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "python3 is required but was not found." >&2; exit 1; }
chmod +x "$HOST_PATH"

[[ -n "$EXTENSION_ID" ]] || EXTENSION_ID="$(compute_extension_id "$REPO_DIR")"

installed=0
for dir in "${BROWSER_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue   # that browser isn't installed here
  target_dir="$dir/NativeMessagingHosts"
  mkdir -p "$target_dir"
  cat > "$target_dir/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Pulls MyTube Organizer updates for the checkout it lives in",
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
