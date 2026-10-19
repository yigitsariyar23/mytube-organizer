import { LANGUAGE_CATALOG, DEFAULT_LANGUAGES, canonicalLanguage, activeLanguages, languageCatalogMatches } from "../shared/languages.js";
import { SHORTCUTS, normalizeControls, shortcutFromEvent, bindingError, shortcutConflict, formatShortcut, selectionModifierPressed } from "../shared/controls.js";
import { RECORD_KEYS, VIDEO_FLAGS, recordPatch, clone, isPlaylistOverlayTitle, editChanges, revertEdit } from "../shared/library.js";
// The shared design language (DESIGN.md in ~/other-projects/design-language),
// vendored by its sync.sh — never edit shared/ui here.
import {
  isMac, openMenu, closeFloating, floatingOpen, openListbox, openPopover, selectButtonHtml, createSelect,
  confirmDialog, promptDialog, bindDialog, openDialog, toast, showUndo, hideUndo, triggerUndo,
  bindNumberField, Selection, attachMarquee, avatarHtml, dateCellHtml, CHIP_TOOLTIP,
} from "../shared/ui/ui.js";

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

// "languages" stores the active selection; catalog choices live in Settings.
let LANGUAGES = [...DEFAULT_LANGUAGES];
let languagesDraft = new Set();
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

let state = { channels: {}, folders: {}, tags: {}, videos: {}, videoFolders: {}, apiKey: "", gistToken: "", gistId: "", lastSyncedAt: null, pendingScan: null, pendingPlaylistImport: null, jobProgress: null };
let libraryBaseline = Object.fromEntries(RECORD_KEYS.map(k => [k, {}]));
let libraryEditSequence = 0;
let pendingVideoPage = { signature: '', limit: 60, list: [], mode: 'new', container: null };
let failedRefreshIds = [];
let refreshRunning = false;
const IS_MAC = isMac;
let controls = normalizeControls();
let controlsDraft = null;
let recordingShortcut = null;
let syncSkipVideoIds = new Set();
let syncSkipAllVideos = false;
let syncReviewRequest = 0;

async function requestWorker(type, payload = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...payload }); }
  catch (error) { return { ok: false, error: error.message || 'The extension disconnected. Reload the dashboard and try again.' }; }
}

async function persistSettings(values) {
  const result = await requestWorker('SET_SETTINGS', { values });
  if (!result.ok) throw new Error(result.error || 'Could not save settings.');
}

// Every dashboard edit to the library lands here: `values` holds the edited
// collections (state.* mutated in place), diffed against the last stored copy
// into field patches the worker applies under its write queue.
//
// Undo (DESIGN §9): `undo` is the toast's description of the edit ("Moved 3
// channels to Science.") — every library edit passes one, so every edit is
// undoable; `undo: false` is for the undo itself. Records the edit touched are
// kept as before/after copies; undo puts back the before-state only of those
// still exactly as the edit left them (revertEdit), so a refresh or an avatar
// landing meanwhile is never reverted. Video flag edits keep their own
// worker-side check (UNDO_VIDEOS against the stamped state the worker returned).
async function persistLibrary(values, { undo = "Change saved." } = {}) {
  const editSequence = ++libraryEditSequence;
  const patches = {};
  const videoUndo = [];
  const before = {}, after = {};
  for (const key of Object.keys(values)) {
    if (!RECORD_KEYS.includes(key)) continue;
    patches[key] = recordPatch(libraryBaseline[key], values[key]);
    if (key === 'videos') for (const change of patches[key]) {
      if (!change.create && !change.remove && VIDEO_FLAGS.some(k => Object.hasOwn(change.set || {}, k) || change.unset?.includes(k))) {
        const b = libraryBaseline.videos[change.id], a = values.videos[change.id];
        videoUndo.push({ id: change.id, before: Object.fromEntries(VIDEO_FLAGS.map(k => [k, b[k] ?? null])),
          after: Object.fromEntries(VIDEO_FLAGS.map(k => [k, a[k] ?? null])) });
      }
    } else if (patches[key].length) {
      before[key] = libraryBaseline[key];
      after[key] = values[key];
    }
    libraryBaseline[key] = clone(values[key]);
  }
  if (!Object.values(patches).some(changes => changes.length)) return;
  const recordUndo = Object.keys(after).length ? editChanges(before, after) : [];
  const result = await requestWorker('PATCH_LIBRARY', { patches });
  if (!result?.ok) {
    await loadState();
    render();
    el.statusText.textContent = result?.error || 'Could not save changes.';
    return;
  }
  if (undo && editSequence === libraryEditSequence && (recordUndo.length || videoUndo.length)) {
    const videoChanges = videoUndo.map(change => ({ ...change, after: result.videoStates[change.id] })).filter(change => change.after);
    showUndo(undo, () => undoEdit(recordUndo, videoChanges));
  }
}

// Undo one edit: records first (a field patch from the current state back to
// the before-state, for those still matching their after-state), then video
// flags through the worker's stamped check. False → the toast says it can't.
async function undoEdit(recordChanges, videoChanges) {
  let undone = 0;
  if (recordChanges.length) {
    const keys = [...new Set(recordChanges.map(change => change.key))];
    const { reverted } = revertEdit(state, recordChanges);
    if (reverted) {
      await persistLibrary(Object.fromEntries(keys.map(key => [key, state[key]])), { undo: false });
      undone += reverted;
    }
  }
  if (videoChanges.length) {
    const result = await requestWorker('UNDO_VIDEOS', { changes: videoChanges });
    if (result.ok) undone += videoChanges.length;
    else el.statusText.textContent = result.error;
  }
  if (!undone) return false;
  render();
  return true;
}

let currentFolderId = "all";       // selected channel folder (Channels/New views)
let currentListId = "all";         // selected Watch Later list
let currentView = "channels";      // "channels" | "new" | "watchlater" | "removed"
// Watched filter per video view: "" (everything) | "unwatched" | "watched".
// Same left/right-click rule as every other chip — see toggleChipFilter.
let newWatchedFilter = "unwatched";        // New feed defaults to hiding watched
let watchLaterWatchedFilter = "unwatched"; // …and so does Watch Later
// Video category chips (Videos / Shorts / Streams), shared by both video
// views. Two-sided like the tag chips: left = only these, right = not these.
const activeKindFilters = new Set();
const excludedKindFilters = new Set();
let videoSortKey = "date";         // "date" | "length"
let videoSortDir = "desc";         // "desc" | "asc"
let videoDetailsRequested = false; // guards the one-shot auto length/view fetch
// Filter chips are two-sided: left click puts a value in the "must have" set,
// right click in the "must not have" set. A value is never in both.
const activeTagFilters = new Set();
const excludedTagFilters = new Set();
const activeLangFilters = new Set();   // languages selected in the filter bar
const excludedLangFilters = new Set(); // …and languages ruled out
// Multi-select (DESIGN §6), one kit Selection per surface: the channel rows,
// and the video cards of whichever video view is showing. Never persisted.
const channelSel = new Selection(() => paintSelection());
const videoSel = new Selection(() => paintVideoSelection());
let filterActive = "";             // "" = off, "only" = active, "not" = inactive (active:false)
let filterFinished = "";           // "" = off, "only" = finished, "not" = unfinished
let filterTracked = "";            // "" = off, "only" = tracked, "not" = untracked
let searchQuery = "";
let sortDate = "desc"; // "desc" (newest first) | "asc" (oldest first) | "none"
let sortCount = "none"; // "none" | "desc" (most first) | "asc" (fewest first)
let sortSubs = "none"; // "none" | "desc" (most subscribers first) | "asc"
let sortFolder = "none"; // "none" | "asc" (sidebar order, top first) | "desc" (reversed)

// Which sort key wins when several are on. The list is **click order, most
// recent first** — with four sortable columns a fixed priority makes the lower
// ones useless (grouping by folder is only worth anything if folder can be the
// *primary* key and date the tiebreaker within it). Clicking a header on moves
// it to the front; keys sitting on "none" are skipped, so turning one off
// leaves the rest in the order the user built. Persisted so a reload doesn't
// silently reshuffle the same four columns into a different arrangement.
const SORT_KEYS = ["date", "count", "subs", "folder"];
let sortPriority = [...SORT_KEYS];

// The direction each column takes on its *first* click. "Most/newest first" is
// what a click on a number or a date means everywhere; for Folder the useful
// first click is the sidebar's own top-to-bottom order, which is ascending.
const SORT_FIRST_DIR = { date: "desc", count: "desc", subs: "desc", folder: "asc" };
let folderSort = "custom"; // "custom" | "alpha" | "count"
const collapsedFolders = new Set();    // collapsed parent channel folders
const collapsedVideoLists = new Set(); // collapsed parent Watch Later lists

// Advanced filters
let filterMinCount = null;
let filterMaxCount = null;
let filterAfterDate = null;  // ISO date string lower bound (inclusive)
let filterBeforeDate = null; // ISO date string upper bound (inclusive)

// Infinite scroll: render channels in batches as the user scrolls near the bottom.
const PAGE_SIZE = 40;
let channelPageSignature = "";
let pendingChannels = []; // filtered channels not yet appended to the grid
let scrollObserver = null;

// Resizable table columns. The first five columns carry explicit px widths; the
// sixth (Folder) is a flexible `1fr` that absorbs remaining space, so there is
// no horizontal scroll. Widths persist as `colWidths`; null means "use the
// default fluid template" until the user first drags a divider.
let colWidths = null;                         // [c1..c5] px, or null
const COL_MINS = [160, 84, 52, 78, 180];      // min px for the five sized columns
                                              // (Subs holds a full grouped number, so it needs
                                              //  more than the compact "2.3K" it used to show)
const COL_FLEX_MIN = 110;                     // min px for the flexible Folder column
const COL_GAP = 16;                           // must match the grid `gap`
const COL_PAD_X = 22;                         // .list-table-header horizontal padding (11*2)

const el = {
  viewRemovedBtn: document.getElementById("viewRemovedBtn"),
  videoLoadMoreBtn: document.getElementById("videoLoadMoreBtn"),
  retryRefreshBtn: document.getElementById("retryRefreshBtn"),
  refreshErrors: document.getElementById("refreshErrors"),
  jobStatus: document.getElementById("jobStatus"),
  jobStatusText: document.getElementById("jobStatusText"),
  jobStopBtn: document.getElementById("jobStopBtn"),
  selectionCount: document.getElementById("selectionCount"),
  reviewBanner: document.getElementById("reviewBanner"),
  reviewBannerText: document.getElementById("reviewBannerText"),
  reviewBannerBtn: document.getElementById("reviewBannerBtn"),
  channelList: document.getElementById("channelList"),
  exportBackupBtn: document.getElementById("exportBackupBtn"),
  importBackupBtn: document.getElementById("importBackupBtn"),
  backupFileInput: document.getElementById("backupFileInput"),
  createBackupBtn: document.getElementById("createBackupBtn"),
  backupList: document.getElementById("backupList"),
  backupStatus: document.getElementById("backupStatus"),

  folderList: document.getElementById("folderList"),
  folderSortSlot: document.getElementById("folderSortSlot"),
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
  updateBannerCmd: document.getElementById("updateBannerCmd"),
  updatePullBtn: document.getElementById("updatePullBtn"),
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
  shortcutList: document.getElementById("shortcutList"),
  shortcutStatus: document.getElementById("shortcutStatus"),
  resetControlsBtn: document.getElementById("resetControlsBtn"),
  shortcutsEnabledInput: document.getElementById("shortcutsEnabledInput"),
  selectionModifierSlot: document.getElementById("selectionModifierSlot"),
  wheelAdjustsNumbersInput: document.getElementById("wheelAdjustsNumbersInput"),
  settingsStatus: document.getElementById("settingsStatus"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  gistTokenInput: document.getElementById("gistTokenInput"),
  languageSearch: document.getElementById("languageSearch"),
  languageCatalog: document.getElementById("languageCatalog"),
  languageSelection: document.getElementById("languageSelection"),
  languagePresetBtn: document.getElementById("languagePresetBtn"),
  syncUploadBtn: document.getElementById("syncUploadBtn"),
  syncDownloadBtn: document.getElementById("syncDownloadBtn"),
  quickUploadBtn: document.getElementById("quickUploadBtn"),
  quickDownloadBtn: document.getElementById("quickDownloadBtn"),
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
  scrollSentinel: document.getElementById("scrollSentinel"),
  listTableHeader: document.getElementById("listTableHeader"),
  main: document.querySelector(".main"),
  clearDataBtn: document.getElementById("clearDataBtn"),
  filterMinCount: document.getElementById("filterMinCount"),
  filterMaxCount: document.getElementById("filterMaxCount"),
  filterAfterDay: document.getElementById("filterAfterDay"),
  filterAfterMonth: document.getElementById("filterAfterMonth"),
  filterAfterYearSlot: document.getElementById("filterAfterYearSlot"),
  filterBeforeDay: document.getElementById("filterBeforeDay"),
  filterBeforeMonth: document.getElementById("filterBeforeMonth"),
  filterBeforeYearSlot: document.getElementById("filterBeforeYearSlot"),
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
  fetchVideosModal: document.getElementById("fetchVideosModal"),
  fetchVideosScopeRow: document.getElementById("fetchVideosScopeRow"),
  fetchVideosScopeAll: document.getElementById("fetchVideosScopeAll"),
  fetchVideosScopeFolder: document.getElementById("fetchVideosScopeFolder"),
  fetchVideosScopeFolderLabel: document.getElementById("fetchVideosScopeFolderLabel"),
  fetchVideosSummary: document.getElementById("fetchVideosSummary"),
  fetchVideosCancel: document.getElementById("fetchVideosCancel"),
  fetchVideosStart: document.getElementById("fetchVideosStart"),
  videoFeed: document.getElementById("videoFeed"),
  videoEmptyState: document.getElementById("videoEmptyState"),
  watchLaterGrid: document.getElementById("watchLaterGrid"),
  watchLaterEmptyState: document.getElementById("watchLaterEmptyState"),
};

// Kit Selects that replace the old native <select>s (DESIGN §3). Created once
// here, mounted into their slots in the markup.
const YEAR_NONE = "—";
const yearSelects = {
  after: createSelect({ options: [{ value: YEAR_NONE, label: YEAR_NONE }], value: YEAR_NONE, className: "filter-select", ariaLabel: "Last video after: year", onChange: () => onDateFilterChange("after") }),
  before: createSelect({ options: [{ value: YEAR_NONE, label: YEAR_NONE }], value: YEAR_NONE, className: "filter-select", ariaLabel: "Last video before: year", onChange: () => onDateFilterChange("before") }),
};
yearSelects.after.el.id = "filterAfterYear";
yearSelects.before.el.id = "filterBeforeYear";
el.filterAfterYearSlot.replaceWith(yearSelects.after.el);
el.filterBeforeYearSlot.replaceWith(yearSelects.before.el);
const FOLDER_SORTS = [
  { value: "custom", label: "Custom" },
  { value: "alpha", label: "A → Z" },
  { value: "count-desc", label: "Count ↓" },
  { value: "count-asc", label: "Count ↑" },
];
const folderSortSelect = createSelect({ options: FOLDER_SORTS, value: "custom", className: "bare", ariaLabel: "Folder order", align: "end", onChange: (value) => {
  folderSort = value;
  chrome.storage.local.set({ folderSort });
  renderFolders();
} });
folderSortSelect.el.id = "folderSortSelect";
el.folderSortSlot.replaceWith(folderSortSelect.el);
const selectionModifierSelect = createSelect({
  options: [{ value: "primary", label: `${isMac ? "⌘" : "Ctrl"} + click` }, { value: "alt", label: `${isMac ? "Option" : "Alt"} + click` }],
  value: "primary", ariaLabel: "Select multiple items", align: "end",
  onChange: (value) => { if (controlsDraft) controlsDraft.selectionModifier = value; },
});
selectionModifierSelect.el.id = "selectionModifierInput";
el.selectionModifierSlot.replaceWith(selectionModifierSelect.el);

export const dashboardReady = init();
dashboardReady.catch(error => { el.statusText.textContent = `Could not open the library: ${error.message}`; });

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

  const options = [YEAR_NONE, ...years.map(String)].map((y) => ({ value: y, label: y }));
  for (const [which, sel] of Object.entries(yearSelects)) {
    const previous = sel.value;
    sel.setOptions(options);
    // Keep the selection when that year survives the rebuild; otherwise fall
    // back to "—" (the filter's "no bound") and re-read the filter, so the
    // filter state can't disagree with what the dropdown shows.
    const kept = options.some((o) => o.value === previous);
    if (!kept) {
      sel.value = YEAR_NONE;
      if (previous !== YEAR_NONE) onDateFilterChange(which);
    }
  }
}

// A date bound from its DD / MM fields and year Select; no year = no bound.
function readDateFilter(which) {
  const [dayEl, monthEl] = which === "after" ? [el.filterAfterDay, el.filterAfterMonth] : [el.filterBeforeDay, el.filterBeforeMonth];
  const year = yearSelects[which].value;
  if (!year || year === YEAR_NONE) return null;
  const mm = (monthEl.value || "1").padStart(2, "0");
  const dd = (dayEl.value || "1").padStart(2, "0");
  return `${year.padStart(4, "0")}-${mm}-${dd}`;
}

