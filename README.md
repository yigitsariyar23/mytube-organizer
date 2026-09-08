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
   the pulled files and restarts the extension, then the dashboard reopens by
   itself (it's part of the extension, so the restart closes it). Dismissing the
   banner keeps it quiet until the *next* push.

### One-click updates (optional)

Step 3 can be a single button instead of a trip to the terminal. The extension
still can't run git — but it can ask a small helper on your machine to, which is
what `native-host/` is: a Chrome **native messaging host** that runs
`git pull --ff-only` in this checkout and nothing else. Install it once per
device:

```bash
bash native-host/install.sh
```

Then restart the browser (host manifests are read at startup) and reload the
extension. The update banner now shows **Pull & reload**, which pulls and
restarts in one click. Nothing else changes: without the helper the banner keeps
showing the copyable `git pull`, so devices you never set up keep working
exactly as before.

Details worth knowing:

- It needs `python3` and `git` on the machine, and it pulls **the checkout it
  lives in** — re-run the installer if you move the folder, since the registered
  manifest stores an absolute path.
- It registers with every Chromium-family browser it finds (Chrome, Chromium,
  Vivaldi, Brave, Edge, Opera, Arc, Yandex). If yours isn't found, the installer
  prints where it looked — point it at the directory holding your browser's
  `Default` profile folder: `bash native-host/install.sh --dir "/path/to/dir"`.
- `--ff-only` means it never merges: local commits or conflicting edits make it
  stop and show git's own message in the banner instead of leaving a half-merged
  tree behind.
- It never prompts for credentials (a private remote fails fast rather than
  hanging), and the browser will only start it for this extension's id — which
  the installer computes from the checkout path and prints, so you can compare
  it with `chrome://extensions` and re-run with `--id <id>` if it differs.
- `bash native-host/install.sh --uninstall` removes it.
- **On Windows**, run the same command from **Git Bash** (not WSL — it has to
  reach the Windows registry and the Windows browser install). Windows browsers
  look a host up in `HKCU\Software\<vendor>\NativeMessagingHosts` rather than in
  a profile directory, and they can't launch a `.py` on their own, so the
  installer also writes a small `.bat` next to the host and points the
  registration at that. Both files are generated per machine and gitignored.
  Compare the printed extension id with `chrome://extensions` here especially:
  the Windows id is hashed from the path in a different encoding, so if it
  doesn't match, re-run with `--id`.

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

- **Language** — choose from your active languages. Settings → General → Languages
  has a searchable offline catalog of 48 common languages, searchable by English
  name, native name, or code. Check the languages you want and Save; Cancel
  discards changes. The default/preset is Turkish, English, Russian, and French.
  Only active languages appear in row pickers, right-click menus, and filters.
  Deactivating one keeps existing assignments (shown as “Inactive”) without
  offering it as a choice. Right-click a multi-selection to set language in bulk.
- **Active** / **Finished** — two independent flags (a channel can be neither,
  either, or both). Click a chip to toggle it; it lights up when on. Use them to
  mark channels you're actively following versus ones you consider done.
- **Track** — feeds this channel's new uploads into the **Videos** view (see
  below). Toggling it on fetches that channel's recent videos right away. It has
  a filter chip of its own (**Tracked** / **Untracked**).
- **Tags** — the freeform labels described above.

All of these are **filterable**. The filter bar above the list shows, for the
current folder: each used tag, each used language (with its flag), and
**Active** / **Finished** / **Tracked** toggles (when any channel carries them).
**Tracked** is the quickest way to see which channels actually feed the Videos
view — right-click it for **Untracked** to find the ones being left out.

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

Four column headers sort: **Last Video**, **Videos**, **Subs** and **Folder**.
Each click cycles off → the column's natural first direction → the other one →
off. For the three numeric ones that first direction is "most/newest first"; for
**Folder** it's the sidebar's own top-to-bottom order (your custom folder order
included, not alphabetical).

