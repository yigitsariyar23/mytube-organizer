// dashboard.js — MyTube Organizer main panel logic

const TAG_PALETTE = [
  "#E8B355", "#6FCF97", "#56B6E9", "#C792EA",
  "#F2777A", "#82D9C5", "#D9A86C", "#9FA8DA",
];

// Per-language colors. Large enough that every language in the default set gets
// a distinct color: colors are assigned by the language's position in LANGUAGES,
// not by hash, so no two curated languages collide. Kept disjoint from
// TAG_PALETTE (tags stay distinct from languages) and excludes the Active green
// (#6FCF97) and Finished blue (#56B6E9) button colors.
// Ordered so consecutive colors are far apart on the hue wheel: the first eight
// are a full rainbow (red, indigo, orange, cyan, pink, lime, purple, yellow) and
// each "second shade" of a family is pushed to the tail — so the languages a
// user actually has never look like brighter copies of each other.
const LANG_PALETTE = [
  "#EF5350", "#5C6BC0", "#FFA726", "#26C6DA", "#EC407A",
  "#9CCC65", "#AB47BC", "#FDD835", "#26A69A", "#FF7043",
  "#7E57C2", "#C0CA33", "#8D6E63", "#78909C",
];

function langColor(lang) {
  if (!lang) return null;
  // Curated languages: color by list position — guarantees distinctness up to
  // the palette size. Custom (off-list) languages fall back to a name hash.
  const idx = LANGUAGES.indexOf(lang);
  if (idx >= 0) return LANG_PALETTE[idx % LANG_PALETTE.length];
  let h = 0;
  for (let i = 0; i < lang.length; i++) h = (h * 31 + lang.charCodeAt(i)) >>> 0;
  return LANG_PALETTE[h % LANG_PALETTE.length];
}

// Language variable: a curated dropdown list. A channel may also hold a custom
// language (via the "Other…" prompt); such values are injected as an extra option.
const DEFAULT_LANGUAGES = [
  "English", "Türkçe", "Español", "Português", "Deutsch", "Français",
  "Italiano", "Русский", "日本語", "한국어", "中文", "हिन्दी", "العربية",
];
// Mutable at runtime: the curated set is editable in Settings and persisted
// to storage under "languages". Reassigned in loadState and on settings save.
let LANGUAGES = [...DEFAULT_LANGUAGES];
const LANG_OTHER = "__other__";

// Flag emoji per language. Keyed by the lowercased label, with the native name,
// the English name and the ISO 639-1 code all mapping to the same flag — so a
// language typed by hand as "Dutch", "nederlands" or "nl" still resolves. A
// language this table doesn't know shows the globe; a label that *starts* with
// an emoji keeps that emoji instead (the escape hatch for anything unguessable,
// e.g. "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Gaidhlig" or a made-up language).
const LANG_FLAG_SPECS = [
  ["🇬🇧", "english", "en"],
  ["🇹🇷", "türkçe", "turkish", "tr"],
  ["🇪🇸", "español", "spanish", "es", "castellano"],
  ["🇵🇹", "português", "portuguese", "pt"],
  ["🇧🇷", "português (brasil)", "brazilian portuguese", "pt-br"],
  ["🇩🇪", "deutsch", "german", "de"],
  ["🇫🇷", "français", "french", "fr"],
  ["🇮🇹", "italiano", "italian", "it"],
  ["🇷🇺", "русский", "russian", "ru"],
  ["🇯🇵", "日本語", "japanese", "ja"],
  ["🇰🇷", "한국어", "korean", "ko"],
  ["🇨🇳", "中文", "chinese", "zh", "mandarin"],
  ["🇮🇳", "हिन्दी", "hindi", "hi", "தமிழ்", "tamil", "ta", "telugu", "te", "marathi", "mr"],
  ["🇸🇦", "العربية", "arabic", "ar"],
  ["🇳🇱", "nederlands", "dutch", "nl"],
  ["🇵🇱", "polski", "polish", "pl"],
  ["🇸🇪", "svenska", "swedish", "sv"],
  ["🇳🇴", "norsk", "norwegian", "no", "nb"],
  ["🇩🇰", "dansk", "danish", "da"],
  ["🇫🇮", "suomi", "finnish", "fi"],
  ["🇮🇸", "íslenska", "icelandic", "is"],
  ["🇬🇷", "Ελληνικά", "greek", "el"],
  ["🇨🇿", "čeština", "czech", "cs"],
  ["🇸🇰", "slovenčina", "slovak", "sk"],
  ["🇭🇺", "magyar", "hungarian", "hu"],
  ["🇷🇴", "română", "romanian", "ro"],
  ["🇧🇬", "български", "bulgarian", "bg"],
  ["🇺🇦", "українська", "ukrainian", "uk"],
  ["🇷🇸", "srpski", "serbian", "sr"],
  ["🇭🇷", "hrvatski", "croatian", "hr"],
  ["🇸🇮", "slovenščina", "slovenian", "sl"],
  ["🇮🇱", "עברית", "hebrew", "he"],
  ["🇮🇷", "فارسی", "persian", "farsi", "fa"],
  ["🇹🇭", "ไทย", "thai", "th"],
  ["🇻🇳", "tiếng việt", "vietnamese", "vi"],
  ["🇮🇩", "bahasa indonesia", "indonesian", "id"],
  ["🇲🇾", "bahasa melayu", "malay", "ms"],
  ["🇵🇭", "filipino", "tagalog", "tl"],
  ["🇧🇩", "বাংলা", "bengali", "bn"],
  ["🇵🇰", "اردو", "urdu", "ur"],
  ["🇰🇪", "kiswahili", "swahili", "sw"],
  ["🇦🇿", "azərbaycan", "azerbaijani", "az"],
  ["🇰🇿", "қазақша", "kazakh", "kk"],
  ["🇪🇪", "eesti", "estonian", "et"],
  ["🇱🇻", "latviešu", "latvian", "lv"],
  ["🇱🇹", "lietuvių", "lithuanian", "lt"],
];
const LANG_FLAGS = Object.fromEntries(
  LANG_FLAG_SPECS.flatMap(([flag, ...names]) => names.map((n) => [n, flag]))
);
const UNKNOWN_LANG_FLAG = "🌐";
// A leading flag (regional-indicator pair, tag sequence) or any leading emoji,
// written by the user in the language label itself.
const LEADING_FLAG_RE =
  /^\s*([\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}\uFE0F]|\u200D\p{Extended_Pictographic})*)\s*/u;

// The flag for a language label — the user's own leading emoji if there is one,
// else the table's, else a globe. Never empty for a set language, so every
// picker row lines up.
function langFlag(lang) {
  if (!lang) return "";
  const own = lang.match(LEADING_FLAG_RE);
  if (own) return own[1];
  return LANG_FLAGS[lang.trim().toLowerCase()] || UNKNOWN_LANG_FLAG;
}

// The label without a user-authored leading flag, so it isn't shown twice.
function langName(lang) {
  if (!lang) return "";
  return lang.replace(LEADING_FLAG_RE, "").trim() || lang.trim();
}

// "🇹🇷 Türkçe" — how a language is shown everywhere: filter chips, the row
// dropdown, and the context menus.
function langLabel(lang) {
  return lang ? `${langFlag(lang)} ${langName(lang)}` : "";
}

let state = { channels: {}, folders: {}, tags: {}, videos: {}, videoFolders: {}, apiKey: "", gistToken: "", gistId: "", lastSyncedAt: null, pendingScan: null, pendingPlaylistImport: null };
let currentFolderId = "all";       // selected channel folder (Channels/New views)
let currentListId = "all";         // selected Watch Later list
let currentView = "channels";      // "channels" | "new" | "watchlater"
// Watched filter per video view: "" (everything) | "unwatched" | "watched".
// Same left/right-click rule as every other chip — see toggleChipFilter.
let newWatchedFilter = "unwatched";        // New feed defaults to hiding watched
let watchLaterWatchedFilter = "unwatched"; // …and so does Watch Later
let videoSortKey = "date";         // "date" | "length"
let videoSortDir = "desc";         // "desc" | "asc"
let videoDetailsRequested = false; // guards the one-shot auto length/view fetch
// Filter chips are two-sided: left click puts a value in the "must have" set,
// right click in the "must not have" set. A value is never in both.
const activeTagFilters = new Set();
const excludedTagFilters = new Set();
const activeLangFilters = new Set();   // languages selected in the filter bar
const excludedLangFilters = new Set(); // …and languages ruled out
const selectedChannelIds = new Set(); // multi-select highlight (ctrl/shift click)
let selectionAnchor = null;           // last clicked id, the shift-range pivot
const selectedVideoIds = new Set();   // video multi-select (New / Watch Later)
let videoSelectionAnchor = null;      // shift-range pivot for video cards
let filterActive = "";             // "" = off, "only" = active, "not" = inactive (active:false)
let filterFinished = "";           // "" = off, "only" = finished, "not" = unfinished
let searchQuery = "";
let sortDate = "desc"; // "desc" (newest first) | "asc" (oldest first) | "none"
let sortCount = "none"; // "none" | "desc" (most first) | "asc" (fewest first)
let folderSort = "custom"; // "custom" | "alpha" | "count"
const collapsedFolders = new Set();    // collapsed parent channel folders
const collapsedVideoLists = new Set(); // collapsed parent Watch Later lists
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
let pendingFolderOptions = []; // precomputed move-folder <option> data, rebuilt each render
let scrollObserver = null;

// Resizable table columns. The first five columns carry explicit px widths; the
// sixth (Folder) is a flexible `1fr` that absorbs remaining space, so there is
// no horizontal scroll. Widths persist as `colWidths`; null means "use the
// default fluid template" until the user first drags a divider.
let colWidths = null;                         // [c1..c5] px, or null
const COL_MINS = [160, 84, 52, 52, 180];      // min px for the five sized columns
const COL_FLEX_MIN = 110;                     // min px for the flexible Folder column
const COL_GAP = 16;                           // must match the grid `gap`
const COL_PAD_X = 28;                         // .list-table-header horizontal padding (14*2)

