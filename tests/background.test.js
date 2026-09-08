import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, channel, seed, deferred, gistFetcher } from './harness.js';
import { makeBackup, recordPatch, validateBackup } from '../shared/library.js';

test('refresh preserves edits, additions and deletions made during network work', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ channels: { c: channel(), deleted: channel('deleted') } }, async () => { entered.resolve(); await finish.promise; return { ok: true, text: async () => '<feed></feed>' }; });
  const refresh = h.ctx.refreshChannelStats(['c']);
  await entered.promise;
  await h.send({ type: 'PATCH_LIBRARY', patches: { channels: [{ id: 'c', set: { folderId: 'new', active: true } }, { id: 'deleted', remove: true }, { id: 'added', create: channel('added') }] } });
  finish.resolve(); await refresh;
  assert.equal(h.db.channels.c.folderId, 'new'); assert.equal(h.db.channels.c.active, true);
  assert.ok(h.db.channels.added); assert.equal(h.db.channels.deleted, undefined); assert.ok(h.db.channels.c.lastFetched);
});

test('context-menu save persists immediately and enrichment preserves intervening saves and edits', async () => {
  const entered = deferred(), finish = deferred();
  const h = harness({ videos: { old: { id: 'old', watched: false } } }, async () => { entered.resolve(); await finish.promise; return { ok: true, json: async () => ({ title: 'Metadata title' }) }; });
  const save = h.ctx.saveVideoToWatchLater('new'); await entered.promise;
  assert.equal(h.db.videos.new.saved, true);
  await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'old', set: { watched: true } }, { id: 'other', create: { id: 'other', saved: true } }, { id: 'new', set: { saved: false }, unset: ['folderId'] }], videoFolders: [{ id: 'list', create: { name: 'List', order: 1 } }] } });
  finish.resolve(); await save;
  assert.equal(h.db.videos.old.watched, true); assert.ok(h.db.videos.other); assert.ok(h.db.videoFolders.list);
  assert.equal(h.db.videos.new.saved, false); assert.equal(h.db.videos.new.title, 'Metadata title');
});

test('pruning uses current saved state even if the old snapshot dropped the video', async () => {
  const h = harness({ videos: { v: { id: 'v', channelId: 'gone', saved: false } } });
  const { store, seenIds } = await h.ctx.readVideoStore();
  delete store.v;
  await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v', set: { saved: true } }] } });
  await h.ctx.commitVideos(store, seenIds, { prune: true });
  assert.equal(h.db.videos.v.saved, true);
});

test('simultaneous field patches retain both independent changes and never resurrect a deletion', async () => {
  const h = harness({ channels: { c: channel() } });
  await Promise.all([h.send({ type: 'PATCH_LIBRARY', patches: { channels: [{ id: 'c', set: { active: true } }] } }), h.send({ type: 'PATCH_LIBRARY', patches: { channels: [{ id: 'c', set: { language: 'English' } }] } })]);
  assert.equal(h.db.channels.c.active, true); assert.equal(h.db.channels.c.language, 'English');
  await h.send({ type: 'PATCH_LIBRARY', patches: { channels: [{ id: 'c', remove: true }] } });
  await h.send({ type: 'PATCH_LIBRARY', patches: { channels: [{ id: 'c', set: { active: false } }] } });
  assert.equal(h.db.channels.c, undefined);
});

test('older detail jobs do not roll back metadata filled by a newer job', async () => {
  const h = harness({ videos: { v: { id: 'v', saved: true } } });
  const a = await h.ctx.readVideoStore(), b = await h.ctx.readVideoStore();
  a.store.v.duration = 123; b.store.v.duration = 456;
  await h.ctx.commitVideos(b.store, b.seenIds); await h.ctx.commitVideos(a.store, a.seenIds);
  assert.equal(h.db.videos.v.duration, 456);
});

test('failed RSS and API requests keep successful freshness unchanged and identify retry targets', async () => {
  const h = harness({ channels: { c: { ...channel(), lastFetched: 42 } } }, async () => ({ ok: false, status: 503 }));
  const result = await h.ctx.refreshChannelStats(['c']);
  assert.equal(result.ok, false); assert.equal(result.failures[0].id, 'c'); assert.equal(h.db.channels.c.lastFetched, 42); assert.ok(h.db.channels.c.lastFetchAttempt);
  const api = harness({ apiKey: 'fake', channels: { c: { ...channel(), lastFetched: 42 } } }, async (_db, url) => url.includes('googleapis') ? { ok: false, status: 403, text: async () => '{}' } : { ok: true, text: async () => '<feed></feed>' });
  const failed = await api.ctx.refreshChannelStats(['c']);
  assert.equal(failed.ok, false); assert.equal(failed.failures[0].id, 'c'); assert.equal(api.db.channels.c.lastFetched, 42);
});

