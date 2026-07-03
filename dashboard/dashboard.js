// dashboard.js — MyTube Organizer main panel logic

const TAG_PALETTE = [
  "#E8B355", "#6FCF97", "#56B6E9", "#C792EA",
  "#F2777A", "#82D9C5", "#D9A86C", "#9FA8DA",
];

let state = { channels: {}, folders: {}, tags: {}, apiKey: "", gistToken: "", gistId: "", lastSyncedAt: null, pendingScan: null };
let currentFolderId = "all";
let activeTagFilters = new Set();
let searchQuery = "";
let sortDate = "desc"; // "desc" (newest first) | "asc" (oldest first) | "none"
let sortCount = "none"; // "none" | "desc" (most first) | "asc" (fewest first)
// what the folder modal is currently doing: create-folder | rename-folder | rename-tag
let folderModalMode = { type: "create-folder", id: null };

// Advanced filters
let filterMinCount = null;
let filterMaxCount = null;
let filterAfterDate = null;  // ISO date string lower bound (inclusive)
let filterBeforeDate = null; // ISO date string upper bound (inclusive)

// Infinite scroll: render channels in batches as the user scrolls near the bottom.
const PAGE_SIZE = 40;
let pendingChannels = []; // filtered channels not yet appended to the grid
let scrollObserver = null;

const el = {
  folderList: document.getElementById("folderList"),
  tagFilterBar: document.getElementById("tagFilterBar"),
  channelGrid: document.getElementById("channelGrid"),
  emptyState: document.getElementById("emptyState"),
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  scanBtn: document.getElementById("scanBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  addFolderBtn: document.getElementById("addFolderBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  gistTokenInput: document.getElementById("gistTokenInput"),
  syncUploadBtn: document.getElementById("syncUploadBtn"),
  syncDownloadBtn: document.getElementById("syncDownloadBtn"),
  syncStatus: document.getElementById("syncStatus"),
  syncDiffModal: document.getElementById("syncDiffModal"),
  syncDiffTitle: document.getElementById("syncDiffTitle"),
  syncDiffSummary: document.getElementById("syncDiffSummary"),
  syncDiffWarning: document.getElementById("syncDiffWarning"),
  syncDiffBody: document.getElementById("syncDiffBody"),
  syncDiffApply: document.getElementById("syncDiffApply"),
  syncDiffCancel: document.getElementById("syncDiffCancel"),
  settingsSave: document.getElementById("settingsSave"),
  settingsCancel: document.getElementById("settingsCancel"),
  folderModal: document.getElementById("folderModal"),
  folderModalTitle: document.getElementById("folderModalTitle"),
  folderNameLabel: document.getElementById("folderNameLabel"),
  folderNameInput: document.getElementById("folderNameInput"),
  folderSave: document.getElementById("folderSave"),
  folderCancel: document.getElementById("folderCancel"),
  contextMenu: document.getElementById("contextMenu"),
  scrollSentinel: document.getElementById("scrollSentinel"),
  listTableHeader: document.getElementById("listTableHeader"),
  main: document.querySelector(".main"),
  clearDataBtn: document.getElementById("clearDataBtn"),
  filterMinCount: document.getElementById("filterMinCount"),
  filterMaxCount: document.getElementById("filterMaxCount"),
  filterAfterDay: document.getElementById("filterAfterDay"),
  filterAfterMonth: document.getElementById("filterAfterMonth"),
  filterAfterYear: document.getElementById("filterAfterYear"),
  filterBeforeDay: document.getElementById("filterBeforeDay"),
  filterBeforeMonth: document.getElementById("filterBeforeMonth"),
  filterBeforeYear: document.getElementById("filterBeforeYear"),
  scanDiffModal: document.getElementById("scanDiffModal"),
  scanDiffSummary: document.getElementById("scanDiffSummary"),
  scanDiffWarning: document.getElementById("scanDiffWarning"),
  scanDiffBody: document.getElementById("scanDiffBody"),
  scanDiffApply: document.getElementById("scanDiffApply"),
  scanDiffCancel: document.getElementById("scanDiffCancel"),
};

init();

function populateYearDropdowns() {
  const currentYear = new Date().getFullYear();
  const years = ["—"];
  for (let y = currentYear; y >= 2005; y--) years.push(y);
  for (const sel of [el.filterAfterYear, el.filterBeforeYear]) {
    sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  }
}

async function init() {
  await loadState();
  populateYearDropdowns();
  render();
  bindEvents();

  // A scan finished while the dashboard was closed — review it on open.
  if (state.pendingScan) openScanDiffModal(state.pendingScan);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.channels) state.channels = changes.channels.newValue || {};
    if (changes.folders) state.folders = changes.folders.newValue || {};
    if (changes.tags) state.tags = changes.tags.newValue || {};
    if (changes.pendingScan) {
      state.pendingScan = changes.pendingScan.newValue || null;
      if (state.pendingScan) openScanDiffModal(state.pendingScan);
      else el.scanDiffModal.hidden = true;
    }
    render();
  });
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "channels", "folders", "tags", "apiKey", "gistToken", "gistId", "lastSyncedAt", "pendingScan",
    "sortDate", "sortCount",
  ]);
  state.channels = data.channels || {};
  state.folders = data.folders || { unsorted: { name: "Unsorted", order: 0 } };
  state.tags = data.tags || {};
  state.apiKey = data.apiKey || "";
  state.gistToken = data.gistToken || "";
  state.gistId = data.gistId || "";
  state.lastSyncedAt = data.lastSyncedAt || null;
  state.pendingScan = data.pendingScan || null;
  sortDate = data.sortDate === "asc" || data.sortDate === "none" ? data.sortDate : "desc";
  sortCount = data.sortCount === "desc" || data.sortCount === "asc" ? data.sortCount : "none";
}

