# CLAUDE.md

Internal reference for MyTube Organizer. User-facing docs live in `README.md`;
this file is the map for working *on* the code.

## What it is

A Manifest V3 Chrome extension that organizes YouTube subscriptions into
folders and tags. No build step, no bundler, no framework, no backend — plain
ES modules and vanilla DOM. Load it unpacked from this directory.

## Layout

```
manifest.json                         MV3 manifest (module service worker + one content script)
background.js                         service worker: message hub, scan diff, stats, Gist sync, alarm
dashboard/
  dashboard.html                      the whole UI (dashboard page + all modals + context menus)
  dashboard.css                       theme tokens in :root, all styling
  dashboard.js                        UI logic: render, filter/sort, folders/tags, dialogs, events
content-scripts/
  scrape-subscriptions.js             runs only on youtube.com/feed/channels; scrapes channel links
icons/                                EMPTY — no packaged icon (manifest icon keys commented out)
check-missing.sh, csv-ids.txt,        one-off dev utilities / personal data dumps (see "Cruft")
  scraped-ids.txt
```

There are three independent surfaces — the service worker, the dashboard page,
and the content script — that only talk through `chrome.runtime` messages and
shared `chrome.storage.local`. Keep that boundary: the dashboard never touches
YouTube's DOM, and the content script never touches storage.

## Storage schema (`chrome.storage.local`)

```
channels: { [channelId]: {
  id, name, handle, thumbnail,
  folderId,                 // "unsorted" by default; a leaf folder id otherwise
  tags: [tagId, ...],       // free-form multi-value labels
  language,                 // string | null — the "Variables" cell language dropdown
  active,                   // bool — user flag: a channel you're following
  finished,                 // bool — user flag: a channel you consider done
  trackVideos,              // bool — user flag: feed this channel's uploads into the New videos tab
  fetchedAll,               // bool — full upload history was API-fetched; exempts the channel from the video cap
  lastVideoDate,            // ISO string, from the RSS feed
  videoCount,               // number | null (null until fetched with an API key)
  subscriberCount,          // number | null (null if hidden or not yet fetched); shown in the list
  lastFetched,              // epoch ms of the last stats refresh (drives merge freshness)
} }
folders: { [folderId]: { name, order, parentId?, emoji? } }   // channel folders; "unsorted" pinned
tags:    { [tagId]: { name, color } }
videoFolders: { [folderId]: { name, order, parentId?, emoji? } }  // Watch Later lists; same shape/rules as folders
videos:  { [videoId]: {
  id, channelId,            // null for a manual/imported save until backfilled (oEmbed author_url or the
                            //   playlist byline scrape when a /channel/UC… id is present, else the API snippet)
  title, author,            // author = channel name for saves with no channel record; else null
  published,                // ISO | null (null for manual/imported saves — oEmbed & the scrape have no
                            //   upload date; backfilled from the API snippet on the next details pass)
  channelThumbnail,         // string | absent — channel avatar url for saved videos whose channel ISN'T a
                            //   subscription (subscriptions read the avatar from `channels`); filled by
                            //   fillChannelThumbnails (API snippet), so the Watch Later card shows a photo
  thumbnail, watched,
  viewCount,                // number | null — from RSS media:statistics (free), refreshed by the API
  duration,                 // seconds | null (API contentDetails); undefined = "not yet fetched"
  live,                     // "none" | "live" | "upcoming" (API snippet.liveBroadcastContent)
  hidden,                   // bool — user-dismissed from the New feed; kept so a refresh won't re-add it
  saved,                    // bool — in Watch Later
  folderId,                 // which Watch Later list ("unsorted" default); only meaningful when saved
  addedAt,                  // epoch ms first seen / saved
} }
              // New-tab uploads (from RSS, per-channel-capped, pruned when a channel untracks) AND
              // Watch Later items (saved:true) coexist here. Only the user-touched subset
              // (saved/watched/hidden/organized) is synced — see `syncableVideos` below.
apiKey, gistToken, gistId, lastSyncedAt                        // settings + sync bookkeeping
languages                                                     // string[] — editable language dropdown set (Settings)
sortDate, sortCount, folderSort, currentView                  // persisted UI prefs ("channels"|"new"|"watchlater")
colWidths                                                    // number[5] | absent — resized px widths of the 5 sized table columns
pendingScan: { scannedAt, scannedCount, unresolved, added[], modified[], removed[] }
              // a scan awaiting review; never applied to `channels` until confirmed, never synced
pendingPlaylistImport: { playlistId, title, fetchedAt, statedCount, scrapedCount, videos[] }
              // a scraped playlist awaiting review; each video carries { id, title, published,
              // thumbnail, channelId, author, status:"new"|"savedElsewhere", currentFolderId }.
              // statedCount = the page's "N videos"; scrapedCount = how many we captured (a
              // shortfall warns the user to re-scroll). Never applied until confirmed, never synced
```

