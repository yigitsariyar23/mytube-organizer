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
  dashboard.html                      the whole UI (dashboard page + its <dialog>s)
  dashboard.css                       MyTube brand block + app-specific layout (on top of the kit)
  dashboard.js                        UI logic: render, filter/sort, folders/tags, dialogs, events
content-scripts/
  scrape-subscriptions.js             runs only on youtube.com/feed/channels; scrapes channel links
native-host/
  mytube-updater.py                   OPTIONAL, runs OUTSIDE the browser: native messaging host
                                        that git-pulls this checkout for the update banner
  install.sh                          registers it per browser profile (per device, one-time)
shared/ui/                            VENDORED design-language kit (tokens, components, ui.js) — see "Design language"
version.json                          build stamp (UTC), rewritten by .githooks/pre-commit
.githooks/pre-commit                  stamps version.json; enable with `git config core.hooksPath .githooks`
icons/                                EMPTY — no packaged icon (manifest icon keys commented out)
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
  lastVideoDate,            // ISO string, from the RSS feed
  videoCount,               // number | null (null until fetched with an API key)
  subscriberCount,          // number | null (null if hidden or not yet fetched); shown in the list
  lastFetched,              // epoch ms of the last stats refresh (drives merge freshness)
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
  channelThumbnail,         // string | absent — channel avatar url for saved videos whose channel ISN'T a
                            //   subscription (subscriptions read the avatar from `channels`); filled by
                            //   fillChannelThumbnails (API snippet), so the Watch Later card shows a photo
  thumbnail, watched,
  viewCount,                // number | null — from RSS media:statistics (free), refreshed by the API
  duration,                 // seconds | null (API contentDetails); undefined = "not yet fetched"
  live,                     // "none" | "live" | "upcoming" (API snippet.liveBroadcastContent)
  kind,                     // "video" | "short" | "live" | absent — category. "short" from an RSS
                            //   /shorts/ link; any kind from the category playlist a fetch read
                            //   it from. RSS's "video" is only a hint: it never overwrites a kind
                            //   already set, and mergeVideo prefers short/live over it. Absent =
                            //   unclassified, shown and filtered as "video" (videoKind())
  hidden,                   // bool — user-dismissed from the New feed; kept so a refresh won't re-add it
  saved,                    // bool — in Watch Later
  folderId,                 // which Watch Later list ("unsorted" default); only meaningful when saved
  userStateAt,              // epoch ms | absent — when the user last changed watched/saved/hidden/
                            //   folderId. Stamped automatically by the dashboard's saveVideos()
                            //   (it diffs against videoStateSnapshot) and by the background's own
                            //   saves; sync resolves those four fields last-writer-wins from it
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
languages                                                     // string[] — editable language dropdown set (Settings, or
                                                              //   "+ New language…" in the right-click language submenu)
sortDate, sortCount, sortSubs, sortFolder, sortPriority,       // one direction per sortable channel-list
  folderSort, currentView                                     //   column ("none"|"asc"|"desc") plus their
                                                              //   click-order priority; and the other
                                                              //   persisted UI prefs ("channels"|"new"|
                                                              //   "watchlater"). Per-device — NOT synced
colWidths                                                    // number[5] | absent — resized px widths of the 5 sized table columns
jobProgress: { kind, done, total, startedAt }                // a refresh ("refresh") or video fetch ("fetch") over 2+ channels in
                                                              //   progress; removed when it ends. Per-device, never synced/backed up
pendingScan: { scannedAt, scannedCount, unresolved, added[], modified[], removed[] }
              // a scan awaiting review; never applied to `channels` until confirmed, never synced
pendingPlaylistImport: { playlistId, title, fetchedAt, statedCount, scrapedCount, videos[] }
              // a scraped playlist awaiting review; each video carries { id, title, published,
              // thumbnail, channelId, author, status:"new"|"savedElsewhere", currentFolderId }.
              // statedCount = the page's "N videos"; scrapedCount = how many we captured (a
              // shortfall warns the user to re-scroll). Never applied until confirmed, never synced
