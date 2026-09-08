// Dashboard-only bindings. Physical key codes keep modified keys predictable
// across layouts; Mod means Command on macOS and Control on other platforms.
export const SHORTCUTS = [
  { id: 'search', label: 'Search library', group: 'Navigate', binding: 'Slash' },
  { id: 'channels', label: 'Go to Channels', group: 'Navigate', binding: 'Digit1' },
  { id: 'new', label: 'Go to New videos', group: 'Navigate', binding: 'Digit2' },
  { id: 'watchlater', label: 'Go to Watch Later', group: 'Navigate', binding: 'Digit3' },
  { id: 'removed', label: 'Go to Removed videos', group: 'Navigate', binding: 'Digit4' },
  { id: 'settings', label: 'Open Settings', group: 'Navigate', binding: 'Comma' },
  { id: 'controls', label: 'Open keyboard controls', group: 'Navigate', binding: 'Shift+Slash' },
  { id: 'refresh', label: 'Refresh channel stats', group: 'Actions', binding: 'Shift+KeyR' },
  { id: 'undo', label: 'Undo the last video edit', group: 'Actions', binding: 'Mod+KeyZ' },
  { id: 'clearFilters', label: 'Clear current filters', group: 'Actions', binding: 'Shift+KeyX' },
];
const symbols = { Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' };
const keyAllowed = code => /^(Key[A-Z]|Digit[0-9])$/.test(code) || Object.hasOwn(symbols, code);

export function shortcutFromEvent(event, mac = false) {
  if (event.isComposing || event.getModifierState?.('AltGraph') || !keyAllowed(event.code)) return null;
  if ((mac && event.ctrlKey) || (!mac && event.metaKey)) return null;
  return [((mac && event.metaKey) || (!mac && event.ctrlKey)) && 'Mod', event.altKey && 'Alt', event.shiftKey && 'Shift', event.code].filter(Boolean).join('+');
}

export function bindingError(binding) {
  if (binding === null) return '';
  if (typeof binding !== 'string') return 'Choose a letter, number, or punctuation key.';
  const parts = binding.split('+'), code = parts.pop();
  if (!keyAllowed(code) || parts.join('+') !== ['Mod', 'Alt', 'Shift'].filter(key => parts.includes(key)).join('+')) return 'Choose a letter, number, or punctuation key.';
  // Keep browser navigation, editing, and tab controls available.
  if (parts.includes('Mod') && (/^Digit/.test(code) || ['KeyA', 'KeyC', 'KeyX', 'KeyV', 'KeyL', 'KeyT', 'KeyW', 'KeyN', 'KeyR', 'KeyP', 'KeyF', 'KeyH', 'KeyJ', 'KeyK', 'KeyO', 'KeyS', 'KeyQ', 'KeyD', 'KeyE', 'KeyB', 'KeyG', 'KeyI', 'KeyM', 'KeyU', 'Comma'].includes(code))) return 'That combination is reserved by the browser. Try another key.';
  return '';
}

export function shortcutConflict(bindings, actionId, binding) {
  return binding && SHORTCUTS.find(action => action.id !== actionId && bindings[action.id] === binding);
}

export function normalizeControls(value = {}) {
  const bindings = {}, used = new Set();
  for (const action of SHORTCUTS) {
    let binding = Object.hasOwn(value?.bindings || {}, action.id) ? value.bindings[action.id] : action.binding;
    if (bindingError(binding)) binding = action.binding;
    if (binding && used.has(binding)) binding = null;
    bindings[action.id] = binding;
    if (binding) used.add(binding);
  }
  return { bindings, enabled: value?.enabled !== false,
    selectionModifier: value?.selectionModifier === 'alt' ? 'alt' : 'primary', wheelAdjustsNumbers: value?.wheelAdjustsNumbers !== false };
}

export function formatShortcut(binding, mac = false) {
  if (!binding) return 'Disabled';
  return binding.split('+').map(key => key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : key === 'Alt' ? (mac ? 'Option' : 'Alt')
    : symbols[key] || key.replace(/^(Key|Digit)/, '')).join(' + ');
}

export function selectionModifierPressed(event, controls) {
  return controls.selectionModifier === 'alt' ? event.altKey : event.ctrlKey || event.metaKey;
}
