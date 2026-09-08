import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as library from '../shared/library.js';
const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '');
export const seed = () => ({ channels: {}, videos: {}, folders: { unsorted: { name: 'Unfiled', order: 0 } }, videoFolders: { unsorted: { name: 'Unfiled', order: 0 } }, tags: {} });
export const channel = (id = 'c') => ({ id, name: `Channel ${id}`, folderId: 'unsorted', tags: [], trackVideos: true });
export function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
export function harness(initial = {}, fetcher = async () => ({ ok: true, text: async () => '<feed></feed>' })) {
  const db = structuredClone({ ...seed(), ...initial });
  const listeners = [];
  const event = { addListener() {} };
  const local = {
    async get(keys) { return structuredClone(Object.fromEntries((keys == null ? Object.keys(db) : [].concat(keys)).filter(k => Object.hasOwn(db, k)).map(k => [k, db[k]]))); },
    async set(data) { Object.assign(db, structuredClone(data)); },
    async remove(keys) { for (const k of [].concat(keys)) delete db[k]; }
  };
  const ctx = vm.createContext({ ...library, structuredClone, crypto: webcrypto, TextEncoder, URL, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, fetch: (...args) => fetcher(db, ...args),
    chrome: { storage: { local }, runtime: { id: 'test', onInstalled: event, onStartup: event, onMessage: { addListener(fn) { listeners.push(fn); } } },
      alarms: { onAlarm: event }, action: { onClicked: event }, notifications: { create() {} } }
  });
  vm.runInContext(source, ctx);
  const send = msg => new Promise(resolve => listeners[0](msg, { id: 'test' }, resolve));
  return { db, ctx, send, local };
}
export function gistFetcher(remote) {
  return async (_db, _url, options = {}) => {
    if (options.method === 'PATCH') { Object.assign(remote, JSON.parse(JSON.parse(options.body).files['mytube-organizer.json'].content)); return { ok: true, json: async () => ({ id: 'gist' }) }; }
    return { ok: true, json: async () => ({ files: { 'mytube-organizer.json': { content: JSON.stringify(remote) } } }) };
  };
}