function onDateFilterChange(which) {
  if (which === "after") filterAfterDate = readDateFilter("after");
  else filterBeforeDate = readDateFilter("before");
  renderGrid();
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
  setupNumberFields();
  renderJobStatus();

  // A scan / playlist import finished while the dashboard was closed — review it on open.
  if (state.pendingScan) openScanDiffModal(state.pendingScan);
  else if (state.pendingPlaylistImport) openPlaylistImportModal(state.pendingPlaylistImport);
  renderReviewBanner();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of RECORD_KEYS) if (changes[key]) libraryBaseline[key] = clone(changes[key].newValue || {});
    if (changes.channels) state.channels = changes.channels.newValue || {};
    if (changes.folders) state.folders = changes.folders.newValue || {};
    if (changes.tags) state.tags = changes.tags.newValue || {};
    if (changes.videos) {
      state.videos = changes.videos.newValue || {};
    }
    if (changes.videoFolders) state.videoFolders = changes.videoFolders.newValue || defaultFolders();
    // Settings synced from another device (background gist merge / download).
    if (changes.apiKey) state.apiKey = changes.apiKey.newValue || "";
    if (changes.languages) {
      LANGUAGES = activeLanguages(changes.languages.newValue);
      for (const set of [activeLangFilters, excludedLangFilters]) for (const l of [...set]) if (!LANGUAGES.includes(l)) set.delete(l);
    }
    if (changes.pendingScan) {
      state.pendingScan = changes.pendingScan.newValue || null;
      if (state.pendingScan) openScanDiffModal(state.pendingScan);
      else closeDialog(el.scanDiffModal);
      renderReviewBanner();
    }
    if (changes.pendingPlaylistImport) {
      state.pendingPlaylistImport = changes.pendingPlaylistImport.newValue || null;
      if (state.pendingPlaylistImport) openPlaylistImportModal(state.pendingPlaylistImport);
      else closeDialog(el.playlistImportModal);
      renderReviewBanner();
    }
    if (changes.jobProgress) { state.jobProgress = changes.jobProgress.newValue || null; renderJobStatus(); }
    if (changes.lastSyncedAt) state.lastSyncedAt = changes.lastSyncedAt.newValue || null;
    if (changes.gistId) state.gistId = changes.gistId.newValue || '';
    if (changes.gistToken) state.gistToken = changes.gistToken.newValue || '';
    if (changes.controls) { controls = normalizeControls(changes.controls.newValue); renderShortcutHints(); }
    if (changes.libraryBackups && el.settingsModal.open) refreshBackupList();
    if (changes.channels || changes.folders || changes.tags || changes.languages || changes.apiKey || changes.videoFolders) render();
    else if (changes.videos && currentView !== 'channels') {
      if (currentView === 'watchlater') renderFolders();
      renderCurrentView();
    }
    if (changes.lastSyncedAt || changes.gistId) renderSyncStatus();
  });

  // After the listener is wired, so a long background job's incremental writes
  // land in the UI. Not awaited — the first paint shouldn't wait on the network.
  // The gist check runs after the refresh, not alongside it, so its diff is
  // computed against freshly-refreshed local data; neither is allowed to surface
  // as an unhandled rejection.
  (async () => {
    if (chrome.runtime.platform !== 'mobile-web') await checkForAppUpdate(); // small and quick; the banner shouldn't wait on a refresh
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
    "sortDate", "sortCount", "sortSubs", "sortFolder", "sortPriority",
    "folderSort", "languages", "currentView", "colWidths", "videoSort", "controls", "jobProgress",
  ]);
  state.jobProgress = data.jobProgress || null;
  controls = normalizeControls(data.controls);
  state.channels = data.channels || {};
  state.folders = data.folders || defaultFolders();
  state.tags = data.tags || {};
  state.videos = data.videos || {};
  for (const key of RECORD_KEYS) libraryBaseline[key] = clone(data[key] || {});
  state.videoFolders = data.videoFolders && Object.keys(data.videoFolders).length ? data.videoFolders : defaultFolders();
  libraryBaseline.folders = clone(state.folders);
  libraryBaseline.videoFolders = clone(state.videoFolders);
  // "videos" was the old single video tab; it split into "new" + "watchlater".
  const v = data.currentView === "videos" ? "new" : data.currentView;
  currentView = ["channels", "new", "watchlater", "removed"].includes(v) ? v : "channels";
  state.apiKey = data.apiKey || "";
  state.gistToken = data.gistToken || "";
  state.gistId = data.gistId || "";
  state.lastSyncedAt = data.lastSyncedAt || null;
  state.pendingScan = data.pendingScan || null;
  state.pendingPlaylistImport = data.pendingPlaylistImport || null;
  sortDate = data.sortDate === "asc" || data.sortDate === "none" ? data.sortDate : "desc";
  sortCount = data.sortCount === "desc" || data.sortCount === "asc" ? data.sortCount : "none";
  sortSubs = data.sortSubs === "desc" || data.sortSubs === "asc" ? data.sortSubs : "none";
  sortFolder = data.sortFolder === "desc" || data.sortFolder === "asc" ? data.sortFolder : "none";
  // Keep only known keys, then append any the stored list predates — an older
  // build's `sortPriority` has no "subs"/"folder" in it, and a key missing from
  // the priority list would never be compared at all.
  const storedPriority = Array.isArray(data.sortPriority) ? data.sortPriority.filter((k) => SORT_KEYS.includes(k)) : [];
  sortPriority = [...new Set([...storedPriority, ...SORT_KEYS])];
  folderSort = ["alpha", "count-desc", "count-asc"].includes(data.folderSort) ? data.folderSort : "custom";
  LANGUAGES = activeLanguages(data.languages);
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
      isList: true,
      noun: "list", itemNoun: "video",
      // The items this tree files: saved videos (a removed save keeps no list).
      items: () => Object.values(state.videos).filter((v) => v.saved),
      // `withItems` when the edit also moved items between lists.
      persist: (undo, withItems = false) => persistLibrary(withItems ? { videoFolders: state.videoFolders, videos: state.videos } : { videoFolders: state.videoFolders }, { undo }),
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
    isList: false,
    noun: "folder", itemNoun: "channel",
    items: () => Object.values(state.channels),
    persist: (undo, withItems = false) => persistLibrary(withItems ? { folders: state.folders, channels: state.channels } : { folders: state.folders }, { undo }),
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
  renderShortcutHints();
  renderSelectionCount();
  el.viewChannelsBtn.classList.toggle("active", currentView === "channels");
  el.viewNewBtn.classList.toggle("active", currentView === "new");
  el.viewRemovedBtn.classList.toggle("active", currentView === "removed");
  el.videoLoadMoreBtn.hidden = currentView === "channels";
  el.viewWatchLaterBtn.classList.toggle("active", currentView === "watchlater");
  const channels = currentView === "channels";

  const listMode = currentView === "watchlater";
  el.addFolderBtn.textContent = listMode ? "+ New list" : "+ New folder";
  if (el.folderSectionLabel) el.folderSectionLabel.textContent = listMode ? "Lists" : "Folders";
  renderFolders();

  // Channel-grid surfaces
  el.channelList.hidden = !channels;
  el.channelGrid.hidden = !channels;
  el.scrollSentinel.hidden = !channels;
  if (!channels) el.tagFilterBar.hidden = true;
  // Video surfaces
  el.videoFeed.hidden = currentView !== "new" && currentView !== "removed";
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

  if (currentView === "new" || currentView === "removed") {
    el.searchInput.placeholder = currentView === "removed" ? "Search removed videos…" : "Search new videos…";
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
  videoSel.clear(); // selection is per-view
  channelSel.clear();
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
    if (currentView === "removed") return !!v.hidden && (!inFolder || inFolder(ch?.folderId));
    if (!ch || !ch.trackVideos) return false;
    if (v.hidden) return false;              // user-dismissed from the feed
    if (isUpcomingOrLive(v)) return false;   // live streams / scheduled premieres
    if (inFolder && !inFolder(ch.folderId)) return false;
    return true;
  });
}

// A video's category. `kind` comes from the RSS link (Shorts) or from the
// category playlist a fetch read it from; anything unclassified is a video.
function videoKind(v) {
  return v.kind === "short" || v.kind === "live" ? v.kind : "video";
}

// The search box, watched chip and category chips — the filters both video
// views share.
function applyVideoChips(list, watchedFilter) {
  const q = searchQuery.trim().toLowerCase();
  return list.filter((v) => {
    if (watchedFilter === "unwatched" && v.watched) return false;
    if (watchedFilter === "watched" && !v.watched) return false;
    const kind = videoKind(v);
    if (activeKindFilters.size && !activeKindFilters.has(kind)) return false;
    if (excludedKindFilters.has(kind)) return false;
    if (!q) return true;
    const author = state.channels[v.channelId]?.name || v.author;
    return `${v.title} ${author || ""}`.toLowerCase().includes(q);
  });
}

function getFilteredVideos() {
  return sortVideos(applyVideoChips(newFeedUniverse(), currentView === "removed" ? "" : newWatchedFilter));
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
    if (v.saved && (!v.channelId || !v.channelThumbnail || !v.published || !v.author || !v.channelUrl || isPlaylistOverlayTitle(v.title))) return true;
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
  renderKindChips();
  updateVideoSortButtons();
  maybeFetchVideoDetails();

  const noneTracked = currentView !== "removed" && !anyTrackedChannel();
  el.videoEmptyState.hidden = !noneTracked;
  if (noneTracked) {
    el.videoFeed.innerHTML = "";
    el.videoLoadMoreBtn.hidden = true;
    renderResultCount(0, 0, "video");
    return;
  }

  const universe = newFeedUniverse();
  const vids = sortVideos(applyVideoChips(universe, currentView === "removed" ? "" : newWatchedFilter));
  renderResultCount(vids.length, universe.length, "video");

  if (!vids.length) {
    el.videoLoadMoreBtn.hidden = true;
    const filtered = !!searchQuery.trim() || anyKindFilter() || (currentView !== "removed" && newWatchedFilter !== "");
    el.videoFeed.innerHTML = `<div class="empty-state" style="position:static"><p class="empty-title">No videos</p><p class="empty-body">${filtered ? "No videos match the current filters." : currentView === "removed" ? "No removed videos in this folder." : "No videos fetched yet — click Refresh Stats to pull them."}</p></div>`;
    return;
  }

  renderVideoList(vids, currentView === 'removed' ? 'removed' : 'new', el.videoFeed);
}

