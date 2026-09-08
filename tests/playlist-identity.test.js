import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.js';
import { isPlaylistOverlayTitle } from '../shared/library.js';

const videoId = 'abcdefghijk';
const channelId = 'UC' + 'a'.repeat(22);
function link(href, textContent) {
  return { textContent, matches: () => true, getAttribute: name => name === 'href' ? href : null };
}
async function scrape({ bylines = [], sibling = false, knownRow = true, overlayFirst = false } = {}) {
  const h = harness();
  const video = link('/watch?v=' + videoId, 'Video title');
  const overlay = link('/watch?v=' + videoId, 'İZLENDİ21:01 21:01 Şimdi oynatılıyor');
  overlay.matches = () => false;
  const owner = link('/@owner', 'Playlist owner');
  const outer = { querySelectorAll: selector => selector.includes('watch?v=')
    ? [video, ...(sibling ? [link('/watch?v=12345678901', 'Other video')] : [])]
    : [video, owner], parentElement: null };
  const row = { querySelectorAll: selector => selector.includes('watch?v=') ? [video] : [video, ...bylines], parentElement: outer };
  video.parentElement = row;
  video.closest = () => knownRow ? row : null;
  overlay.parentElement = row;
  overlay.closest = video.closest;
  let message;
  h.ctx.document = {
    body: { appendChild() {} }, documentElement: {}, title: 'Playlist - YouTube',
    createElement: () => ({ style: {}, remove() {} }),
    querySelector: selector => selector.startsWith('h1') ? null : video,
    querySelectorAll: selector => selector === 'yt-formatted-string, span, div' ? [{ textContent: '1 video' }] : (overlayFirst ? [overlay, video] : [video, overlay])
  };
  h.ctx.setTimeout = () => 0;
  h.ctx.chrome.runtime.sendMessage = value => { message = value; };
  await h.ctx.scrapePlaylistInPage('playlist');
  return message.videos[0];
}

test('playlist byline retains a handle link and reads only its own text', async () => {
  const video = await scrape({ bylines: [link('/@creator', '  Real   Creator  ')] });
  assert.equal(video.author, 'Real Creator');
  assert.equal(video.channelUrl, 'https://www.youtube.com/@creator');
  assert.equal(video.channelId, null);
});
test('missing or ambiguous bylines never borrow the playlist owner', async () => {
  assert.equal((await scrape()).author, null);
  assert.equal((await scrape({ bylines: [link('/@a', 'A'), link('/@b', 'B')] })).author, null);
  assert.equal((await scrape({ knownRow: false, sibling: true })).author, null);
});
test('absolute channel links work and external lookalikes are ignored', async () => {
  const video = await scrape({ bylines: [link('https://www.youtube.com/channel/' + channelId, 'Creator')] });
  assert.equal(video.channelId, channelId);
  assert.equal((await scrape({ bylines: [link('https://evil.example/@fake', 'Fake')] })).author, null);
});
test('API details correct an already populated wrong channel identity', async () => {
  const h = harness({}, async (_db, url) => ({ ok: true, json: async () => ({
    items: String(url).includes('/videos?') ? [{ id: videoId, contentDetails: { duration: 'PT1M' },
      snippet: { title: 'Actual video title', channelId, channelTitle: 'Verified Creator', publishedAt: '2026-01-01T00:00:00Z' } }] : []
  }) }));
  const store = { [videoId]: { id: videoId, author: 'Playlist owner', channelId: 'wrong',
    channelThumbnail: 'wrong-avatar', saved: true, watched: true, folderId: 'my-list' } };
  await h.ctx.fillVideoDetails(store, 'key', [videoId]);
  assert.equal(store[videoId].author, 'Verified Creator');
  assert.equal(store[videoId].title, 'Actual video title');
  assert.equal(store[videoId].channelId, channelId);
  assert.equal(store[videoId].channelUrl, 'https://www.youtube.com/channel/' + channelId);
  assert.equal(store[videoId].channelThumbnail, null);
  assert.equal(store[videoId].watched, true);
  assert.equal(store[videoId].folderId, 'my-list');
});

test('playlist titles ignore longer thumbnail overlay text regardless of anchor order', async () => {
  assert.equal((await scrape({ overlayFirst: true })).title, 'Video title');
  assert.equal((await scrape()).title, 'Video title');
});
test('legacy overlay detection does not reject real titles with durations', () => {
  assert.ok(isPlaylistOverlayTitle('İZLENDİ21:01 21:01 Şimdi oynatılıyor'));
  assert.ok(isPlaylistOverlayTitle('WATCHED 21:01 Now playing'));
  assert.equal(isPlaylistOverlayTitle('I watched this at 21:01'), false);
  assert.equal(isPlaylistOverlayTitle('A real video title'), false);
});
