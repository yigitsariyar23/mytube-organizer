# AGENTS.md

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
native-host/
  mytube-updater.py                   OPTIONAL, runs OUTSIDE the browser: native messaging host
                                        that git-pulls this checkout for the update banner
  install.sh                          registers it per browser profile (per device, one-time)
version.json                          build stamp (UTC), rewritten by .githooks/pre-commit
.githooks/pre-commit                  stamps version.json; enable with `git config core.hooksPath .githooks`
shared/library.js                    pure field patches, backup validation, stable serialization
shared/controls.js                   shortcut catalog, normalization, matching, labels, selection modifiers
package.json, tests/                  dependency-free Node regression tests + synthetic browser fixture
icons/                                packaged extension icons
check-missing.sh, csv-ids.txt,        one-off dev utilities / personal data dumps (see "Cruft")
  scraped-ids.txt
```

There are three independent surfaces — the service worker, the dashboard page,
and the content script — that only talk through `chrome.runtime` messages and
shared `chrome.storage.local`. Keep that boundary: the dashboard never touches
YouTube's DOM, and the content script never touches storage. (`native-host/` is
a fourth thing entirely: not part of the extension, optional, installed per
device, and reached only through `sendNativeMessage` — see the update-banner
note under "Known gaps".)

## Storage schema (`chrome.storage.local`)

```
channels: { [channelId]: {
  id, name, handle, thumbnail,
  folderId,                 // "unsorted" by default; a leaf folder id otherwise
  tags: [tagId, ...],       // free-form multi-value labels
  language,                 // string | null — the "Variables" cell language dropdown
                            //   (and the right-click "Set language" menu); shown with a flag
                            //   from LANG_FLAGS, 🌐 when unknown, or a leading emoji the
                            //   label itself carries
  active,                   // bool — user flag: a channel you're following
  finished,                 // bool — user flag: a channel you consider done
  trackVideos,              // bool — user flag: feed this channel's uploads into the New videos tab
  fetchedAll,               // bool — full upload history was API-fetched; exempts the channel from the video cap
  lastVideoDate,            // ISO string, from RSS or the uploads API fallback
  videoCount,               // number | null (null until fetched with an API key)
  subscriberCount,          // number | null (null if hidden or not yet fetched); shown in the list
  lastFetched,              // epoch ms of the last successful feed (RSS or fallback) + channel-stat refresh
  lastFetchAttempt,          // epoch ms of the latest attempt, including failures
  lastFetchError,            // latest failure text; cleared on a successful retry
} }
folders: { [folderId]: { name, order, parentId?, emoji? } }   // channel folders; "unsorted" (shown as
                                                              //   "Unfiled") is the pinned home
tags:    { [tagId]: { name, color } }
videoFolders: { [folderId]: { name, order, parentId?, emoji? } }  // Watch Later lists; same shape/rules as folders
videos:  { [videoId]: {
  id, channelId,            // null for a manual/imported save until backfilled (oEmbed author_url or the
                            //   playlist byline scrape when a /channel/UC… id is present, else the API snippet)
  title, author,            // author = channel name for saves with no channel record; else null
  published,                // ISO | null (null for manual/imported saves — oEmbed & the scrape have no
                            //   upload date; backfilled from the API snippet on the next details pass)
  channelUrl,               // string | null — captured channel/handle URL; canonicalized by API details
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
  userStateAt,              // epoch ms | absent — when the user last changed watched/saved/hidden/
                            //   folderId. Stamped by the worker for PATCH_LIBRARY, Undo, restore,
                            //   and its own saves; sync resolves those four fields last-writer-wins from it
  addedAt,                  // epoch ms first seen / saved
} }
              // New-tab uploads (from RSS, per-channel-capped, pruned when a channel untracks) AND
              // Watch Later items (saved:true) coexist here. The whole store syncs; `isUserTouched`
              // (saved/watched/hidden/organized) marks what `pruneVideos` must never drop.
apiKey, gistToken, gistId, lastSyncedAt                        // settings + sync bookkeeping
dismissedUpdateBuild                                          // the version.json build the user dismissed
                                                              //   in the update banner (per-device)
reopenDashboardAt                                             // epoch ms stamped just before the dashboard
                                                              //   restarts the extension, so the worker can
                                                              //   reopen it on the way back up (per-device)
lastSyncCheckAt                                               // epoch ms of the last on-open gist check
                                                              //   (throttle only; per-device, never synced)
languages                                                     // string[] — active languages selected in Settings; empty is allowed
sortDate, sortCount, sortSubs, sortFolder, sortPriority,       // one direction per sortable channel-list
  folderSort, currentView                                     //   column ("none"|"asc"|"desc") plus their
                                                              //   click-order priority; and the other
                                                              //   persisted UI prefs ("channels"|"new"|
                                                              //   "watchlater"|"removed"). Per-device — NOT synced
libraryEpoch                                                 // incremented by clear/restore; invalidates older enrichment jobs
libraryBackups                                               // latest five local recovery snapshots; never synced/exported recursively
controls: { enabled, bindings: { [actionId]: chord | null },   // per-device keyboard + mouse preferences, never synced/exported
  selectionModifier, wheelAdjustsNumbers }                    // "primary" (Ctrl/Meta) or "alt"; wheel option covers count/date fields
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
  channels only live in leaf folders. `unsorted` (labelled "Unfiled") is the
  fixed home and can't be renamed, reparented or deleted.
- **`folderSort` "custom"** is the only mode where folder drag-and-drop is
  active; the other modes are computed sorts.

## Message protocol (dashboard → background)

