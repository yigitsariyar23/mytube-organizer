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
  await until(() => $('#settingsModal').hidden && $('#statusText').textContent === 'Settings saved.');
  click('#viewChannelsBtn');
  await until(() => $('.var-lang'));
  const picker = $('.var-lang');
  assert([...picker.options].map(o => o.value).join(',') === ',Turkish,English,Russian,French', 'inactive choices leaked');
  picker.value = 'Turkish';
  picker.dispatchEvent(new Event('change', { bubbles: true }));
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
  key('Escape', { key: 'Escape' }); assert(!$('#settingsModal').hidden, 'Escape closed settings during recording');
  click('[data-record-shortcut="search"]'); key('KeyK');
  key('Digit1'); assert(document.body.dataset.view === 'new', 'shortcut ran inside dialog');
  click('#settingsSave'); await until(() => $('#settingsModal').hidden);
  assert(window.fixture.db.controls.bindings.search === 'KeyK', 'binding not persisted');
  document.activeElement?.blur(); key('Slash', { key: '/' }); assert(document.activeElement !== $('#searchInput'), 'old binding still active');
  key('KeyK'); assert(document.activeElement === $('#searchInput'), 'new binding did not run');
});
await check('Reset is cancellable and clearing a binding disables only that action', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); click('#resetControlsBtn'); click('#settingsCancel');
  assert(window.fixture.db.controls.bindings.search === 'KeyK', 'Cancel saved draft');
  click('#settingsBtn'); click('#settingsControlsTab'); click('[data-clear-shortcut="search"]'); click('#settingsSave'); await until(() => $('#settingsModal').hidden);
  document.activeElement?.blur(); key('KeyK'); assert(document.activeElement !== $('#searchInput'), 'cleared binding still active');
  key('Digit1'); await until(() => document.body.dataset.view === 'channels');
});
await check('Disabled shortcuts, Alt selection, and wheel settings are honored', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); click('#shortcutsEnabledInput');
  $('#selectionModifierInput').value = 'alt'; $('#selectionModifierInput').dispatchEvent(new Event('change', { bubbles: true }));
  click('#wheelAdjustsNumbersInput'); click('#settingsSave'); await until(() => $('#settingsModal').hidden);
  key('Digit2'); assert(document.body.dataset.view === 'channels', 'disabled shortcut ran');
  const row = $('#channelGrid [data-channel-id]'); row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  assert(row.classList.contains('selected'), 'Alt selection failed');
  const input = $('#filterMinCount'), before = input.value;
  input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  assert(input.value === before, 'disabled wheel changed filter');
  click('#settingsBtn'); click('#settingsControlsTab'); click('#resetControlsBtn'); click('#settingsSave'); await until(() => $('#settingsModal').hidden);
  key('Digit2'); await until(() => document.body.dataset.view === 'new');
});
await check('Settings tabs and filter chips retain standard keyboard behavior', async () => {
  click('#settingsBtn'); click('#settingsControlsTab'); await Promise.resolve();
  assert(document.activeElement === $('#settingsControlsTab'), 'unselected tab received focus');
  key('ArrowRight', { key: 'ArrowRight' }, $('#settingsControlsTab'));
  assert(!$('#settingsBackupsPanel').hidden && document.activeElement === $('#settingsBackupsTab'), 'tab arrows did not move panels');
  key('Escape', { key: 'Escape' }); assert($('#settingsModal').hidden, 'Escape did not dismiss dialog');
  key('Enter', { key: 'Enter', shiftKey: true }, $('#videoUnwatchedChip'));
  assert($('#videoUnwatchedChip').classList.contains('on-neg'), 'keyboard exclusion did not select watched videos');
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
  await until(() => !$('#undoToast').hidden);
  assert(window.fixture.db.videos.v1.hidden, 'not removed');
  click('#undoBtn');
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
  const remove = [...document.querySelectorAll('#contextMenu button')].find(button => button.textContent === 'Remove');
  assert(remove, 'remove action missing');
  await chrome.runtime.sendMessage({ type: 'PATCH_LIBRARY', patches: { videos: [{ id, set: { title: 'Updated while menu open' } }] } });
  remove.click();
  await until(() => window.fixture.db.videos[id].hidden, 'menu action was lost');
  assert(window.fixture.db.videos[id].title === 'Updated while menu open', 'metadata was overwritten');
  await until(() => !$('#undoToast').hidden);
  click('#undoBtn'); await until(() => !window.fixture.db.videos[id].hidden);
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
  click('#quickDownloadBtn'); await until(() => !$('#syncDiffModal').hidden);
  assert($('#syncDiffBody').textContent.includes('Tags — will overwrite'), 'tag changes missing');
  assert(!$('#syncDiffApply').disabled, 'tag-only apply disabled');
  click('#syncDiffApply'); await until(() => $('#statusText').textContent === 'Download complete.');
  assert(window.fixture.db.tags.t.name === 'Remote tag', 'tag not applied');
  assert(window.fixture.db.libraryBackups[0].reason === 'Before sync download', 'snapshot missing');
});
await check('Changed sources require a second sync review', async () => {
  window.fixture.remote.tags.t.name = 'Reviewed label';
  click('#quickDownloadBtn'); await until(() => !$('#syncDiffModal').hidden);
  window.fixture.remote.tags.t.name = 'Changed after review';
  click('#syncDiffApply'); await until(() => $('#syncDiffWarning').textContent.includes('changed since'));
  assert(!$('#syncDiffModal').hidden, 'updated review was closed');
  assert(window.fixture.db.tags.t.name === 'Remote tag', 'unreviewed change applied');
  click('#syncDiffApply'); await until(() => $('#statusText').textContent === 'Download complete.');
});
await check('Selecting channel removal recalculates videos; skip-all includes unloaded decisions', async () => {
  const videos = Object.fromEntries(Array.from({ length: 620 }, (_, i) => [`x${i}`, { id: `x${i}`, channelId: 'c', title: `Video ${i}`, published: '2020-01-01', duration: 60 }]));
  await chrome.storage.local.set({ videos });
  window.fixture.remote = structuredClone(window.fixture.db); delete window.fixture.remote.channels.c;
  click('#quickDownloadBtn'); await until(() => !$('#syncDiffModal').hidden);
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