// ---------- Render ----------

function render() {
  renderFolders();
  renderTagFilters();
  renderGrid();
}

function renderFolders() {
  const all = Object.values(state.channels).length;
  const items = [{ id: "all", name: "All", count: all, deletable: false }];

  const sortedFolders = Object.entries(state.folders).sort(
    (a, b) => (a[1].order ?? 0) - (b[1].order ?? 0)
  );
  for (const [id, folder] of sortedFolders) {
    const count = Object.values(state.channels).filter((c) => c.folderId === id).length;
    items.push({ id, name: folder.name, count, deletable: id !== "unsorted" });
  }

  el.folderList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "folder-item" + (item.id === currentFolderId ? " active" : "");
    li.dataset.folderId = item.id;
    li.innerHTML = `<span>${escapeHtml(item.name)}</span><span class="folder-count">${item.count}</span>`;
    el.folderList.appendChild(li);
  }
}

function renderTagFilters() {
  const bar = el.tagFilterBar;
  bar.innerHTML = "";

  // only offer tags actually used by channels in the current folder
  const channelsInFolder = Object.values(state.channels).filter(
    (c) => currentFolderId === "all" || c.folderId === currentFolderId
  );
  const available = new Set(channelsInFolder.flatMap((c) => c.tags || []));
  const entries = Object.entries(state.tags).filter(([id]) => available.has(id));

  bar.hidden = entries.length === 0;
  if (bar.hidden) return;

  const label = document.createElement("span");
  label.className = "tag-filter-label";
  label.textContent = "Filter";
  bar.appendChild(label);

  for (const [id, tag] of entries) {
    const chip = document.createElement("span");
    chip.className = "tag-chip" + (activeTagFilters.has(id) ? " active" : "");
    chip.textContent = tag.name;
    chip.style.background = activeTagFilters.has(id) ? tag.color : "";
    chip.style.borderColor = tag.color;
    chip.dataset.tagId = id;
    chip.dataset.role = "filter-tag";
    bar.appendChild(chip);
  }
}

function renderGrid() {
  pendingChannels = getFilteredChannels();
  el.channelGrid.innerHTML = "";
  el.channelGrid.classList.add("list-view");
  el.listTableHeader.hidden = false;
  el.emptyState.hidden = Object.keys(state.channels).length > 0;
  updateSortHeaders();

  appendNextPage();
  setupScrollObserver();
}

// Append the next batch of channels, then keep the sentinel positioned after them.
function appendNextPage() {
  const batch = pendingChannels.splice(0, PAGE_SIZE);
  const frag = document.createDocumentFragment();
  for (const ch of batch) frag.appendChild(buildChannelRow(ch));
  el.channelGrid.appendChild(frag);

  if (pendingChannels.length === 0 && scrollObserver) {
    scrollObserver.unobserve(el.scrollSentinel);
  }
}

// Lazily create an IntersectionObserver that appends more channels as the
// sentinel below the grid scrolls into view.
function setupScrollObserver() {
  if (!scrollObserver) {
    scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && pendingChannels.length) {
          appendNextPage();
        }
      },
      { root: el.main, rootMargin: "400px 0px" }
    );
  }
  scrollObserver.unobserve(el.scrollSentinel);
  if (pendingChannels.length) scrollObserver.observe(el.scrollSentinel);
}

function getFilteredChannels() {
  let list = Object.values(state.channels);

  if (currentFolderId !== "all") {
    list = list.filter((c) => c.folderId === currentFolderId);
  }
  if (activeTagFilters.size) {
    list = list.filter((c) => c.tags?.some((t) => activeTagFilters.has(t)));
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q)
    );
  }
  if (filterMinCount !== null) {
    list = list.filter((c) => (c.videoCount ?? 0) >= filterMinCount);
  }
  if (filterMaxCount !== null) {
    list = list.filter((c) => (c.videoCount ?? 0) <= filterMaxCount);
  }
  if (filterAfterDate) {
    list = list.filter((c) => c.lastVideoDate && c.lastVideoDate >= filterAfterDate);
  }
  if (filterBeforeDate) {
    list = list.filter((c) => c.lastVideoDate && c.lastVideoDate <= filterBeforeDate);
  }
  list.sort(compareChannels);
  return list;
}

