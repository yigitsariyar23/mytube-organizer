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
    const parents = new Set(Object.values(folders).map(f => f.parentId).filter(Boolean));
    for (const item of Object.values(library[key])) {
      if (key === 'videos' && !item.saved) continue;
      if (!folders[item.folderId] || parents.has(item.folderId)) item.folderId = 'unsorted';
      if (key === 'channels') item.tags = (item.tags || []).filter(t => library.tags[t]);
    }
  }
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