// Keep existing card nodes and loaded depth when data changes. Only changed
// cards are replaced; an on-screen item anchors the scroll offset.
function reconcileChildren(container, entries) {
  const top = el.main.getBoundingClientRect().top;
  const anchors = [...container.querySelectorAll('[data-video-id], [data-channel-id]')]
    .filter(node => node.getBoundingClientRect().bottom > top).slice(0, 8)
    .map(node => ({ key: node.dataset.renderKey, offset: node.getBoundingClientRect().top }));
  const focused = document.activeElement;
  const focusCard = focused?.closest('[data-render-key]');
  const focusKey = focusCard?.dataset.renderKey;
  const focusSelector = focused?.dataset.action ? `[data-action="${focused.dataset.action}"]`
    : focused?.dataset.role ? `[data-role="${focused.dataset.role}"]` : focused?.tagName === 'A' ? 'a' : null;
  const old = new Map([...container.children].map(node => [node.dataset.renderKey, node]));
  let cursor = container.firstChild;
  for (const [key, html] of entries) {
    let node = old.get(key);
    if (!node || node._renderHtml !== html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      const replacement = template.content.firstElementChild;
      replacement.dataset.renderKey = key;
      replacement._renderHtml = html;
      if (node === cursor) cursor = node.nextSibling;
      if (node) node.replaceWith(replacement);
      node = replacement;
    }
    if (node !== cursor) container.insertBefore(node, cursor);
    cursor = node.nextSibling;
    old.delete(key);
  }
  for (const node of old.values()) node.remove();
  for (const anchor of anchors) {
    const node = [...container.children].find(n => n.dataset.renderKey === anchor.key);
    if (node) { el.main.scrollTop += node.getBoundingClientRect().top - anchor.offset; break; }
  }
  if (focusKey && !focused.isConnected && focusSelector) {
    const replacement = [...container.children].find(n => n.dataset.renderKey === focusKey);
    replacement?.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
}

function renderVideoList(list, mode, container) {
  const signature = JSON.stringify([currentView, currentFolderId, currentListId, searchQuery, videoSortKey, videoSortDir, newWatchedFilter, watchLaterWatchedFilter,
    [...activeKindFilters], [...excludedKindFilters]]);
  if (signature !== pendingVideoPage.signature) {
    pendingVideoPage.limit = 60;
    container.replaceChildren();
  }
  Object.assign(pendingVideoPage, { signature, list, mode, container });
  const entries = [];
  let previousDay = null;
  for (const video of list.slice(0, pendingVideoPage.limit)) {
    if (mode === 'new' && videoSortKey === 'date') {
      const day = dayLabel(video.published);
      if (day !== previousDay) entries.push([`day:${day}`, `<div class="video-day">${escapeHtml(day)}</div>`]);
      previousDay = day;
    }
    entries.push([`video:${video.id}`, videoCardHtml(video, mode)]);
  }
  reconcileChildren(container, entries);
  renderSelectionCount();
  el.videoLoadMoreBtn.hidden = list.length <= pendingVideoPage.limit;
  el.videoLoadMoreBtn.textContent = `Load more (${Math.min(pendingVideoPage.limit, list.length)} of ${list.length})`;
}

// A video card for either video view. `mode` picks the action buttons:
// "new" → mark watched; "watchlater" → remove from Watch Later.
function videoCardHtml(v, mode) {
  const ch = v.channelId ? state.channels[v.channelId] : null;
  const channelName = ch?.name || v.author || "";
  const channelUrl = videoChannelUrl(v);
  const avatarSrc = ch?.thumbnail || v.channelThumbnail || null;
  const letter = escapeHtml(([...String(channelName || "?")][0] || "?").toUpperCase());
  const avatar = avatarSrc
    ? `<img class="ui-avatar" src="${escapeHtml(avatarSrc)}" alt="" loading="lazy" draggable="false" data-letter="${letter}" />`
    : avatarHtml(null, channelName);
  const when = v.published ? relativeTime(v.published) : "";
  const views = v.viewCount != null ? formatViews(v.viewCount) : "";
  const meta = [when, views].filter(Boolean).join(" · ");
  const durationBadge = v.duration != null ? `<span class="video-duration">${escapeHtml(formatDuration(v.duration))}</span>` : "";
  const kind = videoKind(v);
  const kindBadge = kind === "video" ? "" : `<span class="video-kind video-kind-${kind}">${KIND_LABELS[kind].one}</span>`;
  const actions = mode === "removed"
    ? `<button class="video-act" data-action="restore">Restore to New</button>`
    : mode === "watchlater"
    ? `<button class="video-act" data-action="toggle-watched">${v.watched ? "Mark unwatched" : "Mark watched"}</button>
       <button class="video-act" data-action="remove" title="Remove from Watch Later">Remove</button>`
    : `<button class="video-act" data-action="toggle-watched">${v.watched ? "Mark unwatched" : "Mark watched"}</button>
       <button class="video-act" data-action="hide" title="Remove from the New feed (won't come back)">Remove</button>`;
  return `
    <div class="video-card${v.watched ? " watched" : ""}${videoSel.has(v.id) ? " selected" : ""}" data-video-id="${escapeHtml(v.id)}">
      <div class="video-thumb">
        <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" draggable="false" />
        ${durationBadge}
        ${kindBadge}
        <span class="video-watched-badge">✓ watched</span>
      </div>
      <div class="video-meta">
        <a class="video-title" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer" draggable="false" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</a>
        ${channelUrl
          ? `<a class="video-channel" href="${escapeHtml(channelUrl)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Open channel">${avatar}<span>${escapeHtml(channelName || "Open channel")}</span></a>`
          : `<div class="video-channel" data-action="channel-unavailable">${avatar}<span>${escapeHtml(channelName || "Unknown channel")}</span></div>`}
        <div class="video-date">${escapeHtml(meta)}</div>
      </div>
      <div class="video-actions">${actions}</div>
    </div>`;
}

// Never build a channel destination from a display name or trust an imported URL.
function videoChannelUrl(video) {
  if (video.channelId) return `https://www.youtube.com/channel/${encodeURIComponent(video.channelId)}/videos`;
  if (!video.channelUrl) return null;
  try {
    const url = new URL(video.channelUrl, "https://www.youtube.com");
    if (!["https:", "http:"].includes(url.protocol) ||
        !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) return null;
    const path = url.pathname.match(/^\/(channel\/UC[0-9A-Za-z_-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)\/?$/);
    return path ? "https://www.youtube.com/" + path[1] + "/videos" : null;
  } catch { return null; }
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
  renderKindChips();
  updateVideoSortButtons();
  maybeFetchVideoDetails();

  const anySaved = Object.values(state.videos).some((v) => v.saved);
  el.watchLaterEmptyState.hidden = anySaved;
  if (!anySaved) {
    el.watchLaterGrid.innerHTML = "";
    el.videoLoadMoreBtn.hidden = true;
    renderResultCount(0, 0, "video");
    return;
  }

  const universe = watchLaterUniverse();
  const vids = sortVideos(applyVideoChips(universe, watchLaterWatchedFilter));
  renderResultCount(vids.length, universe.length, "video");

  if (!vids.length) {
    el.videoLoadMoreBtn.hidden = true;
    const filtered = !!searchQuery.trim() || anyKindFilter() || watchLaterWatchedFilter !== "";
    el.watchLaterGrid.innerHTML = `<div class="empty-state" style="position:static"><p class="empty-title">No videos</p><p class="empty-body">${filtered ? "No saved videos match the current filters." : "This list is empty."}</p></div>`;
    return;
  }

  renderVideoList(vids, "watchlater", el.watchLaterGrid);
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

// Open a video on YouTube without changing its watched state.
function openVideo(videoId, background) {
  const v = state.videos[videoId];
  if (!v) return;
  chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: !background });
}

// ---------- Video edits (selection-aware, undoable — §6, §9) ----------

const videosNoun = (ids) => ids.length === 1 ? `“${state.videos[ids[0]]?.title || "video"}”` : plural(ids.length, "video");

// Apply `mutate` to each video, repaint, persist as one undoable edit. The
// selection is kept, minus cards the edit took out of the view.
async function editVideos(ids, mutate, undo) {
  const list = ids.map((id) => state.videos[id]).filter(Boolean);
  if (!list.length) return;
  list.forEach(mutate);
  if (currentView === "watchlater") renderFolders();
  renderCurrentView();
  pruneVideoSelection();
  await persistLibrary({ videos: state.videos }, { undo });
}

function pruneVideoSelection() {
  if (!videoSel.size) return;
  const visible = new Set(currentVideoOrder());
  const kept = [...videoSel.ids].filter((id) => visible.has(id));
  if (kept.length !== videoSel.size) videoSel.set(kept, visible.has(videoSel.anchor) ? videoSel.anchor : null);
}

const setVideosWatched = (ids, watched) =>
  editVideos(ids, (v) => { v.watched = watched; }, `Marked ${videosNoun(ids)} ${watched ? "watched" : "unwatched"}.`);
const setVideosHidden = (ids, hidden) =>
  editVideos(ids, (v) => { v.hidden = hidden; }, hidden ? `Removed ${videosNoun(ids)} from the feed.` : `Restored ${videosNoun(ids)} to New.`);

// Remove videos from Watch Later: clear `saved` and the list. A tracked
// channel's video stays available in the New feed; a manually-saved one is left
// behind as a `saved:false` record rather than deleted, because that record is
// the only trace of the removal — delete it and the gist's older `saved:true`
// merges the video back on the next sync. `pruneVideos` drops it once the
// tombstone ages out (USER_STATE_TOMBSTONE_MS), and neither view shows it
// meanwhile (Watch Later needs `saved`, the New feed needs a tracked channel).
function removeFromWatchLater(ids) {
  return editVideos(ids, (v) => { v.saved = false; delete v.folderId; }, `Removed ${videosNoun(ids)} from Watch Later.`);
}

function moveVideosToList(ids, listId) {
  const moving = ids.filter((id) => state.videos[id]?.saved && (state.videos[id].folderId || "unsorted") !== listId);
  if (!moving.length || !state.videoFolders[listId]) return;
  return editVideos(moving, (v) => { v.folderId = listId; }, `Moved ${videosNoun(moving)} to ${folderLabel(listId, state.videoFolders)}.`);
}

// Tracked channels, optionally narrowed to the selected channel folder.
function trackedChannelIds(scopeFolderId) {
  const inFolder = scopeFolderId ? folderScopeTest(scopeFolderId) : null;
  return Object.values(state.channels)
    .filter((c) => c.trackVideos && (!inFolder || inFolder(c.folderId)))
    .map((c) => c.id);
}

// The fetch dialog: which categories (each read from its own category
// playlist), how deep (latest N per category, or everything), and — from the
// New toolbar — which tracked channels. `fixedIds` comes from a channel's
// right-click menu and replaces the scope choice.
let fetchVideosFixedIds = null;

function openFetchVideosModal(fixedIds) {
  if (!state.apiKey) {
    el.statusText.textContent = "Fetching videos needs a YouTube API key — set one in Settings.";
    return;
  }
  fetchVideosFixedIds = fixedIds;
  const scoped = !fixedIds && currentFolderId !== "all";
  el.fetchVideosScopeRow.hidden = !!fixedIds;
  el.fetchVideosScopeFolder.disabled = !scoped;
  el.fetchVideosScopeFolderLabel.textContent = scoped
    ? `Tracked channels in “${currentFolderId === FILED_ID ? "Filed" : state.folders[currentFolderId]?.name || "this folder"}”`
    : "Tracked channels in the selected folder";
  (scoped ? el.fetchVideosScopeFolder : el.fetchVideosScopeAll).checked = true;
  updateFetchVideosSummary();
  openDialog(el.fetchVideosModal);
}

function readFetchVideosForm() {
  const kinds = [...el.fetchVideosModal.querySelectorAll('input[name="fetchKind"]:checked')].map((i) => i.value);
  const depth = el.fetchVideosModal.querySelector('input[name="fetchDepth"]:checked')?.value || "recent";
  const channelIds = fetchVideosFixedIds ||
    trackedChannelIds(el.fetchVideosScopeFolder.checked ? currentFolderId : null);
  return { channelIds, kinds, limit: depth === "all" ? null : FETCH_RECENT_LIMIT };
}

const FETCH_RECENT_LIMIT = 50;

// Rough cost so a full-history pull over many channels isn't a surprise: one
// quota unit per 50-video page, per category, per channel — at minimum.
function updateFetchVideosSummary() {
  const { channelIds, kinds, limit } = readFetchVideosForm();
  const n = channelIds.length;
  const who = n === 1 ? `“${state.channels[channelIds[0]]?.name || "1 channel"}”` : `${n} channels`;
  const what = kinds.map((k) => KIND_LABELS[k].many.toLowerCase()).join(" + ");
  el.fetchVideosStart.disabled = !n || !kinds.length;
  el.fetchVideosSummary.textContent = !kinds.length ? "Pick at least one category."
    : !n ? "No tracked channels in this scope."
    : limit
      ? `Latest ${limit} ${what} from ${who} — about ${n * kinds.length} API units.`
      : `Full history of ${what} from ${who} — at least ${n * kinds.length} API units, one more per 50 videos.`;
}

// Fetch uploads of the given channels via the API (the RSS refresh only sees
// the latest ~15). Needs a key; can take a while for big catalogs, so it
// reports progress/outcome in the status line. `kinds`/`limit` come from the
// fetch dialog; without them it's the old plain full-history pull.
async function fetchAllVideos(channelIds, { kinds, limit = null } = {}) {
  if (!channelIds.length) return;
  if (!state.apiKey) {
    el.statusText.textContent = "Fetching videos needs a YouTube API key — set one in Settings.";
    return;
  }
  const label = channelIds.length === 1
    ? `“${state.channels[channelIds[0]]?.name || "channel"}”`
    : `${channelIds.length} channels`;
  const what = kinds ? kinds.map((k) => KIND_LABELS[k].many.toLowerCase()).join(", ") : "all videos";
  el.statusText.textContent = `Fetching ${limit ? `latest ${what}` : what} from ${label}… (this can take a while)`;
  videoDetailsRequested = true; // the background fills lengths itself; suppress the auto-fetch
  jobResult = null;
  const res = await requestWorker("FETCH_ALL_VIDEOS", { channelIds, kinds, limit });
  await loadState();
  render();
  if (channelIds.length > 1) setJobResult(res?.cancelled ? "Fetch stopped" : `Fetch done${res?.failures?.length ? ` · ${res.failures.length} failed` : ""}`, !!res?.failures?.length);
  if (res?.ok) {
    const split = kinds && kinds.length > 1
      ? ` (${kinds.map((k) => `${res.byKind?.[k] || 0} ${KIND_LABELS[k].many.toLowerCase()}`).join(", ")})` : "";
    el.statusText.textContent = (res.cancelled ? "Stopped. " : "") +
      `Fetched ${res.total} video${res.total === 1 ? "" : "s"}${split} from ${res.channels} channel${res.channels === 1 ? "" : "s"}` +
      (res.failures?.length ? ` — ${describeFetchFailures(res.failures)}`
        : res.lastError ? ` — some requests failed: ${res.lastError}` : ".");
  } else if (res && res.hasApiKey === false) {
    el.statusText.textContent = "Fetching videos needs an API key (set one in Settings).";
  } else {
    el.statusText.textContent = "Fetch failed.";
  }
}

// Name the channels a deep fetch couldn't read. The API's own wording for the
// common case points at a playlist id the user never chose ("The playlist
// identified with the request's playlistId parameter cannot be found"), which
// says nothing about which of the channels being fetched is the problem — so
// report it per channel, and list only the first few to keep the status line
// one line long.
const FETCH_FAILURE_NAMES = 3;

function describeFetchFailures(failures) {
  const shown = failures.slice(0, FETCH_FAILURE_NAMES)
    .map((f) => `“${f.name}” (${f.error})`)
    .join(", ");
  const rest = failures.length - FETCH_FAILURE_NAMES;
  return `skipped ${failures.length} channel${failures.length === 1 ? "" : "s"}: ` +
    shown + (rest > 0 ? `, and ${rest} more` : "") + ".";
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
// The drag payload of channel rows dropped onto a sidebar folder (§10).
const CHANNEL_DRAG_TYPE = "application/x-mytube-channels";
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

function renderFolders() {
  if (folderSortSelect.value !== folderSort) folderSortSelect.value = folderSort;

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
  for (const li of el.folderList.children) {
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    if (li.dataset.folderId === selected) li.setAttribute('aria-current', 'true');
    if (li.dataset.parentFolder) li.setAttribute('aria-expanded', String(!collapsed.has(li.dataset.folderId)));
  }
}

function folderEmojiSlotHtml(folderId, emoji) {
  if (folderId === "unsorted") return "";
  // A plain, non-interactive slot: clicking it selects the folder like the name
  // does (the click bubbles up). Emoji is set from the folder's right-click menu.
  // The slot is always rendered (empty when unset) so folder names stay aligned.
  return `<span class="folder-emoji">${escapeHtml(emoji || "")}</span>`;
}

// The inline emoji field (folder menu → Set emoji…): a floating input next to
// the folder; the first character typed is saved, ✕ clears it.
function openEmojiInput(anchorEl, folderId) {
  const picker = document.createElement("div");
  picker.className = "folder-emoji-picker";
  picker.innerHTML = `<input class="input folder-emoji-input" type="text" placeholder="😀" maxlength="4" aria-label="Folder emoji" /><button class="folder-emoji-clear" type="button" title="Clear emoji" aria-label="Clear emoji">✕</button>`;
  const input = picker.querySelector("input");
  input.value = fdom().folders[folderId]?.emoji || "";
  const popover = openPopover(anchorEl, picker);
  input.focus();
  input.select();
  const save = async (value) => {
    popover.close();
    await setFolderEmoji(folderId, value);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(input.value); });
  input.addEventListener("input", () => { if ([...input.value.trim()].length >= 1) save(input.value); });
  picker.querySelector("button").addEventListener("click", () => save(""));
}

// Set or clear a folder's emoji (empty string clears). Emoji may be up to two
// codepoints. Persists and re-renders the sidebar. Operates on the active domain.
async function setFolderEmoji(folderId, value) {
  const d = fdom();
  const folder = d.folders[folderId];
  if (!folder) return;
  const emoji = [...value.trim()].slice(0, 2).join("");
  if ((folder.emoji || "") === emoji) return;
  if (emoji) folder.emoji = emoji;
  else delete folder.emoji;
  renderFolders();
  await d.persist(emoji ? `Emoji set on “${folder.name}”.` : `Emoji removed from “${folder.name}”.`);
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
// Renumbers the destination group's order values. The caller persists.
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
}

// What a drop of `srcId` onto `targetId` would do, from where the cursor sits
// in the target row — zones 25 / 50 / 25 → before / inside / after (§10).
// `valid: false` still carries the zone, so the indicator shows where it would
// land; the drop itself is then refused with "Only one level of nesting."
// Returns null only for a target that can't take any folder drop at all.
function computeFolderDropIntent(srcId, targetId, clientY, targetEl) {
  const folders = fdom().folders;
  const src = folders[srcId];
  const target = folders[targetId];
  if (!src || !target || srcId === targetId) return null;
  // Unfiled is pinned first: dropping on it means "first among the top level".
  if (targetId === "unsorted") return { type: "first", valid: !!src, zone: "after" };

  const rect = targetEl.getBoundingClientRect();
  const y = (clientY - rect.top) / rect.height;
  const type = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
  const srcHasChildren = folderHasChildren(srcId, folders);
  // Two levels max: nest only into a top-level folder, never nest a group, and
  // a group can't become a child by being reordered next to one either.
  const valid = type === "inside"
    ? !target.parentId && !srcHasChildren && target.parentId !== srcId
    : !(srcHasChildren && target.parentId);
  return { type, valid, zone: type === "inside" ? "into" : type };
}

async function performFolderDrop(srcId, targetId, intent) {
  const d = fdom();
  const target = d.folders[targetId];
  const src = d.folders[srcId];
  if (!target || !src) return;
  let movedItems = false;
  if (intent.type === "inside") {
    // The first subfolder of a folder that holds items takes those items: a
    // group holds none of its own (§11).
    if (!folderHasChildren(targetId, d.folders)) {
      for (const item of d.items()) {
        if ((item.folderId || "unsorted") === targetId) { item.folderId = srcId; movedItems = true; }
      }
    }
    d.collapsed.delete(targetId); // reveal the newly nested child
    applyFolderDrop(srcId, targetId, null);
  } else if (intent.type === "first") {
    applyFolderDrop(srcId, null, getSiblingIdsOrdered(null, d.folders).filter((id) => id !== srcId)[0] || null);
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
  await d.persist(intent.type === "inside" ? `Moved “${src.name}” into “${target.name}”.` : `Moved “${src.name}”.`, movedItems);
}

// The filter chips (DESIGN §7): left click = only these, right click =
// exclude; tag/language chips carry their color dot, flag chips relabel when
// excluded (Active → Inactive …) and wear their flag color.
function chipHtml({ role, label, state, color = "", flag = "", attrs = "", title = CHIP_TOOLTIP }) {
  const cls = ["chip", flag ? `flag flag-${flag}` : "", state === "in" ? "on" : state === "out" ? "out" : ""].filter(Boolean).join(" ");
  const dot = color ? `<span class="dot" style="background:${escapeHtml(color)}"></span>` : "";
  return `<span class="${cls}" data-role="${role}" ${attrs} role="button" tabindex="0" aria-pressed="${state ? "true" : "false"}" title="${escapeHtml(title)}">${dot}<span class="chip-label">${escapeHtml(label)}</span></span>`;
}

function renderTagFilters() {
  const bar = el.tagFilterBar;

  // Only offer variables actually present on channels in the current folder.
  const inFolder = folderScopeTest(currentFolderId);
  const channelsInFolder = Object.values(state.channels).filter((c) => !inFolder || inFolder(c.folderId));
  const usedTagIds = new Set(channelsInFolder.flatMap((c) => c.tags || []));
  const tagEntries = Object.entries(state.tags).filter(([id]) => usedTagIds.has(id))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const langs = [...new Set(channelsInFolder.map((c) => canonicalLanguage(c.language)).filter(l => LANGUAGES.includes(l)))].sort();
  const hasActive = channelsInFolder.some((c) => c.active);
  const hasFinished = channelsInFolder.some((c) => c.finished);
  const hasTracked = channelsInFolder.some((c) => c.trackVideos);

  bar.hidden = tagEntries.length === 0 && langs.length === 0 && !hasActive && !hasFinished && !hasTracked;
  if (bar.hidden) { bar.innerHTML = ""; return; }

  const side = (include, exclude, key) => (include.has(key) ? "in" : exclude.has(key) ? "out" : "");
  const flagSide = (value) => (value === "only" ? "in" : value === "not" ? "out" : "");
  const html = ['<span class="filter-label">Filter</span>'];
  for (const [id, tag] of tagEntries) {
    html.push(chipHtml({ role: "filter-tag", label: tag.name, color: tag.color, state: side(activeTagFilters, excludedTagFilters, id),
      attrs: `data-tag-id="${escapeHtml(id)}"`, title: `${tag.name} — ${CHIP_TOOLTIP} · Shift+right click: rename, color or delete` }));
  }
  for (const lang of langs) {
    html.push(chipHtml({ role: "filter-lang", label: langLabel(lang), color: langColor(lang), state: side(activeLangFilters, excludedLangFilters, lang),
      attrs: `data-lang="${escapeHtml(lang)}"` }));
  }
  if (hasActive) html.push(chipHtml({ role: "filter-active", flag: "active", label: filterActive === "not" ? "Inactive" : "Active", state: flagSide(filterActive) }));
  if (hasFinished) html.push(chipHtml({ role: "filter-finished", flag: "finished", label: filterFinished === "not" ? "Unfinished" : "Finished", state: flagSide(filterFinished) }));
  // Tracked: its "not" side is how you find the channels a full-history fetch
  // or the feed is silently skipping.
  if (hasTracked) html.push(chipHtml({ role: "filter-tracked", flag: "track", label: filterTracked === "not" ? "Untracked" : "Tracked", state: flagSide(filterTracked) }));
  bar.innerHTML = html.join("");
}

// The video views' watched chip, which flips label like Active/Finished does:
// left click narrows to unwatched, right click to watched.
function renderWatchedChip(mode) {
  const chip = el.videoUnwatchedChip;
  chip.querySelector(".chip-label").textContent = mode === "watched" ? "Watched" : "Unwatched";
  chip.title = "Left click: only unwatched · Right click: only watched";
  chip.classList.toggle("on", mode === "unwatched");
  chip.classList.toggle("out", mode === "watched");
  chip.setAttribute("aria-pressed", String(!!mode));
}

const KIND_LABELS = {
  video: { one: "Video", many: "Videos" },
  short: { one: "Short", many: "Shorts" },
  live: { one: "Stream", many: "Streams" },
};

function anyKindFilter() {
  return activeKindFilters.size > 0 || excludedKindFilters.size > 0;
}

function renderKindChips() {
  for (const chip of el.videoFilters.querySelectorAll('[data-role="filter-kind"]')) {
    const kind = chip.dataset.kind;
    chip.classList.toggle("on", activeKindFilters.has(kind));
    chip.classList.toggle("out", excludedKindFilters.has(kind));
    chip.setAttribute("aria-pressed", String(activeKindFilters.has(kind) || excludedKindFilters.has(kind)));
    chip.title = `${KIND_LABELS[kind].many} — ${CHIP_TOOLTIP}`;
  }
}

function renderGrid() {
  renderFilterClears();
  pendingChannels = getFilteredChannels();
  const signature = JSON.stringify([currentFolderId, searchQuery, filterActive, filterFinished, filterTracked,
    [...activeTagFilters], [...excludedTagFilters], [...activeLangFilters], [...excludedLangFilters],
    filterMinCount, filterMaxCount, filterAfterDate, filterBeforeDate, sortPriority, sortDate, sortCount, sortSubs, sortFolder]);
  const loaded = signature === channelPageSignature ? Math.max(PAGE_SIZE, el.channelGrid.children.length) : PAGE_SIZE;
  if (signature !== channelPageSignature) el.channelGrid.replaceChildren();
  channelPageSignature = signature;
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

  const entries = pendingChannels.splice(0, loaded).map(ch => [`channel:${ch.id}`, buildChannelRow(ch).outerHTML]);
  reconcileChildren(el.channelGrid, entries);
  setupScrollObserver();
  renderSelectionCount();
}

// Append the next batch of channels, then keep the sentinel positioned after them.
function appendNextPage() {
  const batch = pendingChannels.splice(0, PAGE_SIZE);
  const frag = document.createDocumentFragment();
  for (const ch of batch) {
    const row = buildChannelRow(ch);
    row._renderHtml = row.outerHTML;
    frag.appendChild(row);
  }
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
  filterTracked = "";
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

// ---------- Number fields (§3, §7) ----------
// The count and DD/MM filter fields are kit NumberFields: no spinner arrows;
// type, drag sideways, or — with the Controls wheel setting on — point and
// scroll. The year Selects take the wheel too (one year per notch).
function setupNumberFields() {
  const wheel = () => controls.wheelAdjustsNumbers;
  const count = (input, set) => bindNumberField(input, { min: 0, wheel, onChange: (value) => { set(value); renderGrid(); } });
  count(el.filterMinCount, (value) => { filterMinCount = value; });
  count(el.filterMaxCount, (value) => { filterMaxCount = value; });
  for (const [which, day, month] of [["after", el.filterAfterDay, el.filterAfterMonth], ["before", el.filterBeforeDay, el.filterBeforeMonth]]) {
    bindNumberField(day, { min: 1, max: 31, wheel, onChange: () => onDateFilterChange(which) });
    bindNumberField(month, { min: 1, max: 12, wheel, onChange: () => onDateFilterChange(which) });
    const sel = yearSelects[which];
    sel.el.addEventListener("wheel", (e) => {
      if (!wheel()) return;
      e.preventDefault();
      const values = sel.options.filter((o) => !o.group).map((o) => o.value);
      const next = values.indexOf(sel.value) + (e.deltaY < 0 ? -1 : 1);
      if (next < 0 || next >= values.length) return;
      sel.value = values[next];
      onDateFilterChange(which);
    }, { passive: false });
  }
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
  if (currentView === "new" || currentView === "removed") renderVideoFeed();
  else if (currentView === "watchlater") renderWatchLater();
  else renderGrid();
}

// Show each clear button only while its filter is actually set — a row of dead
// × buttons reads as clutter, and a live one is a hint that something is on.
function renderFilterClears() {
  el.searchClear.hidden = !searchQuery.trim();
  el.clearCountBtn.hidden = filterMinCount === null && filterMaxCount === null;
  el.clearAfterBtn.hidden = !dateFilterSet(el.filterAfterDay, el.filterAfterMonth, yearSelects.after);
  el.clearBeforeBtn.hidden = !dateFilterSet(el.filterBeforeDay, el.filterBeforeMonth, yearSelects.before);
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
  return !!searchQuery.trim() || watched === "watched" || anyKindFilter();
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
  yearSelects[which].value = YEAR_NONE;
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
    filterTracked !== "" ||
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
  yearSelects.after.value = YEAR_NONE;
  el.filterBeforeDay.value = "";
  el.filterBeforeMonth.value = "";
  yearSelects.before.value = YEAR_NONE;
  // "Clear" means nothing is hidden — including the watched chip, even though
  // it *starts* on "unwatched" when the dashboard opens.
  newWatchedFilter = "";
  watchLaterWatchedFilter = "";
  activeKindFilters.clear();
  excludedKindFilters.clear();
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
    list = list.filter((c) => activeLangFilters.has(canonicalLanguage(c.language)));
  }
  if (excludedLangFilters.size) {
    list = list.filter((c) => !excludedLangFilters.has(canonicalLanguage(c.language)));
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
  if (filterTracked === "only") {
    list = list.filter((c) => c.trackVideos);
  } else if (filterTracked === "not") {
    list = list.filter((c) => !c.trackVideos);
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
  folderOrderIndex = buildFolderOrderIndex();
  list.sort(compareChannels);
  return list;
}

function sortDirOf(key) {
  return key === "date" ? sortDate : key === "count" ? sortCount : key === "subs" ? sortSubs : sortFolder;
}

function setSortDirOf(key, dir) {
  if (key === "date") sortDate = dir;
  else if (key === "count") sortCount = dir;
  else if (key === "subs") sortSubs = dir;
  else sortFolder = dir;
}

// Folder id → its position in the sidebar, so "sort by folder" reproduces the
// order the sidebar and the row's dropdown already show (custom order included)
// instead of inventing an alphabetical one that matches neither. Rebuilt per
// filter pass, since a rename or a drag changes it.
let folderOrderIndex = {};

function buildFolderOrderIndex() {
  const index = {};
  buildOrderedFolderList().forEach(({ id }, i) => (index[id] = i));
  return index;
}

// The per-key comparators. Each returns a negative/positive number in ASCENDING
// order; `compareChannels` applies the direction. A missing value sorts as -1 /
// last-in-the-sidebar so "no data" never lands in the middle of real numbers.
const SORT_COMPARATORS = {
  date: (a, b) => {
    const da = a.lastVideoDate || "";
    const db = b.lastVideoDate || "";
    return da < db ? -1 : da > db ? 1 : 0;
  },
  count: (a, b) => (a.videoCount ?? -1) - (b.videoCount ?? -1),
  subs: (a, b) => (a.subscriberCount ?? -1) - (b.subscriberCount ?? -1),
  folder: (a, b) => folderRank(a) - folderRank(b),
};

function folderRank(ch) {
  const idx = folderOrderIndex[ch.folderId || "unsorted"];
  return idx === undefined ? Number.MAX_SAFE_INTEGER : idx;
}

// Apply every enabled sort key in `sortPriority` order (most recently clicked
// header first), falling through to the next one on a tie.
function compareChannels(a, b) {
  for (const key of sortPriority) {
    const dir = sortDirOf(key);
    if (dir === "none") continue;
    const cmp = SORT_COMPARATORS[key](a, b);
    if (cmp !== 0) return (dir === "asc" ? 1 : -1) * cmp;
  }
  return 0;
}

// Each active header shows its direction, plus its rank (1, 2, …) whenever more
// than one column is sorting — with click-order priority, an arrow alone can't
// say which column is actually grouping the list.
function updateSortHeaders() {
  const ARROWS = { none: "", desc: " ↓", asc: " ↑" };
  const active = sortPriority.filter((k) => sortDirOf(k) !== "none");
  for (const col of el.listTableHeader.querySelectorAll(".lth-sort-col")) {
    const key = col.dataset.sort;
    const val = sortDirOf(key);
    const rank = active.indexOf(key);
    const arrow = col.querySelector(".lth-arrow");
    arrow.textContent = (ARROWS[val] || "") + (active.length > 1 && rank >= 0 ? String(rank + 1) : "");
    col.classList.toggle("lth-active", val !== "none");
  }
}

function buildChannelRow(ch) {
  const row = document.createElement("div");
  row.className = "channel-row ui-row";
  if (channelSel.has(ch.id)) row.classList.add("selected");
  row.dataset.channelId = ch.id;
  row.dataset.renderKey = `channel:${ch.id}`;
  row.draggable = true;

  const flag = (role, key, label, title) =>
    `<button type="button" class="chip flag flag-${role === "toggle-track" ? "track" : key}${ch[key] ? " on" : ""}" data-role="${role}" aria-pressed="${!!ch[key]}" title="${title}"><span class="chip-label">${label}</span></button>`;
  row.innerHTML = `
    <div class="channel-head">
      ${thumbHtml(ch)}
      <div class="channel-name-wrap">
        <a class="channel-name" href="https://www.youtube.com/channel/${encodeURIComponent(ch.id)}/videos" target="_blank" rel="noopener noreferrer" draggable="false" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</a>
        <div class="channel-handle">${escapeHtml(ch.handle || ch.id)}</div>
      </div>
    </div>
    ${dateCellHtml(ch.lastVideoDate, { colored: true, className: "row-date" })}
    <div class="row-count">${ch.videoCount != null ? ch.videoCount.toLocaleString() : "—"}</div>
    <div class="row-subs" title="${escapeHtml(subscriberTitle(ch.subscriberCount))}">${formatSubscribers(ch.subscriberCount)}</div>
    <div class="channel-tags channel-vars">
      ${languageButtonHtml(ch)}
      ${flag("toggle-active", "active", "Active", "Active — flag channels you're following")}
      ${flag("toggle-finished", "finished", "Finished", "Finished — flag channels you consider done")}
      ${flag("toggle-track", "trackVideos", "Track", "Track — pull this channel's new uploads into the New feed")}
      ${tagChipsHtml(ch)}
      <button type="button" class="chip add" data-role="add-tag" aria-haspopup="menu">+ tag</button>
    </div>
    <div class="channel-controls">
      ${selectButtonHtml({ label: folderLabel(ch.folderId), className: "folder-select", attrs: `data-role="move-folder" aria-label="Folder for ${escapeHtml(ch.name)}"` })}
    </div>
  `;
  return row;
}

// ---------- Channel edits (selection-aware, each one undoable — §5, §9) ----------

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
// "“Veritasium”" for one channel, "3 channels" for several — the undo toasts.
const channelsNoun = (ids) => ids.length === 1 ? `“${state.channels[ids[0]]?.name || "channel"}”` : plural(ids.length, "channel");

// Inline edits on a selected row apply to the whole selection.
const rowTargets = (id) => channelSel.targetsFor(id);

// Apply `mutate` to each channel, repaint at once, then persist as one
// undoable edit. Bulk edits keep the selection (so edits can be chained) —
// only rows the edit took out of the view leave it.
async function editChannels(ids, mutate, undo) {
  const list = ids.map((id) => state.channels[id]).filter(Boolean);
  if (!list.length) return;
  list.forEach(mutate);
  render();
  pruneChannelSelection();
  await persistLibrary({ channels: state.channels }, { undo });
}

function pruneChannelSelection() {
  if (!channelSel.size) return;
  const visible = new Set(getFilteredChannels().map((c) => c.id));
  const kept = [...channelSel.ids].filter((id) => visible.has(id));
  if (kept.length !== channelSel.size) channelSel.set(kept, visible.has(channelSel.anchor) ? channelSel.anchor : null);
}

const FLAG_WORDS = { active: ["active", "inactive"], finished: ["finished", "unfinished"], trackVideos: ["tracked", "untracked"] };

// Set one of the three per-channel flags (active / finished / trackVideos).
// Row chips, the single menu and the bulk menu all land here, so the one thing
// that isn't just a boolean — turning Track on has to fetch that channel's
// uploads right away, or the feed stays empty until the next refresh — can't
// be implemented in one place and forgotten in another.
async function setChannelFlag(ids, key, value) {
  const changed = ids.filter((id) => state.channels[id] && !!state.channels[id][key] !== value);
  if (!changed.length) return;
  await editChannels(changed, (ch) => { ch[key] = value; }, `Marked ${channelsNoun(changed)} ${FLAG_WORDS[key][value ? 0 : 1]}.`);
  if (key === "trackVideos" && value) {
    if (changed.length === 1) chrome.runtime.sendMessage({ type: "REFRESH_SINGLE", channelId: changed[0] });
    else requestWorker("REFRESH_STATS", { channelIds: changed });
  }
}

async function moveChannels(ids, folderId) {
  const moving = ids.filter((id) => state.channels[id] && (state.channels[id].folderId || "unsorted") !== folderId);
  if (!moving.length || !state.folders[folderId]) return;
  await editChannels(moving, (ch) => { ch.folderId = folderId; }, `Moved ${channelsNoun(moving)} to ${folderLabel(folderId)}.`);
}

async function setChannelLanguage(ids, lang) {
  const language = lang || null;
  const changing = ids.filter((id) => state.channels[id] && (state.channels[id].language || null) !== language);
  if (!changing.length) return;
  await editChannels(changing, (ch) => { ch.language = language; },
    language ? `Set ${channelsNoun(changing)} to ${langName(language)}.` : `Cleared the language of ${channelsNoun(changing)}.`);
}

async function setChannelTag(ids, tagId, on) {
  const tag = state.tags[tagId];
  const changing = ids.filter((id) => state.channels[id] && !!state.channels[id].tags?.includes(tagId) !== on);
  if (!tag || !changing.length) return;
  await editChannels(changing, (ch) => {
    ch.tags = on ? [...(ch.tags || []), tagId] : (ch.tags || []).filter((t) => t !== tagId);
  }, on ? `Tagged ${channelsNoun(changing)} “${tag.name}”.` : `Removed “${tag.name}” from ${channelsNoun(changing)}.`);
}

// An existing tag by name (case-insensitive), else a new one. Mutates
// state.tags only; the caller persists it with whatever uses it.
function ensureTag(name) {
  const existing = Object.keys(state.tags).find((id) => state.tags[id].name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const id = slugify(name) + "-" + Date.now().toString(36).slice(-3);
  state.tags[id] = { name, color: nextTagColor() };
  return id;
}

async function createTagOn(ids, name) {
  const created = !Object.values(state.tags).some((t) => t.name.toLowerCase() === name.toLowerCase());
  const tagId = ensureTag(name);
  for (const id of ids) {
    const ch = state.channels[id];
    if (ch && !ch.tags?.includes(tagId)) ch.tags = [...(ch.tags || []), tagId];
  }
  render();
  await persistLibrary({ tags: state.tags, channels: state.channels },
    { undo: created ? `Created tag “${name}”.` : `Tagged ${channelsNoun(ids)} “${state.tags[tagId].name}”.` });
}

async function deleteChannels(ids) {
  const list = ids.filter((id) => state.channels[id]);
  if (!list.length) return;
  const ok = await confirmDialog({
    title: list.length === 1 ? `Delete “${state.channels[list[0]].name}”?` : `Delete ${plural(list.length, "channel")}?`,
    text: `${list.length === 1 ? "It leaves" : "They leave"} MyTube along with folder and tags. A new scan would add ${list.length === 1 ? "it" : "them"} back while you're still subscribed. Undo is available right after.`,
    okLabel: "Delete", danger: true,
  });
  if (!ok) return;
  const label = `Deleted ${channelsNoun(list)}.`;
  for (const id of list) delete state.channels[id];
  channelSel.set([...channelSel.ids].filter((id) => state.channels[id]), null);
  render();
  await persistLibrary({ channels: state.channels }, { undo: label });
}

function openChannel(id, background = false) {
  chrome.tabs.create({ url: `https://www.youtube.com/channel/${encodeURIComponent(id)}/videos`, active: !background });
}

// ---------- Tag popover (§5) ----------

// "+ tag" on a row (or Tags… in its menu): every tag, ✓ when all targets have
// it; a click toggles it on all of them and the popover stays open. The
// "+ New tag (Enter)" field is always there and focused; × deletes a tag
// everywhere (after a confirm).
function openTagPopover(ids, at) {
  // Anchor to a point: a toggle re-renders the row, replacing the "+ tag"
  // button the popover would otherwise be measured against.
  if (at instanceof Element) { const r = at.getBoundingClientRect(); at = { x: r.left, y: r.bottom + 4 }; }
  const pop = document.createElement("div");
  pop.className = "tag-popover";
  pop.setAttribute("role", "menu");
  pop.setAttribute("aria-label", "Tags");
  const paint = () => {
    const channels = ids.map((id) => state.channels[id]).filter(Boolean);
    const tags = Object.entries(state.tags).sort((a, b) => a[1].name.localeCompare(b[1].name));
    pop.innerHTML = `${ids.length > 1 ? `<div class="ui-menu-title">${escapeHtml(plural(ids.length, "channel"))}</div>` : ""}
      ${tags.map(([id, t]) => {
        const all = channels.length > 0 && channels.every((c) => c.tags?.includes(id));
        return `<div class="ui-menu-item" role="menuitemcheckbox" tabindex="0" aria-checked="${all}" data-tag="${escapeHtml(id)}">
          <span class="check">${all ? "✓" : ""}</span><span class="dot" style="background:${escapeHtml(t.color)}"></span>
          <span class="grow">${escapeHtml(t.name)}</span><button type="button" class="tag-pop-x" data-delete="${escapeHtml(id)}" title="Delete tag everywhere" aria-label="Delete tag ${escapeHtml(t.name)}">×</button></div>`;
      }).join("") || '<div class="tag-pop-empty">No tags yet</div>'}
      <div class="ui-menu-sep"></div>
      <input class="input" data-role="new-tag" type="text" autocomplete="off" placeholder="+ New tag (Enter)" aria-label="New tag" />`;
  };
  paint();
  const popover = openPopover(at, pop);
  const focusField = () => pop.querySelector('[data-role="new-tag"]').focus();
  focusField();
  pop.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) { popover.close(); await deleteTag(del.dataset.delete); return; }
    const item = e.target.closest("[data-tag]");
    if (!item) return;
    await setChannelTag(ids, item.dataset.tag, item.getAttribute("aria-checked") !== "true");
    paint();
    popover.place();
    pop.querySelector(`[data-tag="${CSS.escape(item.dataset.tag)}"]`)?.focus();
  });
  pop.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.dataset.role === "new-tag") {
      e.preventDefault();
      const name = e.target.value.trim();
      if (!name) return;
      await createTagOn(ids, name);
      paint();
      popover.place();
      focusField();
    } else if ((e.key === "Enter" || e.key === " ") && e.target.dataset.tag) {
      e.preventDefault();
      e.target.click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...pop.querySelectorAll("[data-tag], [data-role=\"new-tag\"]")];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      e.preventDefault();
    }
  });
}

