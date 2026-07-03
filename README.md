# MyTube Organizer

A personal YouTube subscription organizer — an alternative to PocketTube,
fully under your control, with no features locked behind a paywall.

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select this folder (`mytube-organizer/`).
4. Click the toolbar icon that appears → the dashboard opens in a new tab.

## First use

1. In the dashboard, click **"Scan Channels"** → YouTube's
   `youtube.com/feed/channels` page opens in a new tab, all the channels
   you're subscribed to are read automatically and imported into the dashboard
   (the page doesn't close itself; you can close it if you want).
2. (Optional but recommended) Enter a YouTube Data API v3 key in **⚙ Settings**.
   It's used to fetch video counts and subscriber counts. The extension works
   without a key too — only the "last video date" comes via RSS, and the video
   count stays empty.
3. Click **"Refresh Stats"** → video counts and last video dates are fetched.
   This also runs automatically in the background every 3 hours (`chrome.alarms`).

## How to get an API key

1. Create a new project at https://console.cloud.google.com.
2. Enable "YouTube Data API v3" under **APIs & Services → Library**.
3. **APIs & Services → Credentials → Create Credentials → API key**.
4. Optionally restrict the key to "YouTube Data API v3" (no need to touch
   Application restrictions — it's called from the extension context).

Quota: 10,000 units per day; one `channels.list` call covers 50 channel IDs
at once and costs 1 unit. Even with 500 channels, a full refresh is ~10 units —
a budget you'll never realistically exhaust with personal use.

## Folders and tags

- Each channel belongs to a single **folder** (change it via the dropdown on
  the card).
- You can add as many **tags** as you like to a channel (click the "+ tag" chip,
  type a new name or pick an existing one). The tag filters in the left menu
  work together with the selected folder — for example, while in the "Science"
  folder you can select the "English" tag to filter out the English-language
  channels in that folder.

## Cross-device sync (GitHub Gist)

All data lives in `chrome.storage.local` by default. To sync it between
devices, the extension can mirror your folders/tags/channels into a **secret
GitHub Gist** (free):

1. On github.com go to **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**, and grant only the
   **Gists** permission (read and write). Classic tokens with just the `gist`
   scope work too.
2. In the dashboard open **⚙ Settings**, paste the token into the GitHub
   token field, and click **Sync now**. The first sync creates the gist.
3. On every other device (works in any Chromium browser, including Vivaldi),
   install the extension, paste the **same token**, and click **Sync now** —
   the gist is found automatically by its filename (`mytube-organizer.json`).

Sync also runs automatically with the 3-hour background refresh. Syncing
*merges* both sides: new channels, folders, tags and tag assignments flow in
both directions, and fresher stats win. Deleting a folder/tag on one device
does not delete it on others (union merge) — remove it on each device, or
remove it again after a sync brings it back.

Notes: the gist is "secret" (not listed publicly, but anyone with its URL can
read it — it contains only channel names/IDs and your folder/tag structure,
never the API key or token). The token itself is stored in
`chrome.storage.local` on each device.

## What to do if the DOM breaks

The scraping logic lives only in `content-scripts/scrape-subscriptions.js` and
looks at the `youtube.com/feed/channels` page. It intentionally does NOT depend
on YouTube's renderer tag names (which change often): it scrolls until the page
stops growing, then collects every `/channel/UC…` and `/@handle` link inside the
main content area. `@handle`-only links are resolved to channel IDs in
`background.js` — via the Data API if a key is set, otherwise by fetching the
channel page and reading the canonical `UC…` id.

If a scan ever reports "no channels found", YouTube likely changed how channel
links are rendered — check `collectChannels()` / `parseChannelHref()` in the
content script. `dashboard/*` is independent of YouTube's DOM.

## Roadmap ideas (optional)

- Drag-and-drop to move channels between folders
- Per-folder/per-tag "unread" counter
- Manual "add channel" (paste a channel ID/handle without waiting for a scan)