All handlers live in the `chrome.runtime.onMessage` dispatcher in `background.js`
and reply through `sendResponse` (async, so each returns `true`). Rejections become
`{ ok: false, error }` responses so the dashboard can reset its busy controls.

| Type | Payload | Response |
| --- | --- | --- |
| `SCAN_RESULT` | `{ channels }` (from the content script) | scan diff counts; stashes `pendingScan`, opens dashboard |
| `APPLY_SCAN` | `{ removeIds }` | `{ ok, added, modified, removed }` |
| `DISCARD_SCAN` | — | `{ ok }` (clears `pendingScan`) |
| `REFRESH_STATS` | `{ channelIds? }` (omit for all) | diagnostics, including `failures: [{id, name, error}]`: `{ ok, hasApiKey, queried, thumbsFilled, missingThumbs, apiFailures, lastError, trackedUpdates }` |
| `REFRESH_SINGLE` | `{ channelId }` | same refresh diagnostics |
| `FILL_MISSING_AVATARS` | — | `{ ok, hasApiKey, missingBefore, thumbsFilled, missingAfter, apiFailures, lastError }` |
| `FILL_VIDEO_DETAILS` | — | `{ ok, hasApiKey, queried, filled, apiFailures, lastError }` (fills video length/views) |
| `FETCH_ALL_VIDEOS` | `{ channelIds }` | `{ ok, hasApiKey, channels, total, added, apiFailures, lastError, failures[] }` (deep-fetch full upload history; `failures` = `{ id, name, error }` per skipped channel) |
| `PLAYLIST_SCAN_RESULT` | `{ playlistId, title, videos, statedCount, scrapedCount }` (from the injected scraper) | `{ ok, count }`; stashes `pendingPlaylistImport`, opens dashboard |
| `APPLY_PLAYLIST_IMPORT` | `{ listName, moveIds }` | `{ ok, listId, added, moved }` (creates a Watch Later list, saves the reviewed playlist into it) |
| `DISCARD_PLAYLIST_IMPORT` | — | `{ ok }` (clears `pendingPlaylistImport`) |
| `FETCH_SYNC_DIFF` | `{ direction, removeIds? }` | diff incl. tags, all video rows, selected `removeIds`, and `reviewToken` |
| `APPLY_UPLOAD` | `{ removeFromGistIds, skipVideoIds, skipAllVideos?, reviewToken }` | `{ ok, gistId, lastSyncedAt }` or `{ ok:false, stale:true, error, diff }` |
| `APPLY_DOWNLOAD` | `{ removeLocalIds, skipVideoIds, skipAllVideos?, reviewToken }` | same apply result; takes a local snapshot first |
| `PATCH_LIBRARY` | `{ patches: { [collection]: [{id, set?, unset?, create?, remove?}] } }` | `{ ok, videoStates }`; field patches from direct edits |
| `SET_SETTINGS` | `{ values }` | `{ ok }`; serialized writes for `apiKey`, `languages`, `gistToken` |
| `UNDO_VIDEOS` | `{ changes: [{id, before, after}] }` | `{ ok }`; rejects if current flags/stamp differ from `after` |
| `EXPORT_BACKUP` | — | `{ ok, backup }`; portable JSON, no credentials |
| `PREVIEW_BACKUP` | `{ backup }` | `{ ok, counts }`; validates without writing |
| `CREATE_BACKUP` | — | `{ ok }`; manual local snapshot |
| `LIST_BACKUPS` | — | `{ ok, backups }`; metadata/counts only |
| `RESTORE_BACKUP` | `{ backup }` or `{ backupId }` | `{ ok }`; snapshots current library, replaces local library, increments epoch |
| `CLEAR_LIBRARY` | — | `{ ok }`; snapshots then clears all five collections, increments epoch |

The dashboard also reacts to `chrome.storage.onChanged` so background writes
(auto-refresh, a scan that finished while it was closed) update the UI live.

## Data flows worth knowing

- **Catch-up on open.** The 3-hour alarm is the only *background* trigger, and
  its first fire is 3 hours after install — so a device left closed showed stale
  data until it happened to run. `catchUpOnOpen()` (dashboard `init`, after the
  `onChanged` listener is wired) fires `REFRESH_STATS` for the channels whose last successful fetch is at least
  3 hours old. **YouTube data only — it never touches the gist.**
- **Sync never *applies* by itself.** Nothing is written to the gist, and nothing
  from the gist is written locally, without the user confirming a review. An
  automatic merge meant a device opened after sitting stale pushed its old
  library up before pulling anything down, so whichever device ran first decided
  the shared state and newer work elsewhere was overwritten. Both directions go
  through the explicit `FETCH_SYNC_DIFF` → review →
  `APPLY_UPLOAD`/`APPLY_DOWNLOAD` flow. (The old silent union merge —
  `SYNC_GIST`/`syncWithGist`/`mergeStates` — is gone; don't reintroduce a
  background merge.)
- **Looking, however, is automatic.** `checkRemoteChangesOnOpen()` (dashboard
  `init`, chained behind `catchUpOnOpen` so the diff sees refreshed local data)
  fetches the **download** diff and opens the normal review when the gist
  actually differs — a device that sat closed otherwise had no way of knowing.
  It's a read: `FETCH_SYNC_DIFF` computes, `openSyncDiffModal` shows, and not a
  byte moves until Apply. Guards: no token → skip; another review already open →
  skip (checked again after the fetch, since the wait is a network round trip);
  a failure is **silent** (an unrequested check shouldn't show "GitHub: 401" to
  someone who just opened their subscriptions); and `lastSyncCheckAt` throttles
  it to once per `SYNC_CHECK_INTERVAL_MS` (10 min) so reopening the dashboard
  isn't a GitHub request every time. `syncDiffTotal()` decides "actually
  differs" — the same count the review's summary and Apply button use, so the
  modal can never open on a diff that would render as "already in sync".
