// Development-only fixture. Never loaded by the extension dashboard itself.
const nativeFetch = window.fetch.bind(window);
const listeners = [], messageHandlers = [];
const event = () => ({ addListener() {} });
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263c4a"/><circle cx="160" cy="90" r="30" fill="#679fbc"/><path d="M150 72v36l28-18z" fill="#fff"/></svg>');
const db = {
  channels: Object.fromEntries(Array.from({ length: 180 }, (_, i) => [`c${i}`, { id: `c${i}`, name: `Channel ${String(i).padStart(3, '0')}`, thumbnail: image, folderId: i % 3 ? 'science-1' : 'unsorted', tags: ['tag-1'], trackVideos: true, fetchedAll: true, active: false, lastFetched: Date.now() }])),
  folders: { unsorted: { name: 'Unfiled', order: 0 }, 'science-1': { name: 'Science', order: 1 } },
  videoFolders: { unsorted: { name: 'Unfiled', order: 0 }, 'learning-1': { name: 'Learning', order: 1 } },
  tags: { 'tag-1': { name: 'Learning', color: '#A8DADC' } },
  videos: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`v${i}`, { id: `v${i}`, channelId: `c${i % 180}`, title: `Video ${String(i).padStart(4, '0')} — exploring the world`, thumbnail: image, duration: 120 + i,
    published: new Date(Date.now() - (i + 1) * 3600000).toISOString(), watched: i % 9 === 0, saved: i % 5 === 0, hidden: i % 11 === 0, folderId: 'unsorted', addedAt: Date.now() - i * 3600000 }])),
  currentView: 'new', gistToken: 'fake-fixture-token', gistId: 'fixture', lastSyncCheckAt: Date.now(), languages: ['English']
};
window.fixture = { db, remote: structuredClone(db), opened: [], rssFailures: new Set(), confirmations: [] };
// Keep test confirmations inspectable without a native modal blocking automation.
window.confirm = message => { window.fixture.confirmations.push(message); return true; };
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario === 'sync' || scenario === 'stale') {
  window.fixture.remote.tags['tag-1'].name = 'Remote learning';
  delete window.fixture.remote.channels.c1;
}
if (scenario === 'refresh') { window.fixture.rssFailures.add('c1'); window.fixture.rssFailures.add('c2'); }
let gistReads = 0;
window.chrome = {
  storage: {
    onChanged: { addListener(fn) { listeners.push(fn); } },
    local: {
      async get(keys) { return structuredClone(Object.fromEntries((keys == null ? Object.keys(db) : [].concat(keys)).filter(key => key in db).map(key => [key, db[key]]))); },
      async set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) if (JSON.stringify(value) !== JSON.stringify(db[key])) changes[key] = { oldValue: structuredClone(db[key]), newValue: structuredClone(value) };
        Object.assign(db, structuredClone(values));
        if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach(fn => fn(changes, 'local')));
      },
      async remove(keys) {
        const changes = {};
        for (const key of [].concat(keys)) { if (key in db) changes[key] = { oldValue: structuredClone(db[key]) }; delete db[key]; }
        if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach(fn => fn(changes, 'local')));
      }
    }
  },
  runtime: { id: 'fixture', onInstalled: event(), onStartup: event(), onMessage: { addListener(fn) { messageHandlers.push(fn); } },
    getURL: path => new URL('/' + path, location.origin).href,
    sendMessage: message => new Promise(resolve => messageHandlers[0](structuredClone(message), { id: 'fixture' }, result => resolve(structuredClone(result)))),
    sendNativeMessage(_host, _message, callback) { callback({ ok: false }); }
  },
  alarms: { onAlarm: event() }, action: { onClicked: event() }, notifications: { create() {} },
  tabs: { create(tab) { window.fixture.opened.push(tab); }, async query() { return []; } }
};
window.fetch = async (url, options = {}) => {
  const parsed = new URL(url, location.href);
  if (parsed.origin === location.origin) return nativeFetch(url, options);
  if (parsed.href.includes('/gists/')) {
    if (options.method === 'PATCH') { window.fixture.remote = JSON.parse(JSON.parse(options.body).files['mytube-organizer.json'].content); return new Response(JSON.stringify({ id: 'fixture' })); }
    const content = JSON.stringify(window.fixture.remote);
    if (scenario === 'stale' && ++gistReads === 1) window.fixture.remote.tags['tag-1'].name = 'Changed after review';
    return new Response(JSON.stringify({ files: { 'mytube-organizer.json': { content } } }));
  }
  if (parsed.pathname.includes('feeds/videos.xml')) {
    const id = parsed.searchParams.get('channel_id');
    if (window.fixture.rssFailures.has(id)) { window.fixture.rssFailures.delete(id); return new Response('', { status: 503 }); }
    return new Response('<feed></feed>');
  }
  return new Response('{}', { status: 404 });
};
await import('../background.js');
await import('../dashboard/dashboard.js');
window.fixture.ready = true;
if (new URLSearchParams(location.search).has('smoke')) await import('./browser-smoke.js');