// When enabled, last video date is the primary key; video count is applied
// next (as the sole key if date sorting is off, otherwise as a tiebreaker).
function compareChannels(a, b) {
  if (sortDate !== "none") {
    const dateDir = sortDate === "asc" ? 1 : -1;
    const dateCmp = (a.lastVideoDate || "").localeCompare(b.lastVideoDate || "");
    if (dateCmp !== 0) return dateDir * dateCmp;
  }

  if (sortCount !== "none") {
    const countDir = sortCount === "asc" ? 1 : -1;
    const ca = a.videoCount ?? -1;
    const cb = b.videoCount ?? -1;
    if (ca !== cb) return countDir * (ca - cb);
  }
  return 0;
}

function updateSortHeaders() {
  const ARROWS = { none: "", desc: " ↓", asc: " ↑" };
  for (const col of el.listTableHeader.querySelectorAll(".lth-sort-col")) {
    const key = col.dataset.sort;
    const val = key === "date" ? sortDate : sortCount;
    const arrow = col.querySelector(".lth-arrow");
    arrow.textContent = ARROWS[val] || "";
    col.classList.toggle("lth-active", val !== "none");
  }
}

function buildChannelCard(ch) {
  const card = document.createElement("div");
  card.className = "channel-card";
  card.dataset.channelId = ch.id;

  card.innerHTML = `
    <div class="channel-head">
      ${thumbHtml(ch)}
      <div class="channel-name-wrap">
        <div class="channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
        <div class="channel-handle">${escapeHtml(ch.handle || ch.id)}</div>
      </div>
    </div>
    <div class="channel-stats">
      <span title="${escapeHtml(formatAbsoluteDate(ch.lastVideoDate))}">Last video: <b>${formatRelativeDate(ch.lastVideoDate)}</b></span>
      <span>Videos: <b>${ch.videoCount ?? "—"}</b></span>
    </div>
    <div class="channel-tags">
      ${tagChipsHtml(ch)}
      <span class="tag-chip add-tag" data-role="add-tag">+ tag</span>
    </div>
    <div class="channel-controls">
      <select class="folder-select" data-role="move-folder">${folderOptionsHtml(ch)}</select>
    </div>
  `;
  return card;
}

function buildChannelRow(ch) {
  const row = document.createElement("div");
  row.className = "channel-row";
  row.dataset.channelId = ch.id;

  row.innerHTML = `
    <div class="channel-head">
      ${thumbHtml(ch)}
      <div class="channel-name-wrap">
        <div class="channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
        <div class="channel-handle">${escapeHtml(ch.handle || ch.id)}</div>
      </div>
    </div>
    <div class="row-date" title="${escapeHtml(formatAbsoluteDate(ch.lastVideoDate))}">${formatRelativeDate(ch.lastVideoDate)}</div>
    <div class="row-count">${ch.videoCount ?? "—"}</div>
    <div class="channel-tags">
      ${tagChipsHtml(ch)}
      <span class="tag-chip add-tag" data-role="add-tag">+ tag</span>
    </div>
    <div class="channel-controls">
      <select class="folder-select" data-role="move-folder">${folderOptionsHtml(ch)}</select>
    </div>
  `;
  return row;
}

function thumbHtml(ch) {
  return ch.thumbnail
    ? `<img class="channel-thumb" src="${ch.thumbnail}" alt="" onerror="this.outerHTML='<div class=&quot;channel-thumb&quot;></div>'" />`
    : `<div class="channel-thumb"></div>`;
}

function folderOptionsHtml(ch) {
  return Object.entries(state.folders)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(
      ([id, f]) =>
        `<option value="${id}" ${ch.folderId === id ? "selected" : ""}>${escapeHtml(f.name)}</option>`
    )
    .join("");
}

function tagChipsHtml(ch) {
  return (ch.tags || [])
    .map((tid) => state.tags[tid])
    .filter(Boolean)
    .map(
      (t) =>
        `<span class="tag-chip" style="border-color:${t.color};color:${t.color}" data-role="remove-tag" data-tag-name="${escapeHtml(t.name)}">${escapeHtml(t.name)} ×</span>`
    )
    .join("");
}

// ---------- Helpers ----------

function formatRelativeDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Full date + time for tooltips, e.g. "Jul 3, 2026, 2:15 PM"
function formatAbsoluteDate(iso) {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (isNaN(date)) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-çğıöşü]/g, "");
}

function nextTagColor() {
  const idx = Object.keys(state.tags).length % TAG_PALETTE.length;
  return TAG_PALETTE[idx];
}