- **Folder nesting is one level deep.** A folder with children is a "parent";
  channels only live in leaf folders. `unsorted` is the fixed home and can't be
  renamed, reparented or deleted.
- **`folderSort` "custom"** is the only mode where folder drag-and-drop is
  active; the other modes are computed sorts.

## Message protocol (dashboard → background)

All handlers live in the `chrome.runtime.onMessage` switch in `background.js`
and reply through `sendResponse` (async, so each returns `true`).

| Type | Payload | Response |
| --- | --- | --- |
| `SCAN_RESULT` | `{ channels }` (from the content script) | scan diff counts; stashes `pendingScan`, opens dashboard |
| `APPLY_SCAN` | `{ removeIds }` | `{ ok, added, modified, removed }` |
| `DISCARD_SCAN` | — | `{ ok }` (clears `pendingScan`) |
| `REFRESH_STATS` | — | diagnostics: `{ ok, hasApiKey, queried, thumbsFilled, missingThumbs, apiFailures, lastError, trackedUpdates }` |
| `REFRESH_SINGLE` | `{ channelId }` | `{ ok }` |
| `FILL_MISSING_AVATARS` | — | `{ ok, hasApiKey, missingBefore, thumbsFilled, missingAfter, apiFailures, lastError }` |
| `FILL_VIDEO_DETAILS` | — | `{ ok, hasApiKey, queried, filled, apiFailures, lastError }` (fills video length/views) |
| `FETCH_ALL_VIDEOS` | `{ channelIds }` | `{ ok, hasApiKey, channels, total, added, apiFailures, lastError }` (deep-fetch full upload history) |
| `PLAYLIST_SCAN_RESULT` | `{ playlistId, title, videos, statedCount, scrapedCount }` (from the injected scraper) | `{ ok, count }`; stashes `pendingPlaylistImport`, opens dashboard |
| `APPLY_PLAYLIST_IMPORT` | `{ listName, moveIds }` | `{ ok, listId, added, moved }` (creates a Watch Later list, saves the reviewed playlist into it) |
| `DISCARD_PLAYLIST_IMPORT` | — | `{ ok }` (clears `pendingPlaylistImport`) |
| `SYNC_GIST` | — | `{ ok, gistId, lastSyncedAt }` (background union merge) |
| `FETCH_SYNC_DIFF` | `{ direction }` | `{ ok, direction, channels: { added, removed, modified } }` |
| `APPLY_UPLOAD` | `{ removeFromGistIds }` | `{ ok, gistId, lastSyncedAt }` |
| `APPLY_DOWNLOAD` | `{ removeLocalIds }` | `{ ok, gistId, lastSyncedAt }` |

The dashboard also reacts to `chrome.storage.onChanged` so background writes
(auto-refresh, a scan that finished while it was closed) update the UI live.

## Data flows worth knowing

- **Scan → review → apply.** The content script scrapes links and posts
  `SCAN_RESULT`. `background.js` resolves handles to IDs, diffs against the
  library, writes `pendingScan`, and opens the dashboard, which shows the review
  dialog. Nothing hits `channels` until `APPLY_SCAN`. Removals apply only for
  IDs the user explicitly ticks.
- **Stats refresh.** `channels.list?part=snippet,statistics` in batches of 50
  fills video/subscriber counts and backfills avatars; last-video date comes
  from each channel's RSS feed (`feeds/videos.xml`, regex-parsed by
  `fetchChannelVideos` — no DOMParser in a worker). `FILL_MISSING_AVATARS` is
  the cheap subset: snippet-only, only for channels missing a thumbnail. A
  refresh also fires an OS notification (`notifications` permission, inline icon)
  listing any `active`/`finished` channel whose `lastVideoDate` moved — the
  "tracked update" alert.