const el = {
  folderList: document.getElementById("folderList"),
  folderSortSelect: document.getElementById("folderSortSelect"),
  folderSectionLabel: document.getElementById("folderSectionLabel"),
  tagFilterBar: document.getElementById("tagFilterBar"),
  channelGrid: document.getElementById("channelGrid"),
  emptyState: document.getElementById("emptyState"),
  noResultsState: document.getElementById("noResultsState"),
  noResultsBody: document.getElementById("noResultsBody"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  statusText: document.getElementById("statusText"),
  updateBanner: document.getElementById("updateBanner"),
  updateBannerText: document.getElementById("updateBannerText"),
  updateReloadBtn: document.getElementById("updateReloadBtn"),
  updateDismissBtn: document.getElementById("updateDismissBtn"),
  resultCount: document.getElementById("resultCount"),
  searchInput: document.getElementById("searchInput"),
  searchClear: document.getElementById("searchClear"),
  clearAllFiltersBtn: document.getElementById("clearAllFiltersBtn"),
  clearCountBtn: document.querySelector('[data-clear="count"]'),
  clearAfterBtn: document.querySelector('[data-clear="after"]'),
  clearBeforeBtn: document.querySelector('[data-clear="before"]'),
  scanBtn: document.getElementById("scanBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  fillAvatarsBtn: document.getElementById("fillAvatarsBtn"),
  fillAvatarsStatus: document.getElementById("fillAvatarsStatus"),
  addFolderBtn: document.getElementById("addFolderBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  gistTokenInput: document.getElementById("gistTokenInput"),
  languagesInput: document.getElementById("languagesInput"),
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
  folderParentRow: document.getElementById("folderParentRow"),
  folderParentSelect: document.getElementById("folderParentSelect"),
  folderSave: document.getElementById("folderSave"),
  folderCancel: document.getElementById("folderCancel"),
  contextMenu: document.getElementById("contextMenu"),
  contextSubmenu: document.getElementById("contextSubmenu"),
  contextSubSubmenu: document.getElementById("contextSubSubmenu"),
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
  playlistImportModal: document.getElementById("playlistImportModal"),
  playlistImportName: document.getElementById("playlistImportName"),
  playlistImportSummary: document.getElementById("playlistImportSummary"),
  playlistImportWarning: document.getElementById("playlistImportWarning"),
  playlistImportBody: document.getElementById("playlistImportBody"),
  playlistImportApply: document.getElementById("playlistImportApply"),
  playlistImportCancel: document.getElementById("playlistImportCancel"),
  viewChannelsBtn: document.getElementById("viewChannelsBtn"),
  viewNewBtn: document.getElementById("viewNewBtn"),
  viewWatchLaterBtn: document.getElementById("viewWatchLaterBtn"),
  videoFilters: document.getElementById("videoFilters"),
  videoUnwatchedChip: document.getElementById("videoUnwatchedChip"),
  videoSortDate: document.getElementById("videoSortDate"),
  videoSortLength: document.getElementById("videoSortLength"),
  videoMarkAllBtn: document.getElementById("videoMarkAllBtn"),
  videoFetchAllBtn: document.getElementById("videoFetchAllBtn"),
  videoFeed: document.getElementById("videoFeed"),
  videoEmptyState: document.getElementById("videoEmptyState"),
  watchLaterGrid: document.getElementById("watchLaterGrid"),
  watchLaterEmptyState: document.getElementById("watchLaterEmptyState"),
};

init();

// Only the years the library actually covers. These dropdowns bound
// `lastVideoDate`, so a fixed 2005→today list was mostly dead choice: scrolling
// past a decade of years no channel has. Rebuilt whenever that set changes —
// cheap, because the key check short-circuits the common case.
let yearOptionsKey = "";

function populateYearDropdowns() {
  const years = [...new Set(
    Object.values(state.channels)
      .map((c) => (c.lastVideoDate ? new Date(c.lastVideoDate).getFullYear() : null))
      .filter((y) => y && !isNaN(y))
  )].sort((a, b) => b - a);
  if (!years.length) years.push(new Date().getFullYear());

  const key = years.join(",");
  if (key === yearOptionsKey) return;
  yearOptionsKey = key;

  const html = ["—", ...years].map((y) => `<option value="${y}">${y}</option>`).join("");
  for (const sel of [el.filterAfterYear, el.filterBeforeYear]) {
    const previous = sel.value;
    sel.innerHTML = html;
    // Keep the selection when that year survives the rebuild; otherwise fall
    // back to "—" (the filter's "no bound") and tell the listeners, so the
    // filter state can't disagree with what the dropdown shows.
    const kept = previous && [...sel.options].some((o) => o.value === previous);
    sel.value = kept ? previous : "—";
    if (!kept && previous && previous !== "—") sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function init() {
  await loadState();
  // Fold every parent folder by default; expansions during the session persist.
  for (const id of Object.keys(state.folders)) {
    if (getChildFolderIds(id).length) collapsedFolders.add(id);
  }
  for (const id of Object.keys(state.videoFolders)) {
    if (getChildFolderIds(id, state.videoFolders).length) collapsedVideoLists.add(id);
  }
  populateYearDropdowns();
  if (colWidths) applyColTemplate(colWidths);
  render();
  bindEvents();
  setupColumnResize();
  setupNumberScrubbing();

  // A scan / playlist import finished while the dashboard was closed — review it on open.
  if (state.pendingScan) openScanDiffModal(state.pendingScan);
  if (state.pendingPlaylistImport) openPlaylistImportModal(state.pendingPlaylistImport);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.channels) state.channels = changes.channels.newValue || {};
    if (changes.folders) state.folders = changes.folders.newValue || {};
    if (changes.tags) state.tags = changes.tags.newValue || {};
    if (changes.videos) {
      state.videos = changes.videos.newValue || {};
      resetVideoStateSnapshot();
    }
    if (changes.videoFolders) state.videoFolders = changes.videoFolders.newValue || defaultFolders();
    // Settings synced from another device (background gist merge / download).
    if (changes.apiKey) state.apiKey = changes.apiKey.newValue || "";
    if (changes.languages) LANGUAGES = changes.languages.newValue?.length ? changes.languages.newValue : [...DEFAULT_LANGUAGES];
    if (changes.pendingScan) {
      state.pendingScan = changes.pendingScan.newValue || null;
      if (state.pendingScan) openScanDiffModal(state.pendingScan);
      else el.scanDiffModal.hidden = true;
    }
    if (changes.pendingPlaylistImport) {
      state.pendingPlaylistImport = changes.pendingPlaylistImport.newValue || null;
      if (state.pendingPlaylistImport) openPlaylistImportModal(state.pendingPlaylistImport);
      else el.playlistImportModal.hidden = true;
    }
    render();
  });

  // After the listener is wired, so a long background job's incremental writes
  // land in the UI. Not awaited — the first paint shouldn't wait on the network.
  // The gist check runs after the refresh, not alongside it, so its diff is
  // computed against freshly-refreshed local data; neither is allowed to surface
  // as an unhandled rejection.
  (async () => {
    await checkForAppUpdate(); // small and quick; the banner shouldn't wait on a refresh
    try { await catchUpOnOpen(); } catch (e) { /* reported in the status line */ }
    try { await checkRemoteChangesOnOpen(); } catch (e) { /* silent by design */ }
  })();
}

// The seed library: a single pinned home folder. A factory (not a shared
// constant) so each caller gets a fresh object — state.folders is mutated in place.
// Its id stays "unsorted" (a storage key every channel and video points at);
// only the label is "Unfiled", the name it pairs with the sidebar's "Filed".
// background.js owns the same constant and migrates older stored names.
const defaultFolders = () => ({ unsorted: { name: "Unfiled", order: 0 } });

async function loadState() {
  const data = await chrome.storage.local.get([
    "channels", "folders", "tags", "videos", "videoFolders", "apiKey", "gistToken", "gistId", "lastSyncedAt", "pendingScan",
    "pendingPlaylistImport",
    "sortDate", "sortCount", "folderSort", "languages", "currentView", "colWidths", "videoSort",
  ]);
  state.channels = data.channels || {};
  state.folders = data.folders || defaultFolders();
  state.tags = data.tags || {};
  state.videos = data.videos || {};
  resetVideoStateSnapshot();
  state.videoFolders = data.videoFolders && Object.keys(data.videoFolders).length ? data.videoFolders : defaultFolders();
  // "videos" was the old single video tab; it split into "new" + "watchlater".
  const v = data.currentView === "videos" ? "new" : data.currentView;
  currentView = ["channels", "new", "watchlater"].includes(v) ? v : "channels";
  state.apiKey = data.apiKey || "";
  state.gistToken = data.gistToken || "";
  state.gistId = data.gistId || "";
  state.lastSyncedAt = data.lastSyncedAt || null;
  state.pendingScan = data.pendingScan || null;
  state.pendingPlaylistImport = data.pendingPlaylistImport || null;
  sortDate = data.sortDate === "asc" || data.sortDate === "none" ? data.sortDate : "desc";
  sortCount = data.sortCount === "desc" || data.sortCount === "asc" ? data.sortCount : "none";
  folderSort = ["alpha", "count-desc", "count-asc"].includes(data.folderSort) ? data.folderSort : "custom";
  LANGUAGES = Array.isArray(data.languages) && data.languages.length ? data.languages : [...DEFAULT_LANGUAGES];
  colWidths = Array.isArray(data.colWidths) && data.colWidths.length === COL_MINS.length
    ? data.colWidths.map((w, i) => Math.max(COL_MINS[i], Number(w) || COL_MINS[i]))
    : null;
  videoSortKey = data.videoSort?.key === "length" ? "length" : "date";
  videoSortDir = data.videoSort?.dir === "asc" ? "asc" : "desc";
}

// ---------- Folder domain (channel folders vs Watch Later lists) ----------

// The one sidebar (#folderList) and its operations act on whichever folder set
// matches the current view. This accessor returns that set plus how to count
// items, read/set the selected id, and persist — so the folder code stays one
// implementation. Channels/New share the channel folders; Watch Later uses its
// own `videoFolders`.
function fdom() {
  if (currentView === "watchlater") {
    return {
      folders: state.videoFolders,
      persist: () => chrome.storage.local.set({ videoFolders: state.videoFolders }),
      counts: () => {
        const m = {};
        for (const v of Object.values(state.videos)) {
          if (v.saved) { const f = v.folderId || "unsorted"; m[f] = (m[f] || 0) + 1; }
        }
        return m;
      },
      total: () => Object.values(state.videos).filter((v) => v.saved).length,
      get selected() { return currentListId; },
      select: (id) => { currentListId = id; },
      collapsed: collapsedVideoLists,
    };
  }
  // The New view shares the channel folders, but only its tracked channels feed
  // the uploads list — so its sidebar counts (and, in renderFolders, which
  // folders show at all) are restricted to channels with `trackVideos`.
  const trackedOnly = currentView === "new";
  return {
    folders: state.folders,
    persist: () => chrome.storage.local.set({ folders: state.folders }),
    counts: () => {
      const m = {};
      for (const c of Object.values(state.channels)) {
        if (trackedOnly && !c.trackVideos) continue;
        const f = c.folderId || "unsorted";
        m[f] = (m[f] || 0) + 1;
      }
      return m;
    },
    total: () => Object.values(state.channels).filter((c) => !trackedOnly || c.trackVideos).length,
    get selected() { return currentFolderId; },
    select: (id) => { currentFolderId = id; },
    collapsed: collapsedFolders,
  };
}

// ---------- Render ----------

function render() {
  document.body.dataset.view = currentView;
  el.viewChannelsBtn.classList.toggle("active", currentView === "channels");
  el.viewNewBtn.classList.toggle("active", currentView === "new");
  el.viewWatchLaterBtn.classList.toggle("active", currentView === "watchlater");
  const channels = currentView === "channels";

  const listMode = currentView === "watchlater";
  el.addFolderBtn.textContent = listMode ? "+ New list" : "+ New folder";
  if (el.folderSectionLabel) el.folderSectionLabel.textContent = listMode ? "Lists" : "Folders";
  renderFolders();

  // Channel-grid surfaces
  el.channelGrid.hidden = !channels;
  el.scrollSentinel.hidden = !channels;
  if (!channels) el.tagFilterBar.hidden = true;
  // Video surfaces
  el.videoFeed.hidden = currentView !== "new";
  el.watchLaterGrid.hidden = currentView !== "watchlater";

  if (channels) {
    el.searchInput.placeholder = "Search channels…";
    el.videoEmptyState.hidden = true;
    el.watchLaterEmptyState.hidden = true;
    populateYearDropdowns();
    renderTagFilters();
    renderGrid();
    return;
  }

  // Both video views hide the channel table + its empty states.
  el.emptyState.hidden = true;
  el.noResultsState.hidden = true;
  el.listTableHeader.hidden = true;

  if (currentView === "new") {
    el.searchInput.placeholder = "Search new videos…";
    el.watchLaterEmptyState.hidden = true;
    renderVideoFeed();
  } else {
    el.searchInput.placeholder = "Search Watch Later…";
    el.videoEmptyState.hidden = true;
    renderWatchLater();
  }
}

// Switch between the Channels and Videos surfaces; the choice persists so the
// dashboard reopens where you left it. Search carries between views but the
// text field is view-scoped in meaning, so it's cleared on switch.
async function setView(view) {
  if (view === currentView) return;
  currentView = view;
  searchQuery = "";
  el.searchInput.value = "";
  el.statusText.textContent = "";
  clearVideoSelection(); // selection is per-view
  await chrome.storage.local.set({ currentView: view });
  render();
}

// ---------- New videos view (tracked channels' uploads) ----------

// True once any channel opts into the feed via its "Track" toggle.
function anyTrackedChannel() {
  return Object.values(state.channels).some((c) => c.trackVideos);
}

// New uploads from tracked channels, honoring the channel-folder selection,
// search, the unwatched chip, and the active video sort.
// Everything the New feed *could* show for the selected folder: tracked
// channels, nothing dismissed, no live/upcoming. The search box and watched chip
// narrow this down — keeping the two steps apart is what lets the toolbar say
// "12 of 240" without walking the store twice.
function newFeedUniverse() {
  const inFolder = folderScopeTest(currentFolderId);
  return Object.values(state.videos).filter((v) => {
    const ch = state.channels[v.channelId];
    if (!ch || !ch.trackVideos) return false;
    if (v.hidden) return false;              // user-dismissed from the feed
    if (isUpcomingOrLive(v)) return false;   // live streams / scheduled premieres
    if (inFolder && !inFolder(ch.folderId)) return false;
    return true;
  });
}

// The search box + watched chip: the two filters both video views share.
function applyVideoChips(list, watchedFilter) {
  const q = searchQuery.trim().toLowerCase();
  return list.filter((v) => {
    if (watchedFilter === "unwatched" && v.watched) return false;
    if (watchedFilter === "watched" && !v.watched) return false;
    if (!q) return true;
    const author = v.channelId ? state.channels[v.channelId]?.name : v.author;
    return `${v.title} ${author || ""}`.toLowerCase().includes(q);
  });
}

function getFilteredVideos() {
  return sortVideos(applyVideoChips(newFeedUniverse(), newWatchedFilter));
}

// A live stream or a scheduled/upcoming premiere — not a real uploaded video.
// `live` is set by the API detail fetch; the future-date check also catches
// upcoming premieres before the details are fetched (and without an API key).
function isUpcomingOrLive(v) {
  if (v.live === "live" || v.live === "upcoming") return true;
  if (v.published && Date.parse(v.published) > Date.now() + 60_000) return true;
  return false;
}

// A comparable timestamp for a video: its upload date, or the save time for
// manually-added Watch Later videos that have no published date.
function videoTime(v) {
  return v.published ? Date.parse(v.published) : (v.addedAt || 0);
}

// Sort by the active key/direction. Views nulls sort as lowest; date is the
// tiebreaker so equal-view items stay chronologically sensible.
function sortVideos(list) {
  const dir = videoSortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let cmp = videoSortKey === "length"
      ? (a.duration ?? -1) - (b.duration ?? -1)
      : videoTime(a) - videoTime(b);
    if (cmp === 0) cmp = videoTime(a) - videoTime(b);
    return dir * cmp;
  });
  return list;
}

// Lengths (and API view counts) aren't in RSS — when a video view opens with an
// API key set and some are still missing, ask the background to fetch them. One
// shot per session; the storage write it triggers re-renders with the data.
function maybeFetchVideoDetails() {
  if (videoDetailsRequested || !state.apiKey) return;
  const needs = Object.values(state.videos).some((v) => {
    // A saved video missing its channel name/avatar/date also needs a details pass.
    if (v.saved && (!v.channelId || !v.channelThumbnail || !v.published)) return true;
    return (v.duration === undefined || v.live === "live" || v.live === "upcoming") &&
      (v.saved || (v.channelId && state.channels[v.channelId]?.trackVideos));
  });
  if (!needs) return;
  videoDetailsRequested = true;
  chrome.runtime.sendMessage({ type: "FILL_VIDEO_DETAILS" });
}

// Reflect the active sort on the two sort buttons (highlight + ↑/↓ arrow).
function updateVideoSortButtons() {
  const arrow = videoSortDir === "asc" ? "↑" : "↓";
  for (const [key, btn] of [["date", el.videoSortDate], ["length", el.videoSortLength]]) {
    const active = videoSortKey === key;
    btn.classList.toggle("active", active);
    btn.querySelector(".vs-arrow").textContent = active ? arrow : "";
  }
}

function renderVideoFeed() {
  renderFilterClears();
  renderWatchedChip(newWatchedFilter);
  updateVideoSortButtons();
  maybeFetchVideoDetails();

  const noneTracked = !anyTrackedChannel();
  el.videoEmptyState.hidden = !noneTracked;
  if (noneTracked) {
    el.videoFeed.innerHTML = "";
    renderResultCount(0, 0, "video");
    return;
  }

  const universe = newFeedUniverse();
  const vids = sortVideos(applyVideoChips(universe, newWatchedFilter));
  renderResultCount(vids.length, universe.length, "video");

  if (!vids.length) {
    const filtered = !!searchQuery.trim() || newWatchedFilter !== "";
    el.videoFeed.innerHTML = `<div class="empty-state" style="position:static"><p class="empty-title">No videos</p><p class="empty-body">${filtered ? "No videos match the current filters." : "No videos fetched yet — click Refresh Stats to pull them."}</p></div>`;
    return;
  }

  // Day headers only make sense when the feed is in date order.
  const groupByDay = videoSortKey === "date";
  let html = "";
  let lastLabel = null;
  for (const v of vids) {
    if (groupByDay) {
      const label = dayLabel(v.published);
      if (label !== lastLabel) {
        html += `<div class="video-day">${escapeHtml(label)}</div>`;
        lastLabel = label;
      }
    }
    html += videoCardHtml(v, "new");
  }
  el.videoFeed.innerHTML = html;
}

// A video card for either video view. `mode` picks the action buttons:
// "new" → mark watched; "watchlater" → remove from Watch Later.
function videoCardHtml(v, mode) {
  const ch = v.channelId ? state.channels[v.channelId] : null;
  const channelName = ch?.name || v.author || "";
  const avatarSrc = ch?.thumbnail || v.channelThumbnail || null;
  const avatar = avatarSrc
    ? `<img src="${escapeHtml(avatarSrc)}" alt="" onerror="this.outerHTML='<span class=&quot;vc-avatar-fallback&quot;></span>'" />`
    : `<span class="vc-avatar-fallback"></span>`;
  const when = v.published ? relativeTime(v.published) : "";
  const views = v.viewCount != null ? formatViews(v.viewCount) : "";
  const meta = [when, views].filter(Boolean).join(" · ");
  const durationBadge = v.duration != null ? `<span class="video-duration">${escapeHtml(formatDuration(v.duration))}</span>` : "";
  const actions = mode === "watchlater"
    ? `<button class="video-act" data-action="toggle-watched">${v.watched ? "Mark unwatched" : "Mark watched"}</button>
       <button class="video-act" data-action="remove" title="Remove from Watch Later">Remove</button>`
    : `<button class="video-act" data-action="toggle-watched">${v.watched ? "Mark unwatched" : "Mark watched"}</button>
       <button class="video-act" data-action="hide" title="Remove from the New feed (won't come back)">Remove</button>`;
  return `
    <div class="video-card${v.watched ? " watched" : ""}${selectedVideoIds.has(v.id) ? " selected" : ""}" data-video-id="${escapeHtml(v.id)}">
      <div class="video-thumb">
        <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
        ${durationBadge}
        <span class="video-watched-badge">✓ watched</span>
      </div>
      <div class="video-meta">
        <div class="video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</div>
        <div class="video-channel">${avatar}<span>${escapeHtml(channelName)}</span></div>
        <div class="video-date">${escapeHtml(meta)}</div>
      </div>
      <div class="video-actions">${actions}</div>
    </div>`;
}

// Seconds → "4:13" or "1:02:10".
function formatDuration(sec) {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p2 = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

// Compact view count, e.g. "1.2M views" / "45K views" / "812 views".
function formatViews(n) {
  if (n == null) return "";
  const c = n >= 1_000_000 ? trimZero(n / 1_000_000) + "M"
    : n >= 1_000 ? trimZero(n / 1_000) + "K"
    : String(n);
  return `${c} view${n === 1 ? "" : "s"}`;
}

// ---------- Watch Later view (saved videos, organized into lists) ----------

// Saved videos in the selected list (+ its sub-lists), matching search, newest
// saved first.
// Every saved video in the selected list (+ its sub-lists), before the search
// box and watched chip — the New feed's `newFeedUniverse` for Watch Later.
function watchLaterUniverse() {
  const inList = folderScopeTest(currentListId, state.videoFolders);
  return Object.values(state.videos).filter((v) => {
    if (!v.saved) return false;
    return !inList || inList(v.folderId);
  });
}

function getWatchLaterVideos() {
  return sortVideos(applyVideoChips(watchLaterUniverse(), watchLaterWatchedFilter));
}

function renderWatchLater() {
  renderFilterClears();
  renderWatchedChip(watchLaterWatchedFilter);
  updateVideoSortButtons();
  maybeFetchVideoDetails();

  const anySaved = Object.values(state.videos).some((v) => v.saved);
  el.watchLaterEmptyState.hidden = anySaved;
  if (!anySaved) {
    el.watchLaterGrid.innerHTML = "";
    renderResultCount(0, 0, "video");
    return;
  }

  const universe = watchLaterUniverse();
  const vids = sortVideos(applyVideoChips(universe, watchLaterWatchedFilter));
  renderResultCount(vids.length, universe.length, "video");

  if (!vids.length) {
    const filtered = !!searchQuery.trim() || watchLaterWatchedFilter !== "";
    el.watchLaterGrid.innerHTML = `<div class="empty-state" style="position:static"><p class="empty-title">No videos</p><p class="empty-body">${filtered ? "No saved videos match the current filters." : "This list is empty."}</p></div>`;
    return;
  }

  el.watchLaterGrid.innerHTML = vids.map((v) => videoCardHtml(v, "watchlater")).join("");
}

// "Today" / "Yesterday" / "Jul 3, 2026" for the day-group headers (local time).
function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "Unknown date";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// "5m ago" / "3h ago" / "2d ago", falling back to a short date past a week.
function relativeTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return formatShortDate(iso);
}

// The user-owned fields of a video as one comparable string. An absent folderId
// and "unsorted" are the same state (RSS videos carry none), so they compare
// equal — same rule the sync diff uses.
function videoUserStateKey(v) {
  const list = v.folderId && v.folderId !== "unsorted" ? v.folderId : "";
  return `${!!v.watched}|${!!v.saved}|${!!v.hidden}|${list}`;
}

// What those fields looked like at the last write. saveVideos() diffs against it
// and stamps `userStateAt` on whatever the user changed, so no mutation site has
// to remember to — and forgetting would matter: sync resolves these four fields
// last-writer-wins from that stamp (`mergeUserState` in background.js), so an
// unstamped change loses to the gist's older copy on the next sync.
let videoStateSnapshot = new Map();

function resetVideoStateSnapshot() {
  videoStateSnapshot = new Map(
    Object.entries(state.videos).map(([id, v]) => [id, videoUserStateKey(v)])
  );
}