```

- **Folder nesting is one level deep.** A folder with children is a "group";
  channels only live in leaf folders (the worker repairs strays into a
  "General" child — see "Design language"). `unsorted` (labelled "Unfiled") is the
  fixed home and can't be renamed, reparented or deleted.
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
| `CANCEL_JOB` | — | `{ ok }`; running refresh/fetch jobs stop at their next step and return `cancelled: true` |
| `FILL_MISSING_AVATARS` | — | `{ ok, hasApiKey, missingBefore, thumbsFilled, missingAfter, apiFailures, lastError }` |
| `FILL_VIDEO_DETAILS` | — | `{ ok, hasApiKey, queried, filled, apiFailures, lastError }` (fills video length/views) |
| `FETCH_ALL_VIDEOS` | `{ channelIds, kinds?, limit? }` | `{ ok, hasApiKey, channels, total, added, byKind, apiFailures, lastError, failures[] }` (fetch uploads per category — `kinds` ⊆ `video`/`short`/`live`, omitted = plain uploads playlist; `limit` = newest N per playlist, null = full history; `failures` = `{ id, name, error }` per skipped channel) |
| `PLAYLIST_SCAN_RESULT` | `{ playlistId, title, videos, statedCount, scrapedCount }` (from the injected scraper) | `{ ok, count }`; stashes `pendingPlaylistImport`, opens dashboard |
| `APPLY_PLAYLIST_IMPORT` | `{ listName, moveIds }` | `{ ok, listId, added, moved }` (creates a Watch Later list, saves the reviewed playlist into it) |
| `DISCARD_PLAYLIST_IMPORT` | — | `{ ok }` (clears `pendingPlaylistImport`) |
| `FETCH_SYNC_DIFF` | `{ direction }` | `{ ok, direction, channels: { added, removed, modified } }` |
| `APPLY_UPLOAD` | `{ removeFromGistIds, skipVideoIds }` | `{ ok, gistId, lastSyncedAt }` |
| `APPLY_DOWNLOAD` | `{ removeLocalIds, skipVideoIds }` | `{ ok, gistId, lastSyncedAt }` |

The dashboard also reacts to `chrome.storage.onChanged` so background writes
(auto-refresh, a scan that finished while it was closed) update the UI live.

## Data flows worth knowing

- **Catch-up on open.** The 3-hour alarm is the only *background* trigger, and
  its first fire is 3 hours after install — so a device left closed showed stale
  data until it happened to run. `catchUpOnOpen()` (dashboard `init`, after the
  `onChanged` listener is wired) fires `REFRESH_STATS` if no channel has been
  fetched in 3 hours. **YouTube data only — it never touches the gist.**
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
  - **Writing the store.** It's one storage key, so any background job that reads
    it and writes back minutes later (stats refresh, `FETCH_ALL_VIDEOS`, detail
    backfill) would clobber whatever the dashboard wrote meanwhile — a video
    marked watched mid-refresh used to un-mark itself. Those jobs read via
    `readVideoStore()` and write via `commitVideos(store, seenIds, extra)`, which
    re-reads storage, re-applies the user-owned fields (`USER_VIDEO_FLAGS`:
    watched/saved/hidden/folderId), and keeps ids that appeared after the read
    (`seenIds` distinguishes those from ones `pruneVideos` dropped on purpose).
  - **New (RSS feed).** `fetchChannelVideos` parses the *full* `<entry>` list
    (not just the max date) for every `trackVideos` channel and upserts each into
    `videos` (`upsertChannelVideos`), preserving `watched` across refreshes;
    `pruneVideos` caps history per channel *and kind* (so fetched Shorts/streams
    don't push regular videos out) and drops videos whose channel
    untracked/vanished (saved ones survive; the cap also spares anything else
    `isUserTouched`). No API key or quota. Rendered
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
    per-channel/bulk (channel right-click → "Fetch videos…") or from the New
    toolbar ("Fetch videos…", over the tracked channels in the selected folder or
    all of them) — both open the same dialog (`openFetchVideosModal`).
    **Fetching by category.** YouTube keeps undocumented per-category variants of
    every uploads playlist: swap the `UU` prefix for `UULF` (long-form videos, no
    Shorts), `UUSH` (Shorts) or `UULV` (past live streams) — `categoryPlaylistId`.
    The dialog's `kinds` pages only those playlists and stamps each video's `kind`;
    a 404 on one means the channel has nothing in that category and is *not* a
    failure. `limit` (the dialog's "Latest 50") stops paging early and does **not**
    set `fetchedAll` — only a full-history fetch does. Premieres also carry
    `liveStreamingDetails` in the API, which is why streams are classified only
    from `UULV`, never from `videos.list`.
    **Filtering by category.** The Videos/Shorts/Streams chips in the video
    toolbar (`activeKindFilters`/`excludedKindFilters`, two-sided like the tag
    chips) filter both video views in `applyVideoChips`, and are reset by
    `clearAllFilters` and counted in `anyFilterActiveInView`.
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
  - **Watch Later.** Saved videos (`saved:true`) organized into `videoFolders`
    (a second, independent folder tree with the *same* nesting/drag/emoji/rename
    rules as channel folders). Its own list sidebar; a video's `folderId` is its
    list. Right-click a card → move to list / remove. Removing only clears
    `saved` + `folderId` — for a manual save too, whose record is then a tombstone
    (see the sync notes); a tracked channel's video simply returns to the New feed.
- **The folder sidebar is domain-generalized.** One `#folderList` and one set of
  folder functions serve both trees; `fdom()` returns the active domain (channel
  `folders` + `currentFolderId` for Channels/New, `videoFolders` + `currentListId`
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
  same diff), the video store (a **count summary** — too many to review per item),
  and the mirrored settings, computed against the *effective* apply result (upload
  uses `mergeSettings`, download overlays picked remote keys) so the preview
  matches reality. Folders/lists/settings apply as a whole; **channel removals and
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
  the target lacks), modified rows first, capped at `VIDEO_DIFF_LIMIT` with the
  overflow reported as `truncated`. The review lists them behind a "Show the N
  video changes" button, each ticked; unticking sends the id back as
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