function renderSyncStatus() {
  if (state.lastSyncedAt) {
    el.syncStatus.textContent = "Last synced: " + new Date(state.lastSyncedAt).toLocaleString();
  } else {
    el.syncStatus.textContent = state.gistToken ? "Not synced yet." : "";
  }
}

// ---------- Scan review dialog ----------

function openScanDiffModal(scan) {
  const { added = [], modified = [], removed = [], unresolved = 0, scannedCount = 0 } = scan;

  el.scanDiffSummary.textContent =
    `Scanned ${scannedCount} channel${scannedCount === 1 ? "" : "s"} — ` +
    `${added.length} new, ${modified.length} changed, ${removed.length} not seen.`;

  // Removals are destructive and can be false positives when a scan is
  // incomplete, so warn and never pre-select them.
  if (removed.length && unresolved > 0) {
    el.scanDiffWarning.hidden = false;
    el.scanDiffWarning.textContent =
      `${unresolved} channel${unresolved === 1 ? "" : "s"} couldn't be resolved this scan, so the ` +
      `“not seen” list may include channels you're still subscribed to. Removals are unchecked by ` +
      `default — only tick the ones you're sure about.`;
  } else if (removed.length) {
    el.scanDiffWarning.hidden = false;
    el.scanDiffWarning.textContent =
      `Removing a channel deletes it from MyTube along with its folder and tags. Removals are ` +
      `unchecked by default — tick only the ones you want gone.`;
  } else {
    el.scanDiffWarning.hidden = true;
  }

  el.scanDiffBody.innerHTML = "";
  el.scanDiffBody.appendChild(buildDiffSection("New channels", "add", added, false));
  el.scanDiffBody.appendChild(buildDiffSection("Name / handle changes", "mod", modified, false));
  el.scanDiffBody.appendChild(buildDiffSection("Not seen in this scan", "del", removed, true));

  el.scanDiffApply.disabled = added.length === 0 && modified.length === 0 && removed.length === 0;
  el.scanDiffModal.hidden = false;
}

// ---------- Sync review dialog ----------

let pendingSyncDiff = null;

function openSyncDiffModal(diff) {
  pendingSyncDiff = diff;
  const { direction, channels: { added, removed, modified } } = diff;
  const isUpload = direction === "upload";

  el.syncDiffTitle.textContent = isUpload ? "Review upload" : "Review download";

  const totalChanges = added.length + removed.length + modified.length;
  el.syncDiffSummary.textContent = totalChanges === 0
    ? "No differences — already in sync."
    : `${added.length} to add, ${modified.length} to overwrite, ${removed.length} to remove.`;

  if (removed.length) {
    el.syncDiffWarning.hidden = false;
    const n = removed.length;
    el.syncDiffWarning.textContent = isUpload
      ? `${n} channel${n === 1 ? "" : "s"} exist${n === 1 ? "s" : ""} in the Gist but not locally and will be removed from it. Uncheck any you want to keep in the Gist.`
      : `${n} channel${n === 1 ? "" : "s"} exist${n === 1 ? "s" : ""} locally but not in the Gist and will be removed. Uncheck any you want to keep.`;
  } else {
    el.syncDiffWarning.hidden = true;
  }

  el.syncDiffBody.innerHTML = "";
  const addLabel = isUpload ? "Will be added to Gist" : "Will be added locally";
  const delLabel = isUpload ? "Will be removed from Gist" : "Will be removed locally";
  el.syncDiffBody.appendChild(buildDiffSection(addLabel, "add", added, false));
  el.syncDiffBody.appendChild(buildDiffSection(delLabel, "del", removed, true, isUpload));
  if (modified.length) el.syncDiffBody.appendChild(buildSyncModSection(isUpload ? "Will overwrite in Gist" : "Will overwrite locally", modified));

  el.syncDiffApply.textContent = isUpload ? "Apply upload" : "Apply download";
  el.syncDiffApply.disabled = totalChanges === 0;
  el.syncDiffModal.hidden = false;
}

function buildSyncModSection(title, items) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";

  const head = document.createElement("div");
  head.className = "scan-diff-head";
  head.innerHTML =
    `<span class="scan-diff-title scan-mod">${escapeHtml(title)}</span>` +
    `<span class="folder-count">${items.length}</span>`;
  sec.appendChild(head);

  const list = document.createElement("div");
  list.className = "scan-diff-list";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "scan-diff-row scan-diff-row-link";
    if (it.id) row.dataset.channelId = it.id;
    const name = escapeHtml(it.name || it.handle || it.id);
    const sub = escapeHtml(it.handle || it.id);
    const changes = escapeHtml(it.changes.join(", "));
    row.innerHTML = `<span class="scan-diff-text"><b>${name}</b><span class="scan-diff-sub">${sub} · ${changes}</span></span>`;
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