- **Scan → review → apply.** The content script scrapes links and posts
  `SCAN_RESULT`. `background.js` resolves handles to IDs, diffs against the
  library, writes `pendingScan`, and opens the dashboard, which shows the review
  dialog. Nothing hits `channels` until `APPLY_SCAN`. Removals apply only for
  IDs the user explicitly ticks.
- **Stats refresh.** `channels.list?part=snippet,statistics,contentDetails` in batches of 50
  fills video/subscriber counts and backfills avatars; last-video date comes
  from each channel's RSS feed (`feeds/videos.xml`, regex-parsed by
  `fetchChannelVideos` — no DOMParser in a worker), with an uploads API fallback
  for RSS 404s (see Refresh diagnostics below). `FILL_MISSING_AVATARS` is
  the cheap subset: snippet-only, only for channels missing a thumbnail. A
  refresh also fires an OS notification (`notifications` permission, inline icon)
  listing any `active`/`finished` channel whose `lastVideoDate` moved — the
  "tracked update" alert.
- **Video views share one `videos` store.** The sidebar has **Channels**, **New**,
  **Watch Later**, and **Removed videos** (`currentView`).
  - **Opening leaves watched state unchanged.** Card clicks use `openVideo`, while
    title links keep native navigation; neither path changes watched state. Channel
    names and avatars open the channel Videos tab (ID first, validated channelUrl
    fallback). Unknown identity is inert, never a guessed name-based link. Watched
    changes require the explicit card, context-menu, or bulk controls.
  - **All library writes serialize in the worker.** Dashboard edits still own
    their user decisions, but `persistLibrary` diffs `libraryBaseline` into
    field patches and sends `PATCH_LIBRARY`. The baseline advances before the
    request awaits and follows storage events. The worker's `withLibraryWrite`
    queue reads the latest collections before applying those patches. A field
    update never recreates a deleted record. Mirrored settings use `SET_SETTINGS`
    through the same queue, so they cannot race a sync apply.
  - **Enrichment owns metadata only.** Network requests run outside the queue.
    `readVideoStore` captures a baseline and epoch; `commitVideos` merges changed
    metadata into current storage, preserves all user flags, skips deleted ids,
    and keeps newly added records. It applies a field only if it still matches
    the baseline (or is missing), so an older job does not undo newer metadata.
    Channel enrichment uses `commitChannelMetadata` with the same rule and a
    metadata whitelist. Pruning runs **after** that merge against current saved
    flags and current tracking state. Clear/restore increments `libraryEpoch`;
    a job from an older epoch cannot write the old library back.
  - **New (RSS feed).** `fetchChannelVideos` parses the *full* `<entry>` list
    (not just the max date) for every `trackVideos` channel and upserts each into
    `videos` (`upsertChannelVideos`), preserving `watched` across refreshes;
    `pruneVideos` caps history per channel and drops videos whose channel
    untracked/vanished (saved ones survive; the cap also spares anything else
    `isUserTouched`). Normal RSS needs no API key or quota; recovering a missing
    RSS feed uses the configured key. Rendered
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
    **A channel that can't be read is named, not blamed on a playlist id.**
    `resolveUploadsPlaylists` returns `{ map, gone, error }`: an id the lookup
    *answered about but didn't list* is a channel that no longer exists
    (deleted, terminated, or a stale id from an old scan), so it goes in `gone`
    and is never requested — the `UU` shortcut could only 404 there, and the
    API's reply ("The playlist identified with the request's `playlistId`
    parameter cannot be found") names an id the user never chose and can't act
    on. An id the lookup *couldn't ask about* (the batch call itself failed) is
    merely unresolved and still gets the shortcut; that batch error surfaces as
    `error`. A 404 from `playlistItems` is reported as "no public uploads".
    Each skipped channel lands in `result.failures` as `{ id, name, error }`,
    which the dashboard's `describeFetchFailures` renders by name. A failed
    channel is **not** marked `fetchedAll` — claiming a history is complete
    when it wasn't read exempts it from the prune cap and hides it from a retry.
  - **Recovery.** `currentView === "removed"` reuses `videoFeed` and channel
    folder scope, selects `hidden` videos (including untracked/missing channels),
    and ignores the watched/live filters so they remain recoverable. Restore
    clears `hidden`; normal New-feed tracking/watched filters then apply.
    `persistLibrary` offers Undo for video flag/list edits using the worker's
    returned flags and timestamp. `UNDO_VIDEOS` compares that exact state before
    restoring prior flags and stamping a new decision; metadata is retained.
    Menu actions resolve the current video by id when clicked; a refresh can
    replace the in-memory record while a menu is open.
  - **Watch Later.** Saved videos (`saved:true`) organized into `videoFolders`
    (a second, independent folder tree with the *same* nesting/drag/emoji/rename
    rules as channel folders). Its own list sidebar; a video's `folderId` is its
    list. Right-click a card → move to list / remove. Removing only clears
    `saved` + `folderId` — for a manual save too, whose record is then a tombstone
    (see the sync notes); a tracked channel's video simply returns to the New feed.
- **The folder sidebar is domain-generalized.** One `#folderList` and one set of
  folder functions serve both trees; `fdom()` returns the active domain (channel
  `folders` + `currentFolderId` for Channels/New/Removed, `videoFolders` + `currentListId`
  for Watch Later) — folders/counts/selection/persist. Channel behavior is the
  default, so it's unchanged.