// 40px avatar; a missing (or broken — see the image error handler) photo
// shows a circle with the first letter (§5).
function thumbHtml(ch) {
  const letter = escapeHtml(([...String(ch.name || "?")][0] || "?").toUpperCase());
  return ch.thumbnail
    ? `<img class="channel-thumb ui-avatar" src="${escapeHtml(ch.thumbnail)}" alt="" loading="lazy" draggable="false" data-letter="${letter}" />`
    : avatarHtml(null, ch.name, "channel-thumb ui-avatar");
}

// "📚 Science" — a folder as the row's Select and the menus show it.
function folderLabel(folderId, folders = state.folders) {
  const f = folders[folderId || "unsorted"];
  if (!f) return "Unfiled";
  return `${f.emoji ? `${f.emoji} ` : ""}${f.name}`;
}

// Every folder an item may live in (§5, §11): groups hold no items, so a group
// appears only as a heading over its indented children. `folders` defaults to
// the channel folders; pass state.videoFolders for Watch Later lists.
function folderListboxOptions(folders = state.folders) {
  const options = [];
  for (const [id, f] of getTopLevelFoldersOrdered(folders)) {
    const children = getChildFolderIds(id, folders).sort((a, b) => (folders[a].order ?? 0) - (folders[b].order ?? 0));
    if (!children.length) { options.push({ value: id, label: folderLabel(id, folders) }); continue; }
    options.push({ group: folderLabel(id, folders) });
    for (const cid of children) options.push({ value: cid, label: folderLabel(cid, folders), indent: true });
  }
  return options;
}