async function saveVideos() {
  const now = Date.now();
  for (const [id, v] of Object.entries(state.videos)) {
    const key = videoUserStateKey(v);
    const prev = videoStateSnapshot.get(id);
    if (prev !== undefined && prev !== key) v.userStateAt = now;
    videoStateSnapshot.set(id, key);
  }
  await chrome.storage.local.set({ videos: state.videos });
}

// Open a video on YouTube (where its own algorithm drives autoplay / up-next)
// and mark it watched. The storage write re-renders the feed via onChanged.
function openVideo(videoId, background) {
  const v = state.videos[videoId];
  if (!v) return;
  chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: !background });
  if (!v.watched) {
    v.watched = true;
    saveVideos();
  }
}

// Remove a video from Watch Later: clear `saved` and its list. A tracked
// channel's video stays available in the New feed; a manually-saved one is left
// behind as a `saved:false` record rather than deleted, because that record is
// the only trace of the removal — delete it and the gist's older `saved:true`
// merges the video back on the next sync. `pruneVideos` drops it once the
// tombstone ages out (USER_STATE_TOMBSTONE_MS), and neither view shows it
// meanwhile (Watch Later needs `saved`, the New feed needs a tracked channel).
async function removeFromWatchLater(videoId) {
  const v = state.videos[videoId];
  if (!v) return;
  v.saved = false;
  delete v.folderId;
  await saveVideos();
}

async function moveVideoToList(videoId, listId) {
  const v = state.videos[videoId];
  if (!v || !v.saved) return;
  v.folderId = listId;
  await saveVideos();
}

// Deep-fetch the entire upload history of the given channels via the API (the
// RSS refresh only sees the latest ~15). Needs a key; can take a while for big
// catalogs, so it reports progress/outcome in the status line.
async function fetchAllVideos(channelIds) {
  if (!channelIds.length) return;
  if (!state.apiKey) {
    alert("Fetching all videos needs a YouTube API key — set one in Settings.");
    return;
  }
  const label = channelIds.length === 1
    ? `“${state.channels[channelIds[0]]?.name || "channel"}”`
    : `${channelIds.length} channels`;
  el.statusText.textContent = `Fetching all videos from ${label}… (this can take a while)`;
  videoDetailsRequested = true; // the background fills lengths itself; suppress the auto-fetch
  const res = await chrome.runtime.sendMessage({ type: "FETCH_ALL_VIDEOS", channelIds });
  await loadState();
  render();
  if (res?.ok) {
    el.statusText.textContent =
      `Fetched ${res.total} video${res.total === 1 ? "" : "s"} from ${res.channels} channel${res.channels === 1 ? "" : "s"}` +
      (res.lastError ? ` — some requests failed: ${res.lastError}` : ".");
  } else if (res && res.hasApiKey === false) {
    el.statusText.textContent = "Fetching all videos needs an API key (set one in Settings).";
  } else {
    el.statusText.textContent = "Fetch failed.";
  }
}

// ---------- Resizable table columns ----------

// Write the five sized widths (plus the flexible Folder column) into the shared
// CSS custom property both the header and every row read for their grid template.
function applyColTemplate(widths) {
  const template = widths.map((w) => `${w}px`).join(" ") + ` minmax(${COL_FLEX_MIN}px, 1fr)`;
  el.main.style.setProperty("--col-template", template);
}

// Freeze the header's currently rendered column widths into px, so a first drag
// starts from exactly what the fluid default template was showing.
function measureColumnWidths() {
  return Array.from(el.listTableHeader.children)
    .slice(0, COL_MINS.length)
    .map((c) => Math.round(c.getBoundingClientRect().width));
}

// Attach a drag handle to the right edge of each sized column header, once.
function setupColumnResize() {
  const cells = Array.from(el.listTableHeader.children);
  for (let i = 0; i < COL_MINS.length; i++) {
    const handle = document.createElement("div");
    handle.className = "col-resizer";
    handle.dataset.col = String(i);
    cells[i].appendChild(handle);
  }
  el.listTableHeader.addEventListener("mousedown", startColumnResize);
}

function startColumnResize(e) {
  const handle = e.target.closest(".col-resizer");
  if (!handle) return;
  e.preventDefault();
  const i = Number(handle.dataset.col);
  const widths = colWidths ? [...colWidths] : measureColumnWidths();
  const startX = e.clientX;
  const startW = widths[i];
  // Space the tracks can occupy: header content-box minus the five inter-column gaps.
  const availTracks = el.listTableHeader.clientWidth - COL_PAD_X - COL_GAP * (COL_MINS.length);
  document.body.classList.add("col-resizing");
  handle.classList.add("dragging");

  const onMove = (ev) => {
    const otherFixed = widths.reduce((sum, w, idx) => (idx === i ? sum : sum + w), 0);
    // Cap so the flexible Folder column never dips below its minimum (no overflow).
    const maxW = Math.max(COL_MINS[i], availTracks - otherFixed - COL_FLEX_MIN);
    widths[i] = Math.max(COL_MINS[i], Math.min(Math.round(startW + (ev.clientX - startX)), maxW));
    applyColTemplate(widths);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("col-resizing");
    handle.classList.remove("dragging");
    colWidths = widths;
    chrome.storage.local.set({ colWidths });
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// Returns child folder ids for a given parent (defaults to channel folders;
// pass state.videoFolders to operate on Watch Later lists).
function getChildFolderIds(parentId, folders = state.folders) {
  return Object.keys(folders).filter((id) => folders[id].parentId === parentId);
}

// The id set of a folder plus all its child folders (for counting/filtering).
function getFolderAndDescendantIds(folderId, folders = state.folders) {
  return new Set([folderId, ...getChildFolderIds(folderId, folders)]);
}

// The sidebar's two virtual entries. Neither is a real folder — they hold no
// items of their own, can't be renamed, dragged, or dropped onto: "all" scopes
// nothing, and "filed" is the exact opposite of the pinned Unfiled folder,
// i.e. everything that *has* been filed away. Folder ids are always
// slug + "-" + suffix (see the new-folder handler), so neither can collide.
const FILED_ID = "filed";
const isVirtualFolderId = (id) => id === "all" || id === FILED_ID;
// An absent folderId means Unfiled (RSS videos carry none) — normalize before
// asking anything about it.
const isFiledFolderId = (folderId) => (folderId || "unsorted") !== "unsorted";

// "Does this item belong to the current sidebar selection?" as a predicate over
// an item's folderId, or null when nothing is scoped ("All"). Every view's
// universe function goes through this, so the virtual entries behave the same
// in the channel grid, the New feed and Watch Later.
function folderScopeTest(selectedId, folders = state.folders) {
  if (selectedId === "all") return null;
  if (selectedId === FILED_ID) return isFiledFolderId;
  const ids = getFolderAndDescendantIds(selectedId, folders);
  return (folderId) => ids.has(folderId || "unsorted");
}

// Count channels in a folder and all its children
function getFolderChannelCount(folderId) {
  const allIds = getFolderAndDescendantIds(folderId);
  return Object.values(state.channels).filter((c) => allIds.has(c.folderId)).length;
}

function renderFolders() {
  if (el.folderSortSelect) el.folderSortSelect.value = folderSort;

  const d = fdom();
  const folders = d.folders;
  const selected = d.selected;
  const collapsed = d.collapsed;
  el.folderList.innerHTML = "";

  // Direct item counts per folder + a parent→children index, in single passes.
  const directCount = d.counts();
  const childIndex = {};
  for (const [id, f] of Object.entries(folders)) {
    if (f.parentId) (childIndex[f.parentId] ||= []).push(id);
  }

  // "All" virtual item
  const allLi = document.createElement("li");
  allLi.className = "folder-item" + (selected === "all" ? " active" : "");
  allLi.dataset.folderId = "all";
  allLi.innerHTML = `<span class="folder-name">All</span><span class="folder-count">${d.total()}</span>`;
  el.folderList.appendChild(allLi);

  // Separate top-level and child folders
  const topLevelEntries = Object.entries(folders)
    .filter(([, f]) => !f.parentId)
    .map(([id, folder]) => ({
      id,
      name: folder.name,
      count: (directCount[id] || 0) + (childIndex[id] || []).reduce((s, cid) => s + (directCount[cid] || 0), 0),
      order: folder.order ?? 0,
    }));

  // In the New view the sidebar lists only folders that actually contain a
  // tracked channel (counts above are tracked-only), so empty ones drop out.
  const hideEmpty = currentView === "new";
  const visibleTop = hideEmpty ? topLevelEntries.filter((f) => f.count > 0) : topLevelEntries;

  const unsorted = visibleTop.find((f) => f.id === "unsorted");
  let rest = visibleTop.filter((f) => f.id !== "unsorted");

  // The "Filed" virtual item — the Unfiled folder's mirror image: everything
  // that *is* in a folder. It holds no items of its own, so its count is simply
  // whatever the sidebar's total isn't in Unfiled (both already respect the New
  // view's tracked-only restriction). It renders right under Unfiled, the entry
  // it pairs with, or under "All" when Unfiled itself is hidden.
  const filedCount = d.total() - (directCount["unsorted"] || 0);
  const appendFiledItem = () => {
    if (hideEmpty && filedCount === 0) return;
    const li = document.createElement("li");
    li.className = "folder-item" + (selected === FILED_ID ? " active" : "");
    li.dataset.folderId = FILED_ID;
    li.innerHTML = `<span class="folder-name">Filed</span><span class="folder-count">${filedCount}</span>`;
    el.folderList.appendChild(li);
  };
  if (!unsorted) appendFiledItem();

  if (folderSort === "alpha") {
    rest.sort((a, b) => a.name.localeCompare(b.name));
  } else if (folderSort === "count-desc") {
    rest.sort((a, b) => b.count - a.count);
  } else if (folderSort === "count-asc") {
    rest.sort((a, b) => a.count - b.count);
  } else {
    rest.sort((a, b) => a.order - b.order);
  }

  const topLevelSorted = unsorted ? [unsorted, ...rest] : rest;

  for (const f of topLevelSorted) {
    const draggable = f.id !== "unsorted" && folderSort === "custom";
    const li = document.createElement("li");
    const childIds = (childIndex[f.id] || []).filter((cid) => !hideEmpty || (directCount[cid] || 0) > 0);
    const hasChildren = f.id !== "unsorted" && childIds.length > 0;
    const isCollapsed = hasChildren && collapsed.has(f.id);
    li.className = "folder-item" + (f.id === selected ? " active" : "") + (hasChildren ? " folder-item--parent" : "") + (isCollapsed ? " folder-item--collapsed" : "");
    li.dataset.folderId = f.id;
    if (hasChildren) li.dataset.parentFolder = "1";
    li.draggable = draggable;
    const emoji = folders[f.id]?.emoji || "";
    const caret = hasChildren ? `<span class="folder-caret" aria-hidden="true">▸</span>` : "";
    li.innerHTML = `${caret}${folderEmojiSlotHtml(f.id, emoji)}<span class="folder-name">${escapeHtml(f.name)}</span><span class="folder-count">${f.count}</span>`;
    el.folderList.appendChild(li);
    if (f.id === "unsorted") appendFiledItem();

    // Render children under this parent
    if (f.id !== "unsorted") {
      const children = childIds
        .map((id) => { const cf = folders[id]; return { id, name: cf.name, order: cf.order ?? 0, emoji: cf.emoji || "", count: directCount[id] || 0 }; })
        .sort((a, b) => a.order - b.order);

      for (const child of children) {
        const childLi = document.createElement("li");
        childLi.className = "folder-item folder-item--child" + (child.id === selected ? " active" : "") + (isCollapsed ? " folder-item--hidden" : "");
        childLi.dataset.folderId = child.id;
        childLi.draggable = folderSort === "custom";
        childLi.innerHTML = `${folderEmojiSlotHtml(child.id, child.emoji)}<span class="folder-name">${escapeHtml(child.name)}</span><span class="folder-count">${child.count}</span>`;
        el.folderList.appendChild(childLi);
      }
    }
  }
}

function folderEmojiSlotHtml(folderId, emoji) {
  if (folderId === "unsorted") return "";
  // A plain, non-interactive slot: clicking it selects the folder like the name
  // does (the click bubbles up). Emoji is set from the folder's right-click menu.
  // The slot is always rendered (empty when unset) so folder names stay aligned.
  return `<span class="folder-emoji">${escapeHtml(emoji || "")}</span>`;
}

function openEmojiInput(anchorEl, folderId) {
  // Remove any existing picker
  document.querySelector(".folder-emoji-picker")?.remove();

  const picker = document.createElement("div");
  picker.className = "folder-emoji-picker";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "folder-emoji-input";
  input.placeholder = "😀";
  input.value = fdom().folders[folderId]?.emoji || "";
  input.maxLength = 4; // room for one emoji (some are multi-codepoint)

  const clearBtn = document.createElement("button");
  clearBtn.className = "folder-emoji-clear";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear emoji";

  picker.appendChild(input);
  picker.appendChild(clearBtn);
  document.body.appendChild(picker);

  // Position below the slot
  const rect = anchorEl.getBoundingClientRect();
  picker.style.left = rect.left + "px";
  picker.style.top = (rect.bottom + 4) + "px";

  input.focus();
  input.select();

  const save = async (value) => {
    await setFolderEmoji(folderId, value);
    picker.remove();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save(input.value);
    if (e.key === "Escape") picker.remove();
  });

  // Auto-save when a single emoji is typed
  input.addEventListener("input", () => {
    const chars = [...input.value.trim()];
    if (chars.length >= 1) save(input.value);
  });

  clearBtn.addEventListener("click", () => save(""));

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener("click", function outside(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener("click", outside);
      }
    });
  }, 0);
}

// Set or clear a folder's emoji (empty string clears). Emoji may be up to two
// codepoints. Persists and re-renders the sidebar. Operates on the active domain.
async function setFolderEmoji(folderId, value) {
  const d = fdom();
  const folder = d.folders[folderId];
  if (!folder) return;
  const emoji = [...value.trim()].slice(0, 2).join("");
  if (emoji) folder.emoji = emoji;
  else delete folder.emoji;
  await d.persist();
  renderFolders();
}

// Whether a folder has any subfolders (i.e. is itself a parent).
function folderHasChildren(folderId, folders = fdom().folders) {
  return Object.values(folders).some((f) => f.parentId === folderId);
}

// Ordered ids of folders sharing a parent. parentId null/undefined => top-level.
// The pinned "unsorted" folder is excluded — it is never reordered or reparented.
function getSiblingIdsOrdered(parentId, folders = fdom().folders) {
  return Object.entries(folders)
    .filter(([id, f]) => id !== "unsorted" && (parentId ? f.parentId === parentId : !f.parentId))
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([id]) => id);
}

// Move `srcId` into `newParentId` (null = top-level), positioned just before
// `beforeId` among the destination siblings (append when beforeId is null).
// Renumbers the destination group's order values and persists.
function applyFolderDrop(srcId, newParentId, beforeId) {
  const d = fdom();
  const src = d.folders[srcId];
  if (!src) return;

  if (newParentId) src.parentId = newParentId;
  else delete src.parentId;

  const siblings = getSiblingIdsOrdered(newParentId, d.folders).filter((id) => id !== srcId);
  const idx = beforeId ? siblings.indexOf(beforeId) : -1;
  if (idx >= 0) siblings.splice(idx, 0, srcId);
  else siblings.push(srcId);

  siblings.forEach((id, i) => { d.folders[id].order = i; });
  d.persist();
}

// Decide what a drop of `srcId` onto `targetId` means from where the cursor
// sits within the target row: nest inside (middle) vs. reorder as a sibling
// (top/bottom edge). Returns null when the drop isn't allowed.
function computeFolderDropIntent(srcId, targetId, clientY, targetEl) {
  const folders = fdom().folders;
  const src = folders[srcId];
  const target = folders[targetId];
  if (!src || !target || srcId === targetId) return null;
  if (targetId === "unsorted") return null;   // pinned; never a drop target
  if (target.parentId === srcId) return null; // can't drop a folder onto its own child

  const srcHasChildren = folderHasChildren(srcId, folders);
  const targetIsTopLevel = !target.parentId;
  // 2-level max: only nest into a top-level folder, and never nest a folder
  // that already has children of its own.
  const canNest = targetIsTopLevel && !srcHasChildren;

  const rect = targetEl.getBoundingClientRect();
  const y = clientY - rect.top;
  const h = rect.height;

  if (canNest) {
    if (y < h * 0.25) return { type: "before" };
    if (y > h * 0.75) return { type: "after" };
    return { type: "inside" };
  }

  // No nesting here — the gesture can only reorder as a sibling of the target.
  // A folder with children can't become a child, so reordering it next to a
  // child folder (which would nest it one level down) is disallowed.
  if (srcHasChildren && target.parentId) return null;
  return { type: y < h * 0.5 ? "before" : "after" };
}

function performFolderDrop(srcId, targetId, intent) {
  const d = fdom();
  const target = d.folders[targetId];
  if (intent.type === "inside") {
    d.collapsed.delete(targetId); // reveal the newly nested child
    applyFolderDrop(srcId, targetId, null);
  } else {
    const newParentId = target.parentId || null;
    if (intent.type === "before") {
      applyFolderDrop(srcId, newParentId, targetId);
    } else {
      const siblings = getSiblingIdsOrdered(newParentId, d.folders).filter((id) => id !== srcId);
      const afterId = siblings[siblings.indexOf(targetId) + 1] || null;
      applyFolderDrop(srcId, newParentId, afterId);
    }
  }
  render();
}

