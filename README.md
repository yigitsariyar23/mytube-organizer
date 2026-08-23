# MyTube Organizer

A personal YouTube subscription organizer — an alternative to PocketTube,
fully under your control, with no features locked behind a paywall. Sort your
subscriptions into folders, tag them and set per-channel variables (language,
active/finished flags), see when each channel last uploaded and how many videos
it has, follow a **curated video feed** of new uploads from just the channels
you pick, and (optionally) sync everything across devices through a private
GitHub Gist.

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
   `youtube.com/feed/channels` page opens in a new tab with a floating bar in
   the bottom-right corner: **⬇** (jump to the bottom once), **⏬** (auto-scroll
   until the list stops growing), and **"📋 Scan channels"**.
2. Load every channel you're subscribed to, then click **"📋 Scan channels"**.
   YouTube lazy-loads channels as you near the bottom, so either tap **⬇**
   repeatedly (wait for each new batch to load between taps) or press **⏬** to
   auto-scroll to the end — the scroll helpers only load channels, they never
   scan, so you always trigger the scan yourself once the list is complete. The
   extension then reads the channels and opens the dashboard on a **review
   screen** listing what's new, what changed, and what wasn't seen this scan —
   nothing is imported until you click **Apply changes**. (Removals are
   unchecked by default; see [Scanning](#scanning-and-the-review-screen).)
3. (Optional but recommended) Enter a YouTube Data API v3 key in **⚙ Settings**.
   It's used for video counts, subscriber counts and channel avatars. The
   extension works without a key too — you just get the last-video date (via
   RSS) and whatever avatars the scan managed to capture.
4. Click **"Refresh Stats"** → video counts, subscriber counts, avatars and
   last-video dates are fetched. This also runs automatically in the background
   every 3 hours (`chrome.alarms`).

## Staying up to date

The extension is loaded unpacked from a git checkout, so updating it is
`git pull` — an extension can't run git, reach its own folder, or auto-update
itself outside the Chrome Web Store. What it *can* do is notice and get out of
your way:

1. Every time you open the dashboard it compares the build stamp in the local
   `version.json` with the one on `main` at GitHub.
2. If GitHub is ahead, a banner appears with the latest commit's subject and the
   command to run.
3. After `git pull`, click **Reload extension** in the banner — Chrome re-reads
   the pulled files and restarts the extension. Dismissing the banner keeps it
   quiet until the *next* push.

The stamp is written automatically by a commit hook. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Without it, `version.json` stops moving and the check simply never reports an
update (it never reports a false one).

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
- **Name / handle changes** — updated on apply; your folder, tags, variables
  and stats are preserved.
- **Not seen in this scan** — candidates for removal. These are **unchecked by
  default**, because an incomplete scan (you didn't scroll far enough, or a
  handle failed to resolve) can list channels you're still subscribed to. Tick
  only the ones you actually want gone — removing a channel also drops its
  folder, tags and variables.

If a scan reports "no channels found", YouTube likely changed how channel links
are rendered — see [What to do if the DOM breaks](#what-to-do-if-the-dom-breaks).

## Folders and tags

- Each channel lives in a single **folder**. Move it via the folder dropdown on
  its row, or right-click the row → **Move to folder**.
- The folder sidebar starts with two entries that aren't folders: **All**
  (everything) and **Filed** — the mirror image of **Unfiled**, showing every
  channel that *is* in a folder. Both sit alongside the real folders, count like
  them, and are just as usable in the New feed; in Watch Later the same pair
  scopes your saved videos to the ones already in a list.
  (**Unfiled** is the pinned home folder, named **Unsorted** in earlier
  versions — same folder, same contents, new label.)
- **Folders** support:
  - **Nesting** one level deep (a top-level folder can hold subfolders). Create
    a subfolder from the "New folder" dialog's parent selector or by
    right-clicking a top-level folder → **New subfolder…**.
  - **Drag and drop** (in "Custom" sort only): drop onto the middle of a
    top-level folder to nest inside it, or onto the top/bottom edge of a folder
    to reorder as a sibling.
  - A per-folder **emoji** (right-click the folder → **Set emoji…**). Clicking
    the emoji itself just opens the folder, like clicking its name.
  - **Sort** modes — Custom (manual order), A → Z, Count ↓, Count ↑ — chosen
    from the dropdown in the Folders header.
  - **Collapse/expand** of parents (click anywhere on the parent row — the
    caret shows the state), and a channel **count** that includes subfolders.
  - Rename / delete via right-click. Deleting a folder moves its channels to
    **Unfiled** and promotes any subfolders to top-level. "Unfiled" is pinned
    and can't be renamed, moved or deleted.
- **Tags** are freeform and multiple per channel. Click the **"+ tag"** chip on
  a row to open a dropdown of your existing tags (each with its color) — click
  one to add it, or click **"+ New tag"** to type a new name (Enter to create).
  Tags get a color automatically. A **filter bar** appears above the list with a
  chip per tag used by channels in the current folder (plus language and
  active/finished filters — see [Variables](#variables)); click chips to narrow
  the view (they combine with the selected folder). Left-clicking a tag chip on a
  channel row removes that tag from that channel. Rename or delete a tag by
  right-clicking it in the **filter bar**, or delete one everywhere via the
  **×** beside it in the "+ tag" dropdown.

## Variables

Each row's **Variables** cell holds per-channel attributes alongside its tags:

- **Language** — a dropdown of common languages, each shown with its **flag**.
  Pick **Other…** to type any custom value; it's remembered and shown as its own
  option afterwards. You can also **right-click a channel → Set language** to
  pick from the same list without touching the dropdown; that menu's **+ New
  language…** adds a language to the picker for every channel (the same set you
  can edit in Settings → Languages). Right-clicking a multi-selection sets the
  language on all of them at once. Flags are matched from the language name
  (native name, English name or ISO code — `Nederlands`, `Dutch` and `nl` all
  give 🇳🇱); an unrecognized name shows 🌐, and starting the name with an emoji
  forces that emoji instead.
- **Active** / **Finished** — two independent flags (a channel can be neither,
  either, or both). Click a chip to toggle it; it lights up when on. Use them to
  mark channels you're actively following versus ones you consider done.
- **Track** — feeds this channel's new uploads into the **Videos** view (see
  below). Toggling it on fetches that channel's recent videos right away.
- **Tags** — the freeform labels described above.

All of these are **filterable**. The filter bar above the list shows, for the
current folder: each used tag, each used language (with its flag), and **Active** / **Finished**
toggles (when any channel carries them).

Every chip has two sides: **left-click for "only these", right-click for "not
these"** — clicking the side it's already on switches it off. An excluded chip
keeps its color but is struck through. The same rule covers the **Unwatched**
chip in the video views: left-click for unwatched only, right-click for watched
only. (Tags are renamed/deleted with **shift**+right-click on their chip, since
plain right-click now filters.)

Tags and languages each combine as OR within their group, exclusions always win,
and every group AND's together (and with the selected folder). Switching folders
clears the filters.

When you **Refresh Stats**, any channel flagged **Active** or **Finished** that
has a **new video** since the last refresh triggers a desktop **notification**
listing them — so updates to the channels you track surface even if the
dashboard is closed. (This uses Chrome's `notifications` permission.)

## Browsing, filtering and sorting

The top bar filters the current view (all filters combine):

- **Search** by channel name or handle.
- **Min / Max videos** — bound the video count.
- **Last video after / before** — bound the most recent upload date (inclusive).
  The **year** is required; day and month are optional (default to the 1st). The
  year list only offers years your library actually reaches, newest first.

Every number field can be **dragged** left/right to change its value (like a
Unity inspector) or changed by **pointing at it and scrolling** (like the old
Football Manager spinners) — the native up/down arrows were a tiny target, so
they're hidden. Clicking still puts a caret in for typing; a drag only starts
once the pointer moves. Scrolling over the **year** dropdowns walks their
options the same way.

Each filter has an **×** to clear just it (the search box, the video-count pair,
and each date bound), and a **Clear filters** button at the end of the top bar
wipes every filter in the current view. They appear only while something is
actually set.

The top bar always says how much survived the filters — **"42 of 380 channels"**,
or just **"380 channels"** when nothing is filtered. The video views count the
same way. The total is what the selected folder or list holds, not the whole
library: picking a folder is navigation, not a filter.

**Last Video** dates are color-coded by how recent they are: **blue** for this
month and last month, **green** for the rest of the current year, **yellow** for
the two years before it, **orange** for the two before those, and **red** for
anything older. The buckets are computed from today's date, so they roll over on
their own each year; a channel with no known upload date stays uncolored.

Click the **Last Video** or **Videos** column headers to sort; each click
cycles none → descending → ascending, and the choice is remembered. The list
uses infinite scroll, rendering channels in batches of 40 as you scroll.

**Resize columns** by dragging the divider on the right edge of any column
header. Each column has a minimum width, and your widths are remembered. When
the **Last Video** column gets narrow, its dates switch to a compact numeric
`DD/MM/YY` form (e.g. `06/07/07`).

When no channel matches the current folder and filters, a **"No matching
channels"** panel appears with a **Clear filters** button (shown only when a
filter is actually active — an empty folder just says so).

Row interactions:

- **Left-click** a row (anywhere but a tag or dropdown) → opens the channel's
  Videos page in a new tab.
- **Middle-click** → opens it in a background tab without leaving the dashboard.
- **Right-click** → Move to folder / Delete channel.

## Videos: New and Watch Later

Two tabs at the top of the sidebar list videos, each for a different job.

### New

A curated feed of recent uploads — but only from the channels you flag with the
**Track** variable, not your whole subscription list. Built for when you follow
too many channels to keep up with YouTube's own subscriptions feed.

- **Pick your channels.** Turn on **Track** on any channel — its chip in the
  Variables cell, or right-click → **Track videos** (works on a multi-selection
  too). Latest uploads are fetched on the next **Refresh Stats** (or right away
  when you enable Track on a single channel).
- **Organized your way.** Reuses your channel **folder sidebar** — select a
  folder to see only its tracked channels' videos, grouped by day. **Sort** by
  date or length (each click toggles ascending/descending). The New feed shows
  **only unwatched** videos by default — toggle the **Unwatched** chip off to see
  everything, or **Mark all watched** to clear what you've seen. (Watch Later
  shows all saved videos by default.)
- **Length & views.** Each card shows the video's view count; with an API key set
  it also shows the **duration** (length isn't available from the free RSS feed).
  Lengths fetch automatically when you open a video view with a key set.
- **Remove & no live streams.** Hit **Remove** on a card to dismiss a video from
  the feed — it won't come back on the next refresh. Live streams and scheduled
  premieres are filtered out automatically (they're not finished videos); an API
  key makes this detection reliable.
- **Fetch the full back catalog.** A normal refresh only sees each channel's
  latest ~15 uploads (YouTube's RSS limit). To pull a channel's **entire** upload
  history, right-click it → **Fetch all videos** (or select several), or use
  **Fetch full history** in the New toolbar for every tracked channel. This needs
  an API key and can use notable quota for very large channels, but it isn't
  capped afterward — the full history stays.
- **RSS-powered, no quota.** Roughly the 15 latest per channel, no API key.
- **Why not YouTube's algorithm?** No API exposes YouTube's personalized ranking
  for a subset of channels, so this feed is **chronological**. Every video opens
  on youtube.com, so YouTube's own algorithm still drives your actual watch
  session (autoplay, up-next) — you're just curating which uploads reach you.

### Watch Later

A place to save individual videos and **organize them into nested lists**, just
like channels have folders (parent lists, sub-lists, drag-to-reorder, emoji,
rename/delete). Independent of the New feed.

- **Add a video by right-clicking it on YouTube.** On any YouTube page,
  right-click a video (or the watch page itself) → **“Save to MyTube Watch
  Later.”** The extension grabs the video and fetches its title automatically —
  no copy-pasting URLs, no API key. A notification confirms the save.
- **Import a whole playlist.** Right-click a YouTube playlist page (or a playlist
  link) → **“Import playlist to MyTube Watch Later.”** MyTube reads the playlist
  straight from the page — auto-scrolling to the bottom to load every video — so it
  works for your **private, unlisted, and public** playlists alike, with **no API
  key needed**. It then opens a review dialog where you name the new list (prefilled
  with the playlist’s name) and — for any video you’ve already saved elsewhere —
  choose whether to move it in. If it captured fewer videos than the playlist lists
  (a very long playlist that didn’t finish loading), it warns you to re-run.
  Confirm, and every video lands in a fresh list named after the playlist.
- **Organize into lists.** Saved videos start in **Unfiled**. Create lists with
  **+ New list**, nest them one level deep, and right-click a video → **Move to
  list**. Right-click a list to rename, set an emoji, add a sub-list, or delete.
- **Watch & clean up.** Click a video to open it on YouTube (marked **watched**);
  **Remove** takes it out of Watch Later. The **Sort** (date/length), **Unwatched**
  chip, and **Mark all watched** controls work here too. View count shows on each
  card; duration shows when an API key is set.

## Cross-device sync (GitHub Gist)

All data lives in `chrome.storage.local` by default. To sync it between
devices, the extension mirrors **everything** — channels, folders, tags, your
**Watch Later lists**, and the whole **video library** (saved/watched/dismissed
state and all) — into a **secret GitHub Gist** (free):

1. On github.com go to **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**, and grant only the
   **Gists** permission (read and write). Classic tokens with just the `gist`
   scope work too.
2. In the dashboard open **⚙ Settings**, paste the token into the GitHub token
   field, then hit **⬆ Upload** — the first upload creates the gist for you.
3. On every other device, install the extension, paste the **same token** and
   hit **⬇ Download** — the gist is found by its filename
   (`mytube-organizer.json`), so that's the whole setup.

**Syncing is always something you ask for.** Nothing is uploaded or downloaded
in the background — use **⬆ Upload / ⬇ Download** in Settings. Each runs a
**directional** sync and shows a review screen first: exactly what will be added,
overwritten or removed, with removals opt-out. Upload makes the Gist match this
device; Download makes this device match the Gist.

There used to be an automatic union merge on the 3-hour refresh, and it caused
exactly the problem you'd expect: open a device that had been sitting untouched
for a week and it pushed its stale library up before pulling anything down, so
the device that happened to sync first won. Now the order is yours to pick —
**Download first on a device that's behind**, then Upload once it's caught up.

Both directions still *merge* rather than clobber: new channels, folders, tags,
Watch Later lists and videos flow across; variables carry with each channel; and
fresher stats win. The only channels deleted are the ones you tick in the review
screen.

The review screen lists the channels, folders, lists and settings that would
change. The **Videos** section leads with the counts, and a **"Show the N video
changes"** button expands one row per video — its title, channel, and what the
sync would do to it ("saved to Watch Later (Music)", "removed from Watch Later",
"marked watched", "new", or "will be dropped — its channel isn't tracked").
Every row is ticked; untick one and that video is left exactly as it is on this
side — for a row that would be *dropped*, unticking is how you keep it. So you
can take part of a sync and not the rest. (Very large syncs list the first 500
changes; the rest still apply.)

Only real settings travel with the library: your **API key** and your **language
set**. How you happen to be sorting or which view is open stays on each device.

**Opening the dashboard checks the gist for you.** If another device pushed
something up, the same **Review download** screen opens by itself — so a device
you haven't used in a while tells you there's work waiting instead of quietly
falling behind. It's only a look: nothing is written until you press *Apply
download*, and you can close the review and carry on. The check is skipped if
you haven't set a token, if another review is already open, and for ten minutes
after the last one, so reopening the dashboard doesn't hammer GitHub. A check
that fails (offline, bad token) stays quiet — use the Download button in
Settings to see the actual error.

Per-video state — **watched**, **saved to Watch Later**, **dismissed**, and which
list a video is in — is resolved by **whichever device changed it last**, so
*undoing* something travels just like doing it: remove a video from Watch Later
on one device and it's gone on the other after a sync, instead of reappearing.
(Removals are remembered for 90 days, which is how long the video keeps a record
saying it's no longer saved; after that it's simply forgotten.)

Notes: the gist is "secret" (unlisted, but anyone with the URL can read it, and
it does include your **API key** — but never the GitHub token, which stays only
in `chrome.storage.local` on each device). The whole library goes in, including
the New-feed cache and anything pulled by "Fetch full history", so a second
device inherits the full picture rather than rebuilding it. If your library ever
grows past what the Gist API can serve back (10 MB), the sync stops with a
message asking you to untrack a channel or two instead of writing a gist it
couldn't read again.

## Settings

Open with **⚙ Settings** in the sidebar footer:

- **YouTube API** — the Data API v3 key, plus a **Fill Avatars** button that
  fetches only missing avatars (skips counts and RSS dates, so it's cheaper than
  a full refresh).
- **Cross-device sync** — the GitHub token and the Upload / Download buttons.
- **Clear all data** — wipes channels, folders and tags, and disconnects Gist
  sync (clears the saved gist id and last-sync time). Keeps your API key, GitHub
  token and UI preferences. This cannot be undone.

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

- Manual "add channel" (paste a channel ID/handle without waiting for a scan).
- Per-folder / per-tag "unread" counter.