// The Variables cell's language Select: flag + name, the language color on its
// border/text when set; an assignment no longer active reads "Inactive".
function languageButtonHtml(ch) {
  const current = canonicalLanguage(ch.language);
  const active = LANGUAGES.includes(current);
  const color = active ? langColor(current) : "";
  return selectButtonHtml({
    label: active ? langLabel(current) : current ? "Inactive" : "",
    placeholder: "lang…", className: `var-lang pill${active ? " has-lang" : ""}`, color,
    attrs: `data-role="set-language" aria-label="Language"`, title: current && !active ? `${langName(current)} (inactive)` : "Language",
  });
}

function languageListboxOptions() {
  return [
    { value: "", label: "— none —" },
    ...LANGUAGES.map((language) => ({ value: language, label: langLabel(language), color: langColor(language) })),
  ];
}

// Row tag chips (§5): neutral, the tag's color as a dot; a click removes it.
function tagChipsHtml(ch) {
  return (ch.tags || [])
    .map((tid) => [tid, state.tags[tid]])
    .filter(([, t]) => t)
    .map(([tid, t]) => `<button type="button" class="chip row-tag" data-role="remove-tag" data-tag-id="${escapeHtml(tid)}" title="Remove"><span class="dot" style="background:${escapeHtml(t.color)}"></span><span class="chip-label">${escapeHtml(t.name)}</span></button>`)
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

// ---------- Helpers ----------

function formatShortDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// Compact subscriber count for the list, e.g. 1.2M / 45.3K / 812. null means
// hidden or not-yet-fetched (needs an API key) and shows as an em dash.
// The full number, grouped ("2,300", not "2.3K"). Rounding to one decimal made
// every channel in a band read the same — "2.3K" covers a 50-subscriber spread
// — which is useless in a column you can now sort by.
function formatSubscribers(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
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
  const stale = Object.values(state.channels).filter(ch => Date.now() - (ch.lastFetched || 0) >= AUTO_REFRESH_STALE_MS).map(ch => ch.id);
  if (stale.length) await runRefresh(stale);
}

async function runRefresh(channelIds) {
  if (refreshRunning) return;
  refreshRunning = true;
  jobResult = null;
  el.refreshBtn.disabled = el.retryRefreshBtn.disabled = true;
  el.statusText.textContent = 'Refreshing…';
  try {
    const res = await requestWorker('REFRESH_STATS', channelIds ? { channelIds } : {});
    const failures = res.failures || [];
    failedRefreshIds = [...new Set(failures.map(f => f.id))];
    el.retryRefreshBtn.hidden = !failedRefreshIds.length;
    el.refreshErrors.hidden = !failures.length;
    el.refreshErrors.innerHTML = failures.length ? `<summary>${failures.length} refresh failure${failures.length === 1 ? '' : 's'}</summary><ul>${failures.map(f => `<li>${escapeHtml(f.name)}: ${escapeHtml(f.error)}</li>`).join('')}</ul>` : '';
    el.statusText.textContent = res.cancelled ? 'Refresh stopped. Channels already read were updated.'
      : failures.length ? `Updated with ${failures.length} failed request${failures.length === 1 ? '' : 's'}. Retry failed channels below.`
      : res.ok ? `Updated ${new Date().toLocaleTimeString()}.${res.hasApiKey ? '' : ' Counts and durations need an API key.'}`
      : res.error || res.lastError || 'Refresh failed. Try again.';
    if ((res.queried || 0) > 1) setJobResult(res.cancelled ? 'Stopped' : `Done${failures.length ? ` · ${failures.length} failed` : ''}`, failures.length > 0);
  } finally {
    refreshRunning = false;
    el.refreshBtn.disabled = el.retryRefreshBtn.disabled = false;
  }
}

// ---------- Progress box (§4) ----------
// While the worker runs a refresh or a video fetch over several channels it
// mirrors `jobProgress` ({ kind, done, total, startedAt }); the box under
// Refresh Stats shows it with Stop (CANCEL_JOB — the job stops at its next
// step and keeps what it already read). When a job this page started ends, the
// box shows its result with × to dismiss; failures are listed under the topbar.
let jobResult = null; // { text, failed } once a job this page started finished

function setJobResult(text, failed = false) {
  jobResult = { text, failed };
  renderJobStatus();
}

function renderJobStatus() {
  const job = state.jobProgress;
  const box = el.jobStatus;
  if (job) {
    const left = Math.max(0, job.total - job.done);
    const elapsed = Date.now() - (job.startedAt || Date.now());
    const eta = job.done > 0 ? Math.ceil((elapsed / job.done) * left / 60000) : 0;
    el.jobStatusText.textContent = `${job.kind === 'fetch' ? 'Fetching videos' : 'Refreshing'} ${job.done}/${job.total}${eta ? ` · ~${eta} min` : ''}`;
    el.jobStopBtn.textContent = 'Stop';
    el.jobStopBtn.title = job.kind === 'fetch' ? 'Stop fetching videos' : 'Stop the refresh';
    el.jobStopBtn.setAttribute('aria-label', el.jobStopBtn.title);
    box.classList.remove('paused');
    box.hidden = false;
  } else if (jobResult) {
    el.jobStatusText.textContent = jobResult.text;
    el.jobStopBtn.textContent = '×';
    el.jobStopBtn.title = 'Dismiss';
    el.jobStopBtn.setAttribute('aria-label', 'Dismiss');
    box.classList.toggle('paused', !!jobResult.failed);
    box.hidden = false;
  } else {
    box.hidden = true;
  }
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
  offerNativePull();
}

// ---------- The updater's native host ----------

// The extension still can't pull — nothing inside an MV3 worker can. What it
// can do is ask a *native host* to, and that host is the one in `native-host/`:
// Chrome starts it, it runs `git pull --ff-only` in this checkout, and the only
// thing left for the extension is the restart it could already do. Installing
// it (`native-host/install.sh`) is a per-device step, so everything here has to
// degrade to the old copy-the-command banner when it isn't there.
const UPDATER_HOST = "com.mytube.organizer.updater";

// sendNativeMessage's callback reports a missing/broken host through
// runtime.lastError, which throws if left unread — resolve it as a value.
function sendToUpdater(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(UPDATER_HOST, message, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, missing: true, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false, error: "The updater sent no answer." });
      });
    } catch (e) {
      resolve({ ok: false, missing: true, error: e.message });
    }
  });
}

// Show "Pull & reload" only once the host has actually answered. A button that
// errors on click would be worse than the command it replaces, and a host that
// isn't installed is the normal case on a device nobody has set up yet.
async function offerNativePull() {
  const res = await sendToUpdater({ cmd: "ping" });
  el.updatePullBtn.hidden = !res.ok;
  el.updateBannerCmd.hidden = !!res.ok;
}

// Restart the extension so Chrome re-reads the folder from disk. This page goes
// with it — it *is* part of the extension — so the last thing it does is leave a
// stamp the service worker picks up on the way back up, which reopens the
// dashboard. Without it the button looks like it merely closed the extension.
async function reloadExtension() {
  await chrome.storage.local.set({ reopenDashboardAt: Date.now() });
  chrome.runtime.reload();
}

async function runNativePull() {
  el.updatePullBtn.disabled = true;
  const label = el.updatePullBtn.textContent;
  el.updatePullBtn.textContent = "Pulling…";
  const res = await sendToUpdater({ cmd: "pull" });
  if (res.ok) {
    // Reloading throws this page away along with the rest of the extension —
    // which is the point: the pulled files only take effect on a restart.
    // reloadExtension leaves the note that brings this page back afterwards.
    await reloadExtension();
    return;
  }
  // Failed pulls are the interesting ones (local commits, a conflict, no
  // network), so show git's own words rather than a summary of them.
  el.updateBannerText.textContent = [res.error, res.output].filter(Boolean).join(" ").slice(0, 300);
  el.updateBannerCmd.hidden = false;
  el.updatePullBtn.disabled = false;
  el.updatePullBtn.textContent = label;
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
  return el.scanDiffModal.open || el.playlistImportModal.open || el.syncDiffModal.open;
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
  openDialog(el.scanDiffModal);
  renderReviewBanner();
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
  openDialog(el.playlistImportModal);
  renderReviewBanner();
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
      ? `<input class="ui-check" type="checkbox" data-move-id="${escapeHtml(it.id)}" />${text}`
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
  const count = group => (group?.added?.length || 0) + (group?.modified?.length || 0);
  const videos = diff.videos || {};
  return count(diff.channels) + (diff.removeIds?.length || 0) + count(diff.folders) + count(diff.videoFolders) + count(diff.tags)
    + (diff.settings?.length || 0) + (videos.added || 0) + (videos.modified || 0) + (videos.removed || 0);
}