## Design language

The dashboard follows the shared organizer design language —
`~/other-projects/design-language/DESIGN.md` is the source of truth (MyTube and
MyGram are one product under two brands). Its kit is vendored into
`shared/ui/` (`tokens.css`, `components.css`, `ui.js`, `KIT_VERSION`) by
`~/other-projects/design-language/sync.sh`. **Never edit `shared/ui/` here**:
change `design-language/kit/` and re-run `sync.sh <this checkout>` (keep kit
changes additive — MyGram uses it too). `dashboard.html` loads tokens.css →
components.css → dashboard.css, and dashboard.css only sets the MyTube brand
block (`--accent #edbc6b`, `--accent-dim #584727`, `--accent-text #1a1408`) plus
app-specific layout; buttons, inputs, chips, Selects, menus, dialogs, toasts,
scrollbars, rows, avatars, dates and the marquee come from the kit. The mobile
build copies `shared/ui/` too (`scripts/build-mobile.js`).

- **No native controls** (§3): no `<select>`, `confirm()`, `alert()` or
  `prompt()`. Selects are kit `createSelect` (folder sort, year filters,
  selection modifier, dialog Selects) or `selectButtonHtml` + `openListbox`
  (row language/folder cells, delegated in the channel-grid click handler).
  Checkboxes/radios/switches are real inputs with `.ui-check`/`.ui-radio`/
  `.ui-switch`; number fields are `bindNumberField` (drag, type, or the wheel when
  `controls.wheelAdjustsNumbers`; the year Selects take the wheel too).
  `tests/browser-fixture.js` makes `confirm`/`alert`/`prompt` throw.
- **Dialogs** are `<dialog class="ui-dialog">` opened with kit `openDialog` and
  wired once in `bindDialogs()` (`bindDialog`: backdrop/Esc close, focus returns;
  `busy` refuses closing while a review applies (`applyingReview`) or a shortcut
  is being recorded). Check `.open`, never `.hidden`. Folder/list/tag create and
  rename are `promptDialog`s; every delete/clear/import/restore is a
  `confirmDialog`. Esc on the scan / playlist review only sets it aside — the
  `#reviewBanner` ("A scan is waiting for review. [Review]") brings it back;
  Discard drops it. The only `.modal` overlay left is the mobile build's injected
  save panel (generic Esc/focus code in `bindKeyboardControls` is for it).
