// background.js — MV3 service worker (module)
// Storage schema:
//   channels: { [channelId]: { id, name, handle, thumbnail, folderId, tags:[tagId,...],
//                               language, active, finished,
//                               lastVideoDate, videoCount, subscriberCount, lastFetched } }
//   folders:  { [folderId]: { name, order, parentId?, emoji? } }
//   tags:     { [tagId]: { name, color } }
//   apiKey:   string (YouTube Data API v3 key, entered by the user in Settings)
//   gistToken:    string (GitHub personal access token with the "gist" scope, for cross-device sync)
//   gistId:       string (id of the secret gist holding the synced state)
//   lastSyncedAt: number (epoch ms of the last successful gist sync)
//   pendingScan:  { scannedAt, scannedCount, unresolved, added[], modified[], removed[] }
//                 — a scan awaiting review in the dashboard; not applied to
//                   `channels` until the user confirms, and never synced.

const API_BASE = "https://www.googleapis.com/youtube/v3";
const GIST_API = "https://api.github.com/gists";
const GIST_FILENAME = "mytube-organizer.json";
const ALARM_NAME = "mytube-refresh";
const REFRESH_PERIOD_MIN = 180; // auto-refresh every 3 hours
const YT_CHANNELS_BATCH = 50; // YouTube channels.list max ids per call
const HANDLE_RESOLVE_CONCURRENCY = 5; // parallel handle->id lookups per batch
const VIDEO_KEEP_PER_CHANNEL = 60; // cap stored videos per tracked channel

// Settings mirrored into the gist alongside the library. gistToken/gistId/
// lastSyncedAt are deliberately excluded: the token is the credential used to
// reach the gist (never store it inside), and the ids are per-device bookkeeping.
const SYNC_SETTING_KEYS = ["apiKey", "languages", "sortDate", "sortCount", "folderSort"];

async function readLocalSettings() {
  const data = await chrome.storage.local.get(SYNC_SETTING_KEYS);
  const out = {};
  for (const k of SYNC_SETTING_KEYS) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

// Non-empty local values win; otherwise adopt remote. Lets a fresh device pull
// the apiKey and language set while an actively-edited device keeps its own.
function mergeSettings(local = {}, remote = {}) {
  const merged = {};
  for (const k of SYNC_SETTING_KEYS) {
    if (remote[k] !== undefined) merged[k] = remote[k];
    const v = local[k];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (!empty) merged[k] = v;
  }
  return merged;
}

// Pull only the known setting keys out of a remote gist payload's settings blob.
function pickRemoteSettings(remoteSettings = {}) {
  const out = {};
  for (const k of SYNC_SETTING_KEYS) if (remoteSettings[k] !== undefined) out[k] = remoteSettings[k];
  return out;
}

// Notification icon — inlined so it works without packaged icon files (icons/ ships empty).
const NOTIFY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmUlEQVR4nO3QMREAIBDAsLeFAfyrwAbIyECH7L3OWfv+bHSA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AHaA4QDQjvkAUiZAAAAAElFTkSuQmCC";

// Fire an OS notification for channels flagged active/finished that gained a new
// video in a refresh. `updated` is [{ name, active, finished }, ...].
function notifyTrackedUpdates(updated) {
  if (!updated.length) return;
  const label = (u) => `${u.name}${u.finished ? " (finished)" : u.active ? " (active)" : ""}`;
  const lines = updated.slice(0, 5).map(label);
  if (updated.length > 5) lines.push(`…and ${updated.length - 5} more`);
  try {
    chrome.notifications.create(`mytube-tracked-${Date.now()}`, {
      type: "basic",
      iconUrl: NOTIFY_ICON,
      title:
        updated.length === 1
          ? "A tracked channel has a new video"
          : `${updated.length} tracked channels have new videos`,
      message: lines.join("\n"),
      priority: 1,
    });
  } catch (e) {
    console.warn("notifications.create failed:", e);
  }
}

// ---------- Setup ----------

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["channels", "folders", "tags", "videoFolders", "videos"]);
  if (!data.channels) await chrome.storage.local.set({ channels: {} });
  else await repairDoubledNames(data.channels);
  if (!data.folders) {
    await chrome.storage.local.set({
      folders: { unsorted: { name: "Unsorted", order: 0 } },
    });
  } else if (data.folders.unsorted?.name === "Klasörsüz") {
    // migrate the default folder name from the old Turkish UI
    data.folders.unsorted.name = "Unsorted";
    await chrome.storage.local.set({ folders: data.folders });
  }
  if (!data.tags) await chrome.storage.local.set({ tags: {} });
  // Watch Later lists mirror channel folders: a pinned "unsorted" home list.
  if (!data.videoFolders) {
    await chrome.storage.local.set({ videoFolders: { unsorted: { name: "Unsorted", order: 0 } } });
  }
  // Backfill folderId on any pre-existing saved videos so they land in a list.
  if (data.videos) {
    let touched = false;
    for (const v of Object.values(data.videos)) {
      if (v.saved && !v.folderId) { v.folderId = "unsorted"; touched = true; }
    }
    if (touched) await chrome.storage.local.set({ videos: data.videos });
  }
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MIN });
  setupContextMenus();
});

// The context menus also need (re)creating when the worker cold-starts, not only
// on install — onInstalled doesn't fire on browser restart / worker wake.
chrome.runtime.onStartup?.addListener(() => setupContextMenus());

// ---------- "Save to Watch Later" context menu (YouTube pages) ----------

const CTX_SAVE_ID = "mytube-save-watchlater";
const YT_VIDEO_TARGETS = [
  "*://*.youtube.com/watch*",
  "*://*.youtube.com/shorts/*",
  "*://youtu.be/*",
];

// Recreate the right-click items idempotently (removeAll first avoids duplicate-id
// errors when this runs on both install and startup).
function setupContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    // Right-click a video link/thumbnail anywhere on YouTube.
    chrome.contextMenus.create({
      id: CTX_SAVE_ID + "-link",
      title: "Save to MyTube Watch Later",
      contexts: ["link"],
      targetUrlPatterns: YT_VIDEO_TARGETS,
    });
    // Right-click anywhere on a watch/shorts page itself.
    chrome.contextMenus.create({
      id: CTX_SAVE_ID + "-page",
      title: "Save to MyTube Watch Later",
      contexts: ["page", "video"],
      documentUrlPatterns: YT_VIDEO_TARGETS,
    });
  });
}