- **Two virtual sidebar entries, not one.** `"all"` (no scoping) and `FILED_ID`
  (`"filed"` — everything *not* in the home folder, its mirror image)
  are selections, never folders: they're absent from `folders`/`videoFolders`,
  so they can't be renamed, dragged, dropped onto or deleted (the folder
  right-click guard is `isVirtualFolderId(id) || id === "unsorted"`, and
  `computeFolderDropIntent` already refuses an id it can't find). A real folder
  id is always `slug + "-" + suffix`, so neither can collide.
  **Every view scopes through `folderScopeTest(selectedId, folders)`** — it
  returns `null` for "all", `isFiledFolderId` for "filed", else a
  descendant-set test — so `channelsInCurrentFolder`, `newFeedUniverse` and
  `watchLaterUniverse` behave identically. Add a scoped surface by calling it,
  not by comparing ids. "Filed" holds no items of its own, so `renderFolders`
  counts it as `d.total() - directCount.unsorted`; that only stays honest
  because both sides normalize a missing `folderId` to `"unsorted"` (RSS videos
  carry none) — the same normalization `isFiledFolderId` does.
- **Adding to Watch Later (context menu).** `contextMenus` permission: right-click
  a YouTube video link or a watch/shorts page → "Save to MyTube Watch Later"
  (`setupContextMenus`, created on install *and* `onStartup`). `background.js`
  extracts the id (`extractVideoId`), saves and notifies immediately in the write
  queue, then fetches title/author through keyless **oEmbed** and details through
  the API. Enrichment commits metadata only, so removing or moving the new save
  during its fetch remains authoritative. No URL pasting — the extension captures the
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
  to its row, stopping at known row boundaries or ancestors containing another
  video; ambiguous/missing bylines stay unknown. Channel handle URLs are retained. Any `/watch?v=` anchor plus any
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
- **Sync.** Directional and manual only (`FETCH_SYNC_DIFF` → review →
  `APPLY_UPLOAD`/`APPLY_DOWNLOAD`), so every change is confirmed before it moves.
  Both directions union-merge — **channels, folders, tags, Watch Later lists and
  videos all union** (local wins the overlap on upload, the gist wins it on
  download), fresher `lastFetched` wins on stats, and **deletions do not
  propagate** except for the channel removals the user ticks in the review.
  Folders/lists/tags used to be written wholesale from one side, which meant a
  device that hadn't downloaded yet wiped every folder, list or tag the other had
  just added — while the channels and videos filed under them survived the merge
  and were left pointing at an id with nothing behind it. Don't reintroduce a
  wholesale write on either side.
- **The directional review shows more than channels.** `computeSyncDiff` also
  diffs folders (add/rename/reparent/emoji), the Watch Later lists (`videoFolders`,
  same diff), the video store (counts plus paginated item rows), tag
  additions/renames/color changes, and the mirrored settings, computed against
  the *effective* apply result (upload
  uses `mergeSettings`, download overlays picked remote keys) so the preview
  matches reality. Folders/lists/tags/settings apply as a whole; **channel removals and
  individual video changes are the two opt-outs**. Folder and list *removals* are
  never reported by the diff any more — both directions union them, so a folder
  the target has and the source doesn't simply stays.
  **The video count comes from `effectiveSyncVideos`** — the same union merge +
  `pruneVideos` pass the apply runs, over `effectiveSyncChannels` (the channel set
  the apply lands on). Diffing the raw union instead was a bug: a merged video the
  prune then dropped (untracked channel, or the union pushing a channel past
  `VIDEO_KEEP_PER_CHANNEL`) was reported as "N new" on *every* sync, applied
  cleanly, and was still missing afterwards — a diff that could never be cleared.
  If you change what an apply writes, change these two helpers, not a parallel
  copy of the logic. **The same diff also carries `videos.items`** — one row per
  added/changed video (`{ id, title, author, from, to }`, `from: null` for a video
  the target lacks), removals first, then modifications and additions. All rows are returned
  (`truncated: 0`); the dashboard creates DOM rows in pages of 100 behind a
  disclosure. Its group checkbox covers the entire set, including unloaded
  rows (`skipAllVideos`), and individual decisions live in `syncSkipVideoIds`; unticking sends the id back as
  `skipVideoIds`, and `effectiveSyncVideos` then leaves that video exactly as the
  target has it (dropping it if the target never had it). It's the only way to
  take part of a sync — the counts alone couldn't say *which* video moved.
  **Videos the apply would drop are rows too** (`to: null`, plus a `reason`: the
  channel isn't tracked, or it's past `VIDEO_KEEP_PER_CHANNEL`), listed first
  because they're the destructive ones. For those, unticking *keeps* the video —
  which is why `skipVideoIds` is applied **after** `pruneVideos`, not before. The same rule bit the per-video comparison: an absent
  `folderId` and `"unsorted"` are one state (RSS videos carry none, `mergeVideo`
  stamps `"unsorted"`), so `userStateKey` normalizes them or the whole overlap
  reads as "changed list state" forever.
