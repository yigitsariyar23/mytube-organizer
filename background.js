// background.js — MV3 service worker (module)
// Storage schema:
//   channels: { [channelId]: { id, name, handle, thumbnail, folderId, tags:[tagId,...],
//                               lastVideoDate, videoCount, subscriberCount, lastFetched } }
//   folders:  { [folderId]: { name, order } }
//   tags:     { [tagId]: { name, color } }
//   apiKey:   string (YouTube Data API v3 key, entered by the user in Settings)
//   gistToken:    string (GitHub personal access token with the "gist" scope, for cross-device sync)
//   gistId:       string (id of the secret gist holding the synced state)
//   lastSyncedAt: number (epoch ms of the last successful gist sync)

const API_BASE = "https://www.googleapis.com/youtube/v3";
const GIST_API = "https://api.github.com/gists";
const GIST_FILENAME = "mytube-organizer.json";
const ALARM_NAME = "mytube-refresh";
const REFRESH_PERIOD_MIN = 180; // auto-refresh every 3 hours

// ---------- Setup ----------

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["channels", "folders", "tags"]);
  if (!data.channels) await chrome.storage.local.set({ channels: {} });
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

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard/dashboard.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }
});

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPED_CHANNELS") {
    mergeScrapedChannels(msg.channels).then((n) => sendResponse({ ok: true, added: n }));
    return true;
  }
  if (msg.type === "RESOLVE_HANDLES") {
    resolveHandles(msg.channels).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "REFRESH_STATS") {
    refreshAllChannelStats().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "REFRESH_SINGLE") {
    refreshChannelStats([msg.channelId]).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "SYNC_GIST") {
    syncWithGist().then(sendResponse);
    return true;
  }
});

// ---------- Write scraped channels to storage ----------

async function mergeScrapedChannels(scraped) {
  const { channels = {} } = await chrome.storage.local.get("channels");
  let added = 0;
  for (const ch of scraped) {
    if (!ch.channelId) continue;
    if (!channels[ch.channelId]) {
      channels[ch.channelId] = {
        id: ch.channelId,
        name: ch.name,
        handle: ch.handle || null,
        thumbnail: ch.thumbnail || null,
        folderId: "unsorted",
        tags: [],
        lastVideoDate: null,
        videoCount: null,
        subscriberCount: null,
        lastFetched: null,
      };
      added++;
    } else {
      channels[ch.channelId].name = ch.name;
      if (ch.handle) channels[ch.channelId].handle = ch.handle;
      if (ch.thumbnail) channels[ch.channelId].thumbnail = ch.thumbnail;
    }
  }
  await chrome.storage.local.set({ channels });
  return added;
}

// ---------- Resolve handle-only (@channel) entries to channelIds ----------
// With an API key: channels.list with forHandle (1 unit / channel).
// Without one: fetch the channel page and read the canonical UC id out of it.

async function resolveHandles(list) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const { channels = {} } = await chrome.storage.local.get("channels");

  const knownHandles = new Set(
    Object.values(channels)
      .map((c) => c.handle?.toLowerCase())
      .filter(Boolean)
  );
  const pending = list.filter((c) => !knownHandles.has(c.handle.toLowerCase()));

  for (const group of chunk(pending, 5)) {
    await Promise.allSettled(
      group.map(async (c) => {
        const id = (apiKey && (await resolveHandleViaApi(c.handle, apiKey))) ||
          (await resolveHandleViaPage(c.handle));
        if (id && !channels[id]) {
          channels[id] = {
            id,
            name: c.name,
            handle: c.handle,
            thumbnail: c.thumbnail,
            folderId: "unsorted",
            tags: [],
            lastVideoDate: null,
            videoCount: null,
            subscriberCount: null,
            lastFetched: null,
          };
        } else if (!id) {
          console.warn("could not resolve handle:", c.handle);
        }
      })
    );
    // write per batch so the dashboard fills in while long lists resolve
    await chrome.storage.local.set({ channels });
  }
}

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
    const res = await fetch(`https://www.youtube.com/${encodeURIComponent(handle)}`);
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
  const { channels } = await chrome.storage.local.get("channels");
  await refreshChannelStats(Object.keys(channels));
}

async function refreshChannelStats(channelIds) {
  if (!channelIds.length) return;
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const { channels = {} } = await chrome.storage.local.get("channels");

  // 1) Video count / subscriber count: if an API key is set, in batches of 50 (1 unit/call)
  if (apiKey) {
    for (const group of chunk(channelIds, 50)) {
      try {
        const url = `${API_BASE}/channels?part=statistics&id=${group.join(",")}&key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn("channels.list failed:", res.status, await res.text());
          continue;
        }
        const data = await res.json();
        for (const item of data.items || []) {
          if (channels[item.id]) {
            channels[item.id].videoCount = Number(item.statistics.videoCount ?? 0);
            channels[item.id].subscriberCount = item.statistics.hiddenSubscriberCount
              ? null
              : Number(item.statistics.subscriberCount ?? 0);
          }
        }
      } catch (e) {
        console.warn("channels.list error:", e);
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
}

async function fetchLastVideoDate(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!res.ok) return null;
    const text = await res.text();
    // No DOMParser in service workers; the RSS structure is fixed, so a regex is enough.
    const match = text.match(/<published>([^<]+)<\/published>/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- Cross-device sync via a secret GitHub Gist ----------
// Pull the gist, merge it with local state (union — deletions don't propagate),
// write the merged state locally, then push it back. The gist is found by
// filename, so pasting the same token on another device is the whole setup.

async function syncWithGist() {
  const { gistToken } = await chrome.storage.local.get("gistToken");
  if (!gistToken) return { ok: false, error: "No GitHub token set in Settings." };

  try {
    let { gistId } = await chrome.storage.local.get("gistId");
    if (!gistId) gistId = await findExistingGist(gistToken);

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
