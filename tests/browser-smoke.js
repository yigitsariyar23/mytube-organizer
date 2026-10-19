// Runs against the actual dashboard and worker modules, using fixture data only.
import { makeBackup } from '../shared/library.js';
const results = [];
const output = document.createElement('pre');
output.id = 'fixtureResults';
output.setAttribute('role', 'status');
output.style.cssText = 'position:fixed;inset:10px;z-index:10000;background:#15231c;color:#dbffe6;padding:20px;overflow:auto;pointer-events:none;white-space:pre-wrap';
document.body.appendChild(output);
const $ = selector => document.querySelector(selector);
const click = selector => { const node = $(selector); if (!node) throw new Error(`Missing ${selector}`); node.click(); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message || 'UI did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function check(name, run) {
  try { await run(); results.push(`PASS ${name}`); }
  catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
  output.textContent = results.join('\n');
}
const isOpen = selector => $(selector).open;
// Esc / backdrop on a kit <dialog>: a close request the dialog may refuse.
const requestClose = dialog => (dialog.requestClose ? dialog.requestClose() : dialog.close());
const toastButton = label => [...document.querySelectorAll('.ui-toast button')].find(button => button.textContent === label);
const menuItem = label => [...document.querySelectorAll('.ui-menu .ui-menu-item')].find(item => item.textContent.trim() === label);
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = mac ? { metaKey: true } : { ctrlKey: true };
const clickWith = (node, extra = {}) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...extra }));
const key = (code, extra = {}, target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { code, key: extra.key || code.replace(/^(Key|Digit)/, '').toLowerCase(), bubbles: true, cancelable: true, ...extra }));
await until(() => $('#videoFeed .video-card'));
await check('New and Watch Later channel names and avatars link to the channel', async () => {
  for (const view of ['#viewNewBtn', '#viewWatchLaterBtn']) {
    click(view);
    const grid = view === '#viewNewBtn' ? '#videoFeed' : '#watchLaterGrid';
    await until(() => $(grid + ' a.video-channel'));
    const channelLink = $(grid + ' a.video-channel');
    assert(channelLink.href.includes('/channel/') && channelLink.href.endsWith('/videos'), 'channel destination missing');
    assert(channelLink.target === '_blank', 'channel must open in another tab');
    assert(channelLink.querySelector('img, .vc-avatar-fallback'), 'avatar is outside channel link');
    const before = window.fixture.opened.length;
    // Suppress native navigation in this synthetic test; card delegation still runs.
    channelLink.addEventListener('click', event => event.preventDefault(), { once: true });
    channelLink.querySelector('span').click();
    assert(window.fixture.opened.length === before, 'channel click opened the video');
  }
  click('#viewNewBtn');
});
await check('Active languages are searchable, cancellable, and restrict dashboard choices', async () => {
  click('#settingsBtn');
  click('#languagePresetBtn');
  $('#languageSearch').value = 'Türk';
  $('#languageSearch').dispatchEvent(new Event('input', { bubbles: true }));
  assert($('#languageCatalog').querySelectorAll('input').length === 1, 'native search failed');
  click('#settingsCancel');
  click('#settingsBtn');
  assert($('#languageSelection').textContent === 'English', 'cancel saved language draft');
  click('#languagePresetBtn');
  click('#settingsSave');
  await until(() => !isOpen('#settingsModal') && $('#statusText').textContent === 'Settings saved.');
  click('#viewChannelsBtn');
  await until(() => $('.var-lang'));
  $('.var-lang').click();
  const options = [...document.querySelectorAll('.ui-listbox .ui-option')];
  assert(options.map(o => o.textContent.replace(/[^A-Za-z— ]/g, '').trim()).join(',') === '— none —,Turkish,English,Russian,French', 'inactive choices leaked');
  options.find(o => o.textContent.includes('Turkish')).click();
  await until(() => window.fixture.db.channels.c0.language === 'Turkish');
  assert(window.fixture.db.languages.length === 4, 'active selection not saved');
  click('#viewNewBtn');
});
await check('All Settings tabs keep the same size and footer position', async () => {
  click('#settingsBtn');
  const bounds = [];
  for (const tab of ['#settingsGeneralTab', '#settingsControlsTab', '#settingsBackupsTab']) {
    click(tab);
    const box = $('.modal-box-settings').getBoundingClientRect();
    bounds.push([box.width, box.height, $('#settingsSave').getBoundingClientRect().top]);
  }
  assert(bounds.every(b => b.every((value, i) => Math.abs(value - bounds[0][i]) < 1)), 'Settings resized between tabs');
  click('#settingsCancel');
});
await check('Default shortcuts navigate and focus search without interrupting typing', async () => {
  key('Digit1'); await until(() => document.body.dataset.view === 'channels');
  key('Slash', { key: '/' }); assert(document.activeElement === $('#searchInput'), 'search not focused');
  key('Digit2', {}, $('#searchInput')); assert(document.body.dataset.view === 'channels', 'typing triggered navigation');
  key('Digit2'); await until(() => document.body.dataset.view === 'new');
});
await check('Shortcut recording rejects conflicts, preserves Escape, and saves a new binding', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); assert(!$('#settingsControlsPanel').hidden, 'controls tab not open');
  click('[data-record-shortcut="search"]'); key('Digit1');
  assert($('#shortcutStatus').textContent.includes('Already used'), 'duplicate accepted');
  key('Escape', { key: 'Escape' }); requestClose($('#settingsModal')); assert(isOpen('#settingsModal'), 'Escape closed settings during recording');
  click('[data-record-shortcut="search"]'); key('KeyK');
  key('Digit1'); assert(document.body.dataset.view === 'new', 'shortcut ran inside dialog');
  click('#settingsSave'); await until(() => !isOpen('#settingsModal'));
  assert(window.fixture.db.controls.bindings.search === 'KeyK', 'binding not persisted');
  document.activeElement?.blur(); key('Slash', { key: '/' }); assert(document.activeElement !== $('#searchInput'), 'old binding still active');
  key('KeyK'); assert(document.activeElement === $('#searchInput'), 'new binding did not run');
});
await check('Reset is cancellable and clearing a binding disables only that action', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); click('#resetControlsBtn'); click('#settingsCancel');
  assert(window.fixture.db.controls.bindings.search === 'KeyK', 'Cancel saved draft');
  click('#settingsBtn'); click('#settingsControlsTab'); click('[data-clear-shortcut="search"]'); click('#settingsSave'); await until(() => !isOpen('#settingsModal'));
  document.activeElement?.blur(); key('KeyK'); assert(document.activeElement !== $('#searchInput'), 'cleared binding still active');
  key('Digit1'); await until(() => document.body.dataset.view === 'channels');
});
await check('Disabled shortcuts, Alt selection, and wheel settings are honored', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); click('#shortcutsEnabledInput');
  $('#selectionModifierInput').click(); [...document.querySelectorAll('.ui-listbox .ui-option')].find(o => /Alt|Option/.test(o.textContent)).click();
  click('#wheelAdjustsNumbersInput'); click('#settingsSave'); await until(() => !isOpen('#settingsModal'));
  key('Digit2'); assert(document.body.dataset.view === 'channels', 'disabled shortcut ran');
  const row = $('#channelGrid [data-channel-id]'); row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  assert(row.classList.contains('selected'), 'Alt selection failed');
  const input = $('#filterMinCount'), before = input.value;
  input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  assert(input.value === before, 'disabled wheel changed filter');
  click('#settingsBtn'); click('#settingsControlsTab'); click('#resetControlsBtn'); click('#settingsSave'); await until(() => !isOpen('#settingsModal'));
  key('Digit2'); await until(() => document.body.dataset.view === 'new');
});
await check('Settings tabs and filter chips retain standard keyboard behavior', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); await Promise.resolve();
  assert(document.activeElement === $('#settingsControlsTab'), 'unselected tab received focus');
  key('ArrowRight', { key: 'ArrowRight' }, $('#settingsControlsTab'));
  assert(!$('#settingsBackupsPanel').hidden && document.activeElement === $('#settingsBackupsTab'), 'tab arrows did not move panels');
  requestClose($('#settingsModal')); assert(!isOpen('#settingsModal'), 'Escape did not dismiss dialog');
  key('Enter', { key: 'Enter', shiftKey: true }, $('#videoUnwatchedChip'));
  assert($('#videoUnwatchedChip').classList.contains('out'), 'keyboard exclusion did not select watched videos');
  key('Enter', { key: 'Enter', shiftKey: true }, $('#videoUnwatchedChip'));
  click('#videoUnwatchedChip');
});
await check('Video lists render 60 cards then load another 60', async () => {
  assert(document.querySelectorAll('#videoFeed .video-card').length === 60, 'initial page');
  click('#videoLoadMoreBtn');
  assert(document.querySelectorAll('#videoFeed .video-card').length === 120, 'second page');
});
await check('Background writes preserve loaded cards and scroll position', async () => {
  const card = $('#videoFeed [data-video-id="v1"]');
  const main = $('.main'); main.scrollTop = 1300;
  const before = main.scrollTop;
  await chrome.runtime.sendMessage({ type: 'PATCH_LIBRARY', patches: { videos: [{ id: 'v1999', set: { title: 'Updated off-screen' } }] } });
  assert(card === $('#videoFeed [data-video-id="v1"]'), 'unchanged card was replaced');
  assert(document.querySelectorAll('#videoFeed .video-card').length === 120, 'loaded page reset');
  assert(Math.abs(main.scrollTop - before) < 2, 'scroll jumped');
  main.scrollTop = 0;
});
await check('Remove and Undo restore the video without marking it watched', async () => {
  click('[data-video-id="v1"] [data-action="hide"]');
  await until(() => window.fixture.db.videos.v1.hidden, 'not removed');
  await until(() => document.querySelector('.ui-toast')?.textContent.includes('Removed “Video 0001'), 'no undo toast for the removal');
  toastButton('Undo').click();
  await until(() => !window.fixture.db.videos.v1.hidden);
  assert(!window.fixture.db.videos.v1.watched, 'opening/removing marked watched');
});
await check('Removed view is searchable and Restore clears the hidden flag', async () => {
  click('#viewRemovedBtn'); await until(() => document.body.dataset.view === 'removed');
  $('#searchInput').value = 'Video 0000'; $('#searchInput').dispatchEvent(new Event('input', { bubbles: true }));
  await until(() => document.querySelectorAll('#videoFeed .video-card').length === 1);
  click('[data-video-id="v0"] [data-action="restore"]');
  await until(() => !window.fixture.db.videos.v0.hidden);
  click('#viewNewBtn'); await until(() => document.body.dataset.view === 'new');
});
await check('Opening a card only opens its YouTube tab', async () => {
  const card = $('#videoFeed .video-card'), id = card.dataset.videoId;
  const before = JSON.stringify(window.fixture.db.videos[id]);
  card.click();
  assert(window.fixture.opened.at(-1).url.includes(id), 'tab was not opened');
  assert(JSON.stringify(window.fixture.db.videos[id]) === before, 'video was changed');
  assert(card.querySelector('a.video-title[target="_blank"]'), 'title is not a native link');
});
await check('Video menu actions survive a background refresh while the menu is open', async () => {
  const card = $('#videoFeed .video-card'), id = card.dataset.videoId;
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const remove = menuItem('Remove');
  assert(remove, 'remove action missing');
  await chrome.runtime.sendMessage({ type: 'PATCH_LIBRARY', patches: { videos: [{ id, set: { title: 'Updated while menu open' } }] } });
  remove.click();
  await until(() => window.fixture.db.videos[id].hidden, 'menu action was lost');
  await until(() => document.querySelector('.ui-toast')?.textContent.includes('Removed'), 'no undo toast');
  assert(window.fixture.db.videos[id].title === 'Updated while menu open', 'metadata was overwritten');
  await until(() => toastButton('Undo'));
  toastButton('Undo').click(); await until(() => !window.fixture.db.videos[id].hidden);
});
await check('No native selects or OS dialogs anywhere in the dashboard', async () => {
  assert(!document.querySelector('select'), 'a native <select> is rendered');
  assert(document.querySelectorAll('.ui-select').length >= 4, 'kit selects missing');
});
await check('Selection: Mod toggles, Shift selects a new range, Mod+Shift adds one, Mod+A and Esc', async () => {
  key('Digit1'); await until(() => document.body.dataset.view === 'channels');
  key('Escape', { key: 'Escape' });
  const rows = () => [...document.querySelectorAll('#channelGrid .channel-row')];
  clickWith(rows()[1], MOD);
  clickWith(rows()[4], { shiftKey: true });
  assert(rows().filter(r => r.classList.contains('selected')).length === 4, 'shift range');
  clickWith(rows()[7], { ...MOD, shiftKey: true });
  clickWith(rows()[2], MOD);
  assert(rows().filter(r => r.classList.contains('selected')).length === 6, 'mod+shift add range / mod toggle');
  assert($('#selectionCount').textContent === '6 selected' && !$('#selectionCount').hidden, 'N selected indicator');
  clickWith(rows()[10], { shiftKey: true });
  assert(rows().filter(r => r.classList.contains('selected')).length === 9, 'shift starts a new range from the anchor');
  key('KeyA', { ...MOD, key: 'a' });
  assert($('#selectionCount').textContent === '180 selected', 'Mod+A must cover unrendered rows');
  key('Escape', { key: 'Escape' });
  assert($('#selectionCount').hidden && !document.querySelector('.channel-row.selected'), 'Esc did not clear the selection');
});
await check('Bulk menu edits keep the selection and Undo reverts them', async () => {
  const rows = () => [...document.querySelectorAll('#channelGrid .channel-row')];
  for (const i of [0, 1, 2]) clickWith(rows()[i], MOD);
  const ids = rows().slice(0, 3).map(r => r.dataset.channelId);
  rows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  assert($('.ui-menu-title')?.textContent === '3 channels', 'bulk menu title');
  menuItem('Mark active').click();
  await until(() => ids.every(id => window.fixture.db.channels[id].active), 'bulk edit not saved');
  assert(rows().filter(r => r.classList.contains('selected')).length === 3, 'bulk edit dropped the selection');
  toastButton('Undo').click();
  await until(() => ids.every(id => !window.fixture.db.channels[id].active), 'undo did not revert');
  rows()[5].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  assert(rows().filter(r => r.classList.contains('selected')).length === 1 && rows()[5].classList.contains('selected'), 'right-click outside the selection must reset it');
  assert($('.ui-menu-title')?.textContent === window.fixture.db.channels[rows()[5].dataset.channelId].name, 'single menu title');
  key('Escape', { key: 'Escape' }); key('Escape', { key: 'Escape' });
});
await check('Dragging rows onto a folder moves them, with undo', async () => {
  const row = [...document.querySelectorAll('#channelGrid .channel-row')].find(r => window.fixture.db.channels[r.dataset.channelId].folderId === 'unsorted');
  const id = row.dataset.channelId;
  const transfer = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const folder = $('.folder-item[data-folder-id="science-1"]');
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
  folder.dispatchEvent(over);
  assert(over.defaultPrevented && folder.classList.contains('drop-into'), 'real folder must accept the drop');
  const virtual = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
  $('.folder-item[data-folder-id="all"]').dispatchEvent(virtual);
  assert(!virtual.defaultPrevented, 'All must refuse rows');
  folder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  await until(() => window.fixture.db.channels[id].folderId === 'science-1', 'drop did not move the row');
  assert(document.querySelector('.ui-toast')?.textContent.includes('Moved'), 'no Moved toast');
  toastButton('Undo').click();
  await until(() => window.fixture.db.channels[id].folderId === 'unsorted', 'undo did not move it back');
});
await check('Tag popover toggles tags, stays open, and creates tags with Enter', async () => {
  const row = $('#channelGrid .channel-row'), id = row.dataset.channelId;
  row.querySelector('[data-role="add-tag"]').click();
  await until(() => $('.tag-popover'));
  assert(document.activeElement === $('.tag-popover [data-role="new-tag"]'), 'new tag field not focused');
  $('.tag-popover [data-tag="tag-1"]').click();
  await until(() => !window.fixture.db.channels[id].tags.includes('tag-1'), 'toggle off failed');
  assert($('.tag-popover'), 'popover closed after a toggle');
  const field = $('.tag-popover [data-role="new-tag"]');
  field.value = 'Fresh tag';
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => Object.values(window.fixture.db.tags).some(t => t.name === 'Fresh tag'), 'new tag not created');
  const fresh = Object.keys(window.fixture.db.tags).find(t => window.fixture.db.tags[t].name === 'Fresh tag');
  await until(() => window.fixture.db.channels[id].tags.includes(fresh), 'new tag not applied');
  key('Escape', { key: 'Escape' });
  assert(!$('.tag-popover'), 'Esc did not close the popover');
});
await check('A first subfolder takes its parent\'s channels; Undo reverts the whole edit', async () => {
  const before = Object.values(window.fixture.db.channels).filter(c => c.folderId === 'science-1').length;
  assert(before > 0, 'fixture folder is empty');
  $('.folder-item[data-folder-id="science-1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }));
  menuItem('New subfolder…').click();
  await until(() => document.querySelector('dialog.ui-dialog[open] input'));
  const dialog = document.querySelector('dialog.ui-dialog[open]');
  dialog.querySelector('input').value = 'Physics';
  dialog.querySelector('button[value="ok"]').click();
  await until(() => Object.values(window.fixture.db.folders).some(f => f.name === 'Physics' && f.parentId === 'science-1'), 'subfolder not created');
  const physics = Object.keys(window.fixture.db.folders).find(fid => window.fixture.db.folders[fid].name === 'Physics');
  await until(() => Object.values(window.fixture.db.channels).filter(c => c.folderId === physics).length === before, 'channels not moved into the subfolder');
  assert(!Object.values(window.fixture.db.channels).some(c => c.folderId === 'science-1'), 'the group still holds channels');
  toastButton('Undo').click();
  await until(() => !window.fixture.db.folders[physics], 'undo kept the folder');
  await until(() => Object.values(window.fixture.db.channels).filter(c => c.folderId === 'science-1').length === before, 'undo did not move channels back');
  key('Digit2'); await until(() => document.body.dataset.view === 'new');
});
await check('Settings fits the viewport and creates a local snapshot', async () => {
  click('#settingsBtn'); click('#settingsBackupsTab'); click('#createBackupBtn'); await until(() => $('.backup-row'));
  const rect = $('.modal-box-settings').getBoundingClientRect();
  assert(rect.top >= 0 && rect.bottom <= innerHeight, 'settings clipped');
  assert(window.fixture.db.libraryBackups.length === 1, 'snapshot missing');
});
await check('Clear library saves a recovery snapshot; Restore recovers every collection', async () => {
  click('#clearDataBtn'); await until(() => !Object.keys(window.fixture.db.videos).length);
  assert(window.fixture.confirmations.some(text => text.includes('Clear all channels')), 'missing confirmation');
  click('#settingsBtn'); click('#settingsBackupsTab'); await until(() => document.querySelectorAll('.backup-row').length === 2);
  click('.backup-row button'); await until(() => Object.keys(window.fixture.db.videos).length === 2000);
  assert(Object.keys(window.fixture.db.channels).length === 180, 'channels not restored');
});
const imported = makeBackup({ channels: { c: { id: 'c', name: 'Imported channel', trackVideos: true, fetchedAll: true, lastFetched: Date.now() } },
  folders: { unsorted: { name: 'Unfiled', order: 0 } }, tags: { t: { name: 'Imported tag', color: '#abcdef' } },
  videoFolders: { unsorted: { name: 'Unfiled', order: 0 } }, videos: { v: { id: 'v', channelId: 'c', title: 'Imported video', saved: true, duration: 60 } } });
function upload(backup) {
  const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(backup)], 'synthetic-backup.json', { type: 'application/json' }));
  $('#backupFileInput').files = transfer.files;
  $('#backupFileInput').dispatchEvent(new Event('change', { bubbles: true }));
}
await check('JSON import previews counts and replaces the library after confirmation', async () => {
  upload(imported); await until(() => window.fixture.db.channels.c?.name === 'Imported channel');
  assert(Object.keys(window.fixture.db.videos).length === 1, 'not replaced');
  assert(window.fixture.confirmations.some(text => text.includes('1 channels, 1 videos')), 'missing import review');
});
await check('Malformed imports leave the current library unchanged', async () => {
  upload({ format: 'invalid' }); await until(() => $('#backupStatus').textContent.includes('Import failed'));
  assert(Object.keys(window.fixture.db.videos).length === 1, 'invalid import changed library');
});
await check('JSON export contains the library and excludes credentials', async () => {
  let exported;
  const original = URL.createObjectURL;
  URL.createObjectURL = blob => { exported = blob; return original(blob); };
  const prevent = event => { if (event.target.download) event.preventDefault(); };
  document.addEventListener('click', prevent, true);
  click('#exportBackupBtn'); await until(() => exported);
  const backup = JSON.parse(await exported.text());
  assert(backup.library.videos.v.title === 'Imported video', 'export missing video');
  assert(!JSON.stringify(backup).includes('fake-fixture-token'), 'credential exported');
  URL.createObjectURL = original; document.removeEventListener('click', prevent, true);
});
await check('Tag-only sync is reviewable and creates a download recovery snapshot', async () => {
  click('#settingsCancel'); window.fixture.remote = structuredClone(window.fixture.db); window.fixture.remote.tags.t.name = 'Remote tag';
  click('#quickDownloadBtn'); await until(() => isOpen('#syncDiffModal'));
  assert($('#syncDiffBody').textContent.includes('Tags — will overwrite'), 'tag changes missing');
  assert(!$('#syncDiffApply').disabled, 'tag-only apply disabled');
  click('#syncDiffApply'); await until(() => $('#statusText').textContent === 'Download complete.');
  assert(window.fixture.db.tags.t.name === 'Remote tag', 'tag not applied');
  assert(window.fixture.db.libraryBackups[0].reason === 'Before sync download', 'snapshot missing');
});
await check('Changed sources require a second sync review', async () => {
  window.fixture.remote.tags.t.name = 'Reviewed label';
  click('#quickDownloadBtn'); await until(() => isOpen('#syncDiffModal'));
  window.fixture.remote.tags.t.name = 'Changed after review';
  click('#syncDiffApply'); await until(() => $('#syncDiffWarning').textContent.includes('changed since'));
  assert(isOpen('#syncDiffModal'), 'updated review was closed');
  assert(window.fixture.db.tags.t.name === 'Remote tag', 'unreviewed change applied');
  click('#syncDiffApply'); await until(() => $('#statusText').textContent === 'Download complete.');
});
await check('Selecting channel removal recalculates videos; skip-all includes unloaded decisions', async () => {
  const videos = Object.fromEntries(Array.from({ length: 620 }, (_, i) => [`x${i}`, { id: `x${i}`, channelId: 'c', title: `Video ${i}`, published: '2020-01-01', duration: 60 }]));
  await chrome.storage.local.set({ videos });
  window.fixture.remote = structuredClone(window.fixture.db); delete window.fixture.remote.channels.c;
  click('#quickDownloadBtn'); await until(() => isOpen('#syncDiffModal'));
  const box = $('#syncDiffBody [data-remove-id]'); assert(box, 'missing channel removal');
  box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => $('#syncDiffBody summary')?.textContent.includes('620 video changes'));
  click('#syncDiffBody summary'); await until(() => document.querySelectorAll('#syncDiffBody [data-video-id]').length === 100);
  const all = $('#syncDiffBody [data-role="select-all-videos"]'); all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true }));
  click('#syncDiffApply'); await until(() => $('#statusText').textContent === 'Download complete.');
  assert(Object.keys(window.fixture.db.videos).length === 620, 'unloaded videos not preserved');
  assert(!window.fixture.db.channels.c, 'selected channel not removed');
});
await check('Failed refreshes show channel names and Retry only reruns failed channels', async () => {
  await chrome.storage.local.set({ channels: { c1: { id: 'c1', name: 'First failed channel', trackVideos: true }, c2: { id: 'c2', name: 'Second failed channel', trackVideos: true } }, videos: {} });
  window.fixture.rssFailures.add('c1'); window.fixture.rssFailures.add('c2');
  click('#refreshBtn'); await until(() => !$('#retryRefreshBtn').hidden && !$('#retryRefreshBtn').disabled);
  assert($('#refreshErrors').textContent.includes('First failed channel'), 'missing channel name');
  assert(!window.fixture.db.channels.c1.lastFetched, 'failure marked fresh');
  click('#retryRefreshBtn'); await until(() => $('#retryRefreshBtn').hidden && !$('#refreshBtn').disabled);
  assert(window.fixture.db.channels.c1.lastFetched, 'retry did not succeed');
});
await check('Keyboard settings and save controls fit narrow windows in the original theme', async () => {
  for (const width of [760, 540]) {
    const frame = document.createElement('iframe');
    frame.style.cssText = `width:${width}px;height:650px;border:0;position:fixed;top:0;left:0`;
    frame.src = '/tests/dashboard'; document.body.appendChild(frame);
    try {
      await until(() => frame.contentDocument?.querySelector('#videoFeed .video-card'));
      const doc = frame.contentDocument;
      doc.querySelector('#settingsBtn').click();
      for (const tab of ['controls', 'general', 'backups']) {
        doc.querySelector(`[data-settings-tab="${tab}"]`).click();
        const box = doc.querySelector('.modal-box-settings').getBoundingClientRect();
        const save = doc.querySelector('#settingsSave').getBoundingClientRect();
        const content = doc.querySelector('.settings-content');
        assert(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= 650, `${tab} dialog clipped at ${width}px`);
        assert(save.bottom <= 650 && content.scrollWidth <= content.clientWidth + 1, `${tab} controls overflow at ${width}px`);
      }
    } finally { frame.remove(); }
  }
});
output.dataset.complete = 'true';
output.dataset.failed = String(results.filter(line => line.startsWith('FAIL')).length);
output.textContent += `\n\n${results.length} browser checks complete; ${output.dataset.failed} failures.`;