chrome.contextMenus?.onClicked.addListener(async (info) => {
  if (!info.menuItemId.startsWith(CTX_SAVE_ID)) return;
  const videoId = extractVideoId(info.linkUrl || info.pageUrl || "");
  if (!videoId) {
    notify("mytube-save", "MyTube", "Couldn't find a YouTube video in that link.");
    return;
  }
  await saveVideoToWatchLater(videoId);
});

// Pull an 11-char video id out of a watch / shorts / youtu.be URL.
function extractVideoId(url) {
  if (!url) return null;
  const m =
    url.match(/[?&]v=([0-9A-Za-z_-]{11})/) ||
    url.match(/\/shorts\/([0-9A-Za-z_-]{11})/) ||
    url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/) ||
    url.match(/\/embed\/([0-9A-Za-z_-]{11})/);
  return m ? m[1] : null;
}

// Add a video to the Watch Later store. Title/author come from YouTube's public
// oEmbed endpoint (no API key, no quota); the thumbnail is derived from the id.
async function saveVideoToWatchLater(videoId) {
  const { videos = {}, videoFolders = {} } = await chrome.storage.local.get(["videos", "videoFolders"]);
  if (!videoFolders.unsorted) videoFolders.unsorted = { name: "Unsorted", order: 0 };

  const existing = videos[videoId];
  if (existing && existing.saved) {
    notify("mytube-save", "Already saved", existing.title || "This video is already in Watch Later.");
    return;
  }

  let title = existing?.title || `Video ${videoId}`;
  let author = existing?.author || null;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const meta = await res.json();
      if (meta.title) title = meta.title;
      if (meta.author_name) author = meta.author_name;
    }
  } catch (e) {
    // Keep the fallback title; the save still succeeds offline.
  }

  videos[videoId] = {
    ...(existing || {}),
    id: videoId,
    channelId: existing?.channelId || null,
    title,
    author,
    published: existing?.published || null,
    thumbnail: existing?.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    viewCount: existing?.viewCount ?? null,
    watched: existing?.watched || false,
    saved: true,
    folderId: existing?.folderId || "unsorted",
    addedAt: existing?.addedAt || Date.now(),
  };
  // Fill length + view count immediately if an API key is set (duration isn't
  // available any other way); otherwise the card just shows no length.
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (apiKey && videos[videoId].duration === undefined) {
    await fillVideoDetails(videos, apiKey, [videoId]);
  }
  await chrome.storage.local.set({ videos, videoFolders });
  notify("mytube-save", "Saved to Watch Later", title);
}

// Generic single-line OS notification.
function notify(idPrefix, title, message) {
  try {
    chrome.notifications.create(`${idPrefix}-${Date.now()}`, {
      type: "basic",
      iconUrl: NOTIFY_ICON,
      title,
      message,
      priority: 0,
    });
  } catch (e) {
    console.warn("notifications.create failed:", e);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await refreshAllChannelStats();
  // keep devices converged in the background; a no-op unless a token is set
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (gistToken) await syncWithGist();
});

// ---------- Toolbar icon click -> open / focus the dashboard ----------

chrome.action.onClicked.addListener(() => openDashboard());

async function openDashboard() {
  const url = chrome.runtime.getURL("dashboard/dashboard.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }
}

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCAN_RESULT") {
    handleScanResult(msg.channels).then(sendResponse);
    return true;
  }
  if (msg.type === "APPLY_SCAN") {
    applyScan(msg.removeIds || []).then(sendResponse);
    return true;
  }
  if (msg.type === "DISCARD_SCAN") {
    chrome.storage.local.remove("pendingScan").then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "REFRESH_STATS") {
    refreshAllChannelStats().then((r) => sendResponse(r || { ok: true }));
    return true;
  }
  if (msg.type === "REFRESH_SINGLE") {
    refreshChannelStats([msg.channelId]).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "FILL_MISSING_AVATARS") {
    fillMissingAvatars().then((r) => sendResponse(r || { ok: true }));
    return true;
  }
  if (msg.type === "FILL_VIDEO_DETAILS") {
    fillMissingVideoDetails().then((r) => sendResponse(r || { ok: true }));
    return true;
  }
  if (msg.type === "FETCH_ALL_VIDEOS") {
    fetchAllVideosForChannels(msg.channelIds || []).then(sendResponse);
    return true;
  }
  if (msg.type === "SYNC_GIST") {
    syncWithGist().then(sendResponse);
    return true;
  }
  if (msg.type === "FETCH_SYNC_DIFF") {
    computeSyncDiff(msg.direction).then(sendResponse);
    return true;
  }
  if (msg.type === "APPLY_UPLOAD") {
    applyUpload(msg.removeFromGistIds || []).then(sendResponse);
    return true;
  }
  if (msg.type === "APPLY_DOWNLOAD") {
    applyDownload(msg.removeLocalIds || []).then(sendResponse);
    return true;
  }
});

// A scraper bug (fixed) saved every channel name doubled ("Zach Star Zach
// Star"). Halve names that are an exact "X X" repetition. A genuinely doubled
// name like "Duran Duran" was stored quadrupled by the same bug, so halving
// is correct for it too; the next scan re-syncs names from YouTube anyway.
async function repairDoubledNames(channels) {
  let changed = false;
  for (const ch of Object.values(channels)) {
    const name = ch.name || "";
    const mid = (name.length - 1) / 2;
    if (name.length >= 3 && name[mid] === " " && name.slice(0, mid) === name.slice(mid + 1)) {
      ch.name = name.slice(0, mid);
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ channels });
}

// ---------- Turn a scrape into a reviewable diff ----------
// A scan no longer writes to `channels` directly. It resolves every scraped
// entry to a channelId, diffs the resulting set against the stored library,
// stashes the result in `pendingScan`, and pops the dashboard so the user can
// review adds / modifications / removals before anything is committed.

async function handleScanResult(scraped) {
  const pendingScan = await computeScanDiff(scraped);
  await chrome.storage.local.set({ pendingScan });
  await openDashboard();
  return {
    ok: true,
    added: pendingScan.added.length,
    modified: pendingScan.modified.length,
    removed: pendingScan.removed.length,
  };
}