function openSyncDiffModal(diff, { keepChoices = false } = {}) {
  if (!keepChoices) { syncReviewRequest++; syncSkipVideoIds.clear(); syncSkipAllVideos = false; }
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
  const tagCount = (diff.tags?.added.length || 0) + (diff.tags?.modified.length || 0);
  if (tagCount) extra.push(`${tagCount} tag change${tagCount === 1 ? "" : "s"}`);
  if (settings.length) extra.push(`${settings.length} setting${settings.length === 1 ? "" : "s"}`);
  el.syncDiffSummary.textContent = totalChanges === 0
    ? "No differences — already in sync."
    : [`${added.length} to add, ${modified.length} to overwrite, ${diff.removeIds?.length || 0} selected for removal`, ...extra].join(", ") + ".";

  if (removed.length) {
    el.syncDiffWarning.hidden = false;
    const n = removed.length;
    el.syncDiffWarning.textContent = `${n} channel${n === 1 ? '' : 's'} only exist${n === 1 ? 's' : ''} ${isUpload ? 'in the Gist' : 'locally'}. Select the ones to remove; dependent video changes update below.`;
  } else {
    el.syncDiffWarning.hidden = true;
  }

  el.syncDiffBody.innerHTML = "";
  const addLabel = isUpload ? "Will be added to Gist" : "Will be added locally";
  const delLabel = isUpload ? "Will be removed from Gist" : "Will be removed locally";
  el.syncDiffBody.appendChild(buildDiffSection(addLabel, "add", added, false));
  el.syncDiffBody.appendChild(buildDiffSection(delLabel, "del", removed, true, isUpload));
  const selectedRemovals = new Set(diff.removeIds || []);
  el.syncDiffBody.querySelectorAll('[data-remove-id]').forEach(box => { box.checked = selectedRemovals.has(box.dataset.removeId); });
  const allRemovals = el.syncDiffBody.querySelector('[data-role="select-all-removals"]');
  if (allRemovals) { allRemovals.checked = removed.length > 0 && selectedRemovals.size === removed.length; allRemovals.indeterminate = selectedRemovals.size > 0 && selectedRemovals.size < removed.length; }
  if (modified.length) el.syncDiffBody.appendChild(buildSyncModSection(isUpload ? "Will overwrite in Gist" : "Will overwrite locally", modified));

  const dest = isUpload ? "in Gist" : "locally";
  if (settings.length) el.syncDiffBody.appendChild(buildSyncSettingsSection(`Settings — will overwrite ${dest}`, settings));
  if (tagCount) el.syncDiffBody.appendChild(buildSyncFolderSection(`Tags — will overwrite ${dest}`, diff.tags.added, diff.tags.modified, []));
  if (folderCount) el.syncDiffBody.appendChild(buildSyncFolderSection(`Folders — will overwrite ${dest}`, fo.added, fo.modified, foRemoved));
  if (vfCount) el.syncDiffBody.appendChild(buildSyncFolderSection(`Watch Later lists — will overwrite ${dest}`, vf.added, vf.modified, vfRemoved));
  if (vidsCount) el.syncDiffBody.appendChild(buildSyncVideoSection(`Videos — merged ${dest}`, vids, dest));

  el.syncDiffApply.textContent = isUpload ? "Apply upload" : "Apply download";
  el.syncDiffApply.disabled = totalChanges === 0;
  openDialog(el.syncDiffModal);
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
  const section = document.createElement('section');
  section.className = 'scan-diff-section';
  section.appendChild(buildDiffSectionHeader(title, 'mod', vids.added + vids.modified + (vids.removed || 0)));
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Review ${items.length} video changes (${vids.removed || 0} removals)`;
  details.appendChild(summary);
  const all = document.createElement('label');
  all.className = 'scan-diff-row scan-diff-selectall';
  all.innerHTML = `<input class="ui-check" type="checkbox" data-role="select-all-videos" ${!syncSkipAllVideos && !syncSkipVideoIds.size ? 'checked' : ''} /> Apply video changes — uncheck to keep all videos unchanged ${escapeHtml(dest)}`;
  details.appendChild(all);
  all.querySelector('input').indeterminate = !syncSkipAllVideos && syncSkipVideoIds.size > 0;
  const list = document.createElement('div');
  list.className = 'scan-diff-list scan-diff-videos';
  details.appendChild(list);
  const more = document.createElement('button');
  more.className = 'btn btn-ghost';
  more.type = 'button';
  let shown = 0;
  const append = () => {
    const fragment = document.createDocumentFragment();
    for (const item of items.slice(shown, shown + 100)) {
      const row = document.createElement('label');
      row.className = 'scan-diff-row';
      row.innerHTML = `<input class="ui-check" type="checkbox" data-video-id="${escapeHtml(item.id)}" ${!syncSkipAllVideos && !syncSkipVideoIds.has(item.id) ? 'checked' : ''} /><span class="scan-diff-text"><b>${escapeHtml(item.title)}</b><span class="scan-diff-sub">${escapeHtml([item.author, describeVideoChange(item)].filter(Boolean).join(' · '))}</span></span>`;
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    shown = Math.min(items.length, shown + 100);
    more.textContent = `Show more (${shown} of ${items.length})`;
    more.hidden = shown >= items.length;
  };
  more.addEventListener('click', append);
  details.appendChild(more);
  details.addEventListener('toggle', () => { if (details.open && shown === 0) append(); });
  section.appendChild(details);
  return section;
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
      `<input class="ui-check" type="checkbox" data-role="select-all-removals"${defaultChecked ? " checked" : ""} /> <span>Select all for removal</span>`;
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
      ? `<input class="ui-check" type="checkbox" data-remove-id="${escapeHtml(it.id)}"${defaultChecked ? " checked" : ""} />${text}`
      : text;
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

// ---------- Events ----------

function bindEvents() {
  bindRecoveryControls();
  bindKeyboardControls();
  bindDialogs();
  bindSelectionControls();
  // A broken avatar becomes the first-letter circle (§5).
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('ui-avatar')) return;
    const fallback = document.createElement('span');
    fallback.className = image.className;
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = image.dataset.letter || '?';
    image.replaceWith(fallback);
  }, true);
  el.viewRemovedBtn.addEventListener('click', () => setView('removed'));
  el.videoLoadMoreBtn.addEventListener('click', () => {
    pendingVideoPage.limit += 60;
    renderVideoList(pendingVideoPage.list, pendingVideoPage.mode, pendingVideoPage.container);
  });
  el.folderList.addEventListener('keydown', event => {
    if (event.target.matches('.folder-item') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); }
  });

  // A group only opens/closes; any other entry selects it. Changing folder
  // clears the chip filters and the selection (§6, §7).
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
    if (d.selected === li.dataset.folderId) return;
    d.select(li.dataset.folderId);
    if (currentView !== "watchlater") resetVariableFilters(); // channel filters are per-folder-view
    channelSel.clear();
    videoSel.clear();
    render();
  });

  // Drag and drop onto the sidebar (§10), delegated on the list so the
  // per-render rebuild doesn't re-attach listeners:
  //  - channel rows (or the selection they're part of) onto a real folder that
  //    can hold channels — not All/Filed, not a group;
  //  - folders onto folders (Custom sort only): zones 25/50/25 → before /
  //    into / after. An invalid nesting still shows where it would land and is
  //    refused on drop.
  let folderDragSrcId = null;
  const clearDropMarks = () => {
    el.folderList.querySelectorAll(".drop-into, .drop-before, .drop-after").forEach((x) =>
      x.classList.remove("drop-into", "drop-before", "drop-after"));
  };
  const rowDropTarget = (li) => {
    const id = li.dataset.folderId;
    return currentView === "channels" && state.folders[id] && !folderHasChildren(id, state.folders) ? id : null;
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
    e.target.closest(".folder-item")?.classList.remove("dragging");
    clearDropMarks();
    folderDragSrcId = null;
  });

  el.folderList.addEventListener("dragover", (e) => {
    const li = e.target.closest(".folder-item");
    clearDropMarks();
    if (!li) return;
    if (e.dataTransfer.types.includes(CHANNEL_DRAG_TYPE)) {
      if (!rowDropTarget(li)) return; // no preventDefault: the drop is refused
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("drop-into");
      return;
    }
    if (!folderDragSrcId) return;
    const intent = computeFolderDropIntent(folderDragSrcId, li.dataset.folderId, e.clientY, li);
    if (!intent) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    li.classList.add(`drop-${intent.zone}`);
  });

  el.folderList.addEventListener("dragleave", (e) => {
    if (!el.folderList.contains(e.relatedTarget)) clearDropMarks();
  });

  el.folderList.addEventListener("drop", (e) => {
    const li = e.target.closest(".folder-item");
    clearDropMarks();
    if (!li) return;
    const rows = e.dataTransfer.getData(CHANNEL_DRAG_TYPE);
    if (rows) {
      const folderId = rowDropTarget(li);
      if (!folderId) return;
      e.preventDefault();
      moveChannels(JSON.parse(rows), folderId);
      return;
    }
    if (!folderDragSrcId) return;
    const intent = computeFolderDropIntent(folderDragSrcId, li.dataset.folderId, e.clientY, li);
    if (!intent) return;
    e.preventDefault();
    if (!intent.valid) { toast("Only one level of nesting.", { error: true }); return; }
    performFolderDrop(folderDragSrcId, li.dataset.folderId, intent);
  });

  // Rows drag onto folders: the row, or the whole selection it's part of.
  el.channelGrid.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".channel-row");
    if (!row) return;
    const ids = rowTargets(row.dataset.channelId);
    e.dataTransfer.setData(CHANNEL_DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = ids.length > 1 ? plural(ids.length, "channel") : state.channels[ids[0]]?.name || "1 channel";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);
    closeFloating();
    for (const id of ids) el.channelGrid.querySelector(`[data-channel-id="${CSS.escape(id)}"]`)?.classList.add("dragging");
  });
  el.channelGrid.addEventListener("dragend", () => {
    el.channelGrid.querySelectorAll(".channel-row.dragging").forEach((row) => row.classList.remove("dragging"));
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
    } else if (role === "filter-tracked") {
      filterTracked = toggleTriState(filterTracked, negative);
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
  el.updateReloadBtn.addEventListener("click", reloadExtension);
  el.updatePullBtn.addEventListener("click", runNativePull);
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
  const activateVideoChip = (target, negative) => {
    target = target.closest("[data-role]");
    const role = target?.dataset.role;
    if (role === "filter-unwatched") toggleWatchedChip(negative);
    else if (role === "filter-kind") {
      toggleChipFilter(activeKindFilters, excludedKindFilters, target.dataset.kind, negative);
      renderActiveVideoView();
    } else return false;
    return true;
  };
  el.videoFilters.addEventListener("click", (e) => activateVideoChip(e.target, false));
  el.videoFilters.addEventListener("contextmenu", (e) => {
    if (activateVideoChip(e.target, true)) e.preventDefault();
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
    const ids = vids.filter((v) => !v.watched).map((v) => v.id);
    if (!ids.length) { toast("Every video shown is already watched."); return; }
    const ok = await confirmDialog({ title: `Mark ${plural(ids.length, "video")} as watched?`, text: "Every unwatched video shown in this view is marked watched. Undo is available right after.", okLabel: "Mark watched" });
    if (ok) await setVideosWatched(ids, true);
  });

  el.videoFetchAllBtn.addEventListener("click", () => {
    const tracked = trackedChannelIds(null);
    if (!tracked.length) {
      el.statusText.textContent = "No tracked channels — turn on Track first.";
      return;
    }
    openFetchVideosModal(null);
  });
  el.fetchVideosModal.addEventListener("change", updateFetchVideosSummary);
  el.fetchVideosCancel.addEventListener("click", () => el.fetchVideosModal.close());
  el.fetchVideosStart.addEventListener("click", () => {
    const opts = readFetchVideosForm();
    if (!opts.channelIds.length || !opts.kinds.length) return;
    el.fetchVideosModal.close();
    fetchAllVideos(opts.channelIds, opts);
  });

  // Video cards (New / Removed / Watch Later): the selection gestures (§6),
  // the card's own buttons (on a selected card they act on the selection),
  // and a plain click opens the video and clears the selection.
  const onVideoClick = async (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    const id = card.dataset.videoId;
    const v = state.videos[id];
    if (!v) return;
    const mod = selectionModifierPressed(e, controls);
    if (mod || e.shiftKey) {
      e.preventDefault();
      videoSel.click(id, currentVideoOrder(), { mod, shift: e.shiftKey });
      return;
    }
    const action = e.target.closest("[data-action]")?.dataset.action;
    const targets = videoSel.targetsFor(id);
    if (action === "restore") return setVideosHidden(targets, false);
    if (action === "hide") return setVideosHidden(targets, true);
    if (action === "toggle-watched") return setVideosWatched(targets, !v.watched);
    if (action === "remove") return removeFromWatchLater(targets);
    if (action) return;
    if (videoSel.size) videoSel.clear();
    if (!e.target.closest("a[href]")) openVideo(id, false);
  };
  const onVideoAuxClick = (e) => {
    if (e.button !== 1) return;
    const card = e.target.closest(".video-card");
    if (!card || e.target.closest("[data-action]")) return;
    e.preventDefault();
    if (e.target.closest("a[href]")) { chrome.tabs.create({ url: e.target.closest("a[href]").href, active: false }); return; }
    openVideo(card.dataset.videoId, true);
  };
  // Right-click: inside a multi-selection → the bulk menu; otherwise the
  // selection resets to that card and its own menu shows (§8). Actions look the
  // video up again when clicked — a refresh can replace the record meanwhile.
  const onVideoContextMenu = (e) => {
    const card = e.target.closest(".video-card");
    if (!card) return;
    e.preventDefault();
    const id = card.dataset.videoId;
    const v = state.videos[id];
    if (!v) return;
    const at = { x: e.clientX, y: e.clientY };
    if (videoSel.has(id) && videoSel.size > 1) { showVideoBulkContextMenu(at, [...videoSel.ids]); return; }
    videoSel.set([id], id);
    showVideoContextMenu(at, id);
  };
  for (const grid of [el.videoFeed, el.watchLaterGrid]) {
    grid.addEventListener("click", onVideoClick);
    grid.addEventListener("auxclick", onVideoAuxClick);
    grid.addEventListener("contextmenu", onVideoContextMenu);
    // Shift-click never smears a text selection across cards.
    grid.addEventListener("mousedown", (e) => { if (e.shiftKey && e.target.closest(".video-card")) e.preventDefault(); });
  }

  el.clearFiltersBtn.addEventListener("click", clearAllFilters);

  el.listTableHeader.addEventListener("click", (e) => {
    if (e.target.closest(".col-resizer")) return; // a resize drag, not a sort
    const col = e.target.closest(".lth-sort-col");
    if (!col) return;
    const key = col.dataset.sort;
    // off → the column's natural first direction → the other one → off.
    const first = SORT_FIRST_DIR[key];
    const other = first === "desc" ? "asc" : "desc";
    const current = sortDirOf(key);
    const next = current === "none" ? first : current === first ? other : "none";
    setSortDirOf(key, next);
    // Turning a column on makes it the primary key; turning it off leaves the
    // remaining columns in the order they were already in.
    if (next !== "none") sortPriority = [key, ...sortPriority.filter((k) => k !== key)];
    chrome.storage.local.set({ sortDate, sortCount, sortSubs, sortFolder, sortPriority });
    renderGrid();
  });

  el.scanBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.youtube.com/feed/channels" });
  });

  el.refreshBtn.addEventListener('click', () => runRefresh());
  el.retryRefreshBtn.addEventListener('click', () => runRefresh(failedRefreshIds));
  // Stop while a job runs; × dismisses a finished job's result line.
  el.jobStopBtn.addEventListener('click', async () => {
    if (state.jobProgress) {
      el.jobStopBtn.disabled = true;
      await requestWorker('CANCEL_JOB');
      el.jobStopBtn.disabled = false;
      el.jobStatusText.textContent = 'Stopping…';
    } else {
      jobResult = null;
      renderJobStatus();
    }
  });

  el.fillAvatarsBtn.addEventListener("click", async () => {
    // Persist a just-typed key so the fill works without a separate Save first.
    state.apiKey = el.apiKeyInput.value.trim();
    await persistSettings({ apiKey: state.apiKey });

    el.fillAvatarsBtn.disabled = true;
    el.fillAvatarsStatus.textContent = "Fetching missing avatars…";
    const res = await chrome.runtime.sendMessage({ type: "FILL_MISSING_AVATARS" });
    await loadState();
    render();
    el.fillAvatarsBtn.disabled = false;
    el.fillAvatarsStatus.textContent = summarizeAvatarFill(res);
  });

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

  const isInteractiveTarget = (t) => t.closest(".chip, .ui-select, button, a[href], input");

  // Rows (§5, §6): the selection gestures first, then the row's own controls —
  // each acting on the whole selection when the row is part of it — and a
  // plain click anywhere else opens the channel and clears the selection.
  el.channelGrid.addEventListener("mousedown", (e) => {
    if (e.shiftKey && e.target.closest("[data-channel-id]")) e.preventDefault(); // no shift-click smear
  });

  el.channelGrid.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-channel-id]");
    if (!row) return;
    const channelId = row.dataset.channelId;
    const ch = state.channels[channelId];
    if (!ch) return;

    const mod = selectionModifierPressed(e, controls);
    if (mod || e.shiftKey) {
      e.preventDefault();
      channelSel.click(channelId, getFilteredChannels().map((c) => c.id), { mod, shift: e.shiftKey });
      return;
    }

    const control = e.target.closest("[data-role]");
    const role = control?.dataset.role;
    const targets = rowTargets(channelId);
    if (role === "remove-tag") { await setChannelTag(targets, control.dataset.tagId, false); return; }
    if (role === "add-tag") { openTagPopover(targets, control); return; }
    const flagKey = { "toggle-active": "active", "toggle-finished": "finished", "toggle-track": "trackVideos" }[role];
    if (flagKey) { await setChannelFlag(targets, flagKey, !ch[flagKey]); return; }
    if (role === "set-language") {
      if (control.getAttribute("aria-expanded") === "true") { closeFloating(); return; }
      const current = canonicalLanguage(ch.language);
      openListbox(control, { options: languageListboxOptions(), value: LANGUAGES.includes(current) ? current : "", minWidth: false,
        onPick: (value) => setChannelLanguage(targets, value || null) });
      return;
    }
    if (role === "move-folder") {
      if (control.getAttribute("aria-expanded") === "true") { closeFloating(); return; }
      openListbox(control, { options: folderListboxOptions(), value: ch.folderId || "unsorted", onPick: (value) => moveChannels(targets, value) });
      return;
    }

    if (!isInteractiveTarget(e.target)) {
      if (channelSel.size) channelSel.clear();
      openChannel(channelId);
    }
  });

  // Middle-click: open in a background tab without leaving the dashboard.
  el.channelGrid.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const row = e.target.closest("[data-channel-id]");
    if (!row || isInteractiveTarget(e.target)) return;
    e.preventDefault();
    openChannel(row.dataset.channelId, true);
  });

  // Right-click (§8): inside a multi-selection → the bulk menu; otherwise the
  // selection resets to that row and the row's own menu shows.
  el.channelGrid.addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-channel-id]");
    if (!row) return;
    e.preventDefault();
    const channelId = row.dataset.channelId;
    if (!state.channels[channelId]) return;
    const at = { x: e.clientX, y: e.clientY };
    if (channelSel.has(channelId) && channelSel.size > 1) { showBulkContextMenu(at, [...channelSel.ids]); return; }
    channelSel.set([channelId], channelId);
    showChannelContextMenu(at, channelId, row);
  });

  el.languageSearch.addEventListener("input", renderLanguageCatalog);
  el.languageCatalog.addEventListener("change", event => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    if (input.checked) languagesDraft.add(input.value); else languagesDraft.delete(input.value);
    el.languageSelection.textContent = languagesDraft.size ? [...languagesDraft].join(" · ") : "No active languages";
  });
  el.languagePresetBtn.addEventListener("click", () => {
    languagesDraft = new Set(DEFAULT_LANGUAGES);
    el.languageSearch.value = "";
    renderLanguageCatalog();
  });
  // Settings modal
  el.settingsBtn.addEventListener("click", () => openSettings());
  el.settingsCancel.addEventListener("click", () => el.settingsModal.close());
  el.settingsSave.addEventListener("click", async () => {
    if (recordingShortcut) { sayShortcut('Finish recording or press Escape before saving.', true); return; }
    const parsed = [...languagesDraft];
    el.settingsSave.disabled = true;
    try {
      await persistSettings({ apiKey: el.apiKeyInput.value.trim(), gistToken: el.gistTokenInput.value.trim(), languages: parsed });
      await chrome.storage.local.set({ controls: normalizeControls(controlsDraft) });
      controls = normalizeControls(controlsDraft);
      await loadState();
      render();
      el.settingsSave.disabled = false;
      el.settingsModal.close();
      el.statusText.textContent = 'Settings saved.';
    } catch (error) { el.settingsStatus.textContent = `Could not save: ${error.message}`; }
    finally { el.settingsSave.disabled = false; }
  });

  // Both ways in run this: the Settings modal's buttons and the sidebar's ↑/↓.
  // What differs is only where it can talk — the modal's status line exists
  // while the modal is open, the toolbar's is what's on screen otherwise — and
  // where the token comes from: inside Settings it may have just been typed and
  // not saved yet, everywhere else `state` is the only truth there is.
  async function startSyncFlow(direction) {
    const inSettings = el.settingsModal.open;
    if (inSettings) {
      state.gistToken = el.gistTokenInput.value.trim();
      await persistSettings({ gistToken: state.gistToken });
    }
    const say = (msg) => { (inSettings ? el.syncStatus : el.statusText).textContent = msg; };

    if (!state.gistToken) {
      say(inSettings ? "Enter a GitHub token first." : "Add a GitHub token in Settings to sync.");
      return;
    }
    // Disable all four: the two pairs are the same operation, and a second click
    // during the round trip would open a review computed against stale data.
    const btns = [el.syncUploadBtn, el.syncDownloadBtn, el.quickUploadBtn, el.quickDownloadBtn];
    btns.forEach((b) => (b.disabled = true));
    say("Fetching diff…");
    const diff = await requestWorker("FETCH_SYNC_DIFF", { direction });
    btns.forEach((b) => (b.disabled = false));
    say("");
    if (!diff?.ok) {
      say(diff?.error || "Failed to fetch diff.");
      return;
    }
    if (inSettings) el.settingsModal.close();
    openSyncDiffModal(diff);
  }

  el.syncUploadBtn.addEventListener("click", () => startSyncFlow("upload"));
  el.syncDownloadBtn.addEventListener("click", () => startSyncFlow("download"));
  el.quickUploadBtn.addEventListener("click", () => startSyncFlow("upload"));
  el.quickDownloadBtn.addEventListener("click", () => startSyncFlow("download"));

  el.addFolderBtn.addEventListener("click", () => createFolder());

  // Right-click on a folder (channel folders or Watch Later lists per view);
  // All, Filed and the pinned Unfiled have no actions.
  el.folderList.addEventListener("contextmenu", (e) => {
    const li = e.target.closest(".folder-item");
    if (!li) return;
    e.preventDefault();
    const id = li.dataset.folderId;
    if (isVirtualFolderId(id) || id === "unsorted") return;
    showFolderContextMenu({ x: e.clientX, y: e.clientY }, id, li);
  });

  // Right-click on a filter chip excludes it. A tag's menu (rename, color,
  // delete) is on **shift**+right-click, since plain right-click is half the
  // filter UI.
  el.tagFilterBar.addEventListener("contextmenu", (e) => {
    const chip = e.target.closest("[data-role]");
    if (!chip) return;
    const tagId = chip.dataset.role === "filter-tag" ? chip.dataset.tagId : null;
    if (tagId && e.shiftKey) {
      e.preventDefault();
      showTagContextMenu({ x: e.clientX, y: e.clientY }, tagId);
      return;
    }
    if (activateFilterChip(chip, true)) e.preventDefault();
  });

  el.apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.settingsSave.click();
  });
  el.gistTokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.settingsSave.click();
  });

  el.clearDataBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear the library?', text: 'Clear all channels, folders, tags, videos, and Watch Later lists? A local recovery snapshot will be saved first. Settings stay on this device.', okLabel: 'Clear library', danger: true });
    if (!ok) return;
    const res = await requestWorker('CLEAR_LIBRARY');
    if (!res.ok) { el.backupStatus.textContent = res.error; return; }
    hideUndo();
    await loadState();
    currentFolderId = currentListId = 'all';
    channelSel.clear();
    videoSel.clear();
    clearAllFilters();
    el.settingsModal.close();
    el.statusText.textContent = 'Library cleared. Restore it from Settings → Local backups.';
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
    applyingReview = true;
    const res = await requestWorker("APPLY_SCAN", { removeIds });
    applyingReview = false;
    el.scanDiffApply.disabled = false;
    closeDialog(el.scanDiffModal);
    await loadState();
    render();
    el.statusText.textContent = res?.ok
      ? `Scan applied: +${res.added} added, ${res.modified} updated, −${res.removed} removed.`
      : res?.error || "Could not apply scan.";
  });

  // Discard drops the pending scan; Esc / a backdrop click only sets it aside
  // (the review banner brings it back).
  el.scanDiffCancel.addEventListener("click", async () => {
    closeDialog(el.scanDiffModal);
    await requestWorker("DISCARD_SCAN");
  });

  // Playlist import dialog
  el.playlistImportApply.addEventListener("click", async () => {
    const moveIds = Array.from(
      el.playlistImportBody.querySelectorAll("input[data-move-id]:checked")
    ).map((box) => box.dataset.moveId);
    const newListName = el.playlistImportName.value.trim();
    el.playlistImportApply.disabled = true;
    el.statusText.textContent = "Importing playlist…";
    applyingReview = true;
    const res = await requestWorker("APPLY_PLAYLIST_IMPORT", { listName: newListName, moveIds });
    applyingReview = false;
    el.playlistImportApply.disabled = false;
    closeDialog(el.playlistImportModal);
    await loadState();
    if (res?.ok) {
      currentView = "watchlater";
      currentListId = res.listId;
      searchQuery = "";
      el.searchInput.value = "";
      videoSel.clear();
      channelSel.clear();
      await chrome.storage.local.set({ currentView });
      el.statusText.textContent = `Imported ${res.added + res.moved} video${res.added + res.moved === 1 ? "" : "s"} into the list.`;
    } else {
      el.statusText.textContent = res?.error || "Could not import playlist.";
    }
    render();
  });

  el.playlistImportCancel.addEventListener("click", async () => {
    closeDialog(el.playlistImportModal);
    await requestWorker("DISCARD_PLAYLIST_IMPORT");
  });

  // Channel removals affect video pruning, so refresh the complete preview.
  el.syncDiffBody.addEventListener('change', async event => {
    const box = event.target;
    const role = box.dataset.role;
    if (role === 'select-all-videos') {
      syncSkipAllVideos = !box.checked;
      syncSkipVideoIds.clear();
      el.syncDiffBody.querySelectorAll('[data-video-id]').forEach(input => { input.checked = box.checked; });
      return;
    }
    if (box.dataset.videoId) {
      if (syncSkipAllVideos) {
        syncSkipVideoIds = new Set(pendingSyncDiff.videos.items.map(item => item.id));
        syncSkipAllVideos = false;
      }
      if (box.checked) syncSkipVideoIds.delete(box.dataset.videoId); else syncSkipVideoIds.add(box.dataset.videoId);
      const all = el.syncDiffBody.querySelector('[data-role="select-all-videos"]');
      if (all) { all.checked = !syncSkipVideoIds.size; all.indeterminate = syncSkipVideoIds.size > 0 && syncSkipVideoIds.size < pendingSyncDiff.videos.items.length; }
      return;
    }
    if (role !== 'select-all-removals' && !box.dataset.removeId) return;
    if (role === 'select-all-removals') el.syncDiffBody.querySelectorAll('[data-remove-id]').forEach(input => { input.checked = box.checked; });
    const removeIds = [...el.syncDiffBody.querySelectorAll('[data-remove-id]:checked')].map(input => input.dataset.removeId);
    const request = ++syncReviewRequest;
    el.syncDiffApply.disabled = true;
    const diff = await requestWorker('FETCH_SYNC_DIFF', { direction: pendingSyncDiff.direction, removeIds });
    if (request !== syncReviewRequest || !pendingSyncDiff) return;
    if (!diff.ok) { el.syncDiffWarning.hidden = false; el.syncDiffWarning.textContent = diff.error; return; }
    openSyncDiffModal(diff, { keepChoices: true });
  });

  el.syncDiffApply.addEventListener("click", async () => {
    if (!pendingSyncDiff) return;
    const { direction } = pendingSyncDiff;
    const removeIds = Array.from(
      el.syncDiffBody.querySelectorAll("input[data-remove-id]:checked")
    ).map((box) => box.dataset.removeId);
    // Video rows are ticked by default, so it's the *unticked* ones that carry a
    // decision: leave those alone on the target.
    const skipVideoIds = [...syncSkipVideoIds];

    el.syncDiffApply.disabled = true;
    el.statusText.textContent = direction === "upload" ? "Uploading…" : "Downloading…";

    applyingReview = true;
    const res = direction === "upload"
      ? await requestWorker("APPLY_UPLOAD", { removeFromGistIds: removeIds, skipVideoIds, reviewToken: pendingSyncDiff.reviewToken, skipAllVideos: syncSkipAllVideos })
      : await requestWorker("APPLY_DOWNLOAD", { removeLocalIds: removeIds, skipVideoIds, reviewToken: pendingSyncDiff.reviewToken, skipAllVideos: syncSkipAllVideos });
    applyingReview = false;

    el.syncDiffApply.disabled = false;
    if (res?.stale) {
      openSyncDiffModal(res.diff, { keepChoices: true });
      el.syncDiffWarning.hidden = false;
      el.syncDiffWarning.textContent = res.error;
      el.statusText.textContent = 'Review updated changes.';
      return;
    }
    closeDialog(el.syncDiffModal);

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

  el.syncDiffCancel.addEventListener("click", () => closeDialog(el.syncDiffModal));
}

// ---------- Dialogs (§13) ----------
// Kit dialogs: <dialog class="ui-dialog"> opened with showModal() (focus trap,
// top layer), backdrop click and Esc close, focus returns to the opener. Busy
// dialogs (an apply in flight, a shortcut being recorded) refuse to close.
let applyingReview = false;

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function bindDialogs() {
  bindDialog(el.settingsModal, { busy: () => !!recordingShortcut || escapeEndedRecording || el.settingsSave.disabled });
  // The Escape that cancelled a recording is spent once its key comes back up.
  document.addEventListener('keyup', (e) => { if (e.key === 'Escape') escapeEndedRecording = false; }, true);
  el.settingsModal.addEventListener("close", () => { stopShortcutRecording(); recordingShortcut = null; });
  bindDialog(el.fetchVideosModal);
  for (const dialog of [el.scanDiffModal, el.playlistImportModal, el.syncDiffModal]) bindDialog(dialog, { busy: () => applyingReview });
  // Closing the sync review in any way forgets it; a newer preview request
  // still in flight is dropped.
  el.syncDiffModal.addEventListener("close", () => { syncReviewRequest++; pendingSyncDiff = null; });
  for (const dialog of [el.scanDiffModal, el.playlistImportModal]) dialog.addEventListener("close", renderReviewBanner);
  el.reviewBannerBtn.addEventListener("click", () => {
    if (state.pendingScan) openScanDiffModal(state.pendingScan);
    else if (state.pendingPlaylistImport) openPlaylistImportModal(state.pendingPlaylistImport);
  });
}

// "A scan is waiting for review. [Review]" — shown while a pending scan or
// playlist import was set aside with Esc (§13).
function renderReviewBanner() {
  const scan = state.pendingScan && !el.scanDiffModal.open;
  const playlist = state.pendingPlaylistImport && !el.playlistImportModal.open;
  el.reviewBanner.hidden = !scan && !playlist;
  el.reviewBannerText.textContent = scan ? "A scan is waiting for review." : playlist ? "A playlist import is waiting for review." : "";
}

function renderShortcutHints() {
  const searchKey = controls.enabled && controls.bindings.search;
  el.searchInput.title = searchKey ? `Search library (${formatShortcut(searchKey, IS_MAC)})` : 'Search library';
}

function renderLanguageCatalog() {
  const custom = [...new Set([...LANGUAGES, ...Object.values(state.channels).map(ch => canonicalLanguage(ch.language)).filter(Boolean)])]
    .filter(name => !LANGUAGE_CATALOG.some(language => language.name === name))
    .map(name => ({ code: "", name, native: "Previously used" }));
  const catalog = [...LANGUAGE_CATALOG, ...custom].filter(language => languageCatalogMatches(language, el.languageSearch.value));
  el.languageSelection.textContent = languagesDraft.size ? [...languagesDraft].join(" · ") : "No active languages";
  el.languageCatalog.innerHTML = catalog.length ? catalog.map(language => `
    <label class="language-choice"><input class="ui-check" type="checkbox" value="${escapeHtml(language.name)}" ${languagesDraft.has(language.name) ? "checked" : ""}>
    <span><strong>${escapeHtml(langLabel(language.name))}</strong><small>${escapeHtml(language.native)}</small></span></label>`).join("")
    : '<p class="field-hint">No matching languages.</p>';
}

function openSettings(tab = 'general') {
  controlsDraft = clone(controls);
  recordingShortcut = null;
  el.apiKeyInput.value = state.apiKey || '';
  el.gistTokenInput.value = state.gistToken || '';
  languagesDraft = new Set(LANGUAGES);
  el.languageSearch.value = "";
  renderLanguageCatalog();
  el.fillAvatarsStatus.textContent = '';
  el.settingsStatus.textContent = 'Save to apply your preferences.';
  renderSyncStatus();
  renderControlsSettings();
  sayShortcut('Use letters, numbers, or punctuation, with optional modifiers. Escape cancels recording.');
  selectSettingsTab(tab);
  escapeEndedRecording = false;
  openDialog(el.settingsModal);
  document.querySelector(`[data-settings-tab="${tab}"]`)?.focus();
  refreshBackupList();
}

function selectSettingsTab(tab) {
  stopShortcutRecording();
  document.querySelectorAll('[data-settings-tab]').forEach(button => {
    const selected = button.dataset.settingsTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== tab; });
  document.querySelector('.settings-content').scrollTop = 0;
}

function sayShortcut(message, error = false) {
  el.shortcutStatus.textContent = message;
  el.shortcutStatus.classList.toggle('error', error);
}

function renderControlsSettings() {
  el.shortcutsEnabledInput.checked = controlsDraft.enabled;
  selectionModifierSelect.value = controlsDraft.selectionModifier;
  // "Everyday controls" names the selection modifier the user picked; Select
  // all is always ⌘/Ctrl+A.
  const modName = controlsDraft.selectionModifier === 'alt' ? (IS_MAC ? 'Option' : 'Alt') : (IS_MAC ? '⌘' : 'Ctrl');
  document.querySelectorAll('.controls-reference .mod-label').forEach((label, i, all) => {
    label.textContent = i === all.length - 1 ? (IS_MAC ? '⌘' : 'Ctrl') : modName;
  });
  el.wheelAdjustsNumbersInput.checked = controlsDraft.wheelAdjustsNumbers;
  let group = '';
  el.shortcutList.innerHTML = SHORTCUTS.map(action => {
    const heading = group !== action.group ? `<h4 class="shortcut-group">${action.group}</h4>` : '';
    group = action.group;
    return `${heading}<div class="shortcut-row"><span>${action.label}</span><button type="button" class="shortcut-record" data-record-shortcut="${action.id}" aria-label="Change shortcut for ${action.label}">${escapeHtml(formatShortcut(controlsDraft.bindings[action.id], IS_MAC))}</button><button type="button" class="shortcut-clear" data-clear-shortcut="${action.id}" aria-label="Disable shortcut for ${action.label}" ${controlsDraft.bindings[action.id] ? '' : 'disabled'}>Clear</button></div>`;
  }).join('');
}

// Escape cancels a recording — and must not also close Settings, whatever
// order the browser runs the keydown and the dialog's cancel in.
let escapeEndedRecording = false;

function stopShortcutRecording() {
  if (!recordingShortcut) return;
  const id = recordingShortcut;
  recordingShortcut = null;
  const button = el.shortcutList.querySelector(`[data-record-shortcut="${id}"]`);
  if (button) { button.classList.remove('recording'); button.textContent = formatShortcut(controlsDraft.bindings[id], IS_MAC); }
}

function bindShortcutSettings() {
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => { selectSettingsTab(button.dataset.settingsTab); button.focus(); });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  });
  el.shortcutsEnabledInput.addEventListener('change', () => { controlsDraft.enabled = el.shortcutsEnabledInput.checked; });
  el.wheelAdjustsNumbersInput.addEventListener('change', () => { controlsDraft.wheelAdjustsNumbers = el.wheelAdjustsNumbersInput.checked; });
  el.resetControlsBtn.addEventListener('click', () => {
    stopShortcutRecording(); controlsDraft = normalizeControls(); renderControlsSettings();
    sayShortcut('Defaults restored. Save to apply, or Cancel to keep your current controls.');
  });
  el.shortcutList.addEventListener('click', event => {
    const record = event.target.closest('[data-record-shortcut]');
    const clear = event.target.closest('[data-clear-shortcut]');
    stopShortcutRecording();
    if (record) {
      recordingShortcut = record.dataset.recordShortcut;
      record.classList.add('recording'); record.textContent = 'Press keys…'; record.focus();
      sayShortcut('Press your new shortcut. Escape cancels; Backspace or Delete disables it.');
    } else if (clear) {
      const id = clear.dataset.clearShortcut;
      controlsDraft.bindings[id] = null; renderControlsSettings();
      el.shortcutList.querySelector(`[data-record-shortcut="${id}"]`).focus();
      sayShortcut('Shortcut disabled. Save to apply this change.');
    }
  });
  document.addEventListener('focusin', event => {
    if (recordingShortcut && event.target.dataset.recordShortcut !== recordingShortcut) stopShortcutRecording();
  });
  document.addEventListener('keydown', event => {
    if (!recordingShortcut || !el.settingsModal.open) return;
    if (event.key === 'Tab') { stopShortcutRecording(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || event.isComposing) return;
    if (event.key === 'Escape') { escapeEndedRecording = true; stopShortcutRecording(); sayShortcut('Recording cancelled. Your shortcut is unchanged.'); return; }
    const id = recordingShortcut;
    const binding = ['Backspace', 'Delete'].includes(event.key) ? null : shortcutFromEvent(event, IS_MAC);
    if (!binding && !['Backspace', 'Delete'].includes(event.key)) return;
    const conflict = shortcutConflict(controlsDraft.bindings, id, binding);
    const error = bindingError(binding) || (conflict ? `Already used for “${conflict.label}”. Choose another shortcut or clear that binding first.` : '');
    if (error) { sayShortcut(error, true); return; }
    controlsDraft.bindings[id] = binding;
    recordingShortcut = null; renderControlsSettings();
    el.shortcutList.querySelector(`[data-record-shortcut="${id}"]`).focus();
    sayShortcut(`${binding ? 'Shortcut updated' : 'Shortcut disabled'}. Save to apply this change.`);
  }, true);
}

// Typing in a field never triggers a shortcut.
const isTypingTarget = (target) => target.isContentEditable || !!target.closest?.('input, textarea, select, [role="textbox"]');
// Menus, listboxes, popovers and dialogs own the keyboard while open.
const overlayOpen = () => floatingOpen() || !!document.querySelector('dialog[open], .modal:not([hidden])');

function runKeyboardShortcut(event) {
  if (!controls.enabled || event.defaultPrevented || event.repeat || event.isComposing) return;
  if (isTypingTarget(event.target) || overlayOpen()) return;
  const binding = shortcutFromEvent(event, IS_MAC);
  if (!binding) return;
  const action = SHORTCUTS.find(action => controls.bindings[action.id] === binding);
  if (!action) return;
  if (action.id === 'refresh' && el.refreshBtn.disabled) return;
  // Mod+Z undoes the last edit — whatever the undo toast describes (§9).
  if (action.id === 'undo') { if (triggerUndo()) event.preventDefault(); return; }
  event.preventDefault();
  if (action.id === 'search') { el.searchInput.focus(); el.searchInput.select(); }
  else if (['channels', 'new', 'watchlater', 'removed'].includes(action.id)) setView(action.id);
  else if (action.id === 'settings' || action.id === 'controls') openSettings(action.id === 'controls' ? 'controls' : 'general');
  else if (action.id === 'refresh') el.refreshBtn.click();
  else if (action.id === 'clearFilters') clearAllFilters();
}

function bindKeyboardControls() {
  bindShortcutSettings();
  // The mobile build's injected "Save from YouTube" panel is the one legacy
  // `.modal` overlay left: give it Esc, a focus trap and focus restore.
  const modals = [...document.querySelectorAll('.modal')];
  const focusable = modal => [...modal.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')].filter(node => node.tabIndex >= 0 && node.getClientRects().length);
  for (const modal of modals) {
    new MutationObserver(() => {
      if (!modal.hidden) {
        modal._opener = document.activeElement;
        if (!modal.contains(document.activeElement)) focusable(modal)[0]?.focus();
      } else if (modal._opener?.isConnected && !modals.some(other => !other.hidden)) modal._opener.focus();
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    const modal = modals.findLast(node => !node.hidden);
    if (event.key === 'Escape' && modal) { event.preventDefault(); modal.hidden = true; return; }
    if (event.key === 'Tab' && modal) {
      const nodes = focusable(modal), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    // Filter chips: Enter/Space = only these, Shift+Enter = exclude (§7).
    const chip = event.target.closest?.('.chip[data-role^="filter-"]');
    if (chip && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      chip.dispatchEvent(new MouseEvent(event.shiftKey ? 'contextmenu' : 'click', { bubbles: true, cancelable: true }));
      return;
    }
    runKeyboardShortcut(event);
  });
}

async function refreshBackupList() {
  const result = await requestWorker('LIST_BACKUPS');
  if (!result.ok) { el.backupStatus.textContent = result.error; return; }
  el.backupList.innerHTML = result.backups.length ? result.backups.map(backup =>
    `<div class="backup-row"><span>${escapeHtml(new Date(backup.createdAt).toLocaleString())}<small>${escapeHtml(backup.reason)} · ${backup.counts.channels} channels · ${backup.counts.videos} videos</small></span><button class="btn btn-ghost" data-backup-id="${escapeHtml(backup.id)}">Restore</button></div>`
  ).join('') : '<p class="field-hint">No local snapshots yet.</p>';
}

function bindRecoveryControls() {
  el.exportBackupBtn.addEventListener('click', async () => {
    const result = await requestWorker('EXPORT_BACKUP');
    if (!result.ok) { el.backupStatus.textContent = result.error; return; }
    if (chrome.runtime.exportBackup) {
      try { await chrome.runtime.exportBackup(result.backup); el.backupStatus.textContent = 'Choose Save to Files to keep your backup.'; }
      catch (error) { el.backupStatus.textContent = error.message; }
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mytube-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    el.backupStatus.textContent = 'Backup exported. API keys and GitHub tokens are excluded.';
  });
  el.importBackupBtn.addEventListener('click', () => el.backupFileInput.click());
  el.backupFileInput.addEventListener('change', async () => {
    const file = el.backupFileInput.files[0];
    el.backupFileInput.value = '';
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('This file exceeds the 50 MB import limit.');
      const backup = JSON.parse(await file.text());
      const preview = await requestWorker('PREVIEW_BACKUP', { backup });
      if (!preview.ok) throw new Error(preview.error);
      const ok = await confirmDialog({ title: 'Import this backup?', okLabel: 'Replace library',
        text: `Replace this device’s library with ${preview.counts.channels} channels, ${preview.counts.videos} videos, ${preview.counts.folders} folders, ${preview.counts.videoFolders} Watch Later lists, and ${preview.counts.tags} tags from “${file.name}”? The current library will be saved as a recovery snapshot first.` });
      if (!ok) return;
      const result = await requestWorker('RESTORE_BACKUP', { backup });
      if (!result.ok) throw new Error(result.error);
      await finishRestore();
    } catch (error) { el.backupStatus.textContent = `Import failed: ${error.message}`; }
  });
  el.createBackupBtn.addEventListener('click', async () => {
    const result = await requestWorker('CREATE_BACKUP');
    el.backupStatus.textContent = result.ok ? 'Local snapshot saved.' : result.error;
    await refreshBackupList();
  });
  el.backupList.addEventListener('click', async event => {
    const button = event.target.closest('[data-backup-id]');
    if (!button) return;
    const ok = await confirmDialog({ title: 'Restore this snapshot?', okLabel: 'Restore',
      text: `${button.parentElement.querySelector('span').firstChild.textContent} — ${button.parentElement.querySelector('small').textContent}. The current library will be saved as a recovery snapshot first.` });
    if (!ok) return;
    button.disabled = true;
    const result = await requestWorker('RESTORE_BACKUP', { backupId: button.dataset.backupId });
    if (!result.ok) { button.disabled = false; el.backupStatus.textContent = result.error; return; }
    await finishRestore();
  });
}

async function finishRestore() {
  hideUndo();
  await loadState();
  currentFolderId = currentListId = 'all';
  channelSel.clear();
  videoSel.clear();
  clearAllFilters();
  el.backupStatus.textContent = 'Library restored on this device. Sync remains manual.';
  await refreshBackupList();
}

// ---------- Folder / tag management (§11; every edit undoable, §9) ----------

const newFolderId = (name) => (slugify(name) || "folder") + "-" + Date.now().toString(36).slice(-4);

// New folder / list (sidebar button, or a folder's "New subfolder…"). Groups
// hold no items, so the first subfolder of a folder that holds items takes them.
async function createFolder(parentId = null) {
  const d = fdom();
  const parents = getTopLevelFoldersOrdered(d.folders).filter(([id]) => id !== "unsorted");
  const result = await promptDialog({
    title: parentId ? `New sub${d.noun} in “${d.folders[parentId]?.name || ""}”` : `New ${d.noun}`,
    placeholder: d.isList ? "e.g. Tutorials, Music, Later" : "e.g. Gaming, Science, Music",
    okLabel: "Create",
    select: parentId ? null : {
      label: `Inside ${d.noun} (optional)`,
      options: [{ value: "", label: "— None (top-level)" }, ...parents.map(([id]) => ({ value: id, label: folderLabel(id, d.folders) }))],
      value: "",
    },
    validate: (name) => (name ? "" : `Enter a ${d.noun} name.`),
  });
  if (!result) return;
  const parent = parentId || result.selectValue || null;
  if (parent && !d.folders[parent]) return;
  const id = newFolderId(result.value);
  const siblings = Object.values(d.folders).filter((f) => (parent ? f.parentId === parent : !f.parentId));
  d.folders[id] = { name: result.value, order: siblings.length, ...(parent ? { parentId: parent } : {}) };
  let movedItems = false;
  if (parent && !siblings.length) {
    for (const item of d.items()) {
      if ((item.folderId || "unsorted") === parent) { item.folderId = id; movedItems = true; }
    }
    d.collapsed.delete(parent);
  }
  render();
  await d.persist(`Created ${d.noun} “${result.value}”.`, movedItems);
}

async function renameFolder(id) {
  const d = fdom();
  const folder = d.folders[id];
  if (!folder || id === "unsorted") return;
  const result = await promptDialog({ title: `Rename ${d.noun}`, value: folder.name, okLabel: "Save",
    validate: (name) => (name ? "" : `Enter a ${d.noun} name.`) });
  if (!result || result.value === folder.name || !d.folders[id]) return;
  const old = folder.name;
  d.folders[id].name = result.value;
  render();
  await d.persist(`Renamed “${old}” to “${result.value}”.`);
}

async function moveFolderToTopLevel(id) {
  const d = fdom();
  const folder = d.folders[id];
  if (!folder?.parentId) return;
  applyFolderDrop(id, null, null);
  render();
  await d.persist(`Moved “${folder.name}” to the top level.`);
}

// Delete a folder/list from the active domain: its items (and its
// subfolders' items) move to Unfiled and its subfolders become top-level.
async function deleteFolder(id) {
  const d = fdom();
  const folder = d.folders[id];
  if (!folder || id === "unsorted") return;
  const childIds = getChildFolderIds(id, d.folders);
  const gone = new Set([id, ...childIds]);
  const items = d.items().filter((it) => gone.has(it.folderId || "unsorted"));
  const parts = [];
  if (items.length) parts.push(`Its ${plural(items.length, d.itemNoun)} move to Unfiled`);
  if (childIds.length) parts.push(`${parts.length ? "s" : "S"}ub${d.noun}s become top-level`);
  const ok = await confirmDialog({ title: `Delete “${folder.name}”?`, text: parts.length ? `${parts.join("; ")}.` : `The ${d.noun} is empty.`, okLabel: "Delete", danger: true });
  if (!ok || !d.folders[id]) return;
  for (const it of items) it.folderId = "unsorted";
  for (const childId of childIds) delete d.folders[childId].parentId;
  delete d.folders[id];
  if (d.selected === id || childIds.includes(d.selected)) d.select("all");
  render();
  await d.persist(`Deleted ${d.noun} “${folder.name}”.`, true);
}

async function renameTag(id) {
  const tag = state.tags[id];
  if (!tag) return;
  const result = await promptDialog({ title: "Rename tag", value: tag.name, okLabel: "Save",
    validate: (name) => (!name ? "Enter a tag name." : Object.entries(state.tags).some(([tid, t]) => tid !== id && t.name.toLowerCase() === name.toLowerCase()) ? "Another tag already has that name." : "") });
  if (!result || result.value === tag.name || !state.tags[id]) return;
  const old = tag.name;
  state.tags[id].name = result.value;
  render();
  await persistLibrary({ tags: state.tags }, { undo: `Renamed tag “${old}” to “${result.value}”.` });
}

async function setTagColor(id, color) {
  const tag = state.tags[id];
  if (!tag || tag.color === color) return;
  tag.color = color;
  render();
  await persistLibrary({ tags: state.tags }, { undo: `Changed the color of “${tag.name}”.` });
}

async function deleteTag(id) {
  const tag = state.tags[id];
  if (!tag) return;
  const used = Object.values(state.channels).filter((ch) => ch.tags?.includes(id)).length;
  const ok = await confirmDialog({ title: `Delete tag “${tag.name}”?`,
    text: used ? `It's removed from ${plural(used, "channel")}.` : "No channel uses it.", okLabel: "Delete", danger: true });
  if (!ok || !state.tags[id]) return;
  for (const ch of Object.values(state.channels)) {
    if (ch.tags?.includes(id)) ch.tags = ch.tags.filter((t) => t !== id);
  }
  delete state.tags[id];
  activeTagFilters.delete(id);
  excludedTagFilters.delete(id);
  render();
  await persistLibrary({ channels: state.channels, tags: state.tags }, { undo: `Deleted tag “${tag.name}”.` });
}