- **Menus** are kit `openMenu` (cascading flyouts, keyboard, Esc restores
  focus): `showChannelContextMenu` (title = channel name), `showBulkContextMenu`
  (title "N channels"), `showFolderContextMenu`, `showTagContextMenu`
  (shift+right-click a tag chip: rename, color, delete), `showVideoContextMenu` /
  `showVideoBulkContextMenu`. Right-click on a row outside the selection resets
  the selection to that row first. Folder pickers in menus are
  `folderMenuItems` (groups cascade into children; ✓ marks the current value).
- **Undo for every library edit** (§9). `persistLibrary(values, { undo })`
  takes the toast's description of the edit; every dashboard edit passes one.
  It records `editChanges(baseline, values)` (shared/library.js) for
  non-video collections and the worker-stamped flags for videos, then
  `showUndo(label, …)`. Undo (`undoEdit`) runs `revertEdit`, which restores the
  before-state only of records whose *edited fields* still equal the after-state
  — a refresh or avatar landing meanwhile is neither reverted nor blocks the
  undo; a record edited again or deleted meanwhile is skipped, never
  resurrected — and sends that as a normal patch with `undo: false`; video flags
  still go through `UNDO_VIDEOS`. One level; Mod+Z (`triggerUndo`) runs it. Scan/
  sync applies, restores and settings are not undoable (they snapshot instead),
  and restore/clear drop the pending undo (`hideUndo`).
- **Edits are selection-aware.** `editChannels`/`editVideos` mutate state,
  re-render, prune the selection to rows still in view, and persist once.
  `setChannelFlag`, `moveChannels`, `setChannelLanguage`, `setChannelTag`,
  `createTagOn`, `deleteChannels`, `setVideosWatched`, `setVideosHidden`,
  `removeFromWatchLater`, `moveVideosToList` all take id lists; inline row/card
  controls pass `channelSel.targetsFor(id)` / `videoSel.targetsFor(id)`, so on a
  selected row they act on the whole selection. Bulk actions keep the selection.
- **Selection** (§6) is two kit `Selection`s, `channelSel` and `videoSel`
  (never persisted; cleared on view or folder change). Mod-click toggles,
  Shift-click is a *new* range from the anchor, Mod+Shift-click adds the range;
  Mod is the Controls selection modifier (`selectionModifierPressed`). Ranges
  and Mod+A use the whole filtered list (`getFilteredChannels` /
  `currentVideoOrder`), so unrendered rows count. `bindSelectionControls` attaches
  the kit marquee to `#channelList` and both video grids (`.list-area` reaches
  into the main padding and leaves 120px under the last row, so there's always
  empty space to start from) and handles the fixed everyday keys: Mod+A selects
  all in view, Esc clears the selection when no menu/dialog/popover is open.
  `#selectionCount` shows "N selected". Mod+A and Esc are not in the recordable
  catalog (`shared/controls.js` reserves Mod+A for the browser).
- **Rows → folders drag** (§10): channel rows are `draggable`; the payload is
  `CHANNEL_DRAG_TYPE` (the row or its selection), the ghost is a kit
  `.drag-ghost` pill. Real non-group folders accept (`.drop-into`); All/Filed and
  groups refuse. Folder drags use zones 25/50/25 (`computeFolderDropIntent`
  returns `{ type, zone, valid }`): an invalid nesting still shows its indicator
  and is refused on drop with the toast "Only one level of nesting."
- **Groups hold no channels** (§11). `repairLibraryGroups` / `repairGroupItems`
  (shared/library.js) move items filed directly in a folder with subfolders into
  its child named "General" (created with the deterministic id
  `general-<parentId>` so two devices create the same one). The worker runs it
  after every `PATCH_LIBRARY`, on install, on a sync download and in
  `validateBackup` (restore/import). Creating the first subfolder of a folder
  that holds items (dialog or drag-nesting) moves those items into it.