function buildDiffSection(title, kind, items, checkable, defaultChecked = false) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";

  const head = document.createElement("div");
  head.className = "scan-diff-head";
  head.innerHTML =
    `<span class="scan-diff-title scan-${kind}">${escapeHtml(title)}</span>` +
    `<span class="folder-count">${items.length}</span>`;
  sec.appendChild(head);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "scan-diff-empty";
    empty.textContent = "None";
    sec.appendChild(empty);
    return sec;
  }

  if (checkable) {
    const all = document.createElement("label");
    all.className = "scan-diff-row scan-diff-selectall";
    all.innerHTML =
      `<input type="checkbox" data-role="select-all-removals"${defaultChecked ? " checked" : ""} /> <span>Select all for removal</span>`;
    sec.appendChild(all);
  }

  const list = document.createElement("div");
  list.className = "scan-diff-list";
  for (const it of items) {
    const main =
      kind === "mod"
        ? `${escapeHtml(it.oldName || "—")} <span class="scan-diff-arrow">→</span> <b>${escapeHtml(it.name)}</b>`
        : `<b>${escapeHtml(it.name || it.handle || it.id)}</b>`;
    const sub = escapeHtml(it.handle || it.id);
    const text = `<span class="scan-diff-text">${main}<span class="scan-diff-sub">${sub}</span></span>`;

    const row = document.createElement(checkable ? "label" : "div");
    row.className = "scan-diff-row scan-diff-row-link";
    if (it.id) row.dataset.channelId = it.id;
    row.innerHTML = checkable
      ? `<input type="checkbox" data-remove-id="${escapeHtml(it.id)}"${defaultChecked ? " checked" : ""} />${text}`
      : text;
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

// ---------- Events ----------

function bindEvents() {
  el.folderList.addEventListener("click", (e) => {
    const li = e.target.closest(".folder-item");
    if (!li) return;
    currentFolderId = li.dataset.folderId;
    activeTagFilters.clear(); // filters are per-folder-view
    render();
  });

  el.tagFilterBar.addEventListener("click", (e) => {
    const chip = e.target.closest('[data-role="filter-tag"]');
    if (!chip) return;
    const id = chip.dataset.tagId;
    if (activeTagFilters.has(id)) activeTagFilters.delete(id);
    else activeTagFilters.add(id);
    renderTagFilters();
    renderGrid();
  });

  el.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderGrid();
  });

  el.filterMinCount.addEventListener("input", (e) => {
    filterMinCount = e.target.value !== "" ? parseInt(e.target.value, 10) : null;
    renderGrid();
  });
  el.filterMaxCount.addEventListener("input", (e) => {
    filterMaxCount = e.target.value !== "" ? parseInt(e.target.value, 10) : null;
    renderGrid();
  });

  function readDateFilter(dayEl, monthEl, yearEl) {
    const year = yearEl.value;
    const day = dayEl.value;
    const month = monthEl.value;
    if (!year || year === "—") return null;
    const yy = year.padStart(4, "0");
    const mm = (month || "1").padStart(2, "0");
    const dd = (day || "1").padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  const onAfterChange = () => {
    filterAfterDate = readDateFilter(el.filterAfterDay, el.filterAfterMonth, el.filterAfterYear);
    renderGrid();
  };
  const onBeforeChange = () => {
    filterBeforeDate = readDateFilter(el.filterBeforeDay, el.filterBeforeMonth, el.filterBeforeYear);
    renderGrid();
  };
  el.filterAfterDay.addEventListener("input", onAfterChange);
  el.filterAfterMonth.addEventListener("input", onAfterChange);
  el.filterAfterYear.addEventListener("change", onAfterChange);
  el.filterBeforeDay.addEventListener("input", onBeforeChange);
  el.filterBeforeMonth.addEventListener("input", onBeforeChange);
  el.filterBeforeYear.addEventListener("change", onBeforeChange);

  el.listTableHeader.addEventListener("click", (e) => {
    const col = e.target.closest(".lth-sort-col");
    if (!col) return;
    const key = col.dataset.sort;
    const CYCLE = { none: "desc", desc: "asc", asc: "none" };
    if (key === "date") {
      sortDate = CYCLE[sortDate];
      chrome.storage.local.set({ sortDate });
    } else {
      sortCount = CYCLE[sortCount];
      chrome.storage.local.set({ sortCount });
    }
    renderGrid();
  });

  el.scanBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.youtube.com/feed/channels" });
  });

  el.refreshBtn.addEventListener("click", async () => {
    el.statusText.textContent = "Refreshing…";
    await chrome.runtime.sendMessage({ type: "REFRESH_STATS" });
    await loadState();
    render();
    el.statusText.textContent = "Last updated: " + new Date().toLocaleTimeString();
  });

  function isInteractiveTarget(t) {
    return t.closest(".tag-chip") || t.closest("select") || t.closest(".tag-input-popover");
  }

  // Folder change / tag add-remove / row clicks
  el.channelGrid.addEventListener("click", async (e) => {
    const channelCard = e.target.closest("[data-channel-id]");
    if (!channelCard) return;
    const channelId = channelCard.dataset.channelId;

    if (e.target.dataset.role === "remove-tag") {
      const tagName = e.target.dataset.tagName;
      const tagId = Object.keys(state.tags).find((id) => state.tags[id].name === tagName);
      if (tagId) {
        state.channels[channelId].tags = state.channels[channelId].tags.filter((t) => t !== tagId);
        await chrome.storage.local.set({ channels: state.channels });
      }
      return;
    }

    if (e.target.dataset.role === "add-tag") {
      openTagInput(channelCard, channelId);
      return;
    }

    // Left-click anywhere on the row that isn't a tag/select opens the channel
    if (!isInteractiveTarget(e.target)) {
      chrome.tabs.create({ url: `https://www.youtube.com/channel/${channelId}/videos` });
    }
  });

  // Middle-click: open in background tab without leaving the dashboard
  el.channelGrid.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const channelCard = e.target.closest("[data-channel-id]");
    if (!channelCard) return;
    if (!isInteractiveTarget(e.target)) {
      e.preventDefault();
      chrome.tabs.create({ url: `https://www.youtube.com/channel/${channelCard.dataset.channelId}/videos`, active: false });
    }
  });

  el.channelGrid.addEventListener("change", async (e) => {
    if (e.target.dataset.role !== "move-folder") return;
    const channelCard = e.target.closest("[data-channel-id]");
    const channelId = channelCard.dataset.channelId;
    state.channels[channelId].folderId = e.target.value;
    await chrome.storage.local.set({ channels: state.channels });
    renderFolders();
    if (currentFolderId !== "all") renderGrid();
  });

  // Settings modal
  el.settingsBtn.addEventListener("click", () => {
    el.apiKeyInput.value = state.apiKey || "";
    el.gistTokenInput.value = state.gistToken || "";
    renderSyncStatus();
    el.settingsModal.hidden = false;
  });
  el.settingsCancel.addEventListener("click", () => (el.settingsModal.hidden = true));
  el.settingsSave.addEventListener("click", async () => {
    state.apiKey = el.apiKeyInput.value.trim();
    state.gistToken = el.gistTokenInput.value.trim();
    await chrome.storage.local.set({ apiKey: state.apiKey, gistToken: state.gistToken });
    el.settingsModal.hidden = true;
  });

  async function startSyncFlow(direction) {
    state.gistToken = el.gistTokenInput.value.trim();
    await chrome.storage.local.set({ gistToken: state.gistToken });
    if (!state.gistToken) {
      el.syncStatus.textContent = "Enter a GitHub token first.";
      return;
    }
    const btn = direction === "upload" ? el.syncUploadBtn : el.syncDownloadBtn;
    btn.disabled = true;
    el.syncStatus.textContent = "Fetching diff…";
    const diff = await chrome.runtime.sendMessage({ type: "FETCH_SYNC_DIFF", direction });
    btn.disabled = false;
    el.syncStatus.textContent = "";
    if (!diff?.ok) {
      el.syncStatus.textContent = diff?.error || "Failed to fetch diff.";
      return;
    }
    el.settingsModal.hidden = true;
    openSyncDiffModal(diff);
  }

  el.syncUploadBtn.addEventListener("click", () => startSyncFlow("upload"));
  el.syncDownloadBtn.addEventListener("click", () => startSyncFlow("download"));

  // New folder / rename modal
  el.addFolderBtn.addEventListener("click", () => openFolderModal("create-folder"));
  el.folderCancel.addEventListener("click", () => (el.folderModal.hidden = true));
  el.folderSave.addEventListener("click", async () => {
    const name = el.folderNameInput.value.trim();
    if (!name) return;
    const { type, id } = folderModalMode;
    if (type === "rename-folder" && state.folders[id]) {
      state.folders[id].name = name;
      await chrome.storage.local.set({ folders: state.folders });
    } else if (type === "rename-tag" && state.tags[id]) {
      state.tags[id].name = name;
      await chrome.storage.local.set({ tags: state.tags });
    } else if (type === "create-folder") {
      const newId = slugify(name) + "-" + Date.now().toString(36).slice(-4);
      const order = Object.keys(state.folders).length;
      state.folders[newId] = { name, order };
      await chrome.storage.local.set({ folders: state.folders });
    }
    el.folderModal.hidden = true;
    render();
  });

  // Right-click menu on folders
  el.folderList.addEventListener("contextmenu", (e) => {
    const li = e.target.closest(".folder-item");
    if (!li) return;
    e.preventDefault();
    const id = li.dataset.folderId;
    if (id === "all") return; // virtual folder, nothing to manage
    const items = [{ label: "Rename…", action: () => openFolderModal("rename-folder", id) }];
    if (id !== "unsorted") {
      items.push({ label: "Delete", danger: true, action: () => deleteFolder(id) });
    }
    showContextMenu(e.clientX, e.clientY, items);
  });

  // Right-click menu on tag filter chips
  el.tagFilterBar.addEventListener("contextmenu", (e) => {
    const chip = e.target.closest('[data-role="filter-tag"]');
    if (!chip) return;
    e.preventDefault();
    const id = chip.dataset.tagId;
    showContextMenu(e.clientX, e.clientY, [
      { label: "Rename…", action: () => openFolderModal("rename-tag", id) },
      { label: "Delete", danger: true, action: () => deleteTag(id) },
    ]);
  });

  // Context menu dismissal
  document.addEventListener("click", hideContextMenu);
  document.addEventListener("scroll", hideContextMenu, true);
  window.addEventListener("blur", hideContextMenu);

  // Escape closes menu + modals; Enter submits the open modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      el.settingsModal.hidden = true;
      el.folderModal.hidden = true;
    }
  });
  el.folderNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.folderSave.click();
  });
  el.apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.settingsSave.click();
  });
  el.gistTokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.settingsSave.click();
  });

  el.clearDataBtn.addEventListener("click", async () => {
    if (!confirm("Clear all data? This will remove all channels, folders, and tags. This cannot be undone.")) return;
    await chrome.storage.local.remove(["channels", "folders", "tags", "gistId", "lastSyncedAt"]);
    state = { channels: {}, folders: { unsorted: { name: "Unsorted", order: 0 } }, tags: {}, apiKey: state.apiKey, gistToken: state.gistToken, gistId: "", lastSyncedAt: null };
    currentFolderId = "all";
    activeTagFilters.clear();
    searchQuery = "";
    el.settingsModal.hidden = true;
    render();
  });

  // Scan review dialog — click row to open channel
  function handleDiffRowClick(e) {
    const row = e.target.closest(".scan-diff-row-link[data-channel-id]");
    if (!row) return;
    // Don't navigate when clicking a checkbox itself
    if (e.target.tagName === "INPUT") return;
    chrome.tabs.create({ url: `https://www.youtube.com/channel/${row.dataset.channelId}/videos` });
  }
  el.scanDiffBody.addEventListener("click", handleDiffRowClick);
  document.getElementById("syncDiffBody").addEventListener("click", handleDiffRowClick);

  el.scanDiffBody.addEventListener("change", (e) => {
    if (e.target.dataset.role !== "select-all-removals") return;
    const on = e.target.checked;
    el.scanDiffBody
      .querySelectorAll("input[data-remove-id]")
      .forEach((box) => (box.checked = on));
  });

  el.scanDiffApply.addEventListener("click", async () => {
    const removeIds = Array.from(
      el.scanDiffBody.querySelectorAll("input[data-remove-id]:checked")
    ).map((box) => box.dataset.removeId);
    el.scanDiffApply.disabled = true;
    el.statusText.textContent = "Applying scan…";
    const res = await chrome.runtime.sendMessage({ type: "APPLY_SCAN", removeIds });
    el.scanDiffApply.disabled = false;
    el.scanDiffModal.hidden = true;
    await loadState();
    render();
    el.statusText.textContent = res?.ok
      ? `Scan applied: +${res.added} added, ${res.modified} updated, −${res.removed} removed.`
      : res?.error || "Could not apply scan.";
  });

  el.scanDiffCancel.addEventListener("click", async () => {
    el.scanDiffModal.hidden = true;
    await chrome.runtime.sendMessage({ type: "DISCARD_SCAN" });
  });

  // Sync diff dialog
  el.syncDiffBody.addEventListener("change", (e) => {
    if (e.target.dataset.role !== "select-all-removals") return;
    const on = e.target.checked;
    el.syncDiffBody.querySelectorAll("input[data-remove-id]").forEach((box) => (box.checked = on));
  });

  el.syncDiffApply.addEventListener("click", async () => {
    if (!pendingSyncDiff) return;
    const { direction } = pendingSyncDiff;
    const removeIds = Array.from(
      el.syncDiffBody.querySelectorAll("input[data-remove-id]:checked")
    ).map((box) => box.dataset.removeId);

    el.syncDiffApply.disabled = true;
    el.statusText.textContent = direction === "upload" ? "Uploading…" : "Downloading…";

    const res = direction === "upload"
      ? await chrome.runtime.sendMessage({ type: "APPLY_UPLOAD", removeFromGistIds: removeIds })
      : await chrome.runtime.sendMessage({ type: "APPLY_DOWNLOAD", removeLocalIds: removeIds });

    el.syncDiffApply.disabled = false;
    el.syncDiffModal.hidden = true;
    pendingSyncDiff = null;

    if (res?.ok) {
      state.gistId = res.gistId;
      state.lastSyncedAt = res.lastSyncedAt;
      await loadState();
      render();
      el.statusText.textContent = direction === "upload" ? "Upload complete." : "Download complete.";
    } else {
      el.statusText.textContent = res?.error || "Sync failed.";
    }
  });

  el.syncDiffCancel.addEventListener("click", () => {
    el.syncDiffModal.hidden = true;
    pendingSyncDiff = null;
  });

  // Clicking the dark backdrop closes a modal
  for (const modal of [el.settingsModal, el.folderModal]) {
    modal.addEventListener("mousedown", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  }
  el.syncDiffModal.addEventListener("mousedown", (e) => {
    if (e.target === el.syncDiffModal) {
      el.syncDiffModal.hidden = true;
      pendingSyncDiff = null;
    }
  });
}