- **Two video tabs share one `videos` store.** The sidebar has three views:
  **Channels**, **New**, **Watch Later** (`currentView`).
  - **New (RSS feed).** `fetchChannelVideos` parses the *full* `<entry>` list
    (not just the max date) for every `trackVideos` channel and upserts each into
    `videos` (`upsertChannelVideos`), preserving `watched` across refreshes;
    `pruneVideos` caps history per channel and drops videos whose channel
    untracked/vanished (saved ones survive). No API key or quota. Rendered
    newest-first, grouped by day, filtered by the channel-folder sidebar + search
    + unwatched chip. **No algorithmic ranking** (no API exposes YouTube's
    per-subset feed); videos open on youtube.com/watch, where YouTube's own
    algorithm drives the session. Toggling **Track** fires `REFRESH_SINGLE` so
    uploads appear at once. There is **no "save from feed"** — Watch Later is
    populated only via the context menu (below), by design.
  - **Length & views.** View count comes from the RSS feed (`media:statistics`,
    free). **Duration is not in RSS** — `fillVideoDetails` backfills it (and
    fresher view counts) via `videos.list?part=contentDetails,statistics,snippet`
    when an API key is set, only for videos whose `duration` is still `undefined`
    (cheap, self-limiting). The `snippet` part also backfills `channelId`/`author`/
    `published` for manual/imported saves that lacked them, and `fillVideoDetails`
    then calls `fillChannelThumbnails` (channels.list snippet) to stamp
    `channelThumbnail` on any **saved** video whose channel isn't a subscription —
    so Watch Later cards get a channel name, date, and avatar. `videoNeedsChannel`
    keeps re-querying a saved video until all of those are set (not just until its
    duration fills). It runs during a full refresh *and* on demand: the dashboard
    fires `FILL_VIDEO_DETAILS` (one shot per session) when a video view opens with
    missing lengths + a key, so lengths appear without a manual refresh. Both
    video views share a **sort** (date/length × asc/desc, persisted as
    `videoSort`); New drops its day-group headers when not sorted by date.
  - **Live/upcoming filtering & dismiss.** The New feed hides live streams and
    scheduled premieres: `isUpcomingOrLive` filters `live` in `{live, upcoming}`
    (from the API detail fetch — live/upcoming videos are re-queried each fetch so
    the flag clears when the stream ends) plus any future-dated `published` (which
    catches premieres even with no key). **Remove** on a New card sets `hidden`;
    since RSS keeps re-serving the ~15 latest, that flag is what makes a dismissal
    stick (`upsertChannelVideos` preserves it; `pruneVideos` only drops it once the
    video ages past the per-channel cap, i.e. out of the RSS window).
  - **Full history (beyond RSS's 15).** RSS only exposes a channel's latest ~15
    uploads. `FETCH_ALL_VIDEOS` looks up each channel's real uploads-playlist id
    (`resolveUploadsPlaylists` → `channels.list` `relatedPlaylists.uploads`; the
    `UC`→`UU` shortcut is only a fallback since it 404s for some channels) and
    pages it via `playlistItems.list` (50/page, following `nextPageToken`) to pull
    the entire back catalog — needs an API key. It sets
    `fetchedAll` (which exempts the channel from `VIDEO_KEEP_PER_CHANNEL` in
    `pruneVideos`) and `trackVideos`, persists per-channel as it goes (so a long
    job survives a worker restart), then runs `fillVideoDetails`. Triggered
    per-channel/bulk (channel right-click → "Fetch all videos") or globally
    ("Fetch full history" in the New toolbar, over all tracked channels).
  - **Watch Later.** Saved videos (`saved:true`) organized into `videoFolders`
    (a second, independent folder tree with the *same* nesting/drag/emoji/rename
    rules as channel folders). Its own list sidebar; a video's `folderId` is its
    list. Right-click a card → move to list / remove. Removing a manually-saved
    video deletes it; removing a tracked-channel video just clears `saved`.
- **The folder sidebar is domain-generalized.** One `#folderList` and one set of
  folder functions serve both trees; `fdom()` returns the active domain (channel
  `folders` + `currentFolderId` for Channels/New, `videoFolders` + `currentListId`
  for Watch Later) — folders/counts/selection/persist. Channel behavior is the
  default, so it's unchanged.
- **Adding to Watch Later (context menu).** `contextMenus` permission: right-click
  a YouTube video link or a watch/shorts page → "Save to MyTube Watch Later"
  (`setupContextMenus`, created on install *and* `onStartup`). `background.js`
  extracts the id (`extractVideoId`), fetches title/author from the keyless public
  **oEmbed** endpoint, stores it in `videos` with `saved:true, folderId:"unsorted"`,
  and fires a confirming notification. No URL pasting — the extension captures the
  video from the page.
- **Importing a playlist into Watch Later (context menu, scrape-based).**
  Right-click a YouTube playlist page or playlist link → "Import playlist to MyTube
  Watch Later". The Data API can't read *private* playlists (and needs a key), so
  instead of fetching, the background **scrapes the open, logged-in playlist page**
  — mirroring the subscription `SCAN_RESULT` flow but on demand. `importPlaylistFromPage`
  injects `scrapePlaylistInPage` (via `chrome.scripting.executeScript`, needs the
  `scripting` permission) into the playlist tab — opening the playlist in a new tab
  first if the click came from a link elsewhere. The injected function shows a
  progress banner, **auto-scrolls to the bottom** until the (virtualized) video list
  stops growing or reaches the page's stated "N videos" count, scrapes each video's
  id + title + **channel byline** (id/name, read by climbing from the video anchor
  to its row — not tied to renderer tag names, any `/watch?v=` anchor plus any
  `/channel/`,`/@` link), grabs the
  playlist title (page H1 → tab title fallback), and posts `PLAYLIST_SCAN_RESULT`.
  `handlePlaylistScanResult` classifies each video vs the store (new vs
  `savedElsewhere`), stashes `pendingPlaylistImport` (incl. `statedCount`/`scrapedCount`),
  and opens the dashboard, which shows `openPlaylistImportModal` — the user edits
  the list name (defaults to the playlist title), sees a **warning if fewer videos
  were captured than the playlist claims**, and per already-saved video ticks
  whether to move it into the new list; new videos are always added.
  `APPLY_PLAYLIST_IMPORT` creates the `videoFolders` list and saves the videos
  (`saved:true`, `folderId` = new list); lengths/views backfill via `fillVideoDetails`
  only if an API key is set. **No API key required**; works for private/unlisted/public.
- **Sync.** Directional (`FETCH_SYNC_DIFF` → review → `APPLY_UPLOAD`/
  `APPLY_DOWNLOAD`) surfaces every change for confirmation. The background
  `SYNC_GIST` is a silent **union merge**: local wins on names, tags combine,
  fresher `lastFetched` wins on stats, and **deletions do not propagate**.
- **The directional review shows more than channels.** `computeSyncDiff` also
  diffs folders (add/rename/reparent/emoji), the Watch Later lists (`videoFolders`,
  same diff), the video store (a **count summary** — too many to review per item),
  and the mirrored settings, computed against the *effective* apply result (upload
  uses `mergeSettings`, download overlays picked remote keys) so the preview
  matches reality. Those sections are read-only — folders/lists/settings/videos
  apply wholesale/merge; only channel removals are opt-out via checkboxes. Folder
  and list *removals* only show on upload (download keeps local-only ones).
- **Everything is in the gist — but only the *touched* video subset.** The
  payload carries `channels`, `folders`, `tags`, `videoFolders`, a `settings` blob
  (the `SYNC_SETTING_KEYS`: `apiKey`, `languages`, `sortDate`, `sortCount`,
  `folderSort`), and `videos` **filtered by `syncableVideos`** — only videos the
  user has saved/watched/dismissed/organized. The New-feed cache and full-history
  dumps (the bulk) are re-derivable per device and stay out of the gist, so the
  payload is bounded by *activity*, not catalog size. On download the subset is
  union-merged into the full local store, so each device keeps its own cache while
  user state converges. `videoFolders` merge like `folders`; `videos` merge via
  `mergeVideos`/`mergeVideo` — watched/saved/hidden OR-ed, an organized
  (non-`unsorted`) list assignment wins, higher view count / filled duration win,
  and **nothing is removed**. `mergeSettings` keeps non-empty local values and
  adopts remote for the rest. `gistToken` is **never** synced. Reads already fall
  back to `raw_url` past GitHub's 1 MB inline limit; the subset keeps writes small.

## Conventions

- **Never commit any AI usage including co-author etc.** No `Co-Authored-By`
  trailers, no "Generated with" lines, no AI attribution of any kind in commit
  messages or PR bodies.
- Vanilla everything. New UI = a `render*()` function reading from `state` +
  event delegation in `bindEvents()`. `state` in `dashboard.js` mirrors storage.
- Always `escapeHtml()` any channel/folder/tag text interpolated into
  `innerHTML`.
- The service worker owns cross-cutting storage writes (scan apply, refresh,
  sync); the dashboard writes for direct user edits (move folder, add tag,
  rename). Both persist by writing whole objects back to
  `chrome.storage.local`.
- Migrations run in `onInstalled` (`repairDoubledNames`, the Turkish
  "Klasörsüz" → "Unsorted" rename) — add one-off data fixes there.

## Known gaps / gotchas

- **Two empty states.** `#emptyState` shows when the library is empty (zero
  channels); `#noResultsState` shows when the library is non-empty but the
  current folder + filters match nothing — with a **Clear filters** button
  (`clearAllFilters()`) shown only when `anyFilterActive()`. An empty folder with
  no filters shows the same panel with a "folder is empty" message and no button.
- **Single view only.** The grid renders one way (the list/table view in
  `buildChannelRow`); there's no card/grid alternative. `renderGrid()` still
  hard-wires the `list-view` class, so reintroducing a toggle later is cheap.
- **Resizable table columns.** The header and every row share one grid template
  via the inherited `--col-template` custom property on `.main`. Drag handles
  (`setupColumnResize`) live only in the header; dragging sets explicit px widths
  for the first five columns (Folder stays a flexible `1fr` that absorbs slack,
  so there's no horizontal scroll) and persists `colWidths`. Until the first
  drag (and with no saved widths) the CSS *fallback* fluid template applies —
  `measureColumnWidths` freezes the rendered widths on that first drag so nothing
  jumps. The `≤720px` media query overrides the template wholesale (hides
  Variables), so resizing is a wide-window feature. The date cell is a CSS
  `container` (`container-type: inline-size`): under ~100px it swaps the wordy
  `formatShortDate` span for the numeric `formatNumericDate` one (`DD/MM/YY`).
- **Multi-select** lives entirely in the dashboard: a module-level
  `selectedChannelIds` Set (not in `state`, never persisted) plus a
  `selectionAnchor` pivot. Ctrl/Cmd-click toggles one row; Shift-click
  add/removes the whole run from the anchor (`handleSelectionClick`). The only
  visual is the `.channel-row.selected` yellow ring — no checkboxes, no count.
  `buildChannelRow` re-applies the class so selection survives the scroll pager;
  `paintSelection()` toggles it on already-rendered rows without a re-render.
  Right-clicking inside a selection of 2+ opens `showBulkContextMenu`, which
  reuses `folderSubmenuItems` and runs `bulkMutate`/`bulkDelete` over the set
  (move, language, add/remove tag, active/finished, delete). Any action clears the
  selection; a plain (unmodified) left-click also clears it and opens the channel.
- **Video cards have the same multi-select**, mirrored: `selectedVideoIds` +
  `videoSelectionAnchor`, `handleVideoSelectionClick` (range order from
  `currentVideoOrder`, i.e. the active view's filtered/sorted list),
  `paintVideoSelection`, and `.video-card.selected` (same yellow ring). It works in
  both the New and Watch Later grids; `videoCardHtml` re-applies the class.
  `showVideoBulkContextMenu` offers mark watched/unwatched and, per view, remove
  from feed (New → `hidden`) or move-to-list / remove-from-Watch-Later. Selection
  is per-view (cleared on `setView`).

## Cruft (not part of the extension)

`scraped-ids.txt`, `csv-ids.txt`, and `check-missing.sh` are one-off developer
tools for diffing scraped IDs against a Google Takeout export. They hold personal
subscription data and a hardcoded local path, so they're **untracked** (kept
locally, listed in `.gitignore`) and are not part of the shipped extension.