async function computeScanDiff(scraped) {
  const { apiKey, channels = {} } = await chrome.storage.local.get(["apiKey", "channels"]);

  // Known handles resolve for free against the stored library.
  const idByHandle = new Map();
  for (const c of Object.values(channels)) {
    if (c.handle) idByHandle.set(c.handle.toLowerCase(), c.id);
  }

  const scrapedById = new Map(); // id -> { id, name, handle, thumbnail }
  const needResolve = [];
  for (const c of scraped) {
    if (c.channelId) {
      addScraped(scrapedById, c.channelId, c);
    } else if (c.handle) {
      const known = idByHandle.get(c.handle.toLowerCase());
      if (known) addScraped(scrapedById, known, c);
      else needResolve.push(c);
    }
  }

  // Handle-only channels new to us need a network lookup to get their UC id.
  // Any that fail are counted so the dashboard can warn that the "removed"
  // list may include still-subscribed channels this scan simply missed.
  let unresolved = 0;
  for (const group of chunk(needResolve, HANDLE_RESOLVE_CONCURRENCY)) {
    const results = await Promise.allSettled(
      group.map(async (c) => {
        const id =
          (apiKey && (await resolveHandleViaApi(c.handle, apiKey))) ||
          (await resolveHandleViaPage(c.handle));
        return { c, id };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.id) addScraped(scrapedById, r.value.id, r.value.c);
      else unresolved++;
    }
  }

  const added = [];
  const modified = [];
  for (const [id, s] of scrapedById) {
    const existing = channels[id];
    if (!existing) {
      added.push({ id, name: s.name, handle: s.handle, thumbnail: s.thumbnail });
      continue;
    }
    // Don't count a card that yielded no real name (fell back to the handle or
    // "Unknown channel") as a rename that would clobber a good stored name.
    const realName = s.name && s.name !== "Unknown channel" && s.name !== s.handle;
    const nameChanged = realName && s.name !== existing.name;
    const handleChanged = s.handle && s.handle !== existing.handle;
    if (nameChanged || handleChanged) {
      modified.push({
        id,
        name: nameChanged ? s.name : existing.name,
        handle: handleChanged ? s.handle : existing.handle,
        thumbnail: s.thumbnail,
        oldName: existing.name,
        oldHandle: existing.handle,
      });
    }
  }

  const removed = [];
  for (const [id, c] of Object.entries(channels)) {
    if (!scrapedById.has(id)) removed.push({ id, name: c.name, handle: c.handle });
  }

  return {
    scannedAt: Date.now(),
    scannedCount: scrapedById.size,
    unresolved,
    added,
    modified,
    removed,
  };
}

// Fold duplicate scraped rows for one channel into a single record, keeping the
// first non-empty name / handle / thumbnail we saw.
function addScraped(map, id, c) {
  const prev = map.get(id);
  if (!prev) {
    map.set(id, { id, name: c.name || "", handle: c.handle || null, thumbnail: c.thumbnail || null });
    return;
  }
  if (!prev.name && c.name) prev.name = c.name;
  if (!prev.handle && c.handle) prev.handle = c.handle;
  if (!prev.thumbnail && c.thumbnail) prev.thumbnail = c.thumbnail;
}

// ---------- Commit a reviewed scan ----------
// Adds and modifications are always applied; removals only for the ids the user
// explicitly ticked in the review dialog (and only if they were genuine
// "removed" candidates). Organizing data — folder, tags, stats — is preserved
// on modification and only lost when a channel is deliberately removed.

async function applyScan(removeIds = []) {
  const { pendingScan, channels = {} } = await chrome.storage.local.get(["pendingScan", "channels"]);
  if (!pendingScan) return { ok: false, error: "No pending scan to apply." };

  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const a of pendingScan.added || []) {
    if (!channels[a.id]) {
      channels[a.id] = {
        id: a.id,
        name: a.name || a.handle || "Unknown channel",
        handle: a.handle || null,
        thumbnail: a.thumbnail || null,
        folderId: "unsorted",
        tags: [],
        language: null,
        active: false,
        finished: false,
        lastVideoDate: null,
        videoCount: null,
        subscriberCount: null,
        lastFetched: null,
      };
      added++;
    }
  }

  for (const m of pendingScan.modified || []) {
    const ch = channels[m.id];
    if (!ch) continue;
    if (m.name) ch.name = m.name;
    if (m.handle) ch.handle = m.handle;
    if (m.thumbnail) ch.thumbnail = m.thumbnail;
    modified++;
  }

  const allowedRemovals = new Set((pendingScan.removed || []).map((r) => r.id));
  for (const id of removeIds) {
    if (allowedRemovals.has(id) && channels[id]) {
      delete channels[id];
      removed++;
    }
  }

  await chrome.storage.local.set({ channels });
  await chrome.storage.local.remove("pendingScan");
  return { ok: true, added, modified, removed };
}

// ---------- Resolve a handle (@channel) to its channelId ----------
// With an API key: channels.list with forHandle (1 unit / channel).
// Without one: fetch the channel page and read the canonical UC id out of it.

