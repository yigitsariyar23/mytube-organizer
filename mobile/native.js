// Native storage survives web-view reloads and changes to the private loopback port.
export const native = globalThis.webkit?.messageHandlers?.mytube;
export const callNative = (type, values = {}) => native.postMessage({ type, ...values });
export function nativeStorage(onChanged) {
  return {
    get: keys => callNative('get', { keys: keys ?? null }),
    async set(values) { const changes = await callNative('set', { values }); if (Object.keys(changes).length) onChanged(changes); },
    async remove(keys) { const changes = await callNative('remove', { keys: [].concat(keys) }); if (Object.keys(changes).length) onChanged(changes); }
  };
}
// A share is acknowledged only after the library write succeeds. Retrying after
// interruption is safe: SAVE_VIDEO does not change an already-saved video's list.
export async function consumeInbox(items, send, acknowledge, onPlaylist) {
  for (const item of items) {
    if (item.videoId) {
      const result = await send({ type: 'SAVE_VIDEO', videoId: item.videoId });
      if (!result?.ok) throw new Error(result?.error || 'Could not save shared video.');
      await acknowledge(item.id);
    } else if (item.playlistId) { await onPlaylist(item); break; }
  }
}
