// Pure library operations shared by the dashboard, worker, and regression tests.
export const RECORD_KEYS = ['channels', 'folders', 'tags', 'videoFolders', 'videos'];
export const VIDEO_FLAGS = ['watched', 'saved', 'hidden', 'folderId', 'userStateAt'];
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const clone = (value) => structuredClone(value);

export function recordPatch(before = {}, after = {}) {
  const changes = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id], b = after[id];
    if (!b) { changes.push({ id, remove: true }); continue; }
    if (!a) { changes.push({ id, create: clone(b) }); continue; }
    const set = {}, unset = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (same(a[key], b[key])) continue;
      if (b[key] === undefined) unset.push(key); else set[key] = clone(b[key]);
    }
    if (Object.keys(set).length || unset.length) changes.push({ id, set, unset });
  }
  return changes;
}

export function applyRecordPatch(records, changes, { videos = false, now = Date.now() } = {}) {
  for (const change of changes) {
    const { id } = change;
    if (!safeKey(id)) throw new Error('Invalid record id.');
    if (change.remove) { delete records[id]; continue; }
    if (change.create) {
      if (!Object.hasOwn(records, id)) records[id] = clone(change.create);
      continue;
    }
    const item = records[id];
    if (!item) continue; // An edit never resurrects a record deleted elsewhere.
    for (const [key, value] of Object.entries(change.set || {})) {
      if (!safeKey(key)) throw new Error('Invalid field.');
      item[key] = clone(value);
    }
    for (const key of change.unset || []) delete item[key];
    if (videos && VIDEO_FLAGS.some(k => k !== 'userStateAt' && (Object.hasOwn(change.set || {}, k) || change.unset?.includes(k)))) {
      item.userStateAt = Math.max(now, (item.userStateAt || 0) + 1);
    }
  }
  return records;
}

export const safeKey = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HOME = { name: 'Unfiled', order: 0 };

