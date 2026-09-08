import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, normalizeControls, shortcutFromEvent, bindingError, shortcutConflict, formatShortcut, selectionModifierPressed } from '../shared/controls.js';

test('controls preserve disabled bindings and normalize invalid saved preferences', () => {
  const controls = normalizeControls({ bindings: { search: null, channels: 'Escape', new: 'KeyK', watchlater: 'KeyK' }, selectionModifier: 'invalid', enabled: false });
  assert.equal(controls.bindings.search, null);
  assert.equal(controls.bindings.channels, 'Digit1');
  assert.equal(controls.bindings.new, 'KeyK');
  assert.equal(controls.bindings.watchlater, null);
  assert.equal(controls.enabled, false);
  assert.equal(controls.selectionModifier, 'primary');
  assert.equal(Object.keys(normalizeControls(null).bindings).length, SHORTCUTS.length);
});
test('shortcut matching uses exact modifiers, platform command keys, and physical codes', () => {
  assert.equal(shortcutFromEvent({ code: 'KeyZ', metaKey: true }, true), 'Mod+KeyZ');
  assert.equal(shortcutFromEvent({ code: 'KeyZ', ctrlKey: true }), 'Mod+KeyZ');
  assert.equal(shortcutFromEvent({ code: 'Slash', key: '?', shiftKey: true }), 'Shift+Slash');
  assert.equal(shortcutFromEvent({ code: 'KeyR', shiftKey: true, altKey: true }), 'Alt+Shift+KeyR');
  assert.equal(shortcutFromEvent({ code: 'KeyZ', ctrlKey: true }, true), null);
  assert.equal(shortcutFromEvent({ code: 'KeyK', isComposing: true }), null);
  assert.equal(shortcutFromEvent({ code: 'KeyK', getModifierState: key => key === 'AltGraph' }), null);
  assert.equal(shortcutFromEvent({ code: 'Tab' }), null);
});
test('browser bindings and duplicates are rejected while disabled shortcuts never conflict', () => {
  for (const binding of ['Mod+KeyR', 'Mod+Shift+KeyW', 'Mod+Digit1', 'Escape', 'Shift+Shift+KeyK']) assert.ok(bindingError(binding));
  for (const binding of ['KeyK', 'Alt+KeyK', 'Shift+Slash', 'Mod+KeyZ', null]) assert.equal(bindingError(binding), '');
  const { bindings } = normalizeControls();
  assert.equal(shortcutConflict(bindings, 'search', 'Digit1').id, 'channels');
  assert.equal(shortcutConflict(bindings, 'search', 'Slash'), undefined);
  assert.equal(shortcutConflict(bindings, 'search', null), null);
});
test('selection modifier and shortcut labels reflect the saved controls', () => {
  assert.equal(selectionModifierPressed({ metaKey: true }, normalizeControls()), true);
  assert.equal(selectionModifierPressed({ metaKey: true, altKey: false }, normalizeControls({ selectionModifier: 'alt' })), false);
  assert.equal(selectionModifierPressed({ altKey: true }, normalizeControls({ selectionModifier: 'alt' })), true);
  assert.equal(formatShortcut('Mod+KeyZ', true), '⌘ + Z');
  assert.equal(formatShortcut('Mod+KeyZ'), 'Ctrl + Z');
  assert.equal(formatShortcut(null), 'Disabled');
});