- **The gist holds the whole library.** The payload carries `channels`, `folders`,
  `tags`, `videoFolders`, the **entire** `videos` store (New-feed cache and
  full-history dumps included, not just the user-touched subset), and a `settings`
  blob — `SYNC_SETTING_KEYS`, which is now just `apiKey` and `languages`: real
  configuration you'd otherwise re-enter on a new device. The **view preferences
  are not synced** (`sortDate`, `sortCount`, `sortSubs`, `sortFolder`,
  `sortPriority`, `folderSort`, `videoSort`, `currentView`, `colWidths`) — they say how one device is being looked at right
  now, and syncing them re-sorted the other device's list and put a pointless
  "1 setting" row in every review. Old gists still carry them; readers filter
  through `SYNC_SETTING_KEYS`, so they're ignored and drop out on the next
  upload. Also excluded: `gistToken` (the credential — **never** synced),
  `gistId`/`lastSyncedAt` (per-device bookkeeping), and `pendingScan`/
  `pendingPlaylistImport` (an in-flight review on one device).
  `videoFolders` merge like `folders`; `videos` merge via `mergeVideos`/
  `mergeVideo` — higher view count / filled duration win, **nothing is removed**
  by the merge itself, and the four user-owned fields go through `mergeUserState`
  (below). `mergeSettings` keeps non-empty local values and
  adopts remote for the rest, so an upload never clears a pref the other device
  set; a *changed* pref propagates only through an explicit Download.
- **User state resolves last-writer-wins, not by union.** `watched`/`saved`/
  `hidden`/`folderId` used to be OR-ed on merge. OR only ever turns a flag *on*,
  so un-saving, un-watching, un-hiding and moving back to Unfiled never reached
  the other device — and the gist's stale `true` merged back over the local
  change, so removing something from Watch Later undid itself on the next sync.
  Now every user change stamps `userStateAt` and `mergeUserState` gives all four
  fields to the newer stamp (they're one decision — mixing halves of two devices'
  states invents a third nobody chose). Unstamped on both sides = pre-update
  record, keeps the old union; stamped beats unstamped. **A removal is a record,
  not a deletion**: un-saving leaves `saved:false` behind (even for a manual save,
  which used to be deleted outright) because a deleted row carries no information
  and the gist would merge the video straight back. `pruneVideos` keeps any record
  changed within `USER_STATE_TOMBSTONE_MS` (90 days) so the tombstone outlives the
  next sync on every device, then lets it go.
- **Syncing the whole store has two consequences the code has to handle.**
  1. *Bounds.* Since a download unions the gist's videos back in, `pruneVideos` is
     re-run on the merged result (`applyDownload`) and on what's
     uploaded (`applyUpload`) — otherwise an untracked channel's videos would
     ping-pong back forever and the gist would only ever grow. The cap now spares
     any `isUserTouched` video (not just `saved`), because dropping a watched or
     dismissed flag would now propagate everywhere.
  2. *Size.* `serializeGistPayload` pretty-prints under 512 KB and switches to
     compact JSON above it. Reads past GitHub's 1 MB inline limit already follow
     `raw_url`; past **10 MB** the API can't serve the file back at all, so the
     serializer throws a plain-language error at 9 MB rather than writing a gist
     this extension could no longer read.

- **Sync reviews describe a specific state.** `loadSyncContext` reads both
  libraries/settings and hashes their canonical serialized state with SHA-256.
  `buildSyncDiff` adds the selected channel removals to `reviewToken` and uses
  those same choices for `effectiveSyncVideos`. Changing a channel checkbox
  fetches an updated preview; the Apply button stays disabled during that read.
  Apply re-reads and compares the token under the write queue. A changed source
  or target returns `stale:true` with an updated diff; the user must review and
  apply again. No review snapshot has to survive worker restarts. Network calls
  have timeouts. This checks state at Apply; it is not a distributed transaction
  across GitHub and other devices.
- **Refresh diagnostics distinguish attempts from successes.** RSS requests run
  six at a time with 15-second timeouts. `lastFetchAttempt` advances even on a
  failure; `lastFetched` advances only after successful feed and channel-stat
  requests. `lastFetchError` clears on success. The dashboard shows named
  failures and Retry passes only their ids through `REFRESH_STATS`.
  An RSS 404 goes through `recoverMissingChannelFeed`: the current refresh's
  channel API response must explicitly report `videoCount:0` to accept it as an
  empty channel. Cached counts, missing fields, and failed lookups never qualify.
  Otherwise the returned `contentDetails.relatedPlaylists.uploads` id supplies
  one page of up to 50 entries, keeping 15 readable uploads. The request has a
  20-second timeout and shares `parseUploadItems` with the full-history fetch.
  It never sets `fetchedAll` or enables tracking. An API-confirmed missing
  channel, an unreadable fallback, or a missing key remains an actionable
  failure; no channels or user flags are removed to clear an error.
- **Local recovery is independent of Gist sync.** `libraryBackups` holds the
  latest five snapshots, each with an id, date, reason, the five collections,
  languages, and the local API key. Download/clear/import/restore must save a
  snapshot successfully before writing. `RESTORE_BACKUP` validates format/version,
  collection/field types and folder nesting; it normalizes orphaned assignments
  to Unfiled and stamps restored video state. Portable exports use
  `{format:"mytube-backup",version:1,library,settings}` and exclude API keys,
  GitHub tokens, backup history, and device preferences. Import is replacement
  on this device only, reviewed with counts, capped at 50 MB in the dashboard.
- **Rendering is incremental and keyed.** Video grids start at 60 cards and
  Load more adds 60. `renderVideoList` retains loaded depth for the same view,
  scope, and filters. `reconcileChildren` preserves unchanged nodes, anchors
  scroll to a visible item, and restores focus when a changed card is replaced.
  Channel updates retain loaded depth too. Storage events for unrelated keys
  do not rebuild grids. Titles are native links; channel toggles are buttons;
  right-click context menus and their submenus support keyboard navigation.