async function resolveHandleViaApi(handle, apiKey) {
  try {
    const url = `${API_BASE}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.id || null;
  } catch (e) {
    return null;
  }
}

async function resolveHandleViaPage(handle) {
  try {
    // Keep the leading "@" literal and encode only the (possibly non-ASCII)
    // handle body, so Unicode handles like @DeğişikYollarda resolve correctly.
    const body = handle.startsWith("@") ? handle.slice(1) : handle;
    const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(body)}`);
    if (!res.ok) return null;
    const text = await res.text();
    const match =
      text.match(/youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/) ||
      text.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/) ||
      text.match(/"browseId":"(UC[0-9A-Za-z_-]{22})"/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

// ---------- Stats refresh ----------

async function refreshAllChannelStats() {
  const { channels = {} } = await chrome.storage.local.get("channels");
  return refreshChannelStats(Object.keys(channels), channels);
}

// Cheap, targeted avatar backfill: query snippet only for channels that are
// missing a thumbnail — no per-channel RSS date fetches, no statistics. Fewer
// API calls than a full refresh (ceil(missing/50) vs ceil(total/50)) and far
// less network, since it skips the one-request-per-channel RSS pass.
async function fillMissingAvatars() {
  const { apiKey, channels = {} } = await chrome.storage.local.get(["apiKey", "channels"]);

  const missing = Object.keys(channels).filter((id) => !channels[id].thumbnail);
  const stats = { ok: true, hasApiKey: !!apiKey, missingBefore: missing.length, thumbsFilled: 0, apiCalls: 0, apiFailures: 0, lastError: null };
  if (!apiKey || !missing.length) {
    stats.missingAfter = missing.length;
    return stats;
  }

  for (const group of chunk(missing, YT_CHANNELS_BATCH)) {
    stats.apiCalls++;
    try {
      const url = `${API_BASE}/channels?part=snippet&id=${group.join(",")}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        console.warn("channels.list (avatars) failed:", res.status, body);
        stats.apiFailures++;
        stats.lastError = describeApiError(res, body);
        continue;
      }
      const data = await res.json();
      for (const item of data.items || []) {
        const ch = channels[item.id];
        if (!ch) continue;
        const thumbUrl = pickThumbnailUrl(item);
        if (thumbUrl) { ch.thumbnail = thumbUrl; stats.thumbsFilled++; }
      }
    } catch (e) {
      console.warn("channels.list (avatars) error:", e);
      stats.apiFailures++;
      stats.lastError = String(e?.message || e);
    }
  }

  await chrome.storage.local.set({ channels });
  stats.missingAfter = Object.keys(channels).filter((id) => !channels[id].thumbnail).length;
  return stats;
}

async function refreshChannelStats(channelIds, preloaded) {
  if (!channelIds.length) return { ok: true, queried: 0 };
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const channels = preloaded ?? (await chrome.storage.local.get("channels")).channels ?? {};

  // Diagnostics so a refresh can explain itself (why avatars/counts didn't fill).
  const stats = { ok: true, hasApiKey: !!apiKey, queried: channelIds.length, apiItems: 0, apiFailures: 0, thumbsFilled: 0, lastError: null };

  // 1) Video count / subscriber count / avatar: with an API key, batches of 50 (1 unit/call)
  if (apiKey) {
    for (const group of chunk(channelIds, YT_CHANNELS_BATCH)) {
      try {
        const url = `${API_BASE}/channels?part=snippet,statistics&id=${group.join(",")}&key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text();
          console.warn("channels.list failed:", res.status, body);
          stats.apiFailures++;
          stats.lastError = describeApiError(res, body);
          continue;
        }
        const data = await res.json();
        for (const item of data.items || []) {
          const ch = channels[item.id];
          if (!ch) continue;
          stats.apiItems++;
          // A missing statistics/snippet on one channel must not abort the rest
          // of the batch, so guard each field independently.
          if (item.statistics) {
            ch.videoCount = Number(item.statistics.videoCount ?? 0);
            ch.subscriberCount = item.statistics.hiddenSubscriberCount
              ? null
              : Number(item.statistics.subscriberCount ?? 0);
          }
          // Backfill the avatar the scrape may have missed (lazy-loaded images
          // aren't captured).
          const thumbUrl = pickThumbnailUrl(item);
          if (thumbUrl) { ch.thumbnail = thumbUrl; stats.thumbsFilled++; }
        }
      } catch (e) {
        console.warn("channels.list error:", e);
        stats.apiFailures++;
        stats.lastError = String(e?.message || e);
      }
    }
  }

  // 2) Last video date + tracked-channel video feed: via RSS, without spending
  // quota. Track which active/finished channels gained a newer video so we can
  // notify about them, and stash the recent uploads of `trackVideos` channels.
  const trackedUpdates = [];
  const { videos: videoStore = {} } = await chrome.storage.local.get("videos");
  const now = Date.now();
  await Promise.allSettled(
    channelIds.map(async (id) => {
      const ch = channels[id];
      const prevDate = ch?.lastVideoDate || null;
      const { lastVideoDate, videos } = await fetchChannelVideos(id);
      if (ch) {
        if (lastVideoDate) ch.lastVideoDate = lastVideoDate;
        ch.lastFetched = now;
        if (lastVideoDate && lastVideoDate !== prevDate && (ch.active || ch.finished)) {
          trackedUpdates.push({ name: ch.name, active: !!ch.active, finished: !!ch.finished });
        }
        if (ch.trackVideos) upsertChannelVideos(videoStore, id, videos, now);
      }
    })
  );
  pruneVideos(videoStore, channels);
  // Duration isn't in RSS — backfill it (and fresher view counts) via the API
  // when a key is set. Only newly-seen videos are queried, so this is cheap.
  if (apiKey) {
    const vd = await fillVideoDetails(videoStore, apiKey);
    stats.videoDetailsFilled = vd.filled;
    if (vd.lastError && !stats.lastError) stats.lastError = vd.lastError;
  }

  await chrome.storage.local.set({ channels, videos: videoStore });
  notifyTrackedUpdates(trackedUpdates);

  stats.missingThumbs = channelIds.filter((id) => !channels[id]?.thumbnail).length;
  stats.trackedUpdates = trackedUpdates.length;
  return stats;
}

// Fetch a channel's RSS feed and parse its recent video entries (newest-first).
// Returns { lastVideoDate, videos: [{ videoId, title, published, thumbnail }] }.
// The feed's leading <published> is the channel's creation date — video dates
// live inside <entry> elements. No DOMParser in a service worker, so each
// <entry>…</entry> block is sliced out and scanned with regexes.
async function fetchChannelVideos(channelId) {
  const empty = { lastVideoDate: null, videos: [] };
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!res.ok) return empty;
    const text = await res.text();
    const videos = [];
    for (const part of text.split("<entry>").slice(1)) {
      const block = part.slice(0, part.indexOf("</entry>"));
      const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
      const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1];
      if (!videoId || !published) continue;
      const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      // The RSS feed carries a live-ish view count in media:community. Duration
      // is NOT in RSS — it's filled later via the API (fillVideoDetails).
      const viewsMatch = block.match(/<media:statistics views="(\d+)"/);
      videos.push({
        videoId,
        title: decodeXml(rawTitle).replace(/\s+/g, " ").trim(),
        published,
        viewCount: viewsMatch ? Number(viewsMatch[1]) : null,
        // Derive the thumbnail from the id — always valid, no parsing needed.
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      });
    }
    if (!videos.length) return empty;
    const lastVideoDate = videos.reduce((a, v) => (v.published > a ? v.published : a), videos[0].published);
    return { lastVideoDate, videos };
  } catch (e) {
    return empty;
  }
}