Sorts **stack, and the column you clicked last becomes the primary key** — so a
click always visibly reorders the list, and the columns you set earlier fall in
behind it as tiebreakers. To get channels grouped by folder with the newest
upload at the top of each group, click **Last Video** first and **Folder**
second. When more than one column is sorting, each active header shows a rank
digit next to its arrow (`↑1`, `↓2`) so you can see which column is doing the
grouping. Every choice is remembered per device — sorting is never synced across
devices.

**Subs** shows the full subscriber count (`2,300`, not `2.3K`), so sorting by it
is meaningful down to the last subscriber. Channels that hide their count, or
that haven't been fetched with an API key yet, show `—` and sort last.

The list uses infinite scroll, rendering channels in batches of 40 as you
scroll.

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
- **Right-click** → Move to folder, Set language, Mark active / inactive, Mark
  finished / unfinished, Track videos, Fetch all videos, Delete channel. The
  Active and Finished entries are the same flags as the row's chips, so you can
  set them without aiming at a chip.

Channel and video titles are links: Tab to a title and press Enter to open it.
Channel flag buttons work with Space/Enter and expose their on/off state.
Within an open context menu, use arrow keys to move through items, Right Arrow to enter a submenu, and Escape to close it. Dialogs keep Tab
focus inside and return focus when closed. Filter chips accept Enter/Space;
Shift+Enter/Space selects the negative filter.

## Videos: New, Watch Later, and Removed

Opening a video in either view (left-click or middle-click) keeps its watched
status unchanged. Use **Mark watched** or **Mark all watched** to update it manually.

New and Watch Later sit at the top of the sidebar. **Removed videos** below
them is a searchable recovery view for videos dismissed from New. Choose
**Restore to New** on a card, or restore a selection from its actions menu.
Restored videos still follow the New view's tracking and watched filters.

Video edits offer **Undo** at the bottom of the dashboard, including bulk edits
and removing a Watch Later save. Undo retains any metadata fetched since the edit
and refuses to overwrite a later edit to the same video.

Video lists initially render 60 cards. **Load more** adds the next 60. Background
updates retain the loaded portion, unchanged cards, keyboard focus, and your scroll
position. Channel lists also retain their loaded portion during updates.

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
  capped afterward — the full history stays. Channels that can't be read are
  **named** in the result — a deleted or terminated channel reads "channel not
  found on YouTube", one with nothing public reads "no public uploads" — and
  they're skipped rather than marked as fetched, so a later retry still tries
  them.
- **RSS-powered, no quota for normal feeds.** Roughly the 15 latest per channel,
  no API key. A missing RSS feed can recover through the API when a key is set.
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
- **Watch & clean up.** Click a video to open it on YouTube;
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
in the background — use the small **↑ / ↓** buttons beside the sidebar logo
(hover for what each does), or
**⬆ Upload / ⬇ Download** in Settings (the same two operations; the sidebar pair
just saves the trip). Each runs a **directional** sync and shows a review screen
first: exactly what will be added, overwritten or removed, with removals
opt-out. Upload makes the Gist match this device; Download makes this device
match the Gist.

There used to be an automatic union merge on the 3-hour refresh, and it caused
exactly the problem you'd expect: open a device that had been sitting untouched
for a week and it pushed its stale library up before pulling anything down, so
the device that happened to sync first won. Now the order is yours to pick —
**Download first on a device that's behind**, then Upload once it's caught up.

Both directions still *merge* rather than clobber: new channels, folders, tags,
Watch Later lists and videos flow across; variables carry with each channel; and
fresher stats win. The only channels deleted are the ones you tick in the review
screen.

The review screen lists the channels, folders, lists, tags and settings that would
change. The **Videos** section leads with the counts, and a **"Show the N video
changes"** button expands one row per video — its title, channel, and what the
sync would do to it ("saved to Watch Later (Music)", "removed from Watch Later",
"marked watched", "new", or "will be dropped — its channel isn't tracked").
Every row is ticked; untick one and that video is left exactly as it is on this
side — for a row that would be *dropped*, unticking is how you keep it. So you
can take part of a sync and not the rest. Every video change can be reviewed,
in batches of 100 rows. The group checkbox applies to the entire set, including
rows you haven't expanded or loaded.