- **Tag popover** (`openTagPopover`, kit `openPopover`): every tag with ✓ when
  all targets have it; clicks toggle and the popover stays open; the "+ New tag
  (Enter)" field is always present and focused; × deletes a tag everywhere
  (confirmed, undoable). It anchors to a point, since a toggle re-renders the
  row it was opened from.
- **Progress box** (§4). `REFRESH_STATS` and `FETCH_ALL_VIDEOS` over 2+
  channels run inside the worker's `runJob`, which mirrors `jobProgress` and
  checks `jobGeneration` between steps; `CANCEL_JOB` bumps it, so the job stops
  at its next step and commits what it already read (`result.cancelled`).
  `renderJobStatus` shows "Refreshing d/t · ~N min" + Stop while it runs, then the
  result line ("Done · N failed") with × once a job this page started ends. A
  fresh worker clears a stale `jobProgress` (jobs live in worker memory). Named
  failures stay in `#refreshErrors` (kit `.ui-errors`) with Retry failed channels.

## Conventions

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
  2. **These docs.** `CLAUDE.md` for anything that changes how the code works
     (a new message type, a storage key, a data-flow rule, a gotcha worth not
     rediscovering) and `README.md` for anything the user can see or do. Both in
     the same commit as the change, not after it — a doc that lags is worse than
     one that's missing, because it gets believed.
- Vanilla everything. New UI = a `render*()` function reading from `state` +
  event delegation in `bindEvents()`. `state` in `dashboard.js` mirrors storage.
- Always `escapeHtml()` any channel/folder/tag text interpolated into
  `innerHTML`.
- The service worker owns cross-cutting storage writes (scan apply, refresh,
  sync); the dashboard writes for direct user edits (move folder, add tag,
  rename). Both persist by writing whole objects back to
  `chrome.storage.local`.
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
  through, and that tags/languages never had at all. The two sides must differ in
  **shape**, not shade (one rule at the end of `dashboard.css`): a true
  exclusion (tags, languages, video categories) is unfilled, dashed red, struck
  through with a ✕; a chip that *renames* itself on right click (Inactive,
  Unfinished, Untracked, Watched) is a dashed outline in its flag color — a ✕
  there would read as a double negative. Both sides used to be tints of one
  color, and a later "softened fills" block made them almost identical. Because right-click is now
  filter UI, the tag rename/delete menu moved to **shift**+right-click.
- **Number filters are kit NumberFields.** `setupNumberFields()` binds the
  count and DD/MM inputs with `bindNumberField` (drag sideways, type, or the
  wheel when `controls.wheelAdjustsNumbers`); its `onChange` is the only path
  into the filter state.
- **The year Selects come from the data.** `populateYearDropdowns()` lists only
  years present in `lastVideoDate` (newest first) in the two kit Selects
  (`yearSelects.after/before`), rebuilding when that set changes (keyed on
  `yearOptionsKey`). A rebuild keeps the selection; if the year no longer exists
  it falls back to "—" and re-reads the filter (`onDateFilterChange`), so the
  filter state can't drift from what the Select shows.
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
  long date for the numeric `DD/MM/YY` one (kit `dateCellHtml`).
- **Last Video is tinted by recency.** The cell is the kit's `dateCellHtml`
  (`colored: true`): `ageClass()` buckets the date (this/last month, this year,
  the two years before, the two before those, older → blue/green/yellow/orange/
  red) against `new Date()` at render time, so **never hardcode a year**; a
  missing date gets no class. The cell is a container: under 100px it shows
  `DD/MM/YY`.
- **Multi-select, menus, undo, drag-and-drop:** see "Design language" above.

## Cruft (not part of the extension)

`scraped-ids.txt`, `csv-ids.txt`, and `check-missing.sh` are one-off developer
tools for diffing scraped IDs against a Google Takeout export. They hold personal
subscription data and a hardcoded local path, so they're **untracked** (kept
locally, listed in `.gitignore`) and are not part of the shipped extension.
