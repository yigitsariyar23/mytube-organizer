# MyTube Organizer

A personal YouTube subscription organizer — an alternative to PocketTube,
fully under your control, with no features locked behind a paywall. Sort your
subscriptions into folders and tags, see when each channel last uploaded and
how many videos it has, and (optionally) sync everything across devices through
a private GitHub Gist.

It's a Manifest V3 Chrome extension with no build step and no backend: a
service worker, a single dashboard page, and one content script.

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select this folder (`mytube-organizer/`).
4. Click the toolbar icon that appears → the dashboard opens in a new tab.
   (Pin it for easy access.)

Works in any Chromium browser — Chrome, Edge, Brave, Vivaldi.

## First use

1. In the dashboard, click **"Scan Channels"**. YouTube's
   `youtube.com/feed/channels` page opens in a new tab with a floating
   **"📋 Scan channels"** button in the bottom-right corner.
2. Scroll the page down until every channel you're subscribed to has loaded,
   then click that button. The extension reads the channels and opens the
   dashboard on a **review screen** listing what's new, what changed, and what
   wasn't seen this scan — nothing is imported until you click **Apply
   changes**. (Removals are unchecked by default; see [Scanning](#scanning-and-the-review-screen).)
3. (Optional but recommended) Enter a YouTube Data API v3 key in **⚙ Settings**.
   It's used for video counts, subscriber counts and channel avatars. The
   extension works without a key too — you just get the last-video date (via
   RSS) and whatever avatars the scan managed to capture.
4. Click **"Refresh Stats"** → video counts, avatars and last-video dates are
   fetched. This also runs automatically in the background every 3 hours
   (`chrome.alarms`).

## How to get an API key

1. Create a new project at https://console.cloud.google.com.
2. Enable "YouTube Data API v3" under **APIs & Services → Library**.
3. **APIs & Services → Credentials → Create Credentials → API key**.
4. Optionally restrict the key to "YouTube Data API v3" (no need to touch
   Application restrictions — it's called from the extension context).

Quota: 10,000 units per day; one `channels.list` call covers 50 channel IDs
at once and costs 1 unit. Even with 500 channels, a full refresh is ~10 units —
a budget you'll never realistically exhaust with personal use.

## Scanning and the review screen

Scanning never writes to your library directly. A scan resolves every scraped
entry to a channel ID, diffs it against what you already have, and shows the
result for review:

- **New channels** — added on apply.
- **Name / handle changes** — updated on apply; your folder, tags and stats are
  preserved.
- **Not seen in this scan** — candidates for removal. These are **unchecked by
  default**, because an incomplete scan (you didn't scroll far enough, or a
  handle failed to resolve) can list channels you're still subscribed to. Tick
  only the ones you actually want gone — removing a channel also drops its
  folder and tags.

If a scan reports "no channels found", YouTube likely changed how channel links
are rendered — see [What to do if the DOM breaks](#what-to-do-if-the-dom-breaks).

## Folders and tags

- Each channel lives in a single **folder**. Move it via the folder dropdown on
  its row, or right-click the row → **Move to folder**.
- **Folders** support:
  - **Nesting** one level deep (a top-level folder can hold subfolders). Create
    a subfolder from the "New folder" dialog's parent selector or by
    right-clicking a top-level folder → **New subfolder…**.
  - **Drag and drop** (in "Custom" sort only): drop onto the middle of a
    top-level folder to nest inside it, or onto the top/bottom edge of a folder
    to reorder as a sibling.
  - A per-folder **emoji** (click the `+` slot next to the name).
  - **Sort** modes — Custom (manual order), A → Z, Count ↓, Count ↑ — chosen
    from the dropdown in the Folders header.
  - **Collapse/expand** of parents (click the caret), and a channel **count**
    that includes subfolders.
  - Rename / delete via right-click. Deleting a folder moves its channels to
    **Unsorted** and promotes any subfolders to top-level. "Unsorted" is pinned
    and can't be renamed, moved or deleted.
- **Tags** are freeform and multiple per channel. Click the **"+ tag"** chip on
  a row, then type a new name or pick an existing one (autocomplete). Tags get a
  color automatically. A tag **filter bar** appears above the list showing only
  the tags used by channels in the current folder; click chips to narrow the
  view (they combine with the selected folder). Rename / delete a tag by
  right-clicking its chip.

## Browsing, filtering and sorting

The top bar filters the current view (all filters combine):

- **Search** by channel name or handle.
- **Min / Max videos** — bound the video count.
- **Last video after / before** — bound the most recent upload date (day / month
  / year, each part optional).

Click the **Last Video** or **Videos** column headers to sort; each click
cycles none → descending → ascending, and the choice is remembered. The list
uses infinite scroll, rendering channels in batches of 40 as you scroll.

Row interactions:

- **Left-click** a row (anywhere but a tag or dropdown) → opens the channel's
  Videos page in a new tab.
- **Middle-click** → opens it in a background tab without leaving the dashboard.
- **Right-click** → Move to folder / Delete channel.

## Cross-device sync (GitHub Gist)

All data lives in `chrome.storage.local` by default. To sync it between
devices, the extension mirrors your folders/tags/channels into a **secret
GitHub Gist** (free):

1. On github.com go to **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**, and grant only the
   **Gists** permission (read and write). Classic tokens with just the `gist`
   scope work too.
2. In the dashboard open **⚙ Settings**, paste the token into the GitHub token
   field. The first sync creates the gist automatically.
3. On every other device, install the extension, paste the **same token** —
   the gist is found by its filename (`mytube-organizer.json`), so that's the
   whole setup.

Two ways to sync:

- **⬆ Upload / ⬇ Download** (in Settings) run a **directional** sync and show a
  review screen first: exactly what will be added, overwritten or removed, with
  removals opt-out. Upload makes the Gist match this device; Download makes this
  device match the Gist.
- The **3-hour background refresh** also runs an automatic **union merge** (no
  review): new channels, folders, tags and tag assignments flow both ways, and
  fresher stats win. Deletions do **not** propagate through the background merge
  — remove an item on each device, or use a directional Upload/Download to make
  a deletion stick.

Notes: the gist is "secret" (unlisted, but anyone with the URL can read it — it
holds only channel names/IDs and your folder/tag structure, never the API key
or token). The token is stored in `chrome.storage.local` on each device.

## Settings

Open with **⚙ Settings** in the sidebar footer:

- **YouTube API** — the Data API v3 key, plus a **Fill Avatars** button that
  fetches only missing avatars (skips counts and RSS dates, so it's cheaper than
  a full refresh).
- **Cross-device sync** — the GitHub token and the Upload / Download buttons.
- **Clear all data** — wipes channels, folders and tags (keeps your API key and
  token). This cannot be undone.

## What to do if the DOM breaks

The scraping logic lives only in `content-scripts/scrape-subscriptions.js` and
looks at the `youtube.com/feed/channels` page. It intentionally does NOT depend
on YouTube's renderer tag names (which change often): it collects every
`/channel/UC…` and `/@handle` link inside the main content area
(`ytd-browse`). `@handle`-only links are resolved to channel IDs in
`background.js` — via the Data API if a key is set, otherwise by fetching the
channel page and reading the canonical `UC…` id.

If a scan ever reports "no channels found", check `collectChannels()` /
`parseChannelHref()` in the content script. `dashboard/*` is independent of
YouTube's DOM.

## Architecture

| Piece | File | Role |
| --- | --- | --- |
| Service worker | `background.js` | Message routing, scan diffing, stats refresh, Gist sync, the 3-hour alarm. Owns all `chrome.storage.local` writes for cross-cutting operations. |
| Dashboard | `dashboard/` | The single-page UI (`dashboard.html` / `.css` / `.js`). Renders from storage, reacts to `chrome.storage.onChanged`. |
| Content script | `content-scripts/scrape-subscriptions.js` | Runs only on `youtube.com/feed/channels`; scrapes channel links and posts a `SCAN_RESULT` message. |

See `CLAUDE.md` for the storage schema, message protocol and internal notes.

## Roadmap ideas (optional)

- A "no results" state when filters exclude every channel.
- Manual "add channel" (paste a channel ID/handle without waiting for a scan).
- Per-folder / per-tag "unread" counter.