// ---------- Folder / tag management ----------

function openFolderModal(type, id = null) {
  folderModalMode = { type, id };
  const texts = {
    "create-folder": { title: "New folder", label: "Folder name", save: "Create", value: "" },
    "rename-folder": { title: "Rename folder", label: "Folder name", save: "Save", value: state.folders[id]?.name || "" },
    "rename-tag": { title: "Rename tag", label: "Tag name", save: "Save", value: state.tags[id]?.name || "" },
  };
  const t = texts[type];
  el.folderModalTitle.textContent = t.title;
  el.folderNameLabel.textContent = t.label;
  el.folderSave.textContent = t.save;
  el.folderNameInput.value = t.value;
  el.folderModal.hidden = false;
  el.folderNameInput.focus();
  el.folderNameInput.select();
}

async function deleteFolder(id) {
  const folder = state.folders[id];
  if (!folder || id === "unsorted") return;
  const count = Object.values(state.channels).filter((c) => c.folderId === id).length;
  const msg = count
    ? `Delete folder "${folder.name}"? Its ${count} channel${count === 1 ? "" : "s"} will move to Unsorted.`
    : `Delete folder "${folder.name}"?`;
  if (!confirm(msg)) return;

  for (const ch of Object.values(state.channels)) {
    if (ch.folderId === id) ch.folderId = "unsorted";
  }
  delete state.folders[id];
  if (currentFolderId === id) currentFolderId = "all";
  await chrome.storage.local.set({ channels: state.channels, folders: state.folders });
  render();
}

