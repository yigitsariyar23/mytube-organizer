import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, channel, deferred } from './harness.js';

const json = body => ({ ok: true, json: async () => structuredClone(body) });
const apiChannel = (id = 'c', count = '20') => ({ id, statistics: { videoCount: count }, contentDetails: { relatedPlaylists: { uploads: `actual-uploads-${id}` } } });
const upload = (id, published = '2026-09-01T12:00:00Z', title = `Video ${id}`) => ({
  contentDetails: { videoId: id, videoPublishedAt: published },
  snippet: { title, publishedAt: '2026-09-07T00:00:00Z' },
});

function feedHarness({ channels = { c: channel() }, videos = {}, apiKey = 'test-key', channelItems = [apiChannel()], playlist = { items: [] }, playlistFetch, rssStatus = 404 } = {}) {
  const calls = [];
  const h = harness({ apiKey, channels, videos }, async (_db, rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options });
    if (url.pathname === '/feeds/videos.xml') return rssStatus === 200
      ? { ok: true, text: async () => '<feed></feed>' }
      : { ok: false, status: rssStatus };
    if (url.pathname.endsWith('/channels')) return json({ items: channelItems });
    if (url.pathname.endsWith('/playlistItems')) return playlistFetch ? playlistFetch() : json(playlist);
    if (url.pathname.endsWith('/videos')) return json({ items: [] });
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  return { ...h, calls, uploadsCalls: () => calls.filter(c => c.url.pathname.endsWith('/playlistItems')) };
}

test('freshly confirmed empty channels recover from RSS 404 and clear previous failures', async () => {
  const channels = Object.fromEntries(['a', 'b'].map(id => [id, { ...channel(id), lastFetched: 42, lastFetchError: 'YouTube feed: HTTP 404' }]));
  const existing = { id: 'old', channelId: 'a', watched: true, hidden: true, duration: 10, published: '2020-01-01' };
  const h = feedHarness({ channels, channelItems: [apiChannel('a', '0'), apiChannel('b', 0)], videos: { old: existing } });
  const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['a', 'b'] });
  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.rssFailures, 0);
  for (const id of ['a', 'b']) {
    assert.ok(h.db.channels[id].lastFetched > 42);
    assert.ok(h.db.channels[id].lastFetchAttempt > 42);
    assert.equal(h.db.channels[id].lastFetchError, undefined);
    assert.equal(h.db.channels[id].fetchedAll, undefined);
  }
  assert.deepEqual(h.db.videos.old, existing);
  assert.equal(h.uploadsCalls().length, 0);
});

test('a missing RSS feed falls back to the real uploads playlist with a bounded recent window', async () => {
  const items = [upload('private', undefined, 'Private video'), upload('deleted', undefined, 'Deleted video'), {}];
  for (let i = 0; i < 20; i++) items.push(upload(`v${i}`, new Date(Date.UTC(2026, 8, 7 - i)).toISOString()));
  const h = feedHarness({ playlist: { items, nextPageToken: 'older-videos' } });
  const result = await h.send({ type: 'REFRESH_SINGLE', channelId: 'c' });
  assert.equal(result.ok, true);
  assert.equal(h.uploadsCalls().length, 1);
  const { url, options } = h.uploadsCalls()[0];
  assert.equal(url.searchParams.get('playlistId'), 'actual-uploads-c');
  assert.equal(url.searchParams.get('maxResults'), '50');
  assert.equal(url.searchParams.has('pageToken'), false);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(Object.keys(h.db.videos).length, 15);
  assert.equal(h.db.videos.v0.published, '2026-09-07T00:00:00.000Z');
  assert.equal(h.db.videos.v1.published, '2026-09-06T00:00:00.000Z');
  assert.equal(h.db.videos.v0.watched, false);
  assert.equal(h.db.channels.c.lastVideoDate, h.db.videos.v0.published);
  assert.equal(h.db.channels.c.fetchedAll, undefined);
});

