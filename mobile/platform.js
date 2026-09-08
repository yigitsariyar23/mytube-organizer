import { native, callNative, nativeStorage } from './native.js';
import { openStorage } from './storage.js';
const event = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: (...args) => { for (const fn of listeners) fn(...args); }, listeners }; };
const storageEvent = event(), installed = event(), messages = event();
const channel = new BroadcastChannel('mytube-mobile');
const changed = changes => { storageEvent.emit(changes, 'local'); channel.postMessage(changes); };
const local = native ? nativeStorage(changed) : openStorage(indexedDB, changed);
channel.onmessage = event => storageEvent.emit(event.data, 'local');
const nativeFetch = globalThis.fetch.bind(globalThis);
// Only public YouTube metadata/feed reads need the same-origin bridge. Credentials
// for GitHub and the Data API stay on the device and go directly to their APIs.
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
  if (url.hostname === 'www.youtube.com' && ['/oembed', '/feeds/videos.xml'].includes(url.pathname)) {
    const target = new URL('/api/youtube', location.origin);
    if (url.pathname === '/oembed') {
      target.searchParams.set('video', new URL(url.searchParams.get('url')).searchParams.get('v'));
    } else target.searchParams.set('channel', url.searchParams.get('channel_id'));
    if (native) return callNative('metadata', Object.fromEntries(target.searchParams)).then(result => new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType } }));
    return nativeFetch(target, options);
  }
  return nativeFetch(input, options);
};

function openTab({ url }) {
  const parsed = new URL(url, location.origin);
  if (parsed.origin === location.origin) return Promise.resolve({ id: 1, windowId: 1 });
  if (!['https:', 'http:'].includes(parsed.protocol)) return Promise.reject(new Error('Unsupported link.'));
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
  return Promise.resolve({ id: 1, windowId: 1 });
}
const notifications = event();
export const platform = {
  storage: { local, onChanged: storageEvent },
  runtime: {
    id: 'mytube-mobile', platform: 'mobile-web', onInstalled: installed, onStartup: event(), onMessage: messages,
    getURL: path => new URL('/' + path, location.origin).href,
    withLibraryLock: work => native ? work() : navigator.locks.request('mytube-library-write', work),
    ...(native ? { exportBackup: backup => callNative('exportBackup', { backup }) } : {}),
    sendMessage(message) { return new Promise(resolve => {
      let handled = false;
      for (const handler of messages.listeners) handled = handler(message, { id: 'mytube-mobile' }, resolve) || handled;
      if (!handled) resolve({ ok: false, error: 'This action is not available on mobile.' });
    }); },
    reload: () => location.reload(),
    sendNativeMessage: (_host, _message, callback) => callback({ ok: false })
  },
  tabs: { create: openTab, query: async () => [{ id: 1, windowId: 1 }], update: async () => ({ id: 1 }) },
  windows: { update: async () => ({}) },
  alarms: { create() {}, onAlarm: event() },
  action: { onClicked: event() },
  notifications: { create: (_id, details) => notifications.emit(details) }
};
export async function initialize() {
  if (!native && !navigator.locks) throw new Error('This browser cannot safely coordinate library writes. Use an up-to-date browser with a secure HTTPS connection.');
  globalThis.chrome = platform;
  await import('../background.js');
  for (const fn of installed.listeners) await fn();
  const prefs = await local.get(['currentView']);
  if (!prefs.currentView) await local.set({ currentView: 'watchlater' });
  return platform;
}
