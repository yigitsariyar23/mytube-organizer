import test from 'node:test';
import assert from 'node:assert/strict';
import { repairGroupItems, repairLibraryGroups, editChanges, revertEdit, validateBackup, makeBackup } from '../shared/library.js';
import { harness, channel } from './harness.js';

const folders = () => ({
  unsorted: { name: 'Unfiled', order: 0 },
  music: { name: 'Music', order: 1 },
  jazz: { name: 'Jazz', order: 0, parentId: 'music' },
  science: { name: 'Science', order: 2 },
});

test('items filed directly in a group move into a new "General" child', () => {
  const f = folders();
  const items = { a: { folderId: 'music' }, b: { folderId: 'jazz' }, c: { folderId: 'science' }, d: { folderId: 'music' } };
  assert.equal(repairGroupItems(f, items), true);
  assert.equal(items.a.folderId, 'general-music');
  assert.equal(items.d.folderId, 'general-music');
  assert.deepEqual(f['general-music'], { name: 'General', order: 1, parentId: 'music' });
  assert.equal(items.b.folderId, 'jazz');
  assert.equal(items.c.folderId, 'science');
  assert.equal(repairGroupItems(f, items), false, 'a repaired library is stable');
});

test('group repair reuses an existing General child and leaves leaf folders alone', () => {
  const f = { ...folders(), gen: { name: ' general ', order: 4, parentId: 'music' } };
  const items = { a: { folderId: 'music' } };
  repairGroupItems(f, items);
  assert.equal(items.a.folderId, 'gen');
  assert.equal(Object.keys(f).length, 5);
  const leafOnly = { unsorted: { name: 'Unfiled', order: 0 }, x: { name: 'X', order: 1 } };
  assert.equal(repairGroupItems(leafOnly, { a: { folderId: 'x' } }), false);
});

test('Watch Later repair only moves saved videos and reports the collections it changed', () => {
  const data = {
    channels: { c: { folderId: 'music' } }, folders: folders(),
    videos: { v: { saved: true, folderId: 'list' }, w: { saved: false, folderId: 'list' } },
    videoFolders: { unsorted: { name: 'Unfiled', order: 0 }, list: { name: 'List', order: 1 }, sub: { name: 'Sub', order: 0, parentId: 'list' } },
  };
  assert.deepEqual(repairLibraryGroups(data).sort(), ['channels', 'folders', 'videoFolders', 'videos']);
  assert.equal(data.videos.v.folderId, 'general-list');
  assert.equal(data.videos.w.folderId, 'list');
  assert.deepEqual(repairLibraryGroups({ channels: {}, folders: folders() }), []);
});

test('backup restore files group-held channels under General instead of Unfiled', () => {
  const backup = makeBackup({ channels: { c: { id: 'c', name: 'C', folderId: 'music', tags: [] } }, folders: folders(), tags: {},
    videoFolders: { unsorted: { name: 'Unfiled', order: 0 } }, videos: {} });
  const restored = validateBackup(backup);
  assert.equal(restored.library.channels.c.folderId, 'general-music');
  assert.equal(restored.library.folders['general-music'].parentId, 'music');
});

test('undo reverts only the fields an edit changed, and only while they still match', () => {
  const before = { channels: { a: { folderId: 'x', name: 'A', videoCount: 1 }, b: { folderId: 'x', name: 'B' } } };
  const after = { channels: { a: { folderId: 'y', name: 'A', videoCount: 1 }, b: { folderId: 'y', name: 'B' } } };
  const entries = editChanges(before, after);
  assert.equal(entries.length, 2);
  // Meanwhile a refresh changed a's count, and b was moved again by hand.
  const current = { channels: { a: { folderId: 'y', name: 'A', videoCount: 9 }, b: { folderId: 'z', name: 'B' } } };
  assert.deepEqual(revertEdit(current, entries), { reverted: 1, skipped: 1 });
  assert.deepEqual(current.channels.a, { folderId: 'x', name: 'A', videoCount: 9 }, 'the refresh is kept');
  assert.equal(current.channels.b.folderId, 'z', 'a newer edit is never reverted');
});

test('undo restores deleted records, removes created ones, and never resurrects', () => {
  const before = { channels: { gone: { name: 'Gone', tags: ['t'] } }, tags: {} };
  const after = { channels: {}, tags: { t2: { name: 'New', color: '#fff' } } };
  const entries = editChanges(before, after);
  const current = { channels: {}, tags: { t2: { name: 'New', color: '#fff' } } };
  assert.deepEqual(revertEdit(current, entries), { reverted: 2, skipped: 0 });
  assert.deepEqual(current.channels.gone, { name: 'Gone', tags: ['t'] });
  assert.equal(current.tags.t2, undefined);
  // A record the edit changed but someone deleted meanwhile stays deleted.
  const moved = editChanges({ channels: { a: { folderId: 'x' } } }, { channels: { a: { folderId: 'y' } } });
  const without = { channels: {} };
  assert.deepEqual(revertEdit(without, moved), { reverted: 0, skipped: 1 });
  assert.equal(without.channels.a, undefined);
  // A field the edit added is removed again.
  const added = editChanges({ folders: { f: { name: 'F' } } }, { folders: { f: { name: 'F', emoji: '🎵' } } });
  const folder = { folders: { f: { name: 'F', emoji: '🎵' } } };
  revertEdit(folder, added);
  assert.deepEqual(folder.folders.f, { name: 'F' });
});

test('a patch that leaves channels in a group is repaired by the worker', async () => {
  const h = harness({ channels: { c: channel('c') }, folders: { unsorted: { name: 'Unfiled', order: 0 }, music: { name: 'Music', order: 1 } } });
  h.db.channels.c.folderId = 'music';
  const result = await h.send({ type: 'PATCH_LIBRARY', patches: { folders: [{ id: 'jazz', create: { name: 'Jazz', order: 0, parentId: 'music' } }] } });
  assert.equal(result.ok, true);
  assert.equal(h.db.channels.c.folderId, 'general-music');
  assert.equal(h.db.folders['general-music'].name, 'General');
});

test('a refresh over several channels mirrors progress and stops when cancelled', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = [];
  const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const h = harness({ channels: Object.fromEntries(ids.map(id => [id, channel(id)])) }, async (db, url) => {
    if (String(url).includes('channel_id=c0')) await gate;
    if (db.jobProgress) seen.push(db.jobProgress.done);
    return { ok: true, text: async () => '<feed></feed>' };
  });
  const run = h.send({ type: 'REFRESH_STATS', channelIds: ids });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual({ ...h.db.jobProgress, startedAt: 0 }, { kind: 'refresh', done: 0, total: 12, startedAt: 0 });
  assert.equal((await h.send({ type: 'CANCEL_JOB' })).ok, true);
  release();
  const result = await run;
  assert.equal(result.cancelled, true);
  assert.equal(h.db.jobProgress, undefined, 'progress is cleared when the job ends');
  assert.ok(h.db.channels.c0.lastFetched, 'channels already read are kept');
  assert.equal(h.db.channels.c11.lastFetched, undefined, 'the rest were never requested');
  assert.ok(seen.every(done => done === 0));
});