export function validateBackup(input) {
  if (!isMap(input) || input.format !== 'mytube-backup' || input.version !== 1 || !isMap(input.library)) {
    throw new Error('Choose a MyTube backup JSON file (version 1).');
  }
  const library = {};
  for (const key of RECORD_KEYS) {
    const records = input.library[key];
    if (!isMap(records)) throw new Error(`Backup is missing a valid ${key} collection.`);
    library[key] = {};
    for (const [id, item] of Object.entries(records)) {
      if (!safeKey(id) || !isMap(item)) throw new Error(`Invalid record in ${key}.`);
      for (const [field, value] of Object.entries(item)) {
        if (!safeKey(field) || (value !== null && typeof value === 'object' && !(field === 'tags' && Array.isArray(value)))) {
          throw new Error(`Invalid ${field} in ${key}.`);
        }
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid number in ${key}.`);
      }
      const strings = ['name', 'handle', 'thumbnail', 'folderId', 'language', 'lastVideoDate', 'parentId', 'emoji', 'color', 'channelId', 'title', 'author', 'published', 'channelThumbnail', 'channelUrl', 'live'];
      for (const field of strings) if (item[field] != null && typeof item[field] !== 'string') throw new Error(`Invalid ${field} in ${key}.`);
      for (const field of ['watched', 'saved', 'hidden', 'active', 'finished', 'trackVideos', 'fetchedAll']) {
        if (item[field] != null && typeof item[field] !== 'boolean') throw new Error(`Invalid ${field} in ${key}.`);
      }
      for (const field of ['order', 'lastFetched', 'lastFetchAttempt', 'duration', 'viewCount', 'subscriberCount', 'videoCount', 'userStateAt', 'addedAt']) {
        if (item[field] != null && (typeof item[field] !== 'number' || item[field] < 0)) throw new Error(`Invalid ${field} in ${key}.`);
      }
      if (item.tags != null && (!Array.isArray(item.tags) || item.tags.some(t => !safeKey(t)))) throw new Error('Invalid channel tags.');
      if (['folders', 'videoFolders', 'tags'].includes(key) && typeof item.name !== 'string') throw new Error(`Missing name in ${key}.`);
      library[key][id] = clone(item);
      if (key === 'channels' || key === 'videos') library[key][id].id = id;
    }
  }
  for (const key of ['folders', 'videoFolders']) {
    const folders = library[key];
    folders.unsorted = { ...HOME };
    for (const [id, f] of Object.entries(folders)) {
      if (f.parentId && (f.parentId === id || f.parentId === 'unsorted' || !folders[f.parentId] || folders[f.parentId].parentId)) {
        throw new Error(`Invalid nesting in ${key}.`);
      }
    }
  }
  for (const [key, folderKey] of [['channels', 'folders'], ['videos', 'videoFolders']]) {
    const folders = library[folderKey];
    for (const item of Object.values(library[key])) {
      if (key === 'videos' && !item.saved) continue;
      if (!folders[item.folderId]) item.folderId = 'unsorted';
      if (key === 'channels') item.tags = (item.tags || []).filter(t => library.tags[t]);
    }
  }
  // Items filed directly in a group move into its "General" child (§11).
  repairLibraryGroups(library);
  const settings = {};
  if (input.settings?.languages !== undefined) {
    if (!Array.isArray(input.settings.languages) || input.settings.languages.some(l => typeof l !== 'string')) throw new Error('Invalid languages.');
    settings.languages = [...input.settings.languages];
  }
  // Credentials are deliberately absent from portable exports/imports.
  return { format: 'mytube-backup', version: 1, library, settings };
}

export function makeBackup(data, reason = 'Manual snapshot') {
  return { format: 'mytube-backup', version: 1, createdAt: Date.now(), reason,
    library: Object.fromEntries(RECORD_KEYS.map(key => [key, clone(data[key] || {})])),
    settings: { languages: clone(data.languages || []) } };
}

export function backupCounts(backup) {
  return Object.fromEntries(RECORD_KEYS.map(key => [key, Object.keys(backup.library[key]).length]));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isMap(value)) return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}


// Recognize old thumbnail-overlay captures without rejecting titles merely
// containing a duration or the word "watched".
export function isPlaylistOverlayTitle(title) {
  if (typeof title !== 'string' || !/\d{1,3}:\d{2}/.test(title)) return false;
  const rest = title.replace(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g, '')
    .replace(/İZLENDİ|İzlendi|izlendi|watched|Şimdi oynatılıyor|şimdi oynatılıyor|now playing/giu, '')
    .trim();
  return !rest;
}

// ---------- Folder groups (DESIGN §11) ----------

// A folder with subfolders is a *group* and holds no items of its own. Any item
// sitting directly in a group moves into the group's child named "General",
// created when missing. The new child's id is derived from the group's id, so
// two devices repairing the same library create the same folder (a sync union
// then merges them instead of duplicating). `include` limits which items count
// (Watch Later: only saved videos). Returns true when anything changed.
export function repairGroupItems(folders, items, { include = () => true } = {}) {
  const groups = new Set(Object.values(folders).map(f => f.parentId).filter(id => id && folders[id]));
  if (!groups.size) return false;
  const general = {};
  let changed = false;
  for (const item of Object.values(items)) {
    if (!item || !include(item) || !groups.has(item.folderId)) continue;
    const parentId = item.folderId;
    general[parentId] ||= Object.keys(folders).find(id => folders[id].parentId === parentId && String(folders[id].name).trim().toLowerCase() === 'general')
      || createGeneralFolder(folders, parentId);
    item.folderId = general[parentId];
    changed = true;
  }
  return changed;
}

function createGeneralFolder(folders, parentId) {
  let id = `general-${parentId}`;
  for (let n = 2; folders[id]; n++) id = `general-${parentId}-${n}`;
  const order = Math.max(-1, ...Object.values(folders).filter(f => f.parentId === parentId).map(f => f.order ?? 0)) + 1;
  folders[id] = { name: 'General', order, parentId };
  return id;
}

// Both trees at once: channels in `folders`, saved videos in `videoFolders`.
// Mutates `data` (any subset of the record collections) and returns the keys
// it changed, so a caller writes only those.
export function repairLibraryGroups(data) {
  const changed = new Set();
  if (data.folders && data.channels && repairGroupItems(data.folders, data.channels)) changed.add('folders').add('channels');
  if (data.videoFolders && data.videos && repairGroupItems(data.videoFolders, data.videos, { include: v => v.saved })) changed.add('videoFolders').add('videos');
  return [...changed];
}

// ---------- Undo (DESIGN §9) ----------

// The records one edit touched, per collection: [{ key, id, before, after }]
// with `undefined` for "absent" (a create has no before, a delete no after).
export function editChanges(before, after, keys = Object.keys(after)) {
  const entries = [];
  for (const key of keys) {
    const a = before[key] || {}, b = after[key] || {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (same(a[id], b[id])) continue;
      entries.push({ key, id, before: a[id] === undefined ? undefined : clone(a[id]), after: b[id] === undefined ? undefined : clone(b[id]) });
    }
  }
  return entries;
}

// Put `current` (a library: { channels, folders, … }) back to the before-state
// of `entries` — but only for records still exactly as the edit left them,
// compared on the fields the edit changed. A refresh or an avatar landing in
// between touches other fields, so it neither blocks the undo nor is reverted;
// a record edited again since, or deleted meanwhile, is left alone (and never
// resurrected). Mutates `current`; returns { reverted, skipped }.
export function revertEdit(current, entries) {
  let reverted = 0, skipped = 0;
  for (const { key, id, before, after } of entries) {
    const records = current[key] ||= {};
    const now = records[id];
    if (after === undefined) {
      // Deleted by the edit: restore it unless something recreated it.
      if (now === undefined && before !== undefined) { records[id] = clone(before); reverted++; } else skipped++;
      continue;
    }
    if (now === undefined) { skipped++; continue; }
    if (before === undefined) {
      // Created by the edit: remove it if it's still what the edit created.
      if (Object.keys(after).every(k => same(now[k], after[k]))) { delete records[id]; reverted++; } else skipped++;
      continue;
    }
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !same(before[k], after[k]));
    if (!fields.every(k => same(now[k], after[k]))) { skipped++; continue; }
    for (const k of fields) {
      if (before[k] === undefined) delete now[k]; else now[k] = clone(before[k]);
    }
    reverted++;
  }
  return { reverted, skipped };
}
