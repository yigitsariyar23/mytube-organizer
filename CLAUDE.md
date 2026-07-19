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
  lastVideoDate,            // ISO string, from the RSS feed
  videoCount,               // number | null (null until fetched with an API key)
  subscriberCount,          // number | null (null if hidden or not yet fetched); shown in the list
  lastFetched,              // epoch ms of the last stats refresh (drives merge freshness)
} }
folders: { [folderId]: { name, order, parentId?, emoji? } }   // "unsorted" is pinned
tags:    { [tagId]: { name, color } }
apiKey, gistToken, gistId, lastSyncedAt                        // settings + sync bookkeeping
languages                                                     // string[] — editable language dropdown set (Settings)
sortDate, sortCount, folderSort                               // persisted UI preferences
pendingScan: { scannedAt, scannedCount, unresolved, added[], modified[], removed[] }
              // a scan awaiting review; never applied to `channels` until confirmed, never synced
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
  from each channel's RSS feed (`feeds/videos.xml`, regex-parsed — no DOMParser
  in a worker). `FILL_MISSING_AVATARS` is the cheap subset: snippet-only, only
  for channels missing a thumbnail. A refresh also fires an OS notification
  (`notifications` permission, inline icon) listing any `active`/`finished`
  channel whose `lastVideoDate` moved — the "tracked update" alert.
- **Sync.** Directional (`FETCH_SYNC_DIFF` → review → `APPLY_UPLOAD`/
  `APPLY_DOWNLOAD`) surfaces every change for confirmation. The background
  `SYNC_GIST` is a silent **union merge**: local wins on names, tags combine,
  fresher `lastFetched` wins on stats, and **deletions do not propagate**.
- **The directional review shows more than channels.** `computeSyncDiff` also
  diffs folders (add/rename/reparent/emoji) and the mirrored settings, computed
  against the *effective* apply result (upload uses `mergeSettings`, download
  overlays picked remote keys) so the preview matches reality. Those sections are
  read-only — folders/settings always apply wholesale; only channel removals are
  opt-out via checkboxes. Folder *removals* only show on upload (download keeps
  local-only folders — deletion doesn't propagate).
- **Settings ride along in the gist.** The gist payload carries a `settings`
  blob alongside `channels`/`folders`/`tags` — the keys in `SYNC_SETTING_KEYS`
  (`apiKey`, `languages`, `sortDate`, `sortCount`, `folderSort`). `mergeSettings`
  keeps non-empty local values and adopts remote for the rest, so a fresh device
  pulls the API key and language set. `gistToken` is **never** synced — it's the
  credential used to reach the gist, not content to store inside it.

## Conventions

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

## Cruft (not part of the extension)

`scraped-ids.txt`, `csv-ids.txt`, and `check-missing.sh` are one-off developer
tools for diffing scraped IDs against a Google Takeout export. They hold personal
subscription data and a hardcoded local path, so they're **untracked** (kept
locally, listed in `.gitignore`) and are not part of the shipped extension.