- **Regression checks require no dependencies or build.** `npm test` uses
  Node's test runner with isolated Chrome/storage/network fakes. `npm run check`
  checks syntax. `npm run test:browser` serves the actual UI/worker through a
  synthetic fixture on loopback; `/tests/dashboard?smoke=1` runs browser checks.
  Tests record/accept synthetic confirmations and mock all external requests.
  The fixture is never referenced by the production HTML or manifest.
- **Controls are dashboard preferences.** `shared/controls.js` owns the
  `SHORTCUTS` catalog and defaults. Bindings use physical `KeyboardEvent.code`
  with ordered `Mod+Alt+Shift` modifiers; Mod means Meta on Mac and Ctrl
  elsewhere. Labels use US key positions. Null disables an action; normalization
  rejects invalid/reserved combinations and disables duplicates. The Controls
  tab edits `controlsDraft`; only Settings Save writes the local `controls` key.
  Cancel/Escape/backdrop discard it on the next open. Recording intercepts keys
  in capture phase, rejects conflicts, and treats Escape as cancel (not close).
  The app dispatcher ignores typing, composition, repeats, open menus, and
  dialogs. Standard focus/menu keys are never remapped. New actions need a
  catalog entry and a `runKeyboardShortcut` dispatch branch.
  `selectionModifierPressed` serves channels and both video grids. The wheel
  preference guards count/date number fields and year selects. Neither controls
  nor their defaults belong in `SYNC_SETTING_KEYS`, backups, or library patches.
- **Preserve the original visual layout.** The sidebar uses the original compact
  view tabs, with scan/refresh above folders. Keep all arrangement, dimensions,
  spacing, and table/video-card layout unchanged. Typography uses the shared
  sans-serif family throughout, including native controls and numeric metadata;
  Variables buttons keep the same 11px text as other chips. Action menus open by
  right-clicking folders, channels, or videos; there are no duplicate dot buttons. Visual polish
  may recolor, replace/add icons, and add transitions. Current icon overlays
  preserve the original glyph footprint; transitions affect only color/shadow
  and opacity, with `prefers-reduced-motion` disabling them. Do not introduce
  scaling/sliding animations or `transition: all`. Keyboard preferences live in the
  Settings Controls tab, styled with the existing theme. Settings tabs support
  arrow-key navigation and keep Save/Cancel visible while content scrolls.

## Conventions

- **Reload in Vivaldi after every completed fix.** After finishing extension
  code changes and their relevant checks, reload this checkout's unpacked
  **MyTube Organizer** extension in **Vivaldi** before reporting completion.
  This is standing user authorization; do not ask for permission each time.
  Use the extension's **Reload extension** control when available, or its
  **Reload** control at `vivaldi://extensions`. A dashboard page refresh alone
  does not replace an extension reload. Identify the matching extension and
  checkout before acting; never remove/reinstall it or change its ID. Reopen
  the dashboard if necessary and verify it loads after the reload. If browser
  access is unavailable or the matching extension cannot be identified, report
  the concrete blocker rather than claiming it was reloaded. Documentation-only
  changes do not need a reload.
- **Never commit any AI usage including co-author etc.** No `Co-Authored-By`
  trailers, no "Generated with" lines, no AI attribution of any kind in commit
  messages or PR bodies.
- **Every commit updates two things besides the code:**
  1. `version.json` — the build stamp the update banner compares against. The
     `.githooks/pre-commit` hook rewrites and stages it automatically, so this
     only needs doing by hand when the hook can't run: a fresh clone that hasn't
     had `git config core.hooksPath .githooks`, or a `--no-verify` commit. A
     commit that leaves the stamp untouched doesn't break anything loudly — it
     just silently stops every other device from being told to pull.
  2. **These docs.** `AGENTS.md` for anything that changes how the code works
     (a new message type, a storage key, a data-flow rule, a gotcha worth not
     rediscovering) and `README.md` for anything the user can see or do. Both in
     the same commit as the change, not after it — a doc that lags is worse than
     one that's missing, because it gets believed.
- Vanilla everything. New UI = a `render*()` function reading from `state` +
  event delegation in `bindEvents()`. `state` in `dashboard.js` mirrors storage.
- Always `escapeHtml()` any channel/folder/tag text interpolated into
  `innerHTML`.
- The service worker owns persistence for library and mirrored-setting writes
  through `withLibraryWrite`. The dashboard initiates direct edits as field
  patches through `persistLibrary`; only device UI preferences write directly to
  `chrome.storage.local`. Do not reintroduce dashboard whole-library writes.
- Migrations run in `onInstalled` (`repairDoubledNames`, `renameHomeFolder`) —
  add one-off data fixes there. **The pinned home folder's id is `unsorted` but
  its label is `HOME_FOLDER_NAME` ("Unfiled")** — the id is a storage key every
  channel and video points at, so only the name ever moves; `renameHomeFolder`
  migrates the earlier names (`OLD_HOME_FOLDER_NAMES`: the Turkish "Klasörsüz",
  then "Unsorted") for both folder trees. It also runs inside `fetchGistState`,
  so every reader of a gist written by an older build sees one name: the remote
  side wins the folder overlap on download, so without it the review would
  report a home-folder rename that the apply undoes — on every single sync.

## Known gaps / gotchas