// ---------- Context menus (§8; kit openMenu) ----------

// A folder picker submenu: leaf folders pick, a group cascades into its
// children (groups hold no items). ✓ marks `current`. `folders` defaults to
// channel folders; pass state.videoFolders for Watch Later lists.
function folderMenuItems(onPick, current, folders = state.folders) {
  return getTopLevelFoldersOrdered(folders).map(([id]) => {
    const children = getChildFolderIds(id, folders).sort((a, b) => (folders[a].order ?? 0) - (folders[b].order ?? 0));
    if (!children.length) return { label: folderLabel(id, folders), checked: current === id, action: () => onPick(id) };
    return {
      label: folderLabel(id, folders), checked: children.includes(current),
      submenu: () => children.map((cid) => ({ label: folderLabel(cid, folders), checked: current === cid, action: () => onPick(cid) })),
    };
  });
}

// Only active languages appear in the menus (§14).
function languageMenuItems(onPick, current) {
  return [
    { label: "— none —", checked: current === null, action: () => onPick(null) },
    ...LANGUAGES.map((language) => ({ label: langLabel(language), color: langColor(language), checked: current === language, action: () => onPick(language) })),
  ];
}

function showChannelContextMenu(at, id) {
  const ch = state.channels[id];
  if (!ch) return;
  const ids = [id];
  const language = canonicalLanguage(ch.language) || null;
  openMenu(at, [
    { label: "Move to folder", submenu: () => folderMenuItems((fid) => moveChannels(ids, fid), ch.folderId || "unsorted") },
    { label: "Set language", submenu: () => languageMenuItems((lang) => setChannelLanguage(ids, lang), LANGUAGES.includes(language) ? language : language ? undefined : null) },
    { label: "Tags…", action: () => openTagPopover(ids, at) },
    { sep: true },
    { label: ch.active ? "Mark inactive" : "Mark active", action: () => setChannelFlag(ids, "active", !ch.active) },
    { label: ch.finished ? "Mark unfinished" : "Mark finished", action: () => setChannelFlag(ids, "finished", !ch.finished) },
    { label: ch.trackVideos ? "Stop tracking videos" : "Track videos", action: () => setChannelFlag(ids, "trackVideos", !ch.trackVideos) },
    { sep: true },
    { label: "Refresh stats", action: () => runRefresh(ids) },
    { label: "Fetch videos…", action: () => openFetchVideosModal(ids) },
    { label: "Open channel", action: () => openChannel(id) },
    { sep: true },
    { label: "Delete channel", danger: true, action: () => deleteChannels(ids) },
  ], { title: ch.name });
}

