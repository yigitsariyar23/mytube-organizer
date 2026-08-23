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
version.json                          build stamp (UTC), rewritten by .githooks/pre-commit
.githooks/pre-commit                  stamps version.json; enable with `git config core.hooksPath .githooks`
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
lastSyncCheckAt                                               // epoch ms of the last on-open gist check
                                                              //   (throttle only; per-device, never synced)
languages                                                     // string[] — editable language dropdown set (Settings, or
                                                              //   "+ New language…" in the right-click language submenu)
sortDate, sortCount, folderSort, currentView                  // persisted UI prefs ("channels"|"new"|"watchlater");
                                                              //   per-device — deliberately NOT synced
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
    `pruneVideos` caps history per channel and drops videos whose channel
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
    per-channel/bulk (channel right-click → "Fetch all videos") or globally
    ("Fetch full history" in the New toolbar, over all tracked channels).
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
  are not synced** (`sortDate`, `sortCount`, `folderSort`, `videoSort`,
  `currentView`, `colWidths`) — they say how one device is being looked at right
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

- **The update banner can't update anything.** `checkForAppUpdate()` (dashboard
  `init`) compares the local `version.json` build against the one on GitHub and,
  when the remote is newer, shows a banner with the last commit's subject, the
  `git pull` to run, and a **Reload extension** button. That button is the only
  part the extension can actually do — `chrome.runtime.reload()` makes Chrome
  re-read an unpacked extension from disk. There is **no way** to pull from in
  here: an MV3 worker has no shell and no filesystem (not even to its own
  folder), and Chrome's auto-update only covers Web Store installs. Don't
  "improve" this into a self-updater; it can't exist.
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
- **Filter chips are two-sided.** Left click = "only these", right click = "not
  these", and clicking the side a chip already holds clears it (`toggleChipFilter`
  for the set-backed tag/language chips, `toggleTriState` for the string-backed
  Active/Finished/watched ones — `activateFilterChip` routes both mouse buttons
  into the same place). Tags and languages therefore keep **two** sets each
  (`activeTagFilters`/`excludedTagFilters`, `activeLangFilters`/
  `excludedLangFilters`) and every one of them has to be reset in
  `resetVariableFilters` and counted in `anyFilterActive`. This replaced a
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