function renderTagFilters() {
  const bar = el.tagFilterBar;
  bar.innerHTML = "";

  // Only offer variables actually present on channels in the current folder.
  const channelsInFolder = Object.values(state.channels).filter(
    (c) => currentFolderId === "all" ||
      (currentFolderId === FILED_ID ? isFiledFolderId(c.folderId) : c.folderId === currentFolderId)
  );
  const usedTagIds = new Set(channelsInFolder.flatMap((c) => c.tags || []));
  const tagEntries = Object.entries(state.tags).filter(([id]) => usedTagIds.has(id));
  const langs = [...new Set(channelsInFolder.map((c) => c.language).filter(Boolean))].sort();
  const hasActive = channelsInFolder.some((c) => c.active);
  const hasFinished = channelsInFolder.some((c) => c.finished);

  bar.hidden = tagEntries.length === 0 && langs.length === 0 && !hasActive && !hasFinished;
  if (bar.hidden) return;

  const label = document.createElement("span");
  label.className = "tag-filter-label";
  label.textContent = "Filter";
  bar.appendChild(label);

  for (const [id, tag] of tagEntries) {
    const included = activeTagFilters.has(id);
    const chip = document.createElement("span");
    chip.className = "tag-chip" + (included ? " active" : excludedTagFilters.has(id) ? " excluded" : "");
    chip.textContent = tag.name;
    chip.title = `${tag.name} — left click: only these · right click: exclude · shift+right click: rename or delete`;
    chip.style.background = included ? tag.color : "";
    chip.style.borderColor = tag.color;
    if (!included) chip.style.color = excludedTagFilters.has(id) ? tag.color : "";
    chip.dataset.tagId = id;
    chip.dataset.role = "filter-tag";
    bar.appendChild(chip);
  }

  // Language chips
  for (const lang of langs) {
    const included = activeLangFilters.has(lang);
    const excluded = excludedLangFilters.has(lang);
    const chip = document.createElement("span");
    chip.className = "tag-chip filter-lang-chip" + (included ? " active" : excluded ? " excluded" : "");
    chip.textContent = langLabel(lang);
    chip.title = `${langName(lang)} — left click: only these · right click: exclude`;
    const color = langColor(lang);
    chip.style.background = included ? color : "";
    chip.style.borderColor = color;
    if (!included) chip.style.color = excluded ? color : "";
    chip.dataset.lang = lang;
    chip.dataset.role = "filter-lang";
    bar.appendChild(chip);
  }

  // Active / Finished: the two-sided chips whose *label* flips, since "not
  // active" has its own name. Left click = Active, right click = Inactive.
  if (hasActive) {
    const chip = document.createElement("span");
    const cls = filterActive === "only" ? " on-active" : filterActive === "not" ? " off-active" : "";
    chip.className = "tag-chip var-toggle" + cls;
    chip.textContent = filterActive === "not" ? "Inactive" : "Active";
    chip.title = "Left click: only active channels · right click: only inactive ones";
    chip.dataset.role = "filter-active";
    bar.appendChild(chip);
  }
  if (hasFinished) {
    const chip = document.createElement("span");
    const cls = filterFinished === "only" ? " on-finished" : filterFinished === "not" ? " off-finished" : "";
    chip.className = "tag-chip var-toggle" + cls;
    chip.textContent = filterFinished === "not" ? "Unfinished" : "Finished";
    chip.title = "Left click: only finished channels · right click: only unfinished ones";
    chip.dataset.role = "filter-finished";
    bar.appendChild(chip);
  }
}

// The video views' watched chip, which flips label like Active/Finished does:
// left click narrows to unwatched, right click to watched.
function renderWatchedChip(mode) {
  const chip = el.videoUnwatchedChip;
  chip.textContent = mode === "watched" ? "Watched" : "Unwatched";
  chip.title = "Left click: only unwatched · right click: only watched";
  chip.classList.toggle("on", mode === "unwatched");
  chip.classList.toggle("on-neg", mode === "watched");
}

function renderGrid() {
  renderFilterClears();
  pendingChannels = getFilteredChannels();
  // Precompute the leaf-folder <option> data once per render; buildChannelRow
  // (called lazily per scroll page) then only applies each row's `selected`.
  // Parent folders with children are excluded — channels live only in leaf folders.
  pendingFolderOptions = buildOrderedFolderList()
    .filter(({ id }) => !folderHasChildren(id))
    .map(({ id, f, isChild }) => ({ id, label: `${isChild ? "  " : ""}${escapeHtml(f.name)}` }));
  el.channelGrid.innerHTML = "";
  el.channelGrid.classList.add("list-view");

  const totalChannels = Object.keys(state.channels).length;
  const filteredCount = pendingChannels.length;
  renderResultCount(filteredCount, channelsInCurrentFolder().length, "channel");
  const libraryEmpty = totalChannels === 0;
  const noMatches = !libraryEmpty && filteredCount === 0;

  el.emptyState.hidden = !libraryEmpty;
  el.noResultsState.hidden = !noMatches;
  el.listTableHeader.hidden = libraryEmpty || noMatches;
  if (noMatches) {
    const filtered = anyFilterActive();
    el.noResultsBody.textContent = filtered
      ? "No channels match the current filters."
      : "This folder has no channels yet.";
    el.clearFiltersBtn.hidden = !filtered;
  }
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

// Reset every variable-based filter (tags, language, active/finished) — used
// when switching folders and on "Clear all data", since they're per-folder-view.
function resetVariableFilters() {
  activeTagFilters.clear();
  excludedTagFilters.clear();
  activeLangFilters.clear();
  excludedLangFilters.clear();
  filterActive = "";
  filterFinished = "";
}

// The one rule every filter chip follows: **left click means "only these",
// right click means "not these"**, and clicking the side a chip is already on
// switches it off. It replaces the old single-button cycle (off → only → not),
// where reaching "not" meant clicking past "only" and there was no way back
// without a third click — and where tags and languages had no "not" at all.

// Set-backed chips (tags, languages): move `key` in or out, never both.
function toggleChipFilter(include, exclude, key, negative) {
  const own = negative ? exclude : include;
  const other = negative ? include : exclude;
  if (own.has(key)) own.delete(key);
  else { own.add(key); other.delete(key); }
}

// String-backed chips. `positive`/`negative` are the two values the chip can
// hold; clicking the current one clears it back to "".
function toggleTriState(current, negative, positiveValue = "only", negativeValue = "not") {
  const want = negative ? negativeValue : positiveValue;
  return current === want ? "" : want;
}

// ---------- Number scrubbing ----------
// The filter fields are 44–68px boxes whose native spinner arrows are ~6px of
// target. So they also take the two gestures people already know from elsewhere:
// **drag** left/right across the field like a Unity inspector, or **point and
// scroll** like the old Football Manager spinners. Typing still works — a drag
// only starts once the pointer has actually moved.
const SCRUB_PX_PER_STEP = 6;

function setupNumberScrubbing() {
  const fields = [
    el.filterMinCount, el.filterMaxCount,
    el.filterAfterDay, el.filterAfterMonth,
    el.filterBeforeDay, el.filterBeforeMonth,
  ];
  for (const input of fields) enableNumberScrub(input);
  // The year pickers are <select>s, so scrolling walks their options instead.
  for (const sel of [el.filterAfterYear, el.filterBeforeYear]) enableSelectWheel(sel);
}

function numberBounds(input) {
  return {
    min: input.min !== "" ? Number(input.min) : -Infinity,
    max: input.max !== "" ? Number(input.max) : Infinity,
  };
}

// Where an empty field starts counting from: its own min, or 0 when unbounded.
function scrubBase(input) {
  const { min } = numberBounds(input);
  return min === -Infinity ? 0 : min;
}

// Write the value back clamped, and fire `input` so the filter handlers that
// already listen to typing pick it up — scrubbing isn't a separate code path.
function setScrubValue(input, value) {
  const { min, max } = numberBounds(input);
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  if (String(clamped) === input.value) return;
  input.value = String(clamped);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function enableNumberScrub(input) {
  input.classList.add("scrubbable");

  // Hover is enough — no click first. passive:false because the page would
  // otherwise scroll out from under the cursor as the value changes.
  input.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    // An empty field lands on its base value on the first notch, not base±1.
    const from = input.value === "" ? scrubBase(input) - dir : Number(input.value);
    setScrubValue(input, from + dir);
  }, { passive: false });

  let startX = 0, startValue = 0, dragging = false, moved = false;

  input.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startValue = input.value === "" ? scrubBase(input) : Number(input.value);
  });

  input.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const steps = Math.round((e.clientX - startX) / SCRUB_PX_PER_STEP);
    if (!steps && !moved) return; // still a click, not a drag
    if (!moved) {
      moved = true;
      input.classList.add("scrubbing"); // ew-resize cursor + no text selection
      input.setPointerCapture(e.pointerId); // keep the drag alive outside the box
    }
    setScrubValue(input, startValue + steps);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    input.classList.remove("scrubbing");
    if (input.hasPointerCapture?.(e.pointerId)) input.releasePointerCapture(e.pointerId);
  };
  input.addEventListener("pointerup", endDrag);
  input.addEventListener("pointercancel", endDrag);
}

function enableSelectWheel(select) {
  select.addEventListener("wheel", (e) => {
    e.preventDefault();
    const next = select.selectedIndex + (e.deltaY < 0 ? -1 : 1);
    if (next < 0 || next >= select.options.length) return;
    select.selectedIndex = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false });
}

// "12 of 240 videos" while something is filtered, "240 videos" when nothing is.
// The denominator is what the current folder/list holds, not the whole library —
// picking a folder is navigation, so it shouldn't read as a filtered-out count.
function renderResultCount(shown, total, noun) {
  const withNoun = (n) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  el.resultCount.textContent = !total ? "" : shown === total ? withNoun(total) : `${shown} of ${withNoun(total)}`;
}

// Re-render whichever view is showing. Every filter control ends here.
function renderCurrentView() {
  if (currentView === "new") renderVideoFeed();
  else if (currentView === "watchlater") renderWatchLater();
  else renderGrid();
}

// Show each clear button only while its filter is actually set — a row of dead
// × buttons reads as clutter, and a live one is a hint that something is on.
function renderFilterClears() {
  el.searchClear.hidden = !searchQuery.trim();
  el.clearCountBtn.hidden = filterMinCount === null && filterMaxCount === null;
  el.clearAfterBtn.hidden = !dateFilterSet(el.filterAfterDay, el.filterAfterMonth, el.filterAfterYear);
  el.clearBeforeBtn.hidden = !dateFilterSet(el.filterBeforeDay, el.filterBeforeMonth, el.filterBeforeYear);
  el.clearAllFiltersBtn.hidden = !anyFilterActiveInView();
}

function dateFilterSet(dayEl, monthEl, yearEl) {
  return !!(dayEl.value || monthEl.value || (yearEl.value && yearEl.value !== "—"));
}

// What the topbar's "Clear filters" button keys off. The video views only have
// search and the watched chip, and the chip *starts* on "unwatched" — counting
// that default would leave the button showing forever, so only its non-default
// side counts there.
function anyFilterActiveInView() {
  if (currentView === "channels") return anyFilterActive();
  const watched = currentView === "watchlater" ? watchLaterWatchedFilter : newWatchedFilter;
  return !!searchQuery.trim() || watched === "watched";
}

function clearCountFilter() {
  filterMinCount = null;
  filterMaxCount = null;
  el.filterMinCount.value = "";
  el.filterMaxCount.value = "";
  renderGrid();
}

// `which` is "after" | "before" — the two date bounds are identical otherwise.
function clearDateFilter(which) {
  const after = which === "after";
  (after ? [el.filterAfterDay, el.filterAfterMonth] : [el.filterBeforeDay, el.filterBeforeMonth])
    .forEach((input) => (input.value = ""));
  (after ? el.filterAfterYear : el.filterBeforeYear).value = "—";
  if (after) filterAfterDate = null;
  else filterBeforeDate = null;
  renderGrid();
}

function clearSearch() {
  searchQuery = "";
  el.searchInput.value = "";
  renderCurrentView();
}

// Any filter that can hide channels within the current folder view. Excludes
// the folder selection itself (that's navigation, not a filter).
function anyFilterActive() {
  return (
    !!searchQuery.trim() ||
    activeTagFilters.size > 0 ||
    excludedTagFilters.size > 0 ||
    activeLangFilters.size > 0 ||
    excludedLangFilters.size > 0 ||
    filterActive !== "" ||
    filterFinished !== "" ||
    filterMinCount !== null ||
    filterMaxCount !== null ||
    !!filterAfterDate ||
    !!filterBeforeDate
  );
}

// Reset every filter — variable filters, search, and the advanced count/date
// bounds — plus their input controls, then re-render. Folder stays put.
function clearAllFilters() {
  resetVariableFilters();
  searchQuery = "";
  filterMinCount = null;
  filterMaxCount = null;
  filterAfterDate = null;
  filterBeforeDate = null;
  el.searchInput.value = "";
  el.filterMinCount.value = "";
  el.filterMaxCount.value = "";
  el.filterAfterDay.value = "";
  el.filterAfterMonth.value = "";
  el.filterAfterYear.value = "—";
  el.filterBeforeDay.value = "";
  el.filterBeforeMonth.value = "";
  el.filterBeforeYear.value = "—";
  // "Clear" means nothing is hidden — including the watched chip, even though
  // it *starts* on "unwatched" when the dashboard opens.
  newWatchedFilter = "";
  watchLaterWatchedFilter = "";
  render();
}

// Everything the selected folder (and its sub-folders) holds, before any filter.
// The denominator of the toolbar's count, and the starting point of the filters.
function channelsInCurrentFolder() {
  const list = Object.values(state.channels);
  const inFolder = folderScopeTest(currentFolderId);
  return inFolder ? list.filter((c) => inFolder(c.folderId)) : list;
}