test('a successful retry clears the recorded error, including valid empty feeds', async () => {
  const h = harness({ channels: { c: { ...channel(), lastFetched: 42, lastFetchError: 'offline' } } });
  const result = await h.ctx.refreshChannelStats(['c']);
  assert.equal(result.ok, true); assert.ok(h.db.channels.c.lastFetched > 42); assert.equal(h.db.channels.c.lastFetchError, undefined);
});

test('tag-only changes are reviewable and download takes a recovery snapshot', async () => {
  const remote = { ...seed(), tags: { t: { name: 'Renamed', color: '#abc' } } };
  const h = harness({ gistToken: 'fake-token', gistId: 'gist', tags: { t: { name: 'Original', color: '#abc' } } }, gistFetcher(remote));
  const diff = await h.ctx.computeSyncDiff('download');
  assert.equal(diff.tags.modified.length, 1);
  const result = await h.ctx.applyDownload([], [], diff.reviewToken);
  assert.equal(result.ok, true); assert.equal(h.db.tags.t.name, 'Renamed');
  assert.equal(h.db.libraryBackups[0].library.tags.t.name, 'Original');
});

test('sync requires a fresh review when either remote or local data changes', async () => {
  const remote = { ...seed(), channels: { c: channel() } };
  const h = harness({ gistToken: 'fake-token', gistId: 'gist' }, gistFetcher(remote));
  let diff = await h.ctx.computeSyncDiff('download'); remote.channels.c.name = 'Changed after review';
  let result = await h.ctx.applyDownload([], [], diff.reviewToken);
  assert.equal(result.stale, true); assert.equal(h.db.channels.c, undefined); assert.equal(h.db.libraryBackups, undefined);
  diff = result.diff;
  await h.send({ type: 'PATCH_LIBRARY', patches: { tags: [{ id: 't', create: { name: 'Local tag', color: '#abc' } }] } });
  result = await h.ctx.applyDownload([], [], diff.reviewToken);
  assert.equal(result.stale, true); assert.equal(h.db.channels.c, undefined);
});

test('channel removal choices recalculate dependent video removals and unticking a video preserves it', async () => {
  const remote = { ...seed(), channels: { c: channel() }, videos: { v: { id: 'v', channelId: 'c', published: '2020-01-01' } } };
  const h = harness({ gistToken: 'fake-token', gistId: 'gist' }, gistFetcher(remote));
  const keep = await h.ctx.computeSyncDiff('upload', []); assert.equal(keep.videos.removed, 0);
  const remove = await h.ctx.computeSyncDiff('upload', ['c']); assert.equal(remove.videos.removed, 1); assert.equal(remove.videos.items[0].to, null);
  const result = await h.ctx.applyUpload(['c'], ['v'], remove.reviewToken);
  assert.equal(result.ok, true); assert.equal(remote.channels.c, undefined); assert.ok(remote.videos.v);
});

test('every video decision is returned past 500, and skip-all protects the complete collection', async () => {
  const remote = { ...seed(), videos: Object.fromEntries(Array.from({ length: 620 }, (_, i) => [String(i), { id: String(i), saved: true, title: `Video ${i}` }])) };
  const h = harness({ gistToken: 'fake-token', gistId: 'gist' }, gistFetcher(remote));
  const diff = await h.ctx.computeSyncDiff('download');
  assert.equal(diff.videos.items.length, 620); assert.equal(diff.videos.truncated, 0);
  assert.equal((await h.ctx.applyDownload([], [], diff.reviewToken, true)).ok, true);
  assert.equal(Object.keys(h.db.videos).length, 0);
});

test('Undo restores flags while retaining new metadata and rejects conflicting user edits', async () => {
  const before = { hidden: false, saved: true, watched: false, folderId: 'unsorted' };
  const after = { ...before, hidden: true };
  const h = harness({ videos: { v: { id: 'v', ...after, duration: 123 } } });
  assert.equal((await h.send({ type: 'UNDO_VIDEOS', changes: [{ id: 'v', before, after }] })).ok, true);
  assert.equal(h.db.videos.v.hidden, false); assert.equal(h.db.videos.v.duration, 123); assert.ok(h.db.videos.v.userStateAt);
  assert.equal((await h.send({ type: 'UNDO_VIDEOS', changes: [{ id: 'v', before, after }] })).ok, false);
});

