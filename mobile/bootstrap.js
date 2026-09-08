import { native, callNative, consumeInbox } from './native.js';
import { initialize, platform } from './platform.js';
import { parseYouTubeLink, readPlaylist } from './links.js';
const $ = selector => document.querySelector(selector);
let sharedPlaylistId = null;
function text(selector, value) { $(selector).textContent = value; }
function folderOptions(folders) {
  const parents = new Set(Object.values(folders).map(folder => folder.parentId).filter(Boolean));
  return Object.entries(folders).filter(([id]) => !parents.has(id)).sort((a, b) => a[1].order - b[1].order).map(([id, folder]) => {
    const option = document.createElement('option'); option.value = id;
    option.textContent = folder.parentId ? `${folders[folder.parentId]?.name || ''} / ${folder.name}` : folder.name;
    return option;
  });
}
const showDrawer = show => { document.body.classList.toggle('mobile-drawer-open', show); $('#mobileFolders').setAttribute('aria-expanded', String(show)); };
async function openSave() {
  const { videoFolders = {} } = await platform.storage.local.get('videoFolders');
  $('#mobileList').replaceChildren(...folderOptions(videoFolders));
  $('#mobileSaveStatus').textContent = '';
  $('#mobileSaveModal').hidden = false;
  $('#mobileUrl').focus();
}
async function saveLink(mode) {
  const buttons = [$('#mobileSaveVideo'), $('#mobileImportPlaylist'), $('#mobileSaveCancel')];
  for (const button of buttons) button.disabled = true;
  try {
    const link = parseYouTubeLink($('#mobileUrl').value);
    if (mode === 'video') {
      if (!link.videoId) throw new Error('This is a playlist link. Choose Import playlist.');
      text('#mobileSaveStatus', 'Saving on this device…');
      const result = await platform.runtime.sendMessage({ type: 'SAVE_VIDEO', videoId: link.videoId, folderId: $('#mobileList').value });
      if (!result?.ok) throw new Error(result?.error || 'Could not save video.');
      $('#mobileSaveModal').hidden = true;
      $('#mobileUrl').value = '';
      $('#viewWatchLaterBtn').click();
      text('#statusText', result.already ? 'Already saved. Moved to your selected list.' : 'Saved to Watch Later on this device.');
    } else {
      if (!link.playlistId) throw new Error('This link is a single video. Choose Save video.');
      const { apiKey } = await platform.storage.local.get('apiKey');
      text('#mobileSaveStatus', 'Reading playlist… keep MyTube open.');
      const preview = await readPlaylist(link.playlistId, apiKey);
      // The normal desktop review owns all apply/move decisions.
      $('#mobileSaveModal').hidden = true;
      const result = await platform.runtime.sendMessage({ type: 'PLAYLIST_SCAN_RESULT', ...preview });
      if (!result?.ok) { $('#mobileSaveModal').hidden = false; throw new Error(result?.error || 'No readable videos found.'); }
      if (sharedPlaylistId) { await callNative('acknowledge', { id: sharedPlaylistId }); sharedPlaylistId = null; }
    }
  } catch (error) { text('#mobileSaveStatus', error.message); }
  finally { for (const button of buttons) button.disabled = false; }
}
function addTouchActions() {
  // These mobile-only controls replace the right-click gesture on touch screens.
  for (const row of document.querySelectorAll('.video-card, .channel-row, .folder-item')) {
    if (row.querySelector('.mobile-item-actions')) continue;
    if (row.classList.contains('folder-item') && ['all', 'filed', 'unsorted'].includes(row.dataset.folderId)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mobile-item-actions';
    button.textContent = 'Actions'; button.dataset.action = 'mobile-menu'; button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-label', `Actions for ${row.querySelector('.video-title, .channel-name, .folder-name')?.textContent || 'item'}`);
    (row.querySelector('.video-actions, .channel-controls') || row).append(button);
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const rect = button.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
    });
  }
}
try {
  await initialize();
  const { dashboardReady } = await import('../dashboard/dashboard.js');
  await dashboardReady;
  if (native) await callNative('ready');
  $('#mobileLoading').remove();
  $('#mobileFolders').addEventListener('click', () => showDrawer(!document.body.classList.contains('mobile-drawer-open')));
  $('#mobileShade').addEventListener('click', () => showDrawer(false));
  $('#folderList').addEventListener('click', event => { if (event.target.closest('.folder-item') && !event.target.closest('.mobile-item-actions')) showDrawer(false); });
  $('#mobileSettings').addEventListener('click', () => { showDrawer(false); $('#settingsBtn').click(); });
  $('#mobileSaveOpen').addEventListener('click', openSave);
  $('#mobileSaveCancel').addEventListener('click', () => { $('#mobileUrl').blur(); $('#mobileSaveModal').hidden = true; });
  $('#mobileUrl').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } });
  $('#mobileSaveVideo').addEventListener('click', () => saveLink('video'));
  $('#mobileImportPlaylist').addEventListener('click', () => saveLink('playlist'));
  $('#mobileSaveModal').addEventListener('click', event => { if (event.target === $('#mobileSaveModal')) $('#mobileSaveModal').hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { showDrawer(false); $('#mobileSaveModal').hidden = true; } });
  const watch = new MutationObserver(addTouchActions);
  for (const id of ['videoFeed', 'watchLaterGrid', 'channelGrid', 'folderList']) watch.observe($('#' + id), { childList: true, subtree: true });
  addTouchActions();
  // Prefill only: even incoming share/deep links need the user's Save/Import tap.
  const params = new URLSearchParams(location.search);
  const incoming = params.get('url') || params.get('text');
  if (incoming) { $('#mobileUrl').value = incoming; await openSave(); history.replaceState(null, '', location.pathname); }
  if (native) {
    $('#mobileInstall').hidden = true;
    let consuming = false;
    const receiveShares = async () => {
      if (consuming || !$('#mobileSaveModal').hidden) return;
      consuming = true;
      try {
        await consumeInbox(await callNative('inbox'), platform.runtime.sendMessage, id => callNative('acknowledge', { id }), async item => {
          sharedPlaylistId = item.id; $('#mobileUrl').value = item.url; await openSave();
        });
      } catch (error) { text('#statusText', `Shared link is still on this device: ${error.message}`); }
      finally { consuming = false; }
    };
    addEventListener('mytube-foreground', receiveShares);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) receiveShares(); });
    await receiveShares();
  }
  $('#mobileInstall').addEventListener('click', () => {
    alert('On iPhone or iPad: open MyTube in your browser, tap Share, then Add to Home Screen. Your library stays on this device; use Gist sync or export a backup to keep another copy.');
  });
  const updateOnline = () => { text('#mobileConnection', navigator.onLine ? '' : 'Offline · saved changes stay on this device'); };
  addEventListener('online', updateOnline); addEventListener('offline', updateOnline); updateOnline();
  if (!native && 'serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
} catch (error) {
  if (native) callNative('startupError').catch(() => {});
  text('#mobileLoading', `MyTube could not start: ${error.message}. Reload to try again.`);
}