function getFilteredChannels() {
  let list = channelsInCurrentFolder();
  if (activeTagFilters.size) {
    list = list.filter((c) => c.tags?.some((t) => activeTagFilters.has(t)));
  }
  if (excludedTagFilters.size) {
    list = list.filter((c) => !c.tags?.some((t) => excludedTagFilters.has(t)));
  }
  if (activeLangFilters.size) {
    list = list.filter((c) => activeLangFilters.has(c.language));
  }
  if (excludedLangFilters.size) {
    list = list.filter((c) => !excludedLangFilters.has(c.language));
  }
  if (filterActive === "only") {
    list = list.filter((c) => c.active);
  } else if (filterActive === "not") {
    list = list.filter((c) => !c.active);
  }
  if (filterFinished === "only") {
    list = list.filter((c) => c.finished);
  } else if (filterFinished === "not") {
    list = list.filter((c) => !c.finished);
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
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
    const da = a.lastVideoDate || "";
    const db = b.lastVideoDate || "";
    const dateCmp = da < db ? -1 : da > db ? 1 : 0;
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

function buildChannelRow(ch) {
  const row = document.createElement("div");
  row.className = "channel-row";
  if (selectedChannelIds.has(ch.id)) row.classList.add("selected");
  row.dataset.channelId = ch.id;

  row.innerHTML = `
    <div class="channel-head">
      ${thumbHtml(ch)}
      <div class="channel-name-wrap">
        <div class="channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
        <div class="channel-handle">${escapeHtml(ch.handle || ch.id)}</div>
      </div>
    </div>
    <div class="row-date ${dateAgeClass(ch.lastVideoDate)}" title="${escapeHtml(formatDateTime(ch.lastVideoDate))}"><span class="date-long">${formatShortDate(ch.lastVideoDate)}</span><span class="date-short">${formatNumericDate(ch.lastVideoDate)}</span></div>
    <div class="row-count">${ch.videoCount ?? "—"}</div>
    <div class="row-subs" title="${escapeHtml(subscriberTitle(ch.subscriberCount))}">${formatSubscribers(ch.subscriberCount)}</div>
    <div class="channel-tags channel-vars">
      <select class="var-lang${ch.language ? " has-lang" : ""}" data-role="set-language" title="Language"${ch.language ? ` style="border-color:${langColor(ch.language)};color:${langColor(ch.language)}"` : ""}>
        ${languageOptionsHtml(ch)}
      </select>
      <span class="tag-chip var-toggle${ch.active ? " on-active" : ""}" data-role="toggle-active" title="Active — flag channels you're following">Active</span>
      <span class="tag-chip var-toggle${ch.finished ? " on-finished" : ""}" data-role="toggle-finished" title="Finished — flag channels you consider done">Finished</span>
      <span class="tag-chip var-toggle${ch.trackVideos ? " on-track" : ""}" data-role="toggle-track" title="Track — pull this channel's new uploads into the Videos feed">Track</span>
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
  // pendingFolderOptions holds the {id, label} for each leaf folder, built once
  // per render in renderGrid(); only the per-row `selected` choice differs here.
  return pendingFolderOptions
    .map(({ id, label }) =>
      `<option value="${id}" ${ch.folderId === id ? "selected" : ""}>${label}</option>`
    )
    .join("");
}

// Top-level folders as [id, folder] entries, unsorted pinned first, then by order.
function getTopLevelFoldersOrdered(folders = state.folders) {
  return Object.entries(folders)
    .filter(([, f]) => !f.parentId)
    .sort((a, b) => {
      if (a[0] === "unsorted") return -1;
      if (b[0] === "unsorted") return 1;
      return (a[1].order ?? 0) - (b[1].order ?? 0);
    });
}

// Returns folders in sidebar order: top-level (unsorted first, then rest), each followed by their children
function buildOrderedFolderList() {
  const topLevel = getTopLevelFoldersOrdered();

  const result = [];
  for (const [id, f] of topLevel) {
    result.push({ id, f, isChild: false });
    const children = Object.entries(state.folders)
      .filter(([, cf]) => cf.parentId === id)
      .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    for (const [cid, cf] of children) {
      result.push({ id: cid, f: cf, isChild: true });
    }
  }
  return result;
}

function languageOptionsHtml(ch) {
  const current = ch.language || "";
  // A custom language not in the curated list still needs its own option.
  const list = current && !LANGUAGES.includes(current) ? [current, ...LANGUAGES] : LANGUAGES;
  const opts = list
    .map((l) => `<option value="${escapeHtml(l)}" ${l === current ? "selected" : ""}>${escapeHtml(langLabel(l))}</option>`)
    .join("");
  return (
    `<option value="" ${current ? "" : "selected"}>lang…</option>` +
    opts +
    `<option value="${LANG_OTHER}">Other…</option>`
  );
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

// Recency bucket for the Last Video cell, as a CSS class. Everything is measured
// against *today*, never a fixed year, so the buckets keep sliding forward on
// their own: this month and last month are "current", then it's calendar-year
// distance — this year, the two years before it, the two before those, and
// everything older. An unknown date gets no class and stays the plain text color
// (missing ≠ ancient).
function dateAgeClass(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();

  // Whole months between the two month-starts: 0 = this month, 1 = last month.
  // Future dates (a scheduled premiere) come out negative and count as current.
  const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (monthsAgo <= 1) return "date-age-current";

  const yearsAgo = now.getFullYear() - d.getFullYear();
  if (yearsAgo <= 0) return "date-age-year";   // earlier this year
  if (yearsAgo <= 2) return "date-age-recent"; // the previous two years
  if (yearsAgo <= 4) return "date-age-old";    // the two before those
  return "date-age-stale";
}

function formatShortDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Compact all-numeric date for a narrow date column, e.g. "06/07/07"
// (day/month/year, two digits each). Mirrors formatShortDate's "—" for empty.
function formatNumericDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date)) return "—";
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(date.getDate())}/${p2(date.getMonth() + 1)}/${p2(date.getFullYear() % 100)}`;
}

// Full date + time for tooltips, e.g. "Jul 3, 2026, 2:15 PM"
function formatDateTime(iso) {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (isNaN(date)) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// Compact subscriber count for the list, e.g. 1.2M / 45.3K / 812. null means
// hidden or not-yet-fetched (needs an API key) and shows as an em dash.
function formatSubscribers(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return trimZero(n / 1_000_000) + "M";
  if (n >= 1_000) return trimZero(n / 1_000) + "K";
  return String(n);
}

function trimZero(x) {
  return x.toFixed(1).replace(/\.0$/, "");
}

// Exact count (or a reason) for the cell's hover tooltip.
function subscriberTitle(n) {
  if (n === null || n === undefined) return "Subscriber count unavailable (needs an API key, or the channel hides it)";
  return n.toLocaleString() + " subscribers";
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

// Matches the background alarm period: if no refresh has landed in that long,
// this device's New feed is stale (or, on a device that was just set up, empty —
// the alarm's first fire is three hours after install). Pull it on open.
//
// Only YouTube data is fetched here. The gist is never touched automatically:
// an auto-sync on open meant a device opened after sitting stale pushed its old
// library up before pulling anything down, overwriting newer state from another
// device. Upload and Download are explicit, reviewed actions in Settings.
const AUTO_REFRESH_STALE_MS = 3 * 60 * 60 * 1000;

async function catchUpOnOpen() {
  const ids = Object.keys(state.channels);
  if (!ids.length) return;
  const newest = ids.reduce((max, id) => Math.max(max, state.channels[id].lastFetched || 0), 0);
  if (Date.now() - newest < AUTO_REFRESH_STALE_MS) return;
  el.statusText.textContent = "Refreshing…";
  const res = await chrome.runtime.sendMessage({ type: "REFRESH_STATS" });
  await loadState();
  render();
  el.statusText.textContent = res?.ok
    ? `Updated ${new Date().toLocaleTimeString()}.`
    : `Refresh failed. ${res?.error || ""}`;
}

// ---------- "There's a newer version on GitHub" ----------
// A `git pull` is not something this extension can do: an MV3 worker has no
// shell and no filesystem, not even to the folder it was loaded from, and
// Chrome's own auto-update only covers Web Store installs. What it *can* do is
// notice — and then restart itself once you've pulled, which is the only part
// that needs to happen from inside the extension (`chrome.runtime.reload()`
// makes Chrome re-read an unpacked extension's files from disk).
//
// "Newer" can't come from the manifest version, which only moves when someone
// remembers to bump it. `.githooks/pre-commit` stamps `version.json` with a UTC
// timestamp on every commit instead, so any push registers, and comparing the
// two stamps also says *which side* is ahead — an unpushed local commit must
// not read as "an update is available".
const REPO = { owner: "yigitsariyar23", name: "mytube-organizer", branch: "main" };
const UPDATE_STAMP_URL = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/version.json`;
const UPDATE_HEAD_URL = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/commits/${REPO.branch}`;

async function checkForAppUpdate() {
  try {
    const local = await fetch(chrome.runtime.getURL("version.json")).then((r) => r.json());
    // Cache-busted: raw.githubusercontent serves a cached copy for minutes, and
    // a stale one would hide exactly the push we're looking for.
    const res = await fetch(`${UPDATE_STAMP_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const remote = await res.json();
    if (!local?.build || !remote?.build) return;
    if (remote.build <= local.build) return; // same commit, or this checkout is ahead

    const { dismissedUpdateBuild } = await chrome.storage.local.get("dismissedUpdateBuild");
    if (dismissedUpdateBuild === remote.build) return; // already said "not now" to this one

    // Nice-to-have only: the banner still works if the API is rate-limited.
    let head = null;
    try {
      const r = await fetch(UPDATE_HEAD_URL);
      if (r.ok) head = await r.json();
    } catch (e) { /* no commit detail, no problem */ }
    showUpdateBanner(remote.build, head);
  } catch (e) {
    // Offline, rate-limited, no version.json yet — an update check is never
    // worth interrupting someone over.
  }
}

function showUpdateBanner(build, head) {
  const subject = (head?.commit?.message || "").split("\n")[0];
  const when = head?.commit?.author?.date ? formatShortDate(head.commit.author.date) : "";
  el.updateBannerText.textContent = subject
    ? `A newer version is on GitHub — “${subject}”${when ? ` · ${when}` : ""}. Pull it, then reload:`
    : "A newer version is on GitHub. Pull it, then reload:";
  el.updateBanner.dataset.build = build;
  el.updateBanner.hidden = false;
}

// Nothing syncs by itself — but *looking* is free, and a device that sat closed
// has no way of knowing the gist moved on. On open, fetch the download diff and,
// if the gist really differs, open the same review the Download button opens.
// Applying is still entirely the user's call; this only saves them from having
// to remember to check. Deliberately NOT an auto-merge — see the sync notes.
const SYNC_CHECK_INTERVAL_MS = 10 * 60 * 1000;

async function checkRemoteChangesOnOpen() {
  if (!state.gistToken) return;                // sync was never set up
  if (anyReviewOpen()) return;                 // a scan / import review comes first
  const { lastSyncCheckAt } = await chrome.storage.local.get("lastSyncCheckAt");
  if (lastSyncCheckAt && Date.now() - lastSyncCheckAt < SYNC_CHECK_INTERVAL_MS) return;
  await chrome.storage.local.set({ lastSyncCheckAt: Date.now() });

  const diff = await chrome.runtime.sendMessage({ type: "FETCH_SYNC_DIFF", direction: "download" });
  // Silent on failure: a check nobody asked for shouldn't put "GitHub: 401" in
  // front of someone who just wanted to look at their subscriptions. The manual
  // Download button still reports everything.
  if (!diff?.ok || !syncDiffTotal(diff)) return;
  if (anyReviewOpen()) return;                 // something opened while we waited
  openSyncDiffModal(diff);
}

function anyReviewOpen() {
  return !el.scanDiffModal.hidden || !el.playlistImportModal.hidden || !el.syncDiffModal.hidden;
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

// ---------- Playlist import review dialog ----------
// Background stashed a fetched playlist as `pendingPlaylistImport`; here the user
// names the list and decides, per video already in Watch Later, whether to move
// it into the new list. New videos are always added.

function openPlaylistImportModal(pending) {
  const vids = pending.videos || [];
  const fresh = vids.filter((v) => v.status !== "savedElsewhere");
  const dupes = vids.filter((v) => v.status === "savedElsewhere");

  el.playlistImportName.value = pending.title || "Imported playlist";
  el.playlistImportSummary.textContent =
    `${vids.length} video${vids.length === 1 ? "" : "s"} — ${fresh.length} new, ` +
    `${dupes.length} already in Watch Later`;

  // Correctness check: the scraper reports the playlist's own "N videos" count.
  // If we captured fewer, the list wasn't fully scrolled — warn, don't block.
  const stated = pending.statedCount;
  const scraped = pending.scrapedCount ?? vids.length;
  if (stated != null && scraped < stated) {
    el.playlistImportWarning.hidden = false;
    el.playlistImportWarning.textContent =
      `Only ${scraped} of the playlist's ${stated} videos were captured. Re-run the import ` +
      `and let the playlist page finish scrolling to the bottom to get them all.`;
  } else {
    el.playlistImportWarning.hidden = true;
  }

  el.playlistImportBody.innerHTML = "";
  el.playlistImportBody.appendChild(buildPlaylistSection("New — will be added to this list", "add", fresh, false));
  el.playlistImportBody.appendChild(buildPlaylistSection("Already in Watch Later — tick to move here", "mod", dupes, true));

  el.playlistImportApply.disabled = vids.length === 0;
  el.playlistImportModal.hidden = false;
}

// One section of the import review. `movable` rows carry a "move into this list"
// checkbox (`data-move-id`); non-movable rows are informational.
function buildPlaylistSection(title, kind, items, movable) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";
  sec.appendChild(buildDiffSectionHeader(title, kind, items.length));

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "scan-diff-empty";
    empty.textContent = "None";
    sec.appendChild(empty);
    return sec;
  }

  const list = document.createElement("div");
  list.className = "scan-diff-list";
  for (const it of items) {
    const sub = movable
      ? `currently in “${escapeHtml(listName(it.currentFolderId))}”`
      : escapeHtml(it.author || "");
    const text =
      `<span class="scan-diff-text"><b>${escapeHtml(it.title || it.id)}</b>` +
      (sub ? `<span class="scan-diff-sub">${sub}</span>` : "") +
      `</span>`;
    const row = document.createElement(movable ? "label" : "div");
    row.className = "scan-diff-row";
    row.innerHTML = movable
      ? `<input type="checkbox" data-move-id="${escapeHtml(it.id)}" />${text}`
      : text;
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

// Resolve a Watch Later list id to its display name (falls back to the id).
function listName(id) {
  return state.videoFolders[id]?.name || id || "Unfiled";
}

// ---------- Sync review dialog ----------

let pendingSyncDiff = null;

// How many changes a diff carries. The summary line and the Apply button key off
// it — and so does the on-open check, which only bothers the user when this is
// non-zero. Removals of folders/lists only ever apply on upload.
function syncDiffTotal(diff) {
  const isUpload = diff.direction === "upload";
  const empty = { added: [], removed: [], modified: [] };
  const ch = diff.channels || empty;
  const vids = diff.videos || { added: 0, modified: 0, removed: 0 };
  const folderish = (f = empty) => f.added.length + f.modified.length + (isUpload ? f.removed.length : 0);
  return (
    ch.added.length + ch.removed.length + ch.modified.length +
    folderish(diff.folders) + folderish(diff.videoFolders) +
    (diff.settings || []).length +
    vids.added + vids.modified + (vids.removed || 0)
  );
}

function openSyncDiffModal(diff) {
  pendingSyncDiff = diff;
  const { direction, channels: { added, removed, modified } } = diff;
  const isUpload = direction === "upload";
  // Folders/settings/video diffs are all optional; guard for gists synced before
  // they existed.
  const fo = diff.folders || { added: [], removed: [], modified: [] };
  const settings = diff.settings || [];
  // Folder removals only truly apply on upload (download keeps local-only folders).
  const foRemoved = isUpload ? fo.removed : [];
  const folderCount = fo.added.length + fo.modified.length + foRemoved.length;

  const vf = diff.videoFolders || { added: [], removed: [], modified: [] };
  const vfRemoved = isUpload ? vf.removed : [];
  const vfCount = vf.added.length + vf.modified.length + vfRemoved.length;
  const vids = diff.videos || { added: 0, modified: 0, removed: 0 };
  const vidsRemoved = vids.removed || 0;
  const vidsCount = vids.added + vids.modified + vidsRemoved;

  el.syncDiffTitle.textContent = isUpload ? "Review upload" : "Review download";

  const totalChanges = syncDiffTotal(diff);
  const extra = [];
  if (folderCount) extra.push(`${folderCount} folder change${folderCount === 1 ? "" : "s"}`);
  if (vfCount) extra.push(`${vfCount} list change${vfCount === 1 ? "" : "s"}`);
  if (vidsCount) extra.push(`${vidsCount} video${vidsCount === 1 ? "" : "s"}`);
  if (settings.length) extra.push(`${settings.length} setting${settings.length === 1 ? "" : "s"}`);
  el.syncDiffSummary.textContent = totalChanges === 0
    ? "No differences — already in sync."
    : [`${added.length} to add, ${modified.length} to overwrite, ${removed.length} to remove`, ...extra].join(", ") + ".";

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

  const dest = isUpload ? "in Gist" : "locally";
  if (settings.length) el.syncDiffBody.appendChild(buildSyncSettingsSection(`Settings — will overwrite ${dest}`, settings));
  if (folderCount) el.syncDiffBody.appendChild(buildSyncFolderSection(`Folders — will overwrite ${dest}`, fo.added, fo.modified, foRemoved));
  if (vfCount) el.syncDiffBody.appendChild(buildSyncFolderSection(`Watch Later lists — will overwrite ${dest}`, vf.added, vf.modified, vfRemoved));
  if (vidsCount) el.syncDiffBody.appendChild(buildSyncVideoSection(`Videos — merged ${dest}`, vids, dest));

  el.syncDiffApply.textContent = isUpload ? "Apply upload" : "Apply download";
  el.syncDiffApply.disabled = totalChanges === 0;
  el.syncDiffModal.hidden = false;
}

// Only the keys in SYNC_SETTING_KEYS reach this section — view preferences
// (sorts, open view, column widths) are no longer synced, so they never appear.
const SETTING_LABELS = {
  apiKey: "YouTube API key",
  languages: "Language set",
};

// The API key is the user's secret — show presence, not the value.
function formatSettingValue(key, val) {
  if (val === null || val === undefined || val === "") return "(none)";
  if (key === "apiKey") return "(set)";
  if (key === "colWidths") return Array.isArray(val) ? val.map(Math.round).join(" / ") + " px" : "(none)";
  if (Array.isArray(val)) return val.join(", ") || "(none)";
  if (typeof val === "object") return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join(", ");
  return String(val);
}

// Read-only section: each changed setting as "label: from → to". Always applied
// (no checkboxes) — settings ride along wholesale on upload/download.
function buildSyncSettingsSection(title, settings) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";
  sec.appendChild(buildDiffSectionHeader(title, "mod", settings.length));
  const list = document.createElement("div");
  list.className = "scan-diff-list";
  for (const s of settings) {
    const row = document.createElement("div");
    row.className = "scan-diff-row";
    const label = escapeHtml(SETTING_LABELS[s.key] || s.key);
    const from = escapeHtml(formatSettingValue(s.key, s.from));
    const to = escapeHtml(formatSettingValue(s.key, s.to));
    row.innerHTML = `<span class="scan-diff-text"><b>${label}</b><span class="scan-diff-sub">${from} <span class="scan-diff-arrow">→</span> ${to}</span></span>`;
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

// Read-only section listing folder adds, renames/reparents, and (upload-only) removals.
function buildSyncFolderSection(title, added, modified, removed) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";
  const count = added.length + modified.length + removed.length;
  sec.appendChild(buildDiffSectionHeader(title, "mod", count));
  const list = document.createElement("div");
  list.className = "scan-diff-list";
  const addRow = (html) => {
    const row = document.createElement("div");
    row.className = "scan-diff-row";
    row.innerHTML = html;
    list.appendChild(row);
  };
  for (const f of modified) {
    const changes = escapeHtml(f.changes.join(", "));
    addRow(`<span class="scan-diff-text">${escapeHtml(f.oldName || "—")} <span class="scan-diff-arrow">→</span> <b>${escapeHtml(f.name)}</b><span class="scan-diff-sub">${changes}</span></span>`);
  }
  for (const f of added) {
    addRow(`<span class="scan-diff-text"><b>${escapeHtml(f.name)}</b><span class="scan-diff-sub">new folder</span></span>`);
  }
  for (const f of removed) {
    addRow(`<span class="scan-diff-text"><b>${escapeHtml(f.name)}</b><span class="scan-diff-sub">removed</span></span>`);
  }
  sec.appendChild(list);
  return sec;
}

// A read-only one-line section (used for the video-store summary, which is too
// large to review per item).
// One video's change, in words: what the review row's second line says.
// `from` is null for a video the target doesn't have at all; `to` is null for
// one the apply would drop.
function describeVideoChange(it) {
  const listOf = (s) => (s.folderId && s.folderId !== "unsorted" ? s.folderId : "unsorted");
  if (!it.to) return `will be dropped — ${it.reason || "outside what the store keeps"}`;
  if (!it.from) {
    const bits = ["new"];
    if (it.to.saved) bits.push(`in Watch Later (${listName(listOf(it.to))})`);
    if (it.to.watched) bits.push("watched");
    if (it.to.hidden) bits.push("dismissed");
    return bits.join(" · ");
  }
  const parts = [];
  const fromList = listOf(it.from), toList = listOf(it.to);
  if (!it.from.saved && it.to.saved) parts.push(`saved to Watch Later (${listName(toList)})`);
  else if (it.from.saved && !it.to.saved) parts.push("removed from Watch Later");
  else if (it.to.saved && fromList !== toList) parts.push(`moved to ${listName(toList)}`);
  if (!!it.from.watched !== !!it.to.watched) parts.push(it.to.watched ? "marked watched" : "marked unwatched");
  if (!!it.from.hidden !== !!it.to.hidden) parts.push(it.to.hidden ? "dismissed from feed" : "back in the feed");
  return parts.join(" · ") || "list changed";
}

// The Videos section of the sync review. The store is far too big to list every
// video, so the section leads with the merged counts — but the *changes* are
// reviewable: a button expands one row per affected video, each ticked by
// default. Unticking a row leaves that video exactly as the target already has
// it (its id goes back to the apply as `skipVideoIds`), which is the only way to
// take some of a sync and not the rest.
function buildSyncVideoSection(title, vids, dest) {
  const items = vids.items || [];
  const removed = vids.removed || 0;
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";
  sec.appendChild(buildDiffSectionHeader(title, "mod", vids.added + vids.modified + removed));

  const list = document.createElement("div");
  list.className = "scan-diff-list";
  const note = document.createElement("div");
  note.className = "scan-diff-row";
  note.innerHTML = `<span class="scan-diff-text">${escapeHtml(
    `${vids.added} new, ${vids.modified} with changed watched/saved/list state`
    + (removed ? `, ${removed} dropped (untracked channel, or past the per-channel history cap)` : "")
    + `. Videos merge both ways; a merge never removes a saved, watched or dismissed video.`
    + (items.length ? ` Untick a row below to leave that video alone — including a dropped one, which keeps it.` : "")
  )}</span>`;
  list.appendChild(note);
  sec.appendChild(list);

  if (!items.length) return sec;

  const details = document.createElement("div");
  details.className = "scan-diff-list scan-diff-videos";
  details.hidden = true;

  const all = document.createElement("label");
  all.className = "scan-diff-row scan-diff-selectall";
  all.innerHTML = `<input type="checkbox" data-role="select-all-videos" checked /> <span>Apply all of these — untick one to leave it as it is ${escapeHtml(dest)}</span>`;
  details.appendChild(all);

  for (const it of items) {
    const row = document.createElement("label");
    row.className = "scan-diff-row";
    const sub = [it.author, describeVideoChange(it)].filter(Boolean).join(" · ");
    row.innerHTML =
      `<input type="checkbox" data-video-id="${escapeHtml(it.id)}" checked />` +
      `<span class="scan-diff-text"><b>${escapeHtml(it.title)}</b>` +
      `<span class="scan-diff-sub">${escapeHtml(sub)}</span></span>`;
    details.appendChild(row);
  }
  if (vids.truncated) {
    const more = document.createElement("div");
    more.className = "scan-diff-row";
    more.innerHTML = `<span class="scan-diff-text"><span class="scan-diff-sub">${escapeHtml(
      `+ ${vids.truncated} more not listed here (too many to review one by one) — these are applied.`
    )}</span></span>`;
    details.appendChild(more);
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "scan-diff-toggle";
  const label = (hidden) =>
    `${hidden ? "Show" : "Hide"} the ${items.length} video change${items.length === 1 ? "" : "s"}`;
  toggle.textContent = label(true);
  toggle.addEventListener("click", () => {
    details.hidden = !details.hidden;
    toggle.textContent = label(details.hidden);
  });
  sec.appendChild(toggle);
  sec.appendChild(details);
  return sec;
}

// The section header shared by the scan/sync diff sections: a title span (with a
// `scan-<kind>` modifier) and a count badge.
function buildDiffSectionHeader(title, kind, count) {
  const head = document.createElement("div");
  head.className = "scan-diff-head";
  head.innerHTML =
    `<span class="scan-diff-title scan-${kind}">${escapeHtml(title)}</span>` +
    `<span class="folder-count">${count}</span>`;
  return head;
}

function buildSyncModSection(title, items) {
  const sec = document.createElement("div");
  sec.className = "scan-diff-section";

  sec.appendChild(buildDiffSectionHeader(title, "mod", items.length));

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

  sec.appendChild(buildDiffSectionHeader(title, kind, items.length));

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
    const d = fdom();
    if (li.dataset.parentFolder) {
      const fid = li.dataset.folderId;
      if (d.collapsed.has(fid)) d.collapsed.delete(fid);
      else d.collapsed.add(fid);
      renderFolders();
      return;
    }
    d.select(li.dataset.folderId);
    if (currentView !== "watchlater") resetVariableFilters(); // channel filters are per-folder-view
    render();
  });

  // Folder drag-and-drop (custom sort only), delegated on the list so the
  // per-render innerHTML rebuild doesn't re-attach listeners on every row.
  let folderDragSrcId = null;
  const clearFolderDragIndicators = () => {
    el.folderList.querySelectorAll(".folder-item").forEach((x) =>
      x.classList.remove("drag-over", "drag-before", "drag-after"));
  };

  el.folderList.addEventListener("dragstart", (e) => {
    if (folderSort !== "custom") return; // manual drag is only meaningful in custom order
    const li = e.target.closest(".folder-item");
    if (!li || !li.draggable) return; // skip the virtual entries and "Unfiled"
    folderDragSrcId = li.dataset.folderId;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderDragSrcId); // Firefox needs data to start a drag
  });

  el.folderList.addEventListener("dragend", (e) => {
    const li = e.target.closest(".folder-item");
    if (li) li.classList.remove("dragging");
    clearFolderDragIndicators();
    folderDragSrcId = null;
  });

  el.folderList.addEventListener("dragover", (e) => {
    if (!folderDragSrcId) return;
    const li = e.target.closest(".folder-item");
    if (!li) return;
    const intent = computeFolderDropIntent(folderDragSrcId, li.dataset.folderId, e.clientY, li);
    if (!intent) return; // invalid target — no preventDefault, so the drop is refused
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearFolderDragIndicators();
    li.classList.add(
      intent.type === "inside" ? "drag-over" :
      intent.type === "before" ? "drag-before" : "drag-after"
    );
  });

  el.folderList.addEventListener("dragleave", (e) => {
    const li = e.target.closest(".folder-item");
    if (li) li.classList.remove("drag-over", "drag-before", "drag-after");
  });

  el.folderList.addEventListener("drop", (e) => {
    if (!folderDragSrcId) return;
    const li = e.target.closest(".folder-item");
    if (!li) return;
    const intent = computeFolderDropIntent(folderDragSrcId, li.dataset.folderId, e.clientY, li);
    clearFolderDragIndicators();
    if (!intent) return;
    e.preventDefault();
    performFolderDrop(folderDragSrcId, li.dataset.folderId, intent);
  });

  // One entry point for both mouse buttons: `negative` is what right-clicking
  // means. Returns false for a target that isn't a filter chip.
  function activateFilterChip(chip, negative) {
    const role = chip.dataset.role;
    if (role === "filter-tag") {
      toggleChipFilter(activeTagFilters, excludedTagFilters, chip.dataset.tagId, negative);
    } else if (role === "filter-lang") {
      toggleChipFilter(activeLangFilters, excludedLangFilters, chip.dataset.lang, negative);
    } else if (role === "filter-active") {
      filterActive = toggleTriState(filterActive, negative);
    } else if (role === "filter-finished") {
      filterFinished = toggleTriState(filterFinished, negative);
    } else {
      return false;
    }
    renderTagFilters();
    renderGrid();
    return true;
  }

  el.tagFilterBar.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-role]");
    if (chip) activateFilterChip(chip, false);
  });

  el.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderCurrentView();
  });
  el.searchClear.addEventListener("click", () => {
    clearSearch();
    el.searchInput.focus();
  });
  el.clearCountBtn.addEventListener("click", clearCountFilter);
  el.clearAfterBtn.addEventListener("click", () => clearDateFilter("after"));
  el.clearBeforeBtn.addEventListener("click", () => clearDateFilter("before"));
  el.clearAllFiltersBtn.addEventListener("click", clearAllFilters);

  // Reloading throws this page away with the rest of the extension — that's the
  // point: Chrome re-reads an unpacked extension's files from disk on reload.
  el.updateReloadBtn.addEventListener("click", () => chrome.runtime.reload());
  el.updateDismissBtn.addEventListener("click", async () => {
    el.updateBanner.hidden = true;
    await chrome.storage.local.set({ dismissedUpdateBuild: el.updateBanner.dataset.build || "" });
  });

  // View switch + shared video toolbar
  el.viewChannelsBtn.addEventListener("click", () => setView("channels"));
  el.viewNewBtn.addEventListener("click", () => setView("new"));
  el.viewWatchLaterBtn.addEventListener("click", () => setView("watchlater"));

  // Re-render whichever video view is active (for ephemeral filter toggles).
  const renderActiveVideoView = () => {
    if (currentView === "watchlater") renderWatchLater();
    else renderVideoFeed();
  };

  // Same two-button rule as the channel chips: left = unwatched, right = watched.
  const toggleWatchedChip = (negative) => {
    if (currentView === "watchlater") {
      watchLaterWatchedFilter = toggleTriState(watchLaterWatchedFilter, negative, "unwatched", "watched");
    } else {
      newWatchedFilter = toggleTriState(newWatchedFilter, negative, "unwatched", "watched");
    }
    renderActiveVideoView();
  };
  el.videoFilters.addEventListener("click", (e) => {
    if (e.target.dataset.role !== "filter-unwatched") return;
    toggleWatchedChip(false);
  });
  el.videoFilters.addEventListener("contextmenu", (e) => {
    if (e.target.dataset.role !== "filter-unwatched") return;
    e.preventDefault();
    toggleWatchedChip(true);
  });

  // Video sort buttons: click an inactive key to switch to it (defaulting to
  // descending); click the active key to flip direction.
  const onSortClick = (key) => {
    if (videoSortKey === key) videoSortDir = videoSortDir === "desc" ? "asc" : "desc";
    else { videoSortKey = key; videoSortDir = "desc"; }
    chrome.storage.local.set({ videoSort: { key: videoSortKey, dir: videoSortDir } });
    renderActiveVideoView();
  };
  el.videoSortDate.addEventListener("click", () => onSortClick("date"));
  el.videoSortLength.addEventListener("click", () => onSortClick("length"));

  el.videoMarkAllBtn.addEventListener("click", async () => {
    const vids = currentView === "watchlater" ? getWatchLaterVideos() : getFilteredVideos();
    if (!vids.length) return;
    if (!confirm(`Mark all ${vids.length} shown video${vids.length === 1 ? "" : "s"} as watched?`)) return;
    for (const v of vids) v.watched = true;
    await saveVideos();
  });

  el.videoFetchAllBtn.addEventListener("click", () => {
    const tracked = Object.values(state.channels).filter((c) => c.trackVideos).map((c) => c.id);
    if (!tracked.length) {
      el.statusText.textContent = "No tracked channels — turn on Track first.";
      return;
    }
    if (!confirm(`Fetch the full upload history of all ${tracked.length} tracked channel${tracked.length === 1 ? "" : "s"}? This can use significant API quota for large catalogs.`)) return;
    fetchAllVideos(tracked);
  });

  // Suppress the browser's text-selection smear when shift-clicking cards.
  const suppressShiftSmear = (e) => {
    if (e.shiftKey && e.target.closest(".video-card")) e.preventDefault();
  };
  el.videoFeed.addEventListener("mousedown", suppressShiftSmear);
  el.watchLaterGrid.addEventListener("mousedown", suppressShiftSmear);

  // New feed card: modifier-click selects; action buttons act; plain click opens.
  el.videoFeed.addEventListener("click", async (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    const id = card.dataset.videoId;
    const v = state.videos[id];
    if (!v) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      handleVideoSelectionClick(id, e);
      return;
    }
    if (e.target.closest('[data-action="toggle-watched"]')) {
      v.watched = !v.watched;
      await saveVideos();
      return;
    }
    if (e.target.closest('[data-action="hide"]')) {
      v.hidden = true; // dismissed — filtered out and never re-shown by a refresh
      await saveVideos();
      return;
    }
    if (e.target.closest("[data-action]")) return;
    if (selectedVideoIds.size) clearVideoSelection();
    openVideo(id, false);
  });
  el.videoFeed.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const card = e.target.closest(".video-card");
    if (!card || e.target.closest("[data-action]")) return;
    e.preventDefault();
    openVideo(card.dataset.videoId, true);
  });
  // Right-click a New-feed card → bulk menu if inside a 2+ selection, else single.
  el.videoFeed.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    e.preventDefault();
    const id = card.dataset.videoId;
    const v = state.videos[id];
    if (!v) return;
    if (selectedVideoIds.size > 1 && selectedVideoIds.has(id)) {
      showVideoBulkContextMenu(e.clientX, e.clientY, [...selectedVideoIds]);
      return;
    }
    showContextMenu(e.clientX, e.clientY, [
      {
        label: v.watched ? "Mark unwatched" : "Mark watched",
        action: async () => { v.watched = !v.watched; await saveVideos(); },
      },
      { separator: true },
      {
        label: "Remove",
        danger: true,
        action: async () => { v.hidden = true; await saveVideos(); },
      },
    ]);
  });

  // Watch Later card: modifier-click selects; action buttons act; plain opens.
  el.watchLaterGrid.addEventListener("click", async (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    const id = card.dataset.videoId;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      handleVideoSelectionClick(id, e);
      return;
    }
    if (e.target.closest('[data-action="toggle-watched"]')) {
      const v = state.videos[id];
      if (v) { v.watched = !v.watched; await saveVideos(); }
      return;
    }
    if (e.target.closest('[data-action="remove"]')) {
      await removeFromWatchLater(id);
      return;
    }
    if (e.target.closest("[data-action]")) return;
    if (selectedVideoIds.size) clearVideoSelection();
    openVideo(id, false);
  });
  el.watchLaterGrid.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const card = e.target.closest(".video-card");
    if (!card || e.target.closest("[data-action]")) return;
    e.preventDefault();
    openVideo(card.dataset.videoId, true);
  });
  // Right-click a saved video → bulk menu if inside a 2+ selection, else single.
  el.watchLaterGrid.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    e.preventDefault();
    const id = card.dataset.videoId;
    const v = state.videos[id];
    if (!v) return;
    if (selectedVideoIds.size > 1 && selectedVideoIds.has(id)) {
      showVideoBulkContextMenu(e.clientX, e.clientY, [...selectedVideoIds]);
      return;
    }
    showContextMenu(e.clientX, e.clientY, [
      { label: "Move to list", submenu: () => buildListSubmenu(id, v) },
      { separator: true },
      { label: "Remove from Watch Later", danger: true, action: () => removeFromWatchLater(id) },
    ]);
  });

  el.clearFiltersBtn.addEventListener("click", clearAllFilters);

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
    if (e.target.closest(".col-resizer")) return; // a resize drag, not a sort
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

  el.folderSortSelect.addEventListener("change", () => {
    folderSort = el.folderSortSelect.value;
    chrome.storage.local.set({ folderSort });
    renderFolders();
  });

  el.scanBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.youtube.com/feed/channels" });
  });

  el.refreshBtn.addEventListener("click", async () => {
    el.statusText.textContent = "Refreshing…";
    videoDetailsRequested = false; // re-enable the auto length/view fetch
    const res = await chrome.runtime.sendMessage({ type: "REFRESH_STATS" });
    await loadState();
    render();
    el.statusText.textContent = summarizeRefresh(res);
  });

  el.fillAvatarsBtn.addEventListener("click", async () => {
    // Persist a just-typed key so the fill works without a separate Save first.
    state.apiKey = el.apiKeyInput.value.trim();
    await chrome.storage.local.set({ apiKey: state.apiKey });

    el.fillAvatarsBtn.disabled = true;
    el.fillAvatarsStatus.textContent = "Fetching missing avatars…";
    const res = await chrome.runtime.sendMessage({ type: "FILL_MISSING_AVATARS" });
    await loadState();
    render();
    el.fillAvatarsBtn.disabled = false;
    el.fillAvatarsStatus.textContent = summarizeAvatarFill(res);
  });

  // Turn the background refresh summary into a status line that explains why
  // avatars/counts may not have filled (missing key, API error, etc.).
  function summarizeRefresh(res) {
    const time = new Date().toLocaleTimeString();
    if (!res || !res.ok) return "Refresh failed. " + (res?.error || "");
    if (res.queried === 0) return "No channels to refresh.";
    if (!res.hasApiKey) {
      return `Updated ${time}. No API key set — avatars and video counts need a YouTube API key in Settings. (${res.missingThumbs ?? "?"} without avatars.)`;
    }
    let msg = `Updated ${time}: ${res.thumbsFilled ?? 0} avatars filled`;
    if (res.missingThumbs) msg += `, ${res.missingThumbs} still missing`;
    msg += ".";
    if (res.apiFailures) {
      msg += ` ⚠ ${res.apiFailures} API call${res.apiFailures === 1 ? "" : "s"} failed` +
        (res.lastError ? ` (${res.lastError})` : "") + ".";
    }
    return msg;
  }

  // Status line for the targeted avatar-only backfill.
  function summarizeAvatarFill(res) {
    const time = new Date().toLocaleTimeString();
    if (!res || !res.ok) return "Avatar fill failed. " + (res?.error || "");
    if (!res.hasApiKey) return "No API key set — add a YouTube API key in Settings to fetch avatars.";
    if (res.missingBefore === 0) return "All channels already have avatars.";
    let msg = `Filled ${res.thumbsFilled} of ${res.missingBefore} missing avatar${res.missingBefore === 1 ? "" : "s"}`;
    if (res.missingAfter) msg += `, ${res.missingAfter} still missing (the API has no avatar for those)`;
    msg += ` — ${time}.`;
    if (res.apiFailures) {
      msg += ` ⚠ ${res.apiFailures} API call${res.apiFailures === 1 ? "" : "s"} failed` +
        (res.lastError ? ` (${res.lastError})` : "") + ".";
    }
    return msg;
  }

  function isInteractiveTarget(t) {
    return t.closest(".tag-chip") || t.closest("select") || t.closest(".tag-picker");
  }

  // Folder change / tag add-remove / row clicks
  // Suppress the browser's text-selection smear when shift-clicking rows.
  el.channelGrid.addEventListener("mousedown", (e) => {
    if (e.shiftKey && e.target.closest("[data-channel-id]")) e.preventDefault();
  });

  el.channelGrid.addEventListener("click", async (e) => {
    const channelCard = e.target.closest("[data-channel-id]");
    if (!channelCard) return;
    const channelId = channelCard.dataset.channelId;

    // Modifier click drives multi-select instead of any row action.
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      handleSelectionClick(channelId, e);
      return;
    }

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
      openTagPicker(e.target, channelId);
      return;
    }

    const toggleKey = { "toggle-active": "active", "toggle-finished": "finished", "toggle-track": "trackVideos" }[e.target.dataset.role];
    if (toggleKey) {
      const ch = state.channels[channelId];
      if (ch) {
        ch[toggleKey] = !ch[toggleKey];
        await chrome.storage.local.set({ channels: state.channels });
        // Enabling tracking: fetch this channel's uploads now so the feed fills
        // immediately instead of waiting for the next scheduled refresh.
        if (toggleKey === "trackVideos" && ch.trackVideos) {
          chrome.runtime.sendMessage({ type: "REFRESH_SINGLE", channelId });
        }
      }
      return;
    }

    // Left-click anywhere on the row that isn't a tag/select opens the channel
    if (!isInteractiveTarget(e.target)) {
      if (selectedChannelIds.size) clearSelection();
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

  // Right-click menu on channel cards/rows
  el.channelGrid.addEventListener("contextmenu", (e) => {
    const channelCard = e.target.closest("[data-channel-id]");
    if (!channelCard) return;
    e.preventDefault();
    const channelId = channelCard.dataset.channelId;
    const ch = state.channels[channelId];
    if (!ch) return;

    // Right-clicking inside a multi-selection acts on the whole set.
    if (selectedChannelIds.size > 1 && selectedChannelIds.has(channelId)) {
      showBulkContextMenu(e.clientX, e.clientY, [...selectedChannelIds]);
      return;
    }

    showContextMenu(e.clientX, e.clientY, [
      {
        label: "Move to folder",
        submenu: () => buildFolderSubmenu(channelId, ch),
      },
      {
        label: "Set language",
        submenu: () =>
          languageSubmenuItems(
            (lang) => setChannelLanguage(channelId, lang),
            (l) => (ch.language || null) === l,
            [ch.language]
          ),
      },
      {
        label: ch.trackVideos ? "Stop tracking videos" : "Track videos",
        action: async () => {
          ch.trackVideos = !ch.trackVideos;
          await chrome.storage.local.set({ channels: state.channels });
          if (ch.trackVideos) chrome.runtime.sendMessage({ type: "REFRESH_SINGLE", channelId });
        },
      },
      {
        label: ch.fetchedAll ? "Re-fetch all videos" : "Fetch all videos",
        action: () => fetchAllVideos([channelId]),
      },
      { separator: true },
      {
        label: "Delete channel",
        danger: true,
        action: () => deleteChannel(channelId),
      },
    ]);
  });

  el.channelGrid.addEventListener("change", async (e) => {
    const channelCard = e.target.closest("[data-channel-id]");
    if (!channelCard) return;
    const channelId = channelCard.dataset.channelId;

    if (e.target.dataset.role === "set-language") {
      const ch = state.channels[channelId];
      if (!ch) return;
      let value = e.target.value;
      if (value === LANG_OTHER) {
        const custom = prompt("Language:", ch.language || "")?.trim();
        // Cancelled / empty prompt: revert the <select> to what was stored.
        if (!custom) { e.target.value = ch.language || ""; return; }
        value = custom;
      }
      ch.language = value || null;
      await chrome.storage.local.set({ channels: state.channels });
      render();
      return;
    }

    if (e.target.dataset.role !== "move-folder") return;
    state.channels[channelId].folderId = e.target.value;
    await chrome.storage.local.set({ channels: state.channels });
    renderFolders();
    if (currentFolderId !== "all") renderGrid();
  });

  // Settings modal
  el.settingsBtn.addEventListener("click", () => {
    el.apiKeyInput.value = state.apiKey || "";
    el.gistTokenInput.value = state.gistToken || "";
    el.languagesInput.value = LANGUAGES.join("\n");
    el.fillAvatarsStatus.textContent = "";
    renderSyncStatus();
    el.settingsModal.hidden = false;
  });
  el.settingsCancel.addEventListener("click", () => (el.settingsModal.hidden = true));
  el.settingsSave.addEventListener("click", async () => {
    state.apiKey = el.apiKeyInput.value.trim();
    state.gistToken = el.gistTokenInput.value.trim();
    // Parse the language set: trim lines, drop blanks, dedupe (keep order).
    // Empty box falls back to the built-in defaults.
    const parsed = [...new Set(el.languagesInput.value.split("\n").map((l) => l.trim()).filter(Boolean))];
    LANGUAGES = parsed.length ? parsed : [...DEFAULT_LANGUAGES];
    await chrome.storage.local.set({ apiKey: state.apiKey, gistToken: state.gistToken, languages: LANGUAGES });
    el.settingsModal.hidden = true;
    render();
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
    if (type === "rename-tag" && state.tags[id]) {
      state.tags[id].name = name;
      await chrome.storage.local.set({ tags: state.tags });
    } else if (type === "rename-folder") {
      const d = fdom();
      if (d.folders[id]) { d.folders[id].name = name; await d.persist(); }
    } else if (type === "create-folder") {
      const d = fdom();
      const newId = slugify(name) + "-" + Date.now().toString(36).slice(-4);
      const parentId = el.folderParentSelect.value || null;
      const siblings = Object.values(d.folders).filter((f) =>
        parentId ? f.parentId === parentId : !f.parentId
      );
      const folderData = { name, order: siblings.length };
      if (parentId) folderData.parentId = parentId;
      d.folders[newId] = folderData;
      await d.persist();
    }
    el.folderModal.hidden = true;
    render();
  });

  // Right-click menu on folders (channel folders or Watch Later lists per view)
  el.folderList.addEventListener("contextmenu", (e) => {
    const li = e.target.closest(".folder-item");
    if (!li) return;
    e.preventDefault();
    const id = li.dataset.folderId;
    if (isVirtualFolderId(id) || id === "unsorted") return; // virtual / pinned home — no actions
    const folder = fdom().folders[id];
    const isChild = !!folder?.parentId;
    const menuItems = [
      { label: "Rename…", action: () => openFolderModal("rename-folder", id) },
      {
        label: folder?.emoji ? "Change emoji…" : "Set emoji…",
        action: () => openEmojiInput(li, id),
      },
    ];
    if (folder?.emoji) {
      menuItems.push({ label: "Remove emoji", action: () => setFolderEmoji(id, "") });
    }
    // Only allow subfolders one level deep (top-level folders can have children)
    if (!isChild) {
      menuItems.push({ label: "New subfolder…", action: () => openFolderModal("create-folder", null, id) });
    }
    menuItems.push({ label: "Delete", danger: true, action: () => deleteFolder(id) });
    showContextMenu(e.clientX, e.clientY, menuItems);
  });

  // Right-click on a filter chip excludes it. Renaming/deleting a tag moved to
  // **shift**+right-click, since plain right-click is now half the filter UI
  // (the chip's tooltip says so, and the "+ tag" dropdown still deletes too).
  el.tagFilterBar.addEventListener("contextmenu", (e) => {
    const chip = e.target.closest("[data-role]");
    if (!chip) return;
    const tagId = chip.dataset.role === "filter-tag" ? chip.dataset.tagId : null;
    if (tagId && e.shiftKey) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Rename…", action: () => openFolderModal("rename-tag", tagId) },
        { label: "Delete", danger: true, action: () => deleteTag(tagId) },
      ]);
      return;
    }
    if (activateFilterChip(chip, true)) e.preventDefault();
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
    await chrome.storage.local.remove(["channels", "folders", "tags", "gistId", "lastSyncedAt", "lastSyncCheckAt"]);
    // Only the cleared keys are reset — Watch Later (videos/videoFolders) is left
    // alone, so `state` must be spread, not rebuilt (a rebuilt object dropped
    // state.videos entirely and broke every video view).
    state = { ...state, channels: {}, folders: defaultFolders(), tags: {}, gistId: "", lastSyncedAt: null };
    currentFolderId = "all";
    resetVariableFilters();
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
  el.syncDiffBody.addEventListener("click", handleDiffRowClick);

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

  // Playlist import dialog
  el.playlistImportApply.addEventListener("click", async () => {
    const moveIds = Array.from(
      el.playlistImportBody.querySelectorAll("input[data-move-id]:checked")
    ).map((box) => box.dataset.moveId);
    const newListName = el.playlistImportName.value.trim();
    el.playlistImportApply.disabled = true;
    el.statusText.textContent = "Importing playlist…";
    const res = await chrome.runtime.sendMessage({ type: "APPLY_PLAYLIST_IMPORT", listName: newListName, moveIds });
    el.playlistImportApply.disabled = false;
    el.playlistImportModal.hidden = true;
    await loadState();
    if (res?.ok) {
      currentView = "watchlater";
      currentListId = res.listId;
      searchQuery = "";
      el.searchInput.value = "";
      clearVideoSelection();
      await chrome.storage.local.set({ currentView });
      el.statusText.textContent = `Imported ${res.added + res.moved} video${res.added + res.moved === 1 ? "" : "s"} into the list.`;
    } else {
      el.statusText.textContent = res?.error || "Could not import playlist.";
    }
    render();
  });

  el.playlistImportCancel.addEventListener("click", async () => {
    el.playlistImportModal.hidden = true;
    await chrome.runtime.sendMessage({ type: "DISCARD_PLAYLIST_IMPORT" });
  });

  // Sync diff dialog
  el.syncDiffBody.addEventListener("change", (e) => {
    const role = e.target.dataset.role;
    if (role !== "select-all-removals" && role !== "select-all-videos") return;
    const selector = role === "select-all-videos" ? "input[data-video-id]" : "input[data-remove-id]";
    const on = e.target.checked;
    el.syncDiffBody.querySelectorAll(selector).forEach((box) => (box.checked = on));
  });

  el.syncDiffApply.addEventListener("click", async () => {
    if (!pendingSyncDiff) return;
    const { direction } = pendingSyncDiff;
    const removeIds = Array.from(
      el.syncDiffBody.querySelectorAll("input[data-remove-id]:checked")
    ).map((box) => box.dataset.removeId);
    // Video rows are ticked by default, so it's the *unticked* ones that carry a
    // decision: leave those alone on the target.
    const skipVideoIds = Array.from(
      el.syncDiffBody.querySelectorAll("input[data-video-id]:not(:checked)")
    ).map((box) => box.dataset.videoId);

    el.syncDiffApply.disabled = true;
    el.statusText.textContent = direction === "upload" ? "Uploading…" : "Downloading…";

    const res = direction === "upload"
      ? await chrome.runtime.sendMessage({ type: "APPLY_UPLOAD", removeFromGistIds: removeIds, skipVideoIds })
      : await chrome.runtime.sendMessage({ type: "APPLY_DOWNLOAD", removeLocalIds: removeIds, skipVideoIds });

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

function openFolderModal(type, id = null, defaultParentId = null) {
  folderModalMode = { type, id };
  const d = fdom();
  const isList = currentView === "watchlater";
  const noun = isList ? "list" : "folder";
  const Noun = isList ? "List" : "Folder";
  const texts = {
    "create-folder": { title: `New ${noun}`, label: `${Noun} name`, save: "Create", value: "" },
    "rename-folder": { title: `Rename ${noun}`, label: `${Noun} name`, save: "Save", value: d.folders[id]?.name || "" },
    "rename-tag": { title: "Rename tag", label: "Tag name", save: "Save", value: state.tags[id]?.name || "" },
  };
  const t = texts[type];
  el.folderModalTitle.textContent = t.title;
  el.folderNameLabel.textContent = t.label;
  el.folderSave.textContent = t.save;
  el.folderNameInput.value = t.value;

  // Show parent selector only when creating a folder
  const isCreate = type === "create-folder";
  el.folderParentRow.hidden = !isCreate;
  if (isCreate) {
    // Populate with top-level folders (excluding unsorted, which can't be a parent)
    const parentOptions = Object.entries(d.folders)
      .filter(([fid, f]) => !f.parentId && fid !== "unsorted")
      .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
      .map(([fid, f]) => `<option value="${fid}"${defaultParentId === fid ? " selected" : ""}>${escapeHtml(f.name)}</option>`)
      .join("");
    el.folderParentSelect.innerHTML = `<option value="">— None (top-level)</option>${parentOptions}`;
    el.folderParentSelect.value = defaultParentId || "";
  }

  el.folderModal.hidden = false;
  el.folderNameInput.focus();
  el.folderNameInput.select();
}

// Delete a folder/list from the active domain: its items move to Unfiled and
// its subfolders are promoted to top-level.
async function deleteFolder(id) {
  const d = fdom();
  const isList = currentView === "watchlater";
  const folder = d.folders[id];
  if (!folder || id === "unsorted") return;

  const childIds = getChildFolderIds(id, d.folders);
  const gone = new Set([id, ...childIds]);
  const itemFolderId = (it) => (isList ? it.folderId || "unsorted" : it.folderId);
  const items = isList ? Object.values(state.videos).filter((v) => v.saved) : Object.values(state.channels);
  const totalCount = items.filter((it) => gone.has(itemFolderId(it))).length;

  let msg = `Delete ${isList ? "list" : "folder"} "${folder.name}"?`;
  if (childIds.length) {
    msg += ` Its ${childIds.length} sub${isList ? "list" : "folder"}${childIds.length === 1 ? "" : "s"} will become top-level.`;
  }
  if (totalCount) {
    const itemNoun = isList ? "video" : "channel";
    msg += ` ${totalCount} ${itemNoun}${totalCount === 1 ? "" : "s"} will move to Unfiled.`;
  }
  if (!confirm(msg)) return;

  // Move items to unsorted
  for (const it of items) {
    if (gone.has(itemFolderId(it))) it.folderId = "unsorted";
  }
  // Promote children to top-level
  for (const childId of childIds) delete d.folders[childId].parentId;
  delete d.folders[id];
  if (d.selected === id || childIds.includes(d.selected)) d.select("all");

  if (isList) {
    await chrome.storage.local.set({ videos: state.videos, videoFolders: state.videoFolders });
  } else {
    await chrome.storage.local.set({ channels: state.channels, folders: state.folders });
  }
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
  hideSubmenu();

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      menu.appendChild(sep);
      continue;
    }

    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.danger) btn.classList.add("danger");

    if (item.submenu) {
      btn.classList.add("has-submenu");
      btn.addEventListener("mouseenter", () => {
        const btnRect = btn.getBoundingClientRect();
        showSubmenu(btnRect.right, btnRect.top, item.submenu());
      });
    } else {
      btn.addEventListener("mouseenter", hideSubmenu);
      btn.addEventListener("click", () => {
        hideContextMenu();
        item.action();
      });
    }

    menu.appendChild(btn);
  }

  menu.hidden = false;
  // keep the menu inside the viewport
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}