- **The update banner can't pull by itself — a native host does it.**
  `checkForAppUpdate()` (dashboard `init`) compares the local `version.json`
  build against the one on GitHub and, when the remote is newer, shows a banner
  with the last commit's subject, the `git pull` to run, and a **Reload
  extension** button (`chrome.runtime.reload()` makes Chrome re-read an unpacked
  extension from disk). Nothing *inside* the extension can run git: an MV3
  worker has no shell and no filesystem, not even to its own folder, and Chrome's
  auto-update only covers Web Store installs. Don't try to write a self-updater
  in here; it can't exist.
  - What can: **`native-host/mytube-updater.py`**, a Chrome native messaging
    host — a plain process outside the browser, so it has the shell the worker
    doesn't. `offerNativePull()` pings it whenever the banner shows and only
    then reveals **Pull & reload** (`runNativePull` → `{cmd:"pull"}` →
    `chrome.runtime.reload()`); an unanswered ping leaves the old copyable
    command exactly as it was. It's optional and **per device**
    (`native-host/install.sh` writes a host manifest into each browser profile),
    so every path here must survive it being absent — that's the whole reason
    the button starts hidden instead of erroring on click.
  - The host is not a general runner: `git pull --ff-only` in its own repo and
    nothing else, non-interactive (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`,
    a 90s timeout) so a credential prompt can't hang Chrome's pipe, and Chrome
    only starts it for the id in `allowed_origins`.
  - **Never add a `key` to `manifest.json` to pin that id.** An unpacked
    extension's id is the hash of the directory path it loads from, so pinning
    it looks like the tidy way to make one host manifest work everywhere — but
    adding the key *changes* the id, and the browser then treats the extension
    as a brand-new one with an empty `chrome.storage.local`. The entire library
    appears deleted (it isn't: it sits under the old id in the profile's
    `Local Extension Settings/<id>/`, and removing the extension is what would
    actually destroy it). This was tried and reverted — don't try it again.
    `install.sh` computes the path-derived id instead, with `--id` for the cases
    the hash gets wrong (symlinked checkout, another clone).
  - **Reloading kills the page that asked for it**, dashboard included — so the
    button used to look like it had merely closed the extension. `reloadExtension()`
    stamps `reopenDashboardAt` first, and a top-level block in `background.js`
    (top level because that's what Chrome re-evaluates on the way back up) reads
    it and calls `openDashboard()`. The stamp is a time, not a flag: the worker
    also starts for alarms and messages, and one that outlived its reload would
    open a tab nobody asked for.
  - The stamp is a **timestamp, not a SHA**: at pre-commit time the commit's own
    hash doesn't exist yet. It also has to *order*, so a local commit that hasn't
    been pushed reads as "ahead", not as "an update is available".
  - The raw fetch is cache-busted (`?t=` + `no-store`) — raw.githubusercontent
    caches for minutes, and a stale copy would hide the very push being looked
    for. The commit *subject* comes from `api.github.com` and is optional: a
    rate-limited API just means a banner with no title.
  - Dismissing stores that build in `dismissedUpdateBuild`, so it stays quiet
    until the next push rather than the next dashboard open.
- **The toolbar counts results** (`renderResultCount`, `#resultCount`): "42 of
  380 channels", or just "380 channels" when nothing is filtered. The
  denominator is the current folder/list, so navigation never reads as a
  filtered-out count. This is why each view is split into a *universe* function
  (`channelsInCurrentFolder`, `newFeedUniverse`, `watchLaterUniverse` — folder
  scope + intrinsic exclusions) and the chips applied on top (`applyVideoChips`);
  the renderers compute the universe once and filter it, so the count costs no
  extra pass. It lives in its own element, **not** `#statusText`, because the
  two used to overwrite each other ("Refreshing…" vs "240 videos").
  - It sits in `.filter-row` — the same line as the chip bar — and not in the
    `.topbar`, where it started. The topbar wraps, and the count plus a
    **Clear filters** button was exactly the width that made it wrap: turning any
    filter on pushed the whole list down a row, and clearing pulled it back up.
    `.filter-row` doesn't wrap (the chip bar takes the slack with `flex:1;
    min-width:0` and wraps *inside itself*), has a `min-height` of one chip, and
    the Clear button is styled chip-sized — so the row is the same height empty,
    filtered, or in a video view with no chips at all. Anything added here has to
    keep that true.
- **Filter chips are two-sided.** Left click = "only these", right click = "not
  these", and clicking the side a chip already holds clears it (`toggleChipFilter`
  for the set-backed tag/language chips, `toggleTriState` for the string-backed
  Active/Finished/watched ones — `activateFilterChip` routes both mouse buttons
  into the same place). Tags and languages therefore keep **two** sets each
  (`activeTagFilters`/`excludedTagFilters`, `activeLangFilters`/
  `excludedLangFilters`) and every one of them has to be reset in
  `resetVariableFilters` and counted in `anyFilterActive`. The string-backed set
  is `filterActive`/`filterFinished`/`filterTracked` (Tracked = the
  `trackVideos` flag), and each one is five edits, not one: the `let`, the
  `has*` guard + chip in `renderTagFilters`, the `activateFilterChip` branch,
  the `.filter()` in the grid, `resetVariableFilters`, and `anyFilterActive` —
  miss either of the last two and the chip survives a folder switch or keeps
  "Clear filters" hidden while it's still hiding rows. This replaced a
  one-button cycle (off → only → not) that could only be reversed by clicking
  through, and that tags/languages never had at all. Because right-click is now
  filter UI, the tag rename/delete menu moved to **shift**+right-click.
- **Number filters scrub.** `setupNumberScrubbing()` gives every number input a
  Unity-style horizontal drag and an FM-style wheel; the native spinners are
  hidden in CSS. Two details that matter: the wheel listener is
  `{ passive: false }` (otherwise the page scrolls under the cursor) and the
  drag only begins after the pointer actually moves, so click-to-type survives.
  Values are written through `setScrubValue`, which clamps to the input's
  min/max and dispatches a real `input` event — the filter handlers listening
  for typing are the only code path, scrubbing has none of its own.
- **The year dropdowns come from the data.** `populateYearDropdowns()` lists only
  years present in `lastVideoDate` (newest first), rebuilding when that set
  changes — it's keyed on `yearOptionsKey` so the common render does nothing. A
  rebuild preserves the current selection, and if the selected year no longer
  exists it falls back to "—" **and fires `change`**, so the filter state can't
  drift from what the dropdown shows.
- **Two empty states.** `#emptyState` shows when the library is empty (zero
  channels); `#noResultsState` shows when the library is non-empty but the
  current folder + filters match nothing — with a **Clear filters** button
  (`clearAllFilters()`) shown only when `anyFilterActive()`. An empty folder with
  no filters shows the same panel with a "folder is empty" message and no button.
