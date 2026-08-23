#!/usr/bin/env bash
# Register the updater with every Chromium-family browser on this machine, so
# the dashboard's update banner can run `git pull` here instead of only printing
# it. One-time, per device. Re-run it if you move this checkout — the host
# manifest stores an absolute path.
#
#   ./native-host/install.sh              install
#   ./native-host/install.sh --uninstall  remove
#
# Nothing here needs root: every path is under the user's own profile directory.
set -euo pipefail

HOST_NAME="com.mytube.organizer.updater"
# Pinned by the "key" field in manifest.json, so it is the same on every device.
EXTENSION_ID="nmjeaoicpdnpchbmelabnpnclhgmmlkc"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/mytube-updater.py"

# Every Chromium-family browser reads host manifests from its own profile dir.
# Missing ones are simply skipped, so this list can be generous.
case "$(uname -s)" in
  Darwin)
    SUPPORT="$HOME/Library/Application Support"
    BROWSER_DIRS=(
      "$SUPPORT/Google/Chrome"
      "$SUPPORT/Google/Chrome Beta"
      "$SUPPORT/Google/Chrome Canary"
      "$SUPPORT/Chromium"
      "$SUPPORT/BraveSoftware/Brave-Browser"
      "$SUPPORT/Microsoft Edge"
      "$SUPPORT/Arc/User Data"
    )
    ;;
  Linux)
    CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
    BROWSER_DIRS=(
      "$CONFIG/google-chrome"
      "$CONFIG/google-chrome-beta"
      "$CONFIG/chromium"
      "$CONFIG/BraveSoftware/Brave-Browser"
      "$CONFIG/microsoft-edge"
    )
    ;;
  *)
    echo "Unsupported platform: $(uname -s). On Windows the host manifest goes in the registry — see README." >&2
    exit 1
    ;;
esac

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
  echo "No Chromium-family browser profile found — nothing installed." >&2
  exit 1
fi

echo
echo "Installed for $installed browser(s), pointing at:"
echo "  $HOST_PATH"
echo "Repo it will pull: $(cd "$SCRIPT_DIR/.." && pwd)"
echo
echo "Now restart the browser (it reads host manifests at startup), then reload"
echo "the extension. The update banner will show a “Pull & reload” button."