test('clear backs up all collections, preserves credentials, and invalidates older jobs', async () => {
  const h = harness({ channels: { c: channel() }, videos: { v: { id: 'v', saved: true } }, gistToken: 'private-token', apiKey: 'private-key' });
  const pending = await h.ctx.readVideoStore(); pending.store.v.title = 'Late metadata';
  assert.equal((await h.send({ type: 'CLEAR_LIBRARY' })).ok, true);
  assert.equal(Object.keys(h.db.videos).length, 0); assert.equal(h.db.libraryBackups[0].library.videos.v.saved, true);
  await h.ctx.commitVideos(pending.store, pending.seenIds); assert.equal(Object.keys(h.db.videos).length, 0);
  const backupId = h.db.libraryBackups[0].id;
  assert.equal((await h.send({ type: 'RESTORE_BACKUP', backupId })).ok, true);
  assert.ok(h.db.videos.v); assert.equal(h.db.apiKey, 'private-key'); assert.equal(h.db.gistToken, 'private-token');
});

test('portable backup round trip excludes credentials and rejects invalid input without changing storage', async () => {
  const h = harness({ channels: { c: channel() }, apiKey: 'secret-key', gistToken: 'secret-token' });
  const result = await h.send({ type: 'EXPORT_BACKUP' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(validateBackup(result.backup).library.channels.c.name, 'Channel c');
  const original = structuredClone(h.db);
  const broken = makeBackup(seed()); broken.library.videos = [];
  assert.equal((await h.send({ type: 'RESTORE_BACKUP', backup: broken })).ok, false);
  assert.deepEqual(h.db, original);
  assert.throws(() => validateBackup(JSON.parse('{"format":"mytube-backup","version":1,"library":{"channels":{"__proto__":{}},"videos":{},"folders":{},"videoFolders":{},"tags":{}}')));
});

test('snapshot failure prevents destructive clear and snapshot retention is bounded', async () => {
  const h = harness({ channels: { c: channel() } });
  for (let i = 0; i < 7; i++) await h.send({ type: 'CREATE_BACKUP' });
  assert.equal(h.db.libraryBackups.length, 5);
  const originalSet = h.local.set;
  h.local.set = async values => { if (values.libraryBackups) throw new Error('Storage unavailable'); await originalSet(values); };
  const result = await h.send({ type: 'CLEAR_LIBRARY' });
  assert.equal(result.ok, false); assert.ok(h.db.channels.c);
});

test('field diffs omit untouched records and preserve explicit false/unset values', () => {
  const before = { a: { watched: true, folderId: 'list' }, b: { title: 'Unchanged' } };
  const patches = recordPatch(before, { a: { watched: false }, b: { title: 'Unchanged' } });
  assert.deepEqual(patches, [{ id: 'a', set: { watched: false }, unset: ['folderId'] }]);
});

test('Undo refuses to overwrite a later edit even when flags return to the same values', async () => {
  const h = harness({ videos: { v: { id: 'v', hidden: false } } });
  const first = await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v', set: { hidden: true } }] } });
  await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v', set: { hidden: false } }] } });
  await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v', set: { hidden: true } }] } });
  const undo = await h.send({ type: 'UNDO_VIDEOS', changes: [{ id: 'v', before: { hidden: false }, after: first.videoStates.v }] });
  assert.equal(undo.ok, false); assert.equal(h.db.videos.v.hidden, true);
});

test('sync direction controls organization while fresher channel statistics survive', () => {
  const h = harness();
  const local = { channels: { c: { ...channel(), folderId: 'local', lastFetched: 200, videoCount: 45 } } };
  const remote = { channels: { c: { ...channel(), folderId: 'remote', lastFetched: 100, videoCount: 12 } } };
  const downloaded = h.ctx.effectiveSyncChannels('download', local, remote);
  assert.equal(downloaded.c.folderId, 'remote'); assert.equal(downloaded.c.videoCount, 45);
  const uploaded = h.ctx.effectiveSyncChannels('upload', remote, local);
  assert.equal(uploaded.c.folderId, 'remote'); assert.equal(uploaded.c.videoCount, 45);
});
