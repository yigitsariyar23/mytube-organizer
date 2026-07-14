// background.js — MV3 service worker (module)
// Storage schema:
//   channels: { [channelId]: { id, name, handle, thumbnail, folderId, tags:[tagId,...],
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

// ---------- Setup ----------

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["channels", "folders", "tags"]);
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
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MIN });
});

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

  // 2) Last video date: via RSS feed, without spending quota
  await Promise.allSettled(
    channelIds.map(async (id) => {
      const date = await fetchLastVideoDate(id);
      if (channels[id]) {
        if (date) channels[id].lastVideoDate = date;
        channels[id].lastFetched = Date.now();
      }
    })
  );

  await chrome.storage.local.set({ channels });

  stats.missingThumbs = channelIds.filter((id) => !channels[id]?.thumbnail).length;
  return stats;
}

async function fetchLastVideoDate(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!res.ok) return null;
    const text = await res.text();
    // The feed's first <published> is the channel's creation date — the video
    // dates live inside <entry> elements. Entries are newest-first, but take the
    // max to be safe. No DOMParser in service workers, so scan with a regex.
    const entriesStart = text.indexOf("<entry>");
    if (entriesStart === -1) return null;
    const dates = [...text.slice(entriesStart).matchAll(/<published>([^<]+)<\/published>/g)].map((m) => m[1]);
    if (!dates.length) return null;
    return dates.reduce((a, b) => (b > a ? b : a));
  } catch (e) {
    return null;
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

    const local = await chrome.storage.local.get(["channels", "folders", "tags"]);
    const localState = {
      channels: local.channels || {},
      folders: local.folders || {},
      tags: local.tags || {},
    };

    let remoteState = null;
    if (gistId) remoteState = await fetchGistState(gistToken, gistId);

    if (direction === "download" && !remoteState) {
      return { ok: false, error: gistId ? "Gist has no usable state yet." : "No Gist found — upload first to create one." };
    }
    if (!remoteState) remoteState = { channels: {}, folders: {}, tags: {} };

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
        if (changes.length) modified.push({ id, name: sc.name, handle: sc.handle, changes });
      }
    }

    for (const [id, tc] of Object.entries(tgtCh)) {
      if (!srcCh[id]) removed.push({ id, name: tc.name, handle: tc.handle });
    }

    return { ok: true, direction, channels: { added, removed, modified } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function applyUpload(removeFromGistIds = []) {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    let gistId = await resolveGistId(gistToken);

    const local = await chrome.storage.local.get(["channels", "folders", "tags"]);
    let uploadChannels = { ...(local.channels || {}) };

    // Re-include any Gist-only channels the user chose to keep
    if (gistId) {
      const remoteState = await fetchGistState(gistToken, gistId);
      if (remoteState) {
        const removeSet = new Set(removeFromGistIds);
        for (const [id, rc] of Object.entries(remoteState.channels || {})) {
          if (!uploadChannels[id] && !removeSet.has(id)) uploadChannels[id] = rc;
        }
      }
    }

    const uploadState = {
      channels: uploadChannels,
      folders: local.folders || {},
      tags: local.tags || {},
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

    const local = await chrome.storage.local.get(["channels", "folders"]);
    const removeSet = new Set(removeLocalIds);

    // Start with Gist channels, then re-add local-only channels user chose to keep
    const channels = { ...remoteState.channels };
    for (const [id, lc] of Object.entries(local.channels || {})) {
      if (!channels[id] && !removeSet.has(id)) channels[id] = lc;
    }

    // Gist folders win, but keep local folders referenced by preserved local-only channels
    const folders = { ...(local.folders || {}), ...remoteState.folders };

    const lastSyncedAt = Date.now();
    await chrome.storage.local.set({ channels, folders, tags: remoteState.tags || {}, gistId, lastSyncedAt });
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

    const local = await chrome.storage.local.get(["channels", "folders", "tags"]);
    const localState = {
      channels: local.channels || {},
      folders: local.folders || { unsorted: { name: "Unsorted", order: 0 } },
      tags: local.tags || {},
    };
    const merged = remoteState ? mergeStates(localState, remoteState) : localState;
    await chrome.storage.local.set(merged);

    const body = {
      description: "MyTube Organizer sync data",
      files: { [GIST_FILENAME]: { content: JSON.stringify(merged, null, 2) } },
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