async function deleteTag(id) {
  const tag = state.tags[id];
  if (!tag) return;
  if (!confirm(`Delete tag "${tag.name}"? It will be removed from all channels.`)) return;

  for (const ch of Object.values(state.channels)) {
    if (ch.tags?.includes(id)) ch.tags = ch.tags.filter((t) => t !== id);
  }
  delete state.tags[id];
  activeTagFilters.delete(id);
  await chrome.storage.local.set({ channels: state.channels, tags: state.tags });
  render();
}

// ---------- Context menu ----------

function showContextMenu(x, y, items) {
  const menu = el.contextMenu;
  menu.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.danger) btn.classList.add("danger");
    btn.addEventListener("click", () => {
      hideContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }
  menu.hidden = false;
  // keep the menu inside the viewport
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}

function hideContextMenu() {
  el.contextMenu.hidden = true;
}

function openTagInput(cardEl, channelId) {
  if (cardEl.querySelector(".tag-input-popover")) return;

  const wrap = document.createElement("div");
  wrap.className = "tag-input-popover";
  wrap.style.marginTop = "4px";

  const input = document.createElement("input");
  input.className = "field-input";
  input.style.fontSize = "12px";
  input.style.padding = "5px 8px";
  input.placeholder = "tag name, press Enter";
  input.setAttribute("list", "existing-tags-datalist");

  const datalist = document.getElementById("existing-tags-datalist") || document.createElement("datalist");
  datalist.id = "existing-tags-datalist";
  datalist.innerHTML = Object.values(state.tags)
    .map((t) => `<option value="${escapeHtml(t.name)}"></option>`)
    .join("");
  document.body.appendChild(datalist);

  wrap.appendChild(input);
  cardEl.appendChild(wrap);
  input.focus();

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const name = input.value.trim();
      if (name) await addTagToChannel(channelId, name);
      wrap.remove();
    } else if (e.key === "Escape") {
      wrap.remove();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => wrap.remove(), 150));
}

async function addTagToChannel(channelId, name) {
  let tagId = Object.keys(state.tags).find(
    (id) => state.tags[id].name.toLowerCase() === name.toLowerCase()
  );
  if (!tagId) {
    tagId = slugify(name) + "-" + Date.now().toString(36).slice(-3);
    state.tags[tagId] = { name, color: nextTagColor() };
    await chrome.storage.local.set({ tags: state.tags });
  }
  const ch = state.channels[channelId];
  if (!ch.tags) ch.tags = [];
  if (!ch.tags.includes(tagId)) {
    ch.tags.push(tagId);
    await chrome.storage.local.set({ channels: state.channels });
  }
}