// Reveal `node` and clamp it into the viewport near (x, y). Shared by the two
// submenu levels, which position identically.
function positionSubmenu(node, x, y) {
  node.hidden = false;
  const rect = node.getBoundingClientRect();
  const left = x + 4;
  const adjustedLeft = left + rect.width + 8 > window.innerWidth ? x - rect.width - 4 : left;
  node.style.left = Math.max(4, adjustedLeft) + "px";
  node.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}

function showSubmenu(x, y, items) {
  const sub = el.contextSubmenu;
  sub.innerHTML = "";
  hideSubSubmenu();

  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.active) btn.classList.add("active-folder");

    if (item.submenu) {
      btn.classList.add("has-submenu");
      btn.addEventListener("mouseenter", () => {
        const r = btn.getBoundingClientRect();
        showSubSubmenu(r.right, r.top, item.submenu());
      });
    } else {
      btn.addEventListener("mouseenter", hideSubSubmenu);
      btn.addEventListener("click", () => {
        hideContextMenu();
        item.action();
      });
    }

    sub.appendChild(btn);
  }

  positionSubmenu(sub, x, y);
}

function showSubSubmenu(x, y, items) {
  const sub = el.contextSubSubmenu;
  sub.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.active) btn.classList.add("active-folder");
    btn.addEventListener("click", () => {
      hideContextMenu();
      item.action();
    });
    sub.appendChild(btn);
  }
  positionSubmenu(sub, x, y);
}