- **The channel list sorts on four columns, by click order.** Last Video,
  Videos, Subs and Folder each cycle off → their natural first direction →
  the other → off (`SORT_FIRST_DIR`: newest/most first for the three numeric
  ones, sidebar order first for Folder). Priority is **not fixed** — turning a
  column on moves it to the front of `sortPriority` (so "group by folder, newest
  first inside each" is Last Video *then* Folder — the later click wins). Newest
  click first, rather than appending as a tiebreaker, because appending makes a
  click on an already-outranked column do nothing visible; this way every click
  reorders the list. A fixed priority list was the old behavior
  (date, then count) and it makes every column but the first useless: grouping by
  folder is only worth anything when folder can be the *primary* key. The header
  arrow therefore carries a rank digit whenever more than one column is active,
  since an arrow alone can't say which column is doing the grouping. Adding a
  fifth sortable column means: a `let`, an entry in `SORT_KEYS`, `SORT_FIRST_DIR`
  and `SORT_COMPARATORS`, a branch in `sortDirOf`/`setSortDirOf`, the
  `data-sort` attribute in `dashboard.html`, and the `chrome.storage.local.set`
  in the header click handler. `sortPriority` is filtered against `SORT_KEYS` on
  load and any missing key appended — a key absent from the priority list would
  never be compared at all, which is exactly what an older build's stored list
  would have done to the new columns.
  - **Folder sorts by sidebar position, not name.** `buildFolderOrderIndex()`
    ranks folders by `buildOrderedFolderList()`, the same order the sidebar and
    the row's dropdown already show — so a custom drag order is respected.
    Alphabetical would match neither. The index is rebuilt each filter pass
    (a rename or a drag changes it), and an unknown `folderId` sorts last.
- **Subs shows the whole number.** `formatSubscribers` used to compact to one
  decimal ("2.3K"), which collapsed a ~50-subscriber spread into one string —
  fine as a glance, useless in a column you can sort by. It's `toLocaleString()`
  now, which is why the Subs column's default width and `COL_MINS[3]` went up.
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
- **Last Video is tinted by recency.** `dateAgeClass()` puts each date in a
  bucket — this/last month, this year, the two years before, the two before
  those, older — and the `.date-age-*` classes color it (blue → green → yellow →
  orange → red, tokens in `:root`). Every bucket is measured against `new Date()`
  at render time, so **never hardcode a year here**; the buckets have to slide
  forward on their own. A missing/unparseable date gets no class on purpose.
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

Video API details correct existing scraped author/channel identity and discard a wrong-channel avatar. Saved videos without channelUrl receive a details pass with an API key; reviewed imports recheck identity even if duration is cached.

Language choices live in shared/languages.js: an offline 48-language catalog with canonical aliases, plus the four-language default. Settings edits a cancellable languagesDraft; languages remains the synced active selection. Dashboard options/filters use only active canonical names, while old channel assignments are preserved and inactive assignments display “Inactive.” No prompt-based language additions remain.

Settings uses one viewport-bounded 620 × 680px shell across all tabs; only settings-content scrolls and the action footer stays anchored. Playlist title extraction ranks dedicated title anchors above explicit title attributes and never uses thumbnail text or text length as a title heuristic. API snippet titles correct stored metadata; legacy Turkish/English badge-only titles trigger a details pass for saved videos.

## Mobile web app

`mobile/platform.js` adapts Chrome storage/runtime APIs to IndexedDB, BroadcastChannel,
and Web Locks, then loads the shared worker module in the page. `withLibraryWrite`
uses the optional platform lock; desktop retains its existing queue. `dashboardReady`
is exported so mobile controls attach only after dashboard initialization.
`SAVE_VIDEO {videoId, folderId?}` validates the destination and uses the same
save/enrichment flow as the desktop context menu.

`mobile/bootstrap.js` adds link input, touch Actions menus, and install/offline UI.
`mobile/links.js` reads public/unlisted playlists through the Data API, using
videoOwnerChannelId/videoOwnerChannelTitle, never the playlist owner's identity.
Imports retain the existing review-before-apply protocol. No native iOS Share
Extension or private-playlist OAuth exists yet. There are no background mobile
alarms and no automatic Gist application.

`scripts/build-mobile.js` transforms a copy of the dashboard into `dist/server/index.js`
with embedded allowlisted assets and an offline shell service worker. `mobile/server.js`
only proxies fixed public oEmbed/RSS endpoints and never receives library credentials.
The Sites project ID is in `.openai/hosting.json`; reuse it. Build after committing
because the pre-commit hook stamps version.json. `tests/mobile.test.js` covers link
validation, playlist ownership, metadata proxy restrictions, and save/lock behavior.