Only real settings travel with the library: your **API key** and your **language
set**. How you happen to be sorting or which view is open stays on each device.

The review includes **tag additions, renames, and color changes**. Selecting or
unselecting a channel removal recalculates the video changes it causes. Before
Apply, MyTube checks that both libraries still match the review; if either has
changed, it presents an updated review for you to confirm. Downloads save a local
recovery snapshot before changing the library.

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

## Refresh reliability

You can organize channels and videos while a refresh, playlist import, or metadata
fetch runs. Background work applies its metadata changes without overwriting your
folder moves, flags, saves, additions, or deletions.

A failed RSS or channel-stat request does not mark the channel freshly fetched.
The dashboard names failed channels and offers **Retry failed channels**. RSS
requests have timeouts and run six at a time. On opening, MyTube refreshes the
channels whose last successful refresh is older than three hours; one recently
refreshed channel no longer hides stale data elsewhere.

If a channel's RSS feed returns **HTTP 404**, MyTube uses your configured YouTube
API key to check it. A channel confirmed to have no public uploads counts as a
successful empty result; otherwise MyTube fetches its recent uploads through
the API. Channels that YouTube cannot find, or whose uploads still cannot be
read, remain named failures with guidance. Without an API key, the error points
to Settings so you can enable this recovery.

## Settings

Open with **⚙ Settings** in the sidebar footer. Settings has three tabs:
**General** for API access, sync, and languages; **Controls** for keyboard and
mouse preferences; and **Backups** for exports, snapshots, and recovery.

- **YouTube API** — the Data API v3 key, plus a **Fill Avatars** button that
  fetches only missing avatars (skips counts and RSS dates, so it's cheaper than
  a full refresh).
- **Cross-device sync** — the GitHub token and the Upload / Download buttons.
- **Local backups** — **Export JSON** downloads a portable backup of channels,
  videos, both folder trees, tags, and languages. API keys and GitHub tokens are
  excluded. **Import JSON** validates the file and previews collection counts
  before you confirm replacing this device's library. Imports accept MyTube
  backup format version 1, up to 50 MB.
- **Save snapshot** — saves a recovery copy on this device. The latest five
  snapshots are listed with their date, reason, and counts; choose **Restore**
  to recover one. Downloads, imports, restores, and clearing the library save a
  snapshot first. If saving the snapshot fails, the destructive operation stops.
  Local snapshots also preserve the YouTube API key; GitHub credentials and
  device preferences stay in place. Snapshots are never uploaded to the Gist.
- **Clear library** — clears channels, folders, tags, videos, and Watch Later
  lists after saving a recovery snapshot. Keeps your settings and Gist connection.
  Restore from **Local backups** if needed. Clearing and restoring are local
  operations; cross-device sync still requires its own review.

## Keyboard and mouse controls