function hideSubSubmenu() {
  el.contextSubSubmenu.hidden = true;
}

function hideSubmenu() {
  el.contextSubmenu.hidden = true;
  hideSubSubmenu();
}

function hideContextMenu() {
  el.contextMenu.hidden = true;
  hideSubmenu();
}

// Generic folder-picker submenu. `onPick(folderId)` fires on choice; `isActive`
// (optional) marks the currently-selected destination. Only leaf folders are
// valid targets — parents nest their children in a further submenu. `folders`
// defaults to channel folders; pass state.videoFolders for Watch Later lists.
function folderSubmenuItems(onPick, isActive = () => false, folders = state.folders) {
  return getTopLevelFoldersOrdered(folders).map(([id, f]) => {
    const children = Object.entries(folders)
      .filter(([, cf]) => cf.parentId === id)
      .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));

    if (children.length === 0) {
      return { label: f.name, active: isActive(id), action: () => onPick(id) };
    }
    return {
      label: f.name,
      active: children.some(([cid]) => isActive(cid)),
      submenu: () => children.map(([cid, cf]) => ({
        label: cf.name,
        active: isActive(cid),
        action: () => onPick(cid),
      })),
    };
  });
}

function buildFolderSubmenu(channelId, ch) {
  const moveTo = async (folderId) => {
    state.channels[channelId].folderId = folderId;
    await chrome.storage.local.set({ channels: state.channels });
    renderFolders();
    if (currentFolderId !== "all") renderGrid();
  };
  return folderSubmenuItems(moveTo, (id) => ch.folderId === id);
}

