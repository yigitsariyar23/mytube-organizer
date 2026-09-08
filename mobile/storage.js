// Device-local library, shared across this app's tabs. Gist sync remains explicit.
export function openStorage(indexedDB, onChanged) {
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open('mytube-mobile', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transact(mode, operation) {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save on this device.'));
      operation(tx.objectStore('state'), value => { result = value; });
    });
  }
  return {
    async get(keys) {
      return transact('readonly', (store, done) => {
        const values = {};
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { done(values); return; }
          if (keys == null || [].concat(keys).includes(cursor.key)) values[cursor.key] = cursor.value;
          cursor.continue();
        };
      });
    },
    async set(values) {
      const changes = await transact('readwrite', (store, done) => {
        const changed = {};
        for (const [key, value] of Object.entries(values)) {
          const request = store.get(key);
          request.onsuccess = () => {
            if (JSON.stringify(request.result) === JSON.stringify(value)) return;
            changed[key] = { oldValue: request.result, newValue: value };
            store.put(value, key);
          };
        }
        done(changed);
      });
      if (Object.keys(changes).length) onChanged(changes);
    },
    async remove(keys) {
      const changes = await transact('readwrite', (store, done) => {
        const changed = {};
        for (const key of [].concat(keys)) {
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result === undefined) return;
            changed[key] = { oldValue: request.result };
            store.delete(key);
          };
        }
        done(changed);
      });
      if (Object.keys(changes).length) onChanged(changes);
    }
  };
}