test('RSS recovery respects tracking and preserves edits made during its network request', async () => {
  const entered = deferred(), finish = deferred();
  const h = feedHarness({ videos: { v: { id: 'v', channelId: 'c', watched: false, duration: 10 } }, playlistFetch: async () => {
    entered.resolve(); await finish.promise; return json({ items: [upload('v'), upload('new')] });
  } });
  const refresh = h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
  await entered.promise;
  await h.send({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v', set: { watched: true, hidden: true } }], channels: [{ id: 'c', set: { trackVideos: false, folderId: 'elsewhere' } }] } });
  finish.resolve();
  assert.equal((await refresh).ok, true);
  assert.equal(h.db.videos.v.watched, true);
  assert.equal(h.db.videos.v.hidden, true);
  assert.equal(h.db.videos.new, undefined);
  assert.equal(h.db.channels.c.trackVideos, false);
  assert.equal(h.db.channels.c.folderId, 'elsewhere');
});

test('a channel absent from a successful API lookup remains a named failure', async () => {
  const h = feedHarness({ channels: { c: { ...channel(), lastFetched: 42, videoCount: 0 } }, channelItems: [] });
  const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.rssFailures, 1);
  assert.equal(result.failures[0].id, 'c');
  assert.match(result.failures[0].error, /Channel not found on YouTube/);
  assert.equal(h.db.channels.c.lastFetched, 42);
  assert.ok(h.db.channels.c);
  assert.equal(h.uploadsCalls().length, 0);
});

test('a cached zero video count cannot turn an unverified RSS 404 into a success', async t => {
  for (const scenario of ['no key', 'missing count', 'missing playlist', 'failed lookup']) await t.test(scenario, async () => {
    let h;
    if (scenario === 'failed lookup') {
      h = harness({ apiKey: 'test-key', channels: { c: { ...channel(), lastFetched: 42, videoCount: 0 } } }, async (_db, url) => url.includes('googleapis')
        ? { ok: false, status: 403, text: async () => '{"error":{"message":"Quota exceeded"}}' }
        : { ok: false, status: 404 });
    } else {
      const item = apiChannel();
      if (scenario === 'missing count') item.statistics = {};
      if (scenario === 'missing playlist') delete item.contentDetails;
      h = feedHarness({ apiKey: scenario === 'no key' ? '' : 'test-key', channels: { c: { ...channel(), lastFetched: 42, videoCount: 0 } }, channelItems: [item],
        playlistFetch: async () => ({ ok: false, status: 503, text: async () => '{}' }) });
    }
    const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
    assert.equal(result.ok, false);
    assert.equal(h.db.channels.c.lastFetched, 42);
    assert.ok(h.db.channels.c.lastFetchError);
    if (scenario === 'no key') assert.match(result.failures[0].error, /API key in Settings/);
  });
});

test('an unavailable, malformed, or timed-out uploads fallback remains retryable', async t => {
  const cases = [
    ['404', async () => ({ ok: false, status: 404 }), /uploads playlist is also unavailable/],
    ['quota', async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"Quota exceeded"}}' }), /Quota exceeded/],
    ['malformed', async () => json({}), /invalid upload details/],
    ['timeout', async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, /timed out/],
    ['network', async () => { throw new TypeError('Failed to fetch'); }, /Failed to fetch/],
  ];
  for (const [name, playlistFetch, message] of cases) await t.test(name, async () => {
    const h = feedHarness({ channels: { c: { ...channel(), lastFetched: 42 } }, playlistFetch });
    const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
    assert.equal(result.ok, false);
    assert.equal(result.apiFailures, 1);
    assert.equal(result.rssFailures, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].error, message);
    assert.equal(h.db.channels.c.lastFetched, 42);
    assert.equal(h.db.channels.c.lastFetchError, result.failures[0].error);
  });
});

test('successful and non-404 RSS responses do not spend quota on an uploads fallback', async t => {
  for (const rssStatus of [200, 403, 429, 503]) await t.test(String(rssStatus), async () => {
    const h = feedHarness({ rssStatus, channelItems: [apiChannel('c', '0')] });
    const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
    assert.equal(result.ok, rssStatus === 200);
    assert.equal(h.uploadsCalls().length, 0);
  });
});

test('an unreadable first uploads page does not hide the need to fetch older pages', async () => {
  const h = feedHarness({ playlist: { items: [upload('private', undefined, 'Private video')], nextPageToken: 'older' } });
  const result = await h.send({ type: 'REFRESH_STATS', channelIds: ['c'] });
  assert.equal(result.ok, false);
  assert.match(result.failures[0].error, /Fetch full history/);
  assert.equal(h.db.channels.c.lastFetched, undefined);
});

test('the full-history fetch still imports every page using the shared upload parser', async () => {
  let pages = 0;
  const h = feedHarness({ playlistFetch: async () => json(++pages === 1
    ? { items: [upload('v1')], nextPageToken: 'next' }
    : { items: [upload('v2'), upload('private', undefined, 'Private video')] }) });
  const result = await h.send({ type: 'FETCH_ALL_VIDEOS', channelIds: ['c'] });
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(pages, 2);
  assert.equal(h.db.channels.c.fetchedAll, true);
  assert.equal(Object.keys(h.db.videos).length, 2);
});