Open **Settings → Controls**, or press **Shift + /** in the dashboard. Click any shortcut to record a replacement, **Clear** to disable it,
or **Reset defaults** to restore the original controls. Duplicate shortcuts and
common browser shortcuts are rejected. **Save** applies your changes; **Cancel**
discards them. Escape cancels a recording without closing Settings.

| Action | Default |
| --- | --- |
| Search the library | `/` |
| Channels / New videos / Watch Later / Removed videos | `1` / `2` / `3` / `4` |
| Open Settings | `,` |
| Open keyboard controls | `Shift + /` |
| Refresh channel stats | `Shift + R` |
| Undo the last video edit | `⌘ + Z` on Mac, `Ctrl + Z` elsewhere |
| Clear the current filters | `Shift + X` |

Shortcuts work inside the dashboard and pause while you're typing or using a
menu or dialog. You can turn all app shortcuts off and still use Tab, Enter,
Space, Escape, and arrow keys normally. Bindings follow physical keys, with US
keyboard labels; record the positions you prefer on another layout.

Controls also lets you choose **Ctrl/⌘-click** or **Alt/Option-click** for
multi-selection and turn scroll-wheel adjustments to number/date filters on or
off. Shift-click always selects a range. The **Everyday controls** reference
lists menu navigation, filter exclusion, and mouse actions.

Keyboard and mouse preferences stay on this device. They are excluded from
Gist sync and portable backups; importing or restoring a library keeps them.

The original layout and spacing are preserved. Visual polish is limited to
colors, icons, and subtle hover transitions and menu/dialog fades. Animations
turn off when your system requests reduced motion.

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
| Service worker | `background.js` | Message routing, scan diffing, stats refresh, Gist sync, the 3-hour alarm. Serializes all library writes, including field patches submitted by dashboard edits. |
| Dashboard | `dashboard/` | The single-page UI (`dashboard.html` / `.css` / `.js`). Renders from storage, reacts to `chrome.storage.onChanged`. |
| Content script | `content-scripts/scrape-subscriptions.js` | Runs only on `youtube.com/feed/channels`; scrapes channel links and posts a `SCAN_RESULT` message. |

See `CLAUDE.md` for the storage schema, message protocol and internal notes.

## Roadmap ideas (optional)

- Manual "add channel" (paste a channel ID/handle without waiting for a scan).
- Per-folder / per-tag "unread" counter.

## Development checks

Loading the extension still requires no build or package installation. With Node.js
22 or newer, run `npm test` for storage, refresh, sync, and backup regression tests,
and `npm run check` for syntax checks.

`npm run test:browser` serves a synthetic dashboard at
`http://127.0.0.1:8767/tests/dashboard`. Add `?smoke=1` to run the browser checks.
The fixture uses the real dashboard and worker modules with in-memory Chrome APIs,
2,000 synthetic videos, mocked network responses, and recorded test confirmations.
It has no access to the installed extension's library or real Gist. It is only
loaded by the development server, never by the extension.

The dashboard uses one consistent sans-serif font throughout, including form controls and Variables chips. Right-click folders, channels, or videos to open their action menus.

In New and Watch Later, click a channel name or avatar to open that channel’s Videos tab in a new tab. Playlist imports retain channel handle links and avoid borrowing names from neighboring videos or the playlist owner. Unknown channels stay unlinked; API details can correct older scraped names when an API key is configured.

Settings tabs share a consistent window size with scrolling content and fixed Save/Cancel controls. Playlist imports ignore thumbnail badges and durations when reading titles. Previously imported badge-only titles are repaired on the next video-details refresh when an API key is available.

## MyTube on iPhone and iPad

The standalone app bundles the interface and stores its library on each device.
It runs without a hosted site or a running Mac. Use YouTube or Vivaldi's Share menu
→ MyTube to queue a video locally; open MyTube to add it to Watch Later. Public or
unlisted playlist shares queue for import review and require a YouTube API key.
Copy/paste through **+ Save** is also available.

Run `npm run prepare:ios`, then open `ios/MyTube.xcodeproj` in Xcode to build for an
iPhone/iPad simulator or a signed physical device. Both app targets need the same
App Group and development team for device installation. See [iOS setup](ios/README.md)
for installation, signing, local backups, and testing instructions.

The app uses the extension's library logic, touch Actions menus, backups, and
optional reviewed Gist sync. To transfer data without cloud sync, export a JSON
backup on desktop, transfer it to Files on the device, and import it in Settings.
Export on iOS opens the native Share sheet for Save to Files. Every device owns
its own library; no automatic cross-device merge runs. Metadata, playlist imports,
and optional Gist operations need internet access. Saving and organizing locally
works without a hosted MyTube service.

For local web development only, run `npm run build` and `npm run dev:mobile` to
preview at `http://127.0.0.1:8770`. This preview is separate from the installed app.
No further cloud publishing is authorized.