// Minimal XML entity decode for RSS video titles (no DOMParser in a worker).
// &amp; is resolved last so double-encoded sequences unwind left-to-right.
function decodeXml(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Merge freshly fetched RSS entries into the persistent video store, preserving
// each video's user state (watched / saved / addedAt) across refreshes.
function upsertChannelVideos(store, channelId, videos, now) {
  for (const v of videos) {
    const existing = store[v.videoId];
    if (existing) {
      existing.title = v.title || existing.title;
      existing.thumbnail = v.thumbnail || existing.thumbnail;
      existing.published = v.published || existing.published;
      existing.channelId = channelId;
      if (v.viewCount != null) existing.viewCount = v.viewCount;
    } else {
      store[v.videoId] = {
        id: v.videoId,
        channelId,
        title: v.title,
        published: v.published,
        thumbnail: v.thumbnail,
        viewCount: v.viewCount ?? null,
        watched: false,
        saved: false,
        addedAt: now,
      };
    }
  }
}

// A video still needs an API detail fetch if its length is unknown, or it was
// last seen live/upcoming (its status — and eventual real duration — changes
// once the stream ends, so keep re-querying those).
function videoNeedsDetails(v) {
  return v.duration === undefined || v.live === "live" || v.live === "upcoming";
}

// Fill video duration + view count + live status via the Data API — none of
// these (duration especially) are in the RSS feed. Batches of 50 (1 quota unit
// each). `snippet.liveBroadcastContent` tells us live/upcoming vs a real video.
// Returns diagnostics so callers can explain why lengths did/didn't fill.
async function fillVideoDetails(store, apiKey, ids) {
  const pending = ids || Object.keys(store).filter((id) => videoNeedsDetails(store[id]));
  const out = { queried: pending.length, filled: 0, apiFailures: 0, lastError: null, changed: false };
  for (const group of chunk(pending, YT_CHANNELS_BATCH)) {
    try {
      const url = `${API_BASE}/videos?part=contentDetails,statistics,snippet&id=${group.join(",")}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        console.warn("videos.list failed:", res.status, body);
        out.apiFailures++;
        out.lastError = describeApiError(res, body);
        continue;
      }
      const data = await res.json();
      const seen = new Set();
      for (const item of data.items || []) {
        const v = store[item.id];
        if (!v) continue;
        seen.add(item.id);
        const duration = parseIsoDuration(item.contentDetails?.duration);
        const live = item.snippet?.liveBroadcastContent || "none";
        const views = item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : v.viewCount ?? null;
        if (v.duration !== duration || v.live !== live || v.viewCount !== views) out.changed = true;
        v.duration = duration;
        v.live = live;
        v.viewCount = views;
        out.filled++;
      }
      // Private/deleted ids never come back — mark them so they aren't re-queried.
      for (const id of group) if (!seen.has(id) && store[id] && store[id].duration === undefined) { store[id].duration = null; store[id].live = "none"; out.changed = true; }
    } catch (e) {
      console.warn("videos.list error:", e);
      out.apiFailures++;
      out.lastError = String(e?.message || e);
    }
  }
  return out;
}

// Fill lengths/views for any videos still missing them (dashboard-triggered when
// a video view opens with an API key set — so lengths appear without a manual
// full refresh). Persists only when something actually changed.
async function fillMissingVideoDetails() {
  const { apiKey, videos = {} } = await chrome.storage.local.get(["apiKey", "videos"]);
  if (!apiKey) return { ok: false, hasApiKey: false, filled: 0 };
  const result = await fillVideoDetails(videos, apiKey);
  if (result.changed) await chrome.storage.local.set({ videos });
  return { ok: true, hasApiKey: true, ...result };
}

// A channel's uploads playlist id is usually its channel id with UC → UU, but
// not always — some channels have a different uploads playlist that 404s under
// the shortcut, so this is only a fallback for `resolveUploadsPlaylists`.
function uploadsPlaylistId(channelId) {
  return channelId && channelId.startsWith("UC") ? "UU" + channelId.slice(2) : null;
}

// Look up each channel's real uploads-playlist id via channels.list
// (contentDetails.relatedPlaylists.uploads) — the reliable source. 1 unit / 50.
async function resolveUploadsPlaylists(channelIds, apiKey) {
  const map = {};
  for (const group of chunk(channelIds, YT_CHANNELS_BATCH)) {
    try {
      const url = `${API_BASE}/channels?part=contentDetails&id=${group.join(",")}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.items || []) {
        const up = item.contentDetails?.relatedPlaylists?.uploads;
        if (up) map[item.id] = up;
      }
    } catch (e) {
      /* fall back to the UU shortcut per-channel */
    }
  }
  return map;
}