function showBulkContextMenu(at, ids) {
  const n = ids.length;
  const tags = Object.entries(state.tags).sort((a, b) => a[1].name.localeCompare(b[1].name));
  // The value every selected channel shares, else undefined (no ✓).
  const common = (read) => {
    const values = new Set(ids.map((id) => read(state.channels[id] || {})));
    return values.size === 1 ? [...values][0] : undefined;
  };
  openMenu(at, [
    { label: `Move ${n} to folder`, submenu: () => folderMenuItems((fid) => moveChannels(ids, fid), common((c) => c.folderId || "unsorted")) },
    { label: "Set language", submenu: () => languageMenuItems((lang) => setChannelLanguage(ids, lang), common((c) => canonicalLanguage(c.language) || null)) },
    {
      label: "Add tag",
      submenu: () => tags.length
        ? tags.map(([tid, t]) => ({ label: t.name, color: t.color, action: () => setChannelTag(ids, tid, true) }))
        : [{ label: "No tags yet", disabled: true }],
    },
    {
      label: "Remove tag",
      submenu: () => {
        // Only tags at least one selected channel actually carries.
        const present = new Set(ids.flatMap((id) => state.channels[id]?.tags || []));
        const removable = tags.filter(([tid]) => present.has(tid));
        return removable.length
          ? removable.map(([tid, t]) => ({ label: t.name, color: t.color, action: () => setChannelTag(ids, tid, false) }))
          : [{ label: "No tags on the selection", disabled: true }];
      },
    },
    { label: "Tags…", action: () => openTagPopover(ids, at) },
    { sep: true },
    { label: "Mark active", action: () => setChannelFlag(ids, "active", true) },
    { label: "Mark inactive", action: () => setChannelFlag(ids, "active", false) },
    { label: "Mark finished", action: () => setChannelFlag(ids, "finished", true) },
    { label: "Mark unfinished", action: () => setChannelFlag(ids, "finished", false) },
    { sep: true },
    { label: "Track videos", action: () => setChannelFlag(ids, "trackVideos", true) },
    { label: "Stop tracking videos", action: () => setChannelFlag(ids, "trackVideos", false) },
    { label: `Refresh stats (${n})`, action: () => runRefresh(ids) },
    { label: `Fetch videos (${n})…`, action: () => openFetchVideosModal(ids) },
    { label: n > 10 ? "Open the first 10" : `Open ${n}`, action: () => ids.slice(0, 10).forEach((id) => openChannel(id, true)) },
    { sep: true },
    { label: `Delete ${n} channels`, danger: true, action: () => deleteChannels(ids) },
  ], { title: plural(n, "channel") });
}

function showFolderContextMenu(at, id, li) {
  const d = fdom();
  const folder = d.folders[id];
  if (!folder) return;
  openMenu(at, [
    { label: "Rename…", action: () => renameFolder(id) },
    { label: folder.emoji ? "Change emoji…" : "Set emoji…", action: () => openEmojiInput(li, id) },
    folder.emoji ? { label: "Remove emoji", action: () => setFolderEmoji(id, "") } : null,
    // One nesting level: only top-level folders take subfolders.
    !folder.parentId ? { label: `New sub${d.noun}…`, action: () => createFolder(id) } : null,
    folder.parentId ? { label: "Move to top level", action: () => moveFolderToTopLevel(id) } : null,
    { sep: true },
    { label: `Delete ${d.noun}`, danger: true, action: () => deleteFolder(id) },
  ], { title: folder.name });
}

function showTagContextMenu(at, tagId) {
  const tag = state.tags[tagId];
  if (!tag) return;
  openMenu(at, [
    { label: "Rename…", action: () => renameTag(tagId) },
    { label: "Color", submenu: () => TAG_PALETTE.map((color) => ({ label: color, color, checked: tag.color.toLowerCase() === color.toLowerCase(), action: () => setTagColor(tagId, color) })) },
    { sep: true },
    { label: "Delete tag", danger: true, action: () => deleteTag(tagId) },
  ], { title: tag.name });
}

// One video card's menu. Actions read the video again when clicked — a
// refresh can replace the record while the menu is open.
function showVideoContextMenu(at, id) {
  const v = state.videos[id];
  if (!v) return;
  const ids = [id];
  const items = currentView === "removed"
    ? [{ label: "Restore to New", action: () => setVideosHidden(ids, false) }, { label: "Open video", action: () => openVideo(id, false) }]
    : [
      { label: v.watched ? "Mark unwatched" : "Mark watched", action: () => setVideosWatched(ids, !v.watched) },
      currentView === "watchlater" ? { label: "Move to list", submenu: () => folderMenuItems((listId) => moveVideosToList(ids, listId), v.folderId || "unsorted", state.videoFolders) } : null,
      { label: "Open video", action: () => openVideo(id, false) },
      { sep: true },
      currentView === "watchlater"
        ? { label: "Remove from Watch Later", danger: true, action: () => removeFromWatchLater(ids) }
        : { label: "Remove", danger: true, action: () => setVideosHidden(ids, true) },
    ];
  openMenu(at, items, { title: v.title });
}

function showVideoBulkContextMenu(at, ids) {
  const n = ids.length;
  const items = [
    { label: `Mark ${n} watched`, action: () => setVideosWatched(ids, true) },
    { label: `Mark ${n} unwatched`, action: () => setVideosWatched(ids, false) },
    { label: n > 10 ? "Open the first 10" : `Open ${n}`, action: () => ids.slice(0, 10).forEach((id) => openVideo(id, true)) },
    { sep: true },
  ];
  if (currentView === "watchlater") {
    items.push({ label: `Move ${n} to list`, submenu: () => folderMenuItems((listId) => moveVideosToList(ids, listId), undefined, state.videoFolders) });
    items.push({ label: `Remove ${n} from Watch Later`, danger: true, action: () => removeFromWatchLater(ids) });
  } else if (currentView === "removed") {
    items.push({ label: `Restore ${n} to New`, action: () => setVideosHidden(ids, false) });
  } else {
    items.push({ label: `Remove ${n} from feed`, danger: true, action: () => setVideosHidden(ids, true) });
  }
  openMenu(at, items, { title: plural(n, "video") });
}

// ---------- Multi-select (§6) ----------

// Repaint the selection on rendered rows/cards without a re-render; rows
// appended later by the pager pick it up in buildChannelRow / videoCardHtml.
function paintSelection() {
  for (const row of el.channelGrid.querySelectorAll("[data-channel-id]")) {
    row.classList.toggle("selected", channelSel.has(row.dataset.channelId));
  }
  renderSelectionCount();
}

function paintVideoSelection() {
  for (const card of document.querySelectorAll(".video-card[data-video-id]")) {
    card.classList.toggle("selected", videoSel.has(card.dataset.videoId));
  }
  renderSelectionCount();
}

// "N selected" in accent next to the result count while a selection exists.
function renderSelectionCount() {
  const n = currentView === "channels" ? channelSel.size : videoSel.size;
  el.selectionCount.hidden = !n;
  el.selectionCount.textContent = n ? `${n.toLocaleString()} selected` : "";
}

// The displayed order of the active video view — range selection and Select
// all cover every card in it, rendered yet or not.
function currentVideoOrder() {
  if (currentView === "channels") return [];
  return (currentView === "watchlater" ? getWatchLaterVideos() : getFilteredVideos()).map((v) => v.id);
}

// Marquee (drag from empty list space), Mod+A and Esc — fixed everyday
// controls that stay on with the shortcuts turned off.
function bindSelectionControls() {
  const additive = (e) => selectionModifierPressed(e, controls);
  attachMarquee(el.channelList, { scroller: el.main, rowSelector: ".channel-row", idOf: (row) => row.dataset.channelId, selection: channelSel, additive });
  for (const grid of [el.videoFeed, el.watchLaterGrid]) {
    attachMarquee(grid, { scroller: el.main, rowSelector: ".video-card", idOf: (card) => card.dataset.videoId, selection: videoSel, additive });
  }
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || overlayOpen() || isTypingTarget(e.target)) return;
    const sel = currentView === "channels" ? channelSel : videoSel;
    if (e.key === "Escape") {
      if (sel.clear()) e.preventDefault();
    } else if ((IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyA") {
      e.preventDefault();
      sel.set(currentView === "channels" ? getFilteredChannels().map((c) => c.id) : currentVideoOrder(), sel.anchor);
    }
  });
}