// Language picker submenu, shared by the single-channel and bulk context menus.
// `onPick(langOrNull)` fires on choice, `isActive` marks the current value, and
// `extra` seeds off-list values (a channel's custom language) so the row it's
// already on is still pickable. "New language…" both creates the language and
// assigns it, which is the only way to add one without opening Settings.
function languageSubmenuItems(onPick, isActive = () => false, extra = []) {
  const list = [...new Set([...extra.filter(Boolean), ...LANGUAGES])];
  return [
    { label: "— none —", active: isActive(null), action: () => onPick(null) },
    ...list.map((l) => ({ label: langLabel(l), active: isActive(l), action: () => onPick(l) })),
    {
      label: "+ New language…",
      action: async () => {
        const name = prompt(
          "New language — added to the picker for every channel.\n" +
            "A flag is matched from the name; start with an emoji to force one."
        )?.trim();
        if (!name) return;
        await addLanguage(name);
        onPick(name);
      },
    },
  ];
}

// Append a language to the curated set and persist it, so it shows up in every
// picker (and syncs with the other settings). No-op if it's already there.
async function addLanguage(name) {
  if (LANGUAGES.includes(name)) return;
  LANGUAGES = [...LANGUAGES, name];
  await chrome.storage.local.set({ languages: LANGUAGES });
}

async function setChannelLanguage(channelId, lang) {
  const ch = state.channels[channelId];
  if (!ch) return;
  ch.language = lang || null;
  await chrome.storage.local.set({ channels: state.channels });
  render(); // the filter bar gains/loses a language chip with the last channel using it
}

// Watch Later "move to list" submenu — the video-list equivalent of the channel
// folder submenu.
function buildListSubmenu(videoId, v) {
  const moveTo = (listId) => moveVideoToList(videoId, listId);
  return folderSubmenuItems(moveTo, (id) => (v.folderId || "unsorted") === id, state.videoFolders);
}

// ---------- Multi-select ----------

// Ctrl/Cmd toggles one row; Shift add/removes the whole run from the anchor to
// the clicked row (add vs remove is decided by the clicked row's current state).
function handleSelectionClick(channelId, e) {
  const ordered = getFilteredChannels().map((c) => c.id);

  if (e.shiftKey && selectionAnchor && ordered.includes(selectionAnchor)) {
    const a = ordered.indexOf(selectionAnchor);
    const b = ordered.indexOf(channelId);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const adding = !selectedChannelIds.has(channelId);
    for (let i = lo; i <= hi; i++) {
      if (adding) selectedChannelIds.add(ordered[i]);
      else selectedChannelIds.delete(ordered[i]);
    }
  } else {
    if (selectedChannelIds.has(channelId)) selectedChannelIds.delete(channelId);
    else selectedChannelIds.add(channelId);
  }
  selectionAnchor = channelId;
  paintSelection();
}

// Toggle the .selected class on rows already in the DOM. Rows appended later by
// the scroll pager pick up the class in buildChannelRow.
function paintSelection() {
  for (const row of el.channelGrid.querySelectorAll("[data-channel-id]")) {
    row.classList.toggle("selected", selectedChannelIds.has(row.dataset.channelId));
  }
}

function clearSelection() {
  selectedChannelIds.clear();
  selectionAnchor = null;
  paintSelection();
}

// Apply `fn` to every selected channel, persist once, then clear + re-render.
async function bulkMutate(ids, fn) {
  for (const id of ids) {
    const ch = state.channels[id];
    if (ch) fn(ch);
  }
  await chrome.storage.local.set({ channels: state.channels });
  clearSelection();
  render(); // not just the grid: a language/tag edit also reshapes the filter bar
}

async function bulkDelete(ids) {
  if (!confirm(`Delete ${ids.length} channels from MyTube? This cannot be undone.`)) return;
  for (const id of ids) delete state.channels[id];
  await chrome.storage.local.set({ channels: state.channels });
  clearSelection();
  render();
}

function showBulkContextMenu(x, y, ids) {
  const n = ids.length;
  const tags = Object.entries(state.tags).sort((a, b) => a[1].name.localeCompare(b[1].name));

  showContextMenu(x, y, [
    {
      label: `Move ${n} to folder`,
      submenu: () => folderSubmenuItems((fid) => bulkMutate(ids, (ch) => (ch.folderId = fid))),
    },
    {
      label: "Set language",
      submenu: () => languageSubmenuItems((lang) => bulkMutate(ids, (ch) => (ch.language = lang))),
    },
    {
      label: "Add tag",
      submenu: () =>
        tags.length
          ? tags.map(([tid, t]) => ({
              label: t.name,
              action: () =>
                bulkMutate(ids, (ch) => {
                  if (!ch.tags) ch.tags = [];
                  if (!ch.tags.includes(tid)) ch.tags.push(tid);
                }),
            }))
          : [{ label: "No tags yet", action: () => {} }],
    },
    {
      label: "Remove tag",
      submenu: () => {
        // Only tags that at least one selected channel actually carries.
        const present = new Set();
        for (const id of ids) for (const tid of state.channels[id]?.tags || []) present.add(tid);
        const removable = tags.filter(([tid]) => present.has(tid));
        return removable.length
          ? removable.map(([tid, t]) => ({
              label: t.name,
              action: () =>
                bulkMutate(ids, (ch) => {
                  if (ch.tags) ch.tags = ch.tags.filter((t) => t !== tid);
                }),
            }))
          : [{ label: "No tags on selection", action: () => {} }];
      },
    },
    { separator: true },
    { label: "Mark active", action: () => bulkMutate(ids, (ch) => (ch.active = true)) },
    { label: "Mark inactive", action: () => bulkMutate(ids, (ch) => (ch.active = false)) },
    { label: "Mark finished", action: () => bulkMutate(ids, (ch) => (ch.finished = true)) },
    { label: "Mark unfinished", action: () => bulkMutate(ids, (ch) => (ch.finished = false)) },
    { separator: true },
    { label: "Track videos", action: () => bulkMutate(ids, (ch) => (ch.trackVideos = true)) },
    { label: "Stop tracking videos", action: () => bulkMutate(ids, (ch) => (ch.trackVideos = false)) },
    { label: `Fetch all videos (${n})`, action: () => fetchAllVideos(ids) },
    { separator: true },
    { label: `Delete ${n} channels`, danger: true, action: () => bulkDelete(ids) },
  ]);
}

// ---------- Video multi-select (New / Watch Later) ----------

// The displayed order of the active video view, for shift-range selection.
function currentVideoOrder() {
  return (currentView === "watchlater" ? getWatchLaterVideos() : getFilteredVideos()).map((v) => v.id);
}

// Ctrl/Cmd toggles one card; Shift add/removes the run from the anchor.
function handleVideoSelectionClick(videoId, e) {
  const ordered = currentVideoOrder();
  if (e.shiftKey && videoSelectionAnchor && ordered.includes(videoSelectionAnchor)) {
    const a = ordered.indexOf(videoSelectionAnchor);
    const b = ordered.indexOf(videoId);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const adding = !selectedVideoIds.has(videoId);
    for (let i = lo; i <= hi; i++) {
      if (adding) selectedVideoIds.add(ordered[i]);
      else selectedVideoIds.delete(ordered[i]);
    }
  } else {
    if (selectedVideoIds.has(videoId)) selectedVideoIds.delete(videoId);
    else selectedVideoIds.add(videoId);
  }
  videoSelectionAnchor = videoId;
  paintVideoSelection();
}

function paintVideoSelection() {
  for (const card of document.querySelectorAll(".video-card[data-video-id]")) {
    card.classList.toggle("selected", selectedVideoIds.has(card.dataset.videoId));
  }
}

function clearVideoSelection() {
  if (!selectedVideoIds.size) return;
  selectedVideoIds.clear();
  videoSelectionAnchor = null;
  paintVideoSelection();
}

// Apply `fn` to every selected video, persist once, then clear the selection.
// The storage write re-renders both video views via onChanged.
async function bulkVideoMutate(ids, fn) {
  for (const id of ids) {
    const v = state.videos[id];
    if (v) fn(v);
  }
  await saveVideos();
  clearVideoSelection();
}

async function bulkRemoveFromWatchLater(ids) {
  for (const id of ids) {
    const v = state.videos[id];
    if (!v) continue;
    v.saved = false; // kept as a tombstone — see removeFromWatchLater
    delete v.folderId;
  }
  await saveVideos();
  clearVideoSelection();
}

function showVideoBulkContextMenu(x, y, ids) {
  const n = ids.length;
  const items = [
    { label: `Mark ${n} watched`, action: () => bulkVideoMutate(ids, (v) => (v.watched = true)) },
    { label: `Mark ${n} unwatched`, action: () => bulkVideoMutate(ids, (v) => (v.watched = false)) },
    { separator: true },
  ];
  if (currentView === "watchlater") {
    items.push({
      label: `Move ${n} to list`,
      submenu: () => folderSubmenuItems(
        (listId) => bulkVideoMutate(ids, (v) => { if (v.saved) v.folderId = listId; }),
        () => false,
        state.videoFolders
      ),
    });
    items.push({ label: `Remove ${n} from Watch Later`, danger: true, action: () => bulkRemoveFromWatchLater(ids) });
  } else {
    items.push({ label: `Remove ${n} from feed`, danger: true, action: () => bulkVideoMutate(ids, (v) => (v.hidden = true)) });
  }
  showContextMenu(x, y, items);
}

async function deleteChannel(channelId) {
  const ch = state.channels[channelId];
  if (!ch) return;
  const confirmed = confirm(`Delete "${ch.name}" from MyTube? This cannot be undone.`);
  if (!confirmed) return;
  delete state.channels[channelId];
  await chrome.storage.local.set({ channels: state.channels });
  render();
}

let tagPickerEl = null;

// Dropdown anchored to a channel's "+ tag" chip: pick an existing tag to add,
// or fall through to "+ New tag" to create one inline.
function openTagPicker(chipEl, channelId) {
  closeTagPicker();

  const ch = state.channels[channelId];
  const current = new Set(ch.tags || []);
  const available = Object.entries(state.tags)
    .filter(([id]) => !current.has(id))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const menu = document.createElement("div");
  menu.className = "tag-picker context-menu";

  const listWrap = document.createElement("div");
  listWrap.className = "tag-picker-list";
  if (available.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tag-picker-empty";
    empty.textContent = current.size ? "All tags added" : "No tags yet";
    listWrap.appendChild(empty);
  } else {
    for (const [id, tag] of available) {
      const row = document.createElement("div");
      row.className = "tag-picker-item";

      const addBtn = document.createElement("button");
      addBtn.className = "tag-picker-add";
      const swatch = document.createElement("span");
      swatch.className = "tag-picker-swatch";
      swatch.style.background = tag.color;
      addBtn.appendChild(swatch);
      addBtn.appendChild(document.createTextNode(tag.name));
      addBtn.addEventListener("click", async () => {
        closeTagPicker();
        await addTagIdToChannel(channelId, id);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "tag-picker-del";
      delBtn.textContent = "×";
      delBtn.title = "Delete tag everywhere";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        closeTagPicker();
        await deleteTag(id);
      });

      row.appendChild(addBtn);
      row.appendChild(delBtn);
      listWrap.appendChild(row);
    }
  }
  menu.appendChild(listWrap);

  const sep = document.createElement("div");
  sep.className = "context-menu-separator";
  menu.appendChild(sep);

  const newBtn = document.createElement("button");
  newBtn.className = "tag-picker-item tag-picker-new";
  newBtn.textContent = "+ New tag";
  newBtn.addEventListener("click", () => showNewTagInput(menu, channelId));
  menu.appendChild(newBtn);

  document.body.appendChild(menu);
  tagPickerEl = menu;
  positionTagPicker(chipEl, menu);

  // Defer so the click that opened the picker doesn't immediately close it.
  setTimeout(() => document.addEventListener("click", onTagPickerOutside), 0);
  document.addEventListener("scroll", closeTagPicker, true);
  document.addEventListener("keydown", onTagPickerKeydown);
}

function positionTagPicker(chipEl, menu) {
  const rect = chipEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + menuRect.width > window.innerWidth - 8) {
    left = window.innerWidth - menuRect.width - 8;
  }
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 4;
  }
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";
}

// Swap the "+ New tag" button for an inline text field to name a new tag.
function showNewTagInput(menu, channelId) {
  const newBtn = menu.querySelector(".tag-picker-new");
  if (!newBtn) return;

  const input = document.createElement("input");
  input.className = "field-input tag-picker-input";
  input.placeholder = "tag name, press Enter";
  newBtn.replaceWith(input);
  input.focus();

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const name = input.value.trim();
      closeTagPicker();
      if (name) await addTagToChannel(channelId, name);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      closeTagPicker();
    }
  });
}

function onTagPickerOutside(e) {
  if (tagPickerEl && tagPickerEl.contains(e.target)) return;
  closeTagPicker();
}

function onTagPickerKeydown(e) {
  if (e.key === "Escape") closeTagPicker();
}

function closeTagPicker() {
  if (!tagPickerEl) return;
  tagPickerEl.remove();
  tagPickerEl = null;
  document.removeEventListener("click", onTagPickerOutside);
  document.removeEventListener("scroll", closeTagPicker, true);
  document.removeEventListener("keydown", onTagPickerKeydown);
}

async function addTagIdToChannel(channelId, tagId) {
  const ch = state.channels[channelId];
  if (!ch || !state.tags[tagId]) return;
  if (!ch.tags) ch.tags = [];
  if (!ch.tags.includes(tagId)) {
    ch.tags.push(tagId);
    await chrome.storage.local.set({ channels: state.channels });
  }
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