// Page through a channel's entire uploads playlist (50/page) to get ALL its
// videos — the RSS feed only exposes the latest ~15. 1 quota unit per page.
async function fetchAllUploads(playlistId, apiKey) {
  if (!playlistId) return { videos: [], error: "no uploads playlist" };
  const videos = [];
  let pageToken = "";
  let error = null;
  for (let page = 0; page < 400; page++) { // safety cap: 400*50 = 20k videos
    const url = `${API_BASE}/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}${pageToken ? `&pageToken=${pageToken}` : ""}&key=${apiKey}`;
    let res;
    try { res = await fetch(url); } catch (e) { error = String(e?.message || e); break; }
    if (!res.ok) {
      const body = await res.text();
      // A 404 here usually means the channel has no public uploads playlist.
      error = describeApiError(res, body);
      break;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId;
      const published = item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt;
      const title = (item.snippet?.title || "").replace(/\s+/g, " ").trim();
      if (!videoId || !published) continue;
      if (title === "Private video" || title === "Deleted video") continue;
      videos.push({ videoId, title, published, viewCount: null, thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return { videos, error };
}

// Deep-fetch every upload for the given channels via the API, exempt them from
// the per-channel cap (`fetchedAll`), auto-track them so the videos show, then
// backfill lengths/views/live status. Dashboard-triggered (`FETCH_ALL_VIDEOS`).
async function fetchAllVideosForChannels(channelIds) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) return { ok: false, hasApiKey: false };
  const { channels = {}, videos: store = {} } = await chrome.storage.local.get(["channels", "videos"]);
  const now = Date.now();
  const result = { ok: true, hasApiKey: true, channels: 0, added: 0, total: 0, apiFailures: 0, lastError: null };
  // Resolve real uploads-playlist ids up front (falls back to the UU shortcut).
  const uploads = await resolveUploadsPlaylists(channelIds.filter((id) => channels[id]), apiKey);
  for (const id of channelIds) {
    if (!channels[id]) continue;
    const { videos, error } = await fetchAllUploads(uploads[id] || uploadsPlaylistId(id), apiKey);
    if (error) { result.apiFailures++; result.lastError = error; }
    const before = Object.keys(store).length;
    upsertChannelVideos(store, id, videos, now);
    channels[id].fetchedAll = true;
    channels[id].trackVideos = true; // so the pulled-in videos actually appear
    result.added += Object.keys(store).length - before;
    result.total += videos.length;
    result.channels++;
    // Persist after each channel so a long job's progress survives a worker
    // restart (and the dashboard shows videos accumulating live).
    await chrome.storage.local.set({ channels, videos: store });
  }
  // Fill duration/views/live for everything still missing them.
  await fillVideoDetails(store, apiKey);
  await chrome.storage.local.set({ videos: store });
  return result;
}

// ISO-8601 duration ("PT1H2M10S") → seconds. Returns null on empty/malformed.
function parseIsoDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

// Keep the video store bounded: drop videos whose channel is gone or no longer
// tracked, and cap per-channel history. Saved ("watch later") videos are always
// kept so a manual bookmark never disappears.
function pruneVideos(store, channels) {
  for (const [vid, v] of Object.entries(store)) {
    const ch = channels[v.channelId];
    if (!v.saved && (!ch || !ch.trackVideos)) delete store[vid];
  }
  const byChannel = {};
  for (const v of Object.values(store)) (byChannel[v.channelId] ||= []).push(v);
  for (const [channelId, list] of Object.entries(byChannel)) {
    if (channels[channelId]?.fetchedAll) continue; // full history kept intact
    if (list.length <= VIDEO_KEEP_PER_CHANNEL) continue;
    list.sort((a, b) => (a.published < b.published ? 1 : -1)); // newest first
    for (const v of list.slice(VIDEO_KEEP_PER_CHANNEL)) {
      if (!v.saved) delete store[v.id];
    }
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Prefer a mid-size, stable thumbnail URL from a channels.list snippet item.
function pickThumbnailUrl(item) {
  const t = item.snippet?.thumbnails || {};
  return t.medium?.url || t.high?.url || t.default?.url;
}

// Surface the API's own reason (quota exceeded, key not valid, referrer
// restriction) from an error body, falling back to the HTTP status.
function describeApiError(res, body) {
  try { return JSON.parse(body)?.error?.message || `HTTP ${res.status}`; }
  catch { return `HTTP ${res.status}`; }
}

// ---------- Directional sync: compute diff, upload, download ----------

// Resolve the gist id from storage, falling back to a filename lookup on the
// account. Call inside each sync try block so a findExistingGist() throw stays
// caught and reported as { ok: false, error }.
async function resolveGistId(gistToken) {
  let { gistId } = await chrome.storage.local.get("gistId");
  if (!gistId) gistId = await findExistingGist(gistToken);
  return gistId;
}

async function computeSyncDiff(direction) {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    const gistId = await resolveGistId(gistToken);

    const local = await chrome.storage.local.get(["channels", "folders", "tags", "videoFolders", "videos"]);
    const localState = {
      channels: local.channels || {},
      folders: local.folders || {},
      tags: local.tags || {},
      videoFolders: local.videoFolders || {},
      // Compare only the syncable subset — the gist holds that, not the full cache.
      videos: syncableVideos(local.videos || {}),
    };

    let remoteState = null;
    if (gistId) remoteState = await fetchGistState(gistToken, gistId);

    if (direction === "download" && !remoteState) {
      return { ok: false, error: gistId ? "Gist has no usable state yet." : "No Gist found — upload first to create one." };
    }
    if (!remoteState) remoteState = { channels: {}, folders: {}, tags: {}, videoFolders: {}, videos: {} };

    const localSettings = await readLocalSettings();
    const remoteSettings = pickRemoteSettings(remoteState.settings);

    const src = direction === "upload" ? localState : remoteState;
    const tgt = direction === "upload" ? remoteState : localState;
    const srcCh = src.channels || {};
    const tgtCh = tgt.channels || {};

    const added = [], removed = [], modified = [];

    for (const [id, sc] of Object.entries(srcCh)) {
      const tc = tgtCh[id];
      if (!tc) {
        added.push({ id, name: sc.name, handle: sc.handle });
      } else {
        const changes = [];
        if (sc.name !== tc.name) changes.push("name");
        if ((sc.folderId || "") !== (tc.folderId || "")) changes.push("folder");
        const srcTags = [...(sc.tags || [])].sort().join(",");
        const tgtTags = [...(tc.tags || [])].sort().join(",");
        if (srcTags !== tgtTags) changes.push("tags");
        if ((sc.language || "") !== (tc.language || "")) changes.push("language");
        if (!!sc.active !== !!tc.active) changes.push("active");
        if (!!sc.finished !== !!tc.finished) changes.push("finished");
        if (!!sc.trackVideos !== !!tc.trackVideos) changes.push("trackVideos");
        if (changes.length) modified.push({ id, name: sc.name, handle: sc.handle, changes });
      }
    }

    for (const [id, tc] of Object.entries(tgtCh)) {
      if (!srcCh[id]) removed.push({ id, name: tc.name, handle: tc.handle });
    }

    // Folder diff: renames, reparents, emoji changes, and add/remove by id.
    const srcFo = src.folders || {};
    const tgtFo = tgt.folders || {};
    const foAdded = [], foRemoved = [], foModified = [];
    for (const [id, sf] of Object.entries(srcFo)) {
      const tf = tgtFo[id];
      if (!tf) {
        foAdded.push({ id, name: sf.name });
      } else {
        const changes = [];
        if ((sf.name || "") !== (tf.name || "")) changes.push("name");
        if ((sf.parentId || "") !== (tf.parentId || "")) changes.push("parent");
        if ((sf.emoji || "") !== (tf.emoji || "")) changes.push("emoji");
        if ((sf.order ?? 0) !== (tf.order ?? 0)) changes.push("order");
        if (changes.length) foModified.push({ id, name: sf.name, oldName: tf.name, changes });
      }
    }
    for (const [id, tf] of Object.entries(tgtFo)) {
      if (!srcFo[id]) foRemoved.push({ id, name: tf.name });
    }

    // Watch Later list diff — identical shape/logic to the channel folder diff.
    const srcVf = src.videoFolders || {};
    const tgtVf = tgt.videoFolders || {};
    const vfAdded = [], vfRemoved = [], vfModified = [];
    for (const [id, sf] of Object.entries(srcVf)) {
      const tf = tgtVf[id];
      if (!tf) {
        vfAdded.push({ id, name: sf.name });
      } else {
        const changes = [];
        if ((sf.name || "") !== (tf.name || "")) changes.push("name");
        if ((sf.parentId || "") !== (tf.parentId || "")) changes.push("parent");
        if ((sf.emoji || "") !== (tf.emoji || "")) changes.push("emoji");
        if ((sf.order ?? 0) !== (tf.order ?? 0)) changes.push("order");
        if (changes.length) vfModified.push({ id, name: sf.name, oldName: tf.name, changes });
      }
    }
    for (const [id, tf] of Object.entries(tgtVf)) {
      if (!srcVf[id]) vfRemoved.push({ id, name: tf.name });
    }

    // Video store is too large to review per-item; summarize how many will be
    // added/updated on the target (a union merge — nothing is removed).
    const srcVids = src.videos || {};
    const tgtVids = tgt.videos || {};
    const userStateKey = (v) => `${!!v.watched}|${!!v.saved}|${!!v.hidden}|${v.folderId || ""}`;
    let vidsAdded = 0, vidsModified = 0;
    for (const [id, sv] of Object.entries(srcVids)) {
      const tv = tgtVids[id];
      if (!tv) vidsAdded++;
      else if (userStateKey(sv) !== userStateKey(tv)) vidsModified++;
    }

    // Settings diff: compare the CURRENT target value against the value the apply
    // would actually write, so the review matches the real outcome. Upload uses
    // mergeSettings (non-empty local wins); download overlays picked remote keys.
    const currentTarget = direction === "upload" ? remoteSettings : localSettings;
    const resultTarget = direction === "upload"
      ? mergeSettings(localSettings, remoteSettings)
      : { ...localSettings, ...remoteSettings };
    const settings = [];
    for (const k of SYNC_SETTING_KEYS) {
      const from = currentTarget[k];
      const to = resultTarget[k];
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
        settings.push({ key: k, from: from ?? null, to: to ?? null });
      }
    }

    return {
      ok: true,
      direction,
      channels: { added, removed, modified },
      folders: { added: foAdded, removed: foRemoved, modified: foModified },
      videoFolders: { added: vfAdded, removed: vfRemoved, modified: vfModified },
      videos: { added: vidsAdded, modified: vidsModified, srcTotal: Object.keys(srcVids).length },
      settings,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function applyUpload(removeFromGistIds = []) {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    let gistId = await resolveGistId(gistToken);

    const local = await chrome.storage.local.get(["channels", "folders", "tags", "videoFolders", "videos"]);
    let uploadChannels = { ...(local.channels || {}) };
    // Video store is union-merged with the gist (deletions don't propagate).
    let uploadVideos = { ...(local.videos || {}) };

    // Re-include any Gist-only channels the user chose to keep
    let remoteSettings = {};
    if (gistId) {
      const remoteState = await fetchGistState(gistToken, gistId);
      if (remoteState) {
        remoteSettings = remoteState.settings || {};
        const removeSet = new Set(removeFromGistIds);
        for (const [id, rc] of Object.entries(remoteState.channels || {})) {
          if (!uploadChannels[id] && !removeSet.has(id)) uploadChannels[id] = rc;
        }
        uploadVideos = mergeVideos(local.videos || {}, remoteState.videos || {});
      }
    }

    const uploadState = {
      channels: uploadChannels,
      folders: local.folders || {},
      tags: local.tags || {},
      videoFolders: local.videoFolders || {},
      videos: syncableVideos(uploadVideos), // only user-touched videos go to the gist
      settings: mergeSettings(await readLocalSettings(), remoteSettings),
    };
    const body = {
      description: "MyTube Organizer sync data",
      files: { [GIST_FILENAME]: { content: JSON.stringify(uploadState, null, 2) } },
    };

    if (gistId) {
      await ghApi(gistToken, `${GIST_API}/${gistId}`, "PATCH", body);
    } else {
      const created = await ghApi(gistToken, GIST_API, "POST", { ...body, public: false });
      gistId = created.id;
    }

    const lastSyncedAt = Date.now();
    await chrome.storage.local.set({ gistId, lastSyncedAt });
    return { ok: true, gistId, lastSyncedAt };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function applyDownload(removeLocalIds = []) {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    const gistId = await resolveGistId(gistToken);
    if (!gistId) return { ok: false, error: "No Gist found to download from." };

    const remoteState = await fetchGistState(gistToken, gistId);
    if (!remoteState) return { ok: false, error: "Gist has no usable state yet." };

    const local = await chrome.storage.local.get(["channels", "folders", "videoFolders", "videos"]);
    const removeSet = new Set(removeLocalIds);

    // Start with Gist channels, then re-add local-only channels user chose to keep
    const channels = { ...remoteState.channels };
    for (const [id, lc] of Object.entries(local.channels || {})) {
      if (!channels[id] && !removeSet.has(id)) channels[id] = lc;
    }

    // Gist folders win, but keep local folders referenced by preserved local-only channels
    const folders = { ...(local.folders || {}), ...remoteState.folders };
    // Watch Later lists: gist wins, local-only lists kept. Video store: union merge.
    const videoFolders = { ...(local.videoFolders || {}), ...(remoteState.videoFolders || {}) };
    const videos = mergeVideos(local.videos || {}, remoteState.videos || {});

    const lastSyncedAt = Date.now();
    const settings = pickRemoteSettings(remoteState.settings);
    await chrome.storage.local.set({ channels, folders, tags: remoteState.tags || {}, videoFolders, videos, gistId, lastSyncedAt, ...settings });
    return { ok: true, gistId, lastSyncedAt };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ---------- Cross-device sync via a secret GitHub Gist ----------
// Pull the gist, merge it with local state (union — deletions don't propagate),
// write the merged state locally, then push it back. The gist is found by
// filename, so pasting the same token on another device is the whole setup.

async function syncWithGist() {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    let gistId = await resolveGistId(gistToken);

    let remoteState = null;
    if (gistId) {
      remoteState = await fetchGistState(gistToken, gistId);
      if (remoteState === undefined) gistId = null; // gist was deleted on github.com
    }

    const local = await chrome.storage.local.get(["channels", "folders", "tags", "videoFolders", "videos"]);
    const localState = {
      channels: local.channels || {},
      folders: local.folders || { unsorted: { name: "Unsorted", order: 0 } },
      tags: local.tags || {},
      videoFolders: local.videoFolders || { unsorted: { name: "Unsorted", order: 0 } },
      videos: local.videos || {},
    };
    const merged = remoteState ? mergeStates(localState, remoteState) : localState;
    const mergedSettings = mergeSettings(await readLocalSettings(), remoteState?.settings);
    await chrome.storage.local.set({ ...merged, ...mergedSettings });

    // The gist carries only the user-touched video subset (see syncableVideos).
    const gistPayload = { ...merged, videos: syncableVideos(merged.videos), settings: mergedSettings };
    const body = {
      description: "MyTube Organizer sync data",
      files: { [GIST_FILENAME]: { content: JSON.stringify(gistPayload, null, 2) } },
    };
    if (gistId) {
      await ghApi(gistToken, `${GIST_API}/${gistId}`, "PATCH", body);
    } else {
      const created = await ghApi(gistToken, GIST_API, "POST", { ...body, public: false });
      gistId = created.id;
    }

    const lastSyncedAt = Date.now();
    await chrome.storage.local.set({ gistId, lastSyncedAt });
    return { ok: true, gistId, lastSyncedAt };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// undefined = gist gone (recreate), null = gist exists but has no usable state yet
async function fetchGistState(token, gistId) {
  const res = await fetch(`${GIST_API}/${gistId}`, { headers: ghHeaders(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
  const gist = await res.json();
  const file = gist.files?.[GIST_FILENAME];
  if (!file) return null;
  let content = file.content;
  if (file.truncated) {
    const raw = await fetch(file.raw_url);
    if (!raw.ok) throw new Error(`GitHub: could not fetch gist content (${raw.status})`);
    content = await raw.text();
  }
  try {
    const state = JSON.parse(content);
    return state && typeof state === "object" ? state : null;
  } catch (e) {
    return null;
  }
}

async function findExistingGist(token) {
  const res = await fetch(`${GIST_API}?per_page=100`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
  const gists = await res.json();
  return gists.find((g) => g.files?.[GIST_FILENAME])?.id || null;
}

// Union merge. Local wins on name conflicts; per-channel tags are combined,
// remote stats are adopted when fresher, and a remote folder assignment is
// adopted when this device hasn't organized the channel yet.
function mergeStates(local, remote) {
  const channels = { ...(remote.channels || {}) };
  for (const [id, lc] of Object.entries(local.channels || {})) {
    const rc = channels[id];
    if (!rc) {
      channels[id] = lc;
      continue;
    }
    const merged = { ...rc, ...lc };
    if ((!lc.folderId || lc.folderId === "unsorted") && rc.folderId && rc.folderId !== "unsorted") {
      merged.folderId = rc.folderId;
    }
    merged.tags = [...new Set([...(rc.tags || []), ...(lc.tags || [])])];
    if ((rc.lastFetched || 0) > (lc.lastFetched || 0)) {
      merged.lastVideoDate = rc.lastVideoDate;
      merged.videoCount = rc.videoCount;
      merged.subscriberCount = rc.subscriberCount;
      merged.lastFetched = rc.lastFetched;
    }
    channels[id] = merged;
  }
  return {
    channels,
    folders: { ...(remote.folders || {}), ...(local.folders || {}) },
    tags: { ...(remote.tags || {}), ...(local.tags || {}) },
    videoFolders: { ...(remote.videoFolders || {}), ...(local.videoFolders || {}) },
    videos: mergeVideos(local.videos, remote.videos),
  };
}

// The subset of the video store worth syncing: only videos the user has actually
// touched (saved, watched, dismissed, or filed into a non-default list). The rest
// — the New-feed cache and full-history dumps — is re-derivable per device from
// RSS/API, so keeping it out of the gist bounds the payload by activity, not by
// catalog size. Each device rebuilds its own cache; user state merges across.
function syncableVideos(videos = {}) {
  const out = {};
  for (const [id, v] of Object.entries(videos)) {
    if (v.saved || v.watched || v.hidden || (v.folderId && v.folderId !== "unsorted")) out[id] = v;
  }
  return out;
}

// Union-merge two video stores by id — deletions don't propagate. For a video
// present on both sides, user state is combined (watched/saved/hidden OR-ed, an
// organized list assignment preferred) and the richer metadata wins.
function mergeVideos(local = {}, remote = {}) {
  const out = { ...remote };
  for (const [id, lv] of Object.entries(local)) {
    out[id] = out[id] ? mergeVideo(lv, out[id]) : lv;
  }
  return out;
}

function mergeVideo(a, b) {
  const firstSet = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== "");
  const numDuration = [a.duration, b.duration].find((d) => typeof d === "number");
  const views = Math.max(a.viewCount ?? -1, b.viewCount ?? -1);
  const seenTimes = [a.addedAt, b.addedAt].filter((t) => typeof t === "number");
  return {
    ...b,
    ...a,
    watched: !!(a.watched || b.watched),
    saved: !!(a.saved || b.saved),
    hidden: !!(a.hidden || b.hidden),
    // Prefer a real (non-"unsorted") Watch Later list assignment from either side.
    folderId: a.folderId && a.folderId !== "unsorted" ? a.folderId
      : b.folderId && b.folderId !== "unsorted" ? b.folderId
      : a.folderId || b.folderId || "unsorted",
    duration: numDuration !== undefined ? numDuration : a.duration ?? b.duration,
    viewCount: views >= 0 ? views : null,
    live: firstSet(a.live, b.live) ?? "none",
    title: firstSet(a.title, b.title) ?? "",
    thumbnail: firstSet(a.thumbnail, b.thumbnail) ?? a.thumbnail,
    author: firstSet(a.author, b.author) ?? null,
    channelId: firstSet(a.channelId, b.channelId) ?? null,
    published: firstSet(a.published, b.published) ?? null,
    addedAt: seenTimes.length ? Math.min(...seenTimes) : Date.now(),
  };
}

async function ghApi(token, url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("GitHub: token rejected (401). Check it has the gist scope.");
    throw new Error(`GitHub: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
