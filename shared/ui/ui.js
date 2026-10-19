// Organizer design language — shared behaviors (DESIGN.md). Plain ES module,
// no dependencies; vendored into each app as shared/ui/ui.js by sync.sh.
// Don't edit the copies — change design-language/kit and run sync.sh.
//
// Everything here draws its own DOM with the classes in components.css, so
// no OS control (select, confirm, prompt, spinner) ever shows.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Dates (§2, §5) ----------

// Recency bucket for a last-activity date: this/last month, earlier this
// year, the two years before, the two before those, older. Unknown → ''.
export function ageClass(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (months <= 1) return 'age-current';
  const years = now.getFullYear() - d.getFullYear();
  if (years <= 0) return 'age-year';
  if (years <= 2) return 'age-recent';
  if (years <= 4) return 'age-old';
  return 'age-stale';
}

export function formatDate(value) {
  const d = value ? new Date(value) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function formatNumericDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)}`;
}

export function formatDateTime(value) {
  const d = value ? new Date(value) : null;
  return d && !isNaN(d) ? d.toLocaleString() : '';
}

// The date cell: long form, short form under 100px (container query), recency
// color and a full tooltip. `colored` = last-activity dates only.
export function dateCellHtml(value, { colored = false, className = '' } = {}) {
  const cls = ['ui-date', className, colored ? ageClass(value) : ''].filter(Boolean).join(' ');
  if (!value) return `<span class="${cls}">—</span>`;
  return `<span class="${cls}" title="${escapeHtml(formatDateTime(value))}"><span class="date-long">${escapeHtml(formatDate(value))}</span><span class="date-short">${escapeHtml(formatNumericDate(value))}</span></span>`;
}

export function avatarHtml(src, name, className = 'ui-avatar') {
  if (src) return `<img class="${className}" src="${escapeHtml(src)}" alt="" loading="lazy" draggable="false">`;
  const letter = [...String(name || '?').replace(/^@/, '')][0] || '?';
  return `<span class="${className}" aria-hidden="true">${escapeHtml(letter.toUpperCase())}</span>`;
}

// ---------- Floating layer plumbing ----------

function place(el, { x, y, anchor, align = 'start' }) {
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  let left, top;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'end' ? a.right - r.width : a.left;
    top = a.bottom + 4;
    if (top + r.height > vh - 8) top = Math.max(8, a.top - r.height - 4);
  } else {
    left = x; top = y;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
  }
  if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

// Where a floating layer mounts: inside the open modal <dialog> that holds
// its anchor (a modal sits in the top layer, so anything appended to <body>
// would render beneath it), otherwise <body>.
function layerHost(anchor) {
  const el = anchor instanceof Element ? anchor : document.activeElement;
  return el?.closest?.('dialog[open]') || document.body;
}

// One floating layer (menu tree or listbox) at a time; opening another, a
// click outside, Esc, scroll or resize closes it.
let activeLayer = null;
export function closeFloating() {
  const layer = activeLayer;
  activeLayer = null;
  layer?.close();
}
export function floatingOpen() { return !!activeLayer; }

function setLayer(layer) {
  closeFloating();
  activeLayer = layer;
}

addEventListener('mousedown', e => {
  if (activeLayer && !activeLayer.contains(e.target)) closeFloating();
}, true);
addEventListener('blur', () => closeFloating());
addEventListener('resize', () => closeFloating());
addEventListener('scroll', e => {
  if (activeLayer && !activeLayer.contains(e.target)) closeFloating();
}, true);

// ---------- Listbox / Select (§3) ----------

// Opens our listbox under `anchor`. options: [{ value, label, html?, color?,
// indent?, disabled?, group? }] (group = a non-selectable heading). Calls
// onPick(value) and closes. Type-ahead, ↑/↓/Home/End, Enter, Esc.
export function openListbox(anchor, { options, value, onPick, align = 'start', minWidth = true, onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'ui-listbox';
  el.setAttribute('role', 'listbox');
  el.tabIndex = -1;
  const items = [];
  for (const opt of options) {
    if (opt.group) {
      const g = document.createElement('div');
      g.className = 'ui-option-group';
      g.textContent = opt.group;
      el.appendChild(g);
      continue;
    }
    const o = document.createElement('div');
    o.className = `ui-option${opt.indent ? ' indent' : ''}`;
    o.setAttribute('role', 'option');
    o.id = `ui-opt-${Math.random().toString(36).slice(2)}`;
    o.setAttribute('aria-selected', String(opt.value === value));
    if (opt.disabled) o.setAttribute('aria-disabled', 'true');
    o.innerHTML = `<span class="check">${opt.value === value ? '✓' : ''}</span>${opt.color ? `<span class="dot" style="background:${escapeHtml(opt.color)}"></span>` : ''}<span>${opt.html ?? escapeHtml(opt.label)}</span>`;
    o.addEventListener('mousemove', () => setActive(items.indexOf(entry)));
    o.addEventListener('click', e => {
      e.stopPropagation();
      if (opt.disabled) return;
      close();
      onPick?.(opt.value);
    });
    const entry = { el: o, opt };
    items.push(entry);
    el.appendChild(o);
  }
  layerHost(anchor).appendChild(el);
  if (minWidth && anchor) el.style.minWidth = `${anchor.getBoundingClientRect().width}px`;
  place(el, { anchor, align });
  anchor?.setAttribute('aria-expanded', 'true');

  let active = -1;
  function setActive(i) {
    items[active]?.el.classList.remove('active');
    active = i;
    const it = items[active];
    if (!it) return;
    it.el.classList.add('active');
    el.setAttribute('aria-activedescendant', it.el.id);
    it.el.scrollIntoView({ block: 'nearest' });
  }
  const enabled = () => items.map((it, i) => (it.opt.disabled ? -1 : i)).filter(i => i >= 0);
  setActive(Math.max(0, items.findIndex(it => it.opt.value === value)));

  let typed = '', typedAt = 0;
  function onKey(e) {
    const list = enabled();
    if (!list.length) return;
    const pos = list.indexOf(active);
    if (e.key === 'ArrowDown') setActive(list[(pos + 1) % list.length]);
    else if (e.key === 'ArrowUp') setActive(list[(pos - 1 + list.length) % list.length]);
    else if (e.key === 'Home') setActive(list[0]);
    else if (e.key === 'End') setActive(list[list.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') items[active]?.el.click();
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else if (e.key.length === 1) {
      typed = Date.now() - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = Date.now();
      const hit = list.find(i => (items[i].opt.label || '').toLowerCase().startsWith(typed));
      if (hit !== undefined) setActive(hit);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
  document.addEventListener('keydown', onKey, true);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    anchor?.setAttribute('aria-expanded', 'false');
    if (activeLayer === layer) activeLayer = null;
    anchor?.focus?.({ preventScroll: true });
    onClose?.();
  }
  const layer = { close, contains: t => el.contains(t) || anchor?.contains(t) };
  setLayer(layer);
  return { close };
}

// The trigger's markup, for rows rendered with innerHTML. Pair with a
// delegated click handler that calls openListbox(button, …).
export function selectButtonHtml({ label, placeholder = '', className = '', attrs = '', color = '', title = '' }) {
  const style = color ? ` style="border-color:${escapeHtml(color)};color:${escapeHtml(color)}"` : '';
  return `<button type="button" class="ui-select ${className}" role="combobox" aria-haspopup="listbox" aria-expanded="false"${title ? ` title="${escapeHtml(title)}"` : ''}${style} ${attrs}><span class="ui-select-label${label ? '' : ' placeholder'}">${escapeHtml(label || placeholder)}</span></button>`;
}

// A standalone select (settings, filters, dialogs). Returns an object with
// .el (the button), .value, .setOptions(options), .disabled.
export function createSelect({ options = [], value = null, onChange, className = '', placeholder = '', ariaLabel = '', align } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `ui-select ${className}`.trim();
  el.setAttribute('role', 'combobox');
  el.setAttribute('aria-haspopup', 'listbox');
  el.setAttribute('aria-expanded', 'false');
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  const label = document.createElement('span');
  label.className = 'ui-select-label';
  el.appendChild(label);
  const api = {
    el,
    get value() { return value; },
    set value(v) { value = v; render(); },
    get options() { return options; },
    setOptions(next) { options = next; render(); },
    get disabled() { return el.disabled; },
    set disabled(v) { el.disabled = v; },
  };
  function render() {
    const opt = options.find(o => !o.group && o.value === value);
    label.textContent = opt ? (opt.short ?? opt.label) : placeholder;
    label.classList.toggle('placeholder', !opt);
  }
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (el.getAttribute('aria-expanded') === 'true') return closeFloating();
    openListbox(el, { options, value, align, onPick: v => { if (v === value) return; value = v; render(); onChange?.(v); } });
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); el.click(); }
  });
  render();
  return api;
}

// ---------- Context menus (§8) ----------

// items: [{ label, html?, action, submenu: items | () => items, checked,
// danger, disabled, hint, color, indent } | { sep: true }]. Cascading flyouts,
// hover or → opens, ← closes, ↑/↓ wrap, Home/End, Enter, Esc returns focus.
export function openMenu(at, items, { title = '', onClose } = {}) {
  const opener = document.activeElement;
  const host = layerHost(at instanceof Element ? at : opener);
  const panels = [];

  function build(list, level, parentItem) {
    const el = document.createElement('div');
    el.className = 'ui-menu';
    el.setAttribute('role', 'menu');
    if (title && level === 0) {
      const t = document.createElement('div');
      t.className = 'ui-menu-title';
      t.textContent = title;
      el.appendChild(t);
    }
    const buttons = [];
    for (const item of list) {
      if (!item) continue;
      if (item.sep) {
        if (el.lastChild && !el.lastChild.classList.contains('ui-menu-sep') && !el.lastChild.classList.contains('ui-menu-title')) {
          const s = document.createElement('div');
          s.className = 'ui-menu-sep';
          el.appendChild(s);
        }
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ui-menu-item${item.danger ? ' danger' : ''}${item.submenu ? ' has-submenu' : ''}${item.indent ? ' indent' : ''}`;
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      if (item.submenu) b.setAttribute('aria-haspopup', 'menu');
      if (item.disabled) b.setAttribute('aria-disabled', 'true');
      const hasCheck = list.some(i => i && 'checked' in i);
      b.innerHTML = `${hasCheck ? `<span class="check">${item.checked ? '✓' : ''}</span>` : ''}${item.color ? `<span class="dot" style="background:${escapeHtml(item.color)}"></span>` : ''}<span class="grow">${item.html ?? escapeHtml(item.label)}</span>${item.hint ? `<span class="hint">${escapeHtml(item.hint)}</span>` : ''}`;
      b.addEventListener('mouseenter', () => {
        b.focus({ preventScroll: true });
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => (item.submenu && !item.disabled ? openSub(level, item, b) : truncate(level + 1)), 120);
      });
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (item.disabled) return;
        if (item.submenu) return openSub(level, item, b, true);
        closeAll(false);
        item.action?.();
      });
      buttons.push(b);
      el.appendChild(b);
    }
    while (el.lastChild?.classList.contains('ui-menu-sep')) el.lastChild.remove();
    el.addEventListener('contextmenu', e => e.preventDefault());
    host.appendChild(el);
    if (level === 0) place(el, at instanceof Element ? { anchor: at } : at);
    else {
      const r = parentItem.getBoundingClientRect(), m = el.getBoundingClientRect();
      let left = r.right + 2;
      if (left + m.width > innerWidth - 8) left = Math.max(8, r.left - m.width - 2);
      let top = r.top - 4;
      if (top + m.height > innerHeight - 8) top = Math.max(8, innerHeight - m.height - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    return { el, buttons, parentItem };
  }

  let hoverTimer = 0;
  function truncate(level) {
    while (panels.length > level) {
      const p = panels.pop();
      p.parentItem?.classList.remove('open');
      p.parentItem?.setAttribute('aria-expanded', 'false');
      p.el.remove();
    }
  }
  function openSub(level, item, button, focusFirst = false) {
    if (panels[level + 1]?.parentItem === button) {
      if (focusFirst) panels[level + 1].buttons.find(b => !b.getAttribute('aria-disabled'))?.focus();
      return;
    }
    truncate(level + 1);
    const list = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
    if (!list?.length || level >= 2) return;
    button.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    panels.push(build(list, level + 1, button));
    if (focusFirst) panels[level + 1].buttons.find(b => !b.getAttribute('aria-disabled'))?.focus();
  }

  function onKey(e) {
    const level = panels.findIndex(p => p.el.contains(document.activeElement));
    const panel = panels[level >= 0 ? level : panels.length - 1];
    const btns = panel.buttons.filter(b => !b.getAttribute('aria-disabled'));
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus();
    else if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus();
    else if (e.key === 'Home') btns[0]?.focus();
    else if (e.key === 'End') btns[btns.length - 1]?.focus();
    else if (e.key === 'ArrowRight') { if (document.activeElement?.classList.contains('has-submenu')) document.activeElement.click(); }
    else if (e.key === 'ArrowLeft') {
      if (level > 0) { const parent = panels[level].parentItem; truncate(level); parent.focus(); }
    } else if (e.key === 'Escape') closeAll(true);
    else if (e.key === 'Tab') closeAll(true);
    else if (e.key === 'Enter' || e.key === ' ') document.activeElement?.click();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  let closed = false;
  function closeAll(restoreFocus) {
    if (closed) return;
    closed = true;
    clearTimeout(hoverTimer);
    document.removeEventListener('keydown', onKey, true);
    truncate(0);
    if (activeLayer === layer) activeLayer = null;
    if (restoreFocus && opener?.isConnected) opener.focus?.({ preventScroll: true });
    onClose?.();
  }
  const layer = { close: () => closeAll(false), contains: t => panels.some(p => p.el.contains(t)) };
  setLayer(layer);
  panels.push(build(items, 0, null));
  document.addEventListener('keydown', onKey, true);
  // Opened from the keyboard (an element anchor, or { keyboard: true }):
  // focus the first item. From the mouse: the panel, so ↓ starts at the top.
  panels[0].el.tabIndex = -1;
  if (at instanceof Element || at?.keyboard) panels[0].buttons.find(b => !b.getAttribute('aria-disabled'))?.focus();
  else panels[0].el.focus({ preventScroll: true });
  return { close: () => closeAll(false) };
}

// ---------- Popovers ----------

// A free-form floating panel (a tag picker, an inline emoji field) under the
// same one-layer rule as menus and listboxes: opening another layer, a click
// outside, scroll, resize or Esc closes it. `el` is appended to <body> with
// .ui-popover added and placed at `at` (an anchor element or { x, y }).
// Esc returns focus to whatever was focused when it opened.
// Returns { close, place } — place() re-clamps it after its content changed.
export function openPopover(at, el, { onClose } = {}) {
  const opener = document.activeElement;
  let closed = false;
  const layer = { close: () => close(false), contains: t => el.contains(t) };
  setLayer(layer);
  el.classList.add('ui-popover');
  layerHost(at instanceof Element ? at : opener).appendChild(el);
  const doPlace = () => place(el, at instanceof Element ? { anchor: at } : at);
  doPlace();
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  }
  document.addEventListener('keydown', onKey, true);
  function close(restoreFocus) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    if (activeLayer === layer) activeLayer = null;
    if (restoreFocus && opener?.isConnected) opener.focus?.({ preventScroll: true });
    onClose?.();
  }
  return { close: () => close(false), place: doPlace };
}

// ---------- Dialogs (§13) ----------

// Wire a <dialog class="ui-dialog"> for the shared behavior: backdrop click
// closes (unless busy()), focus returns to the opener. Use open(dialog)
// instead of dialog.showModal().
export function bindDialog(dialog, { busy = () => false, onCancel } = {}) {
  if (dialog.__uiBound) return dialog;
  dialog.__uiBound = true;
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', e => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', e => {
    if (e.target !== dialog || !downOnBackdrop || busy()) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) { onCancel?.(); dialog.close('cancel'); }
  });
  dialog.addEventListener('cancel', e => {
    if (busy()) e.preventDefault();
    else onCancel?.();
  });
  dialog.addEventListener('close', () => {
    closeFloating();
    if (dialog.__opener?.isConnected) dialog.__opener.focus?.({ preventScroll: true });
    dialog.__opener = null;
  });
  return dialog;
}

export function openDialog(dialog) {
  dialog.__opener = document.activeElement;
  bindDialog(dialog);
  closeFloating();
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function makeDialog(className = 'small') {
  const d = document.createElement('dialog');
  d.className = `ui-dialog ${className}`;
  document.body.appendChild(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
  return d;
}

// confirmDialog({ title, text, okLabel, danger }) → Promise<boolean>
export function confirmDialog({ title, text = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    const d = makeDialog('small');
    d.innerHTML = `<form method="dialog" class="ui-dialog-body"><h2></h2>${text ? '<p class="muted"></p>' : ''}<div class="ui-dialog-actions"><button class="btn btn-ghost" value="cancel" type="submit" formnovalidate></button><button class="btn ${danger ? 'btn-danger-fill' : 'btn-primary'}" value="ok" type="submit"></button></div></form>`;
    d.querySelector('h2').textContent = title;
    if (text) d.querySelector('p').textContent = text;
    const [cancel, ok] = d.querySelectorAll('button');
    cancel.textContent = cancelLabel;
    ok.textContent = okLabel;
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'));
    openDialog(d);
    ok.focus();
  });
}

// promptDialog({ title, text, value, placeholder, okLabel, select: { label,
// options, value }, validate(value, selectValue) → error string | '' })
// → Promise<{ value, selectValue } | null>
export function promptDialog({ title, text = '', value = '', placeholder = '', okLabel = 'OK', select = null, validate } = {}) {
  return new Promise(resolve => {
    const d = makeDialog('small');
    d.innerHTML = `<form method="dialog" class="ui-dialog-body"><h2></h2>${text ? '<p class="muted"></p>' : ''}<input class="input" type="text" autocomplete="off">${select ? '<label class="field"><span></span><div class="select-slot"></div></label>' : ''}<p class="error" hidden></p><div class="ui-dialog-actions"><button class="btn btn-ghost" value="cancel" type="submit" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok" type="submit"></button></div></form>`;
    d.querySelector('h2').textContent = title;
    if (text) d.querySelector('p.muted').textContent = text;
    const input = d.querySelector('input');
    input.value = value;
    input.placeholder = placeholder;
    let sel = null;
    if (select) {
      d.querySelector('.field > span').textContent = select.label || '';
      sel = createSelect({ options: select.options, value: select.value ?? null, className: 'block', placeholder: select.placeholder || '' });
      d.querySelector('.select-slot').replaceWith(sel.el);
    }
    const error = d.querySelector('.error');
    const ok = d.querySelector('button[value="ok"]');
    ok.textContent = okLabel;
    let result = null;
    // Implicit submission (Enter in the field) would use the first submit
    // button — Cancel — so route Enter to OK explicitly.
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok.click(); }
    });
    d.querySelector('form').addEventListener('submit', e => {
      if (e.submitter?.value !== 'ok') return;
      const v = input.value.trim();
      const msg = validate?.(v, sel?.value) || '';
      if (msg) {
        e.preventDefault();
        error.textContent = msg;
        error.hidden = false;
        input.focus();
        return;
      }
      result = { value: v, selectValue: sel?.value ?? null };
    });
    d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? result : null));
    openDialog(d);
    input.focus();
    input.select();
  });
}

// ---------- Tabs (§14) ----------

// ARIA tablist: tabs are [role=tab][data-tab], panels [role=tabpanel][data-panel].
export function bindTabs(tablist, panelsRoot, onSelect) {
  const tabs = () => [...tablist.querySelectorAll('[role="tab"]')];
  function select(id, focus = false) {
    for (const t of tabs()) {
      const on = t.dataset.tab === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const p of panelsRoot.querySelectorAll('[role="tabpanel"]')) p.hidden = p.dataset.panel !== id;
    onSelect?.(id);
  }
  tablist.addEventListener('click', e => {
    const t = e.target.closest('[role="tab"]');
    if (t) select(t.dataset.tab);
  });
  tablist.addEventListener('keydown', e => {
    const list = tabs(), i = list.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(list[next].dataset.tab, true);
  });
  return { select };
}

// ---------- Toasts and undo (§9) ----------

let stack = null;
function toastStack() {
  if (!stack?.isConnected) {
    stack = document.createElement('div');
    stack.className = 'ui-toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

let plainToast = null, plainTimer = 0;
// A transient confirmation. Results worth reading later go to the status text.
export function toast(message, { error = false, ms = 4000 } = {}) {
  plainToast?.remove();
  clearTimeout(plainTimer);
  const el = document.createElement('div');
  el.className = `ui-toast${error ? ' error' : ''}`;
  el.textContent = message;
  toastStack().appendChild(el);
  plainToast = el;
  plainTimer = setTimeout(() => el.remove(), ms);
}

let undoEntry = null;
// The undo toast: stays until dismissed or replaced. onUndo may be async and
// return false (or throw) to keep the toast with an error message.
export function showUndo(message, onUndo) {
  hideUndo();
  const el = document.createElement('div');
  el.className = 'ui-toast';
  el.innerHTML = '<span class="grow"></span><button class="btn btn-ghost" type="button">Undo</button><button class="ui-toast-x" type="button" aria-label="Dismiss">×</button>';
  el.querySelector('.grow').textContent = message;
  const [undoBtn, x] = el.querySelectorAll('button');
  const entry = { el, run };
  async function run() {
    if (undoBtn.disabled) return;
    undoBtn.disabled = true;
    let ok;
    try { ok = await onUndo(); } catch (e) { ok = false; }
    if (ok === false) {
      el.querySelector('.grow').textContent = 'Could not undo — the items changed since.';
      el.classList.add('error');
      return;
    }
    if (undoEntry === entry) hideUndo();
  }
  undoBtn.addEventListener('click', run);
  x.addEventListener('click', hideUndo);
  undoEntry = entry;
  toastStack().appendChild(el);
}
export function hideUndo() {
  undoEntry?.el.remove();
  undoEntry = null;
}
// Mod+Z: returns false when there's nothing to undo.
export function triggerUndo() {
  if (!undoEntry) return false;
  undoEntry.run();
  return true;
}

// ---------- Number fields (§3, §7) ----------

// No spinners: type, drag sideways (1 step per 6px) or — when wheel() is
// true — scroll over it. onChange fires on every committed change.
export function bindNumberField(input, { min = -Infinity, max = Infinity, step = 1, wheel = () => true, onChange } = {}) {
  input.classList.add('ui-number');
  input.inputMode = 'numeric';
  const clamp = v => Math.min(max, Math.max(min, v));
  const current = () => {
    const n = Number(input.value);
    return input.value === '' || !Number.isFinite(n) ? null : n;
  };
  function set(v) {
    input.value = v === null ? '' : String(clamp(v));
    onChange?.(current());
  }
  input.addEventListener('input', () => onChange?.(current()));
  input.addEventListener('wheel', e => {
    if (!wheel() || document.activeElement !== input && !input.matches(':hover')) return;
    e.preventDefault();
    const base = current() ?? (e.deltaY < 0 ? min - step : max + step);
    set(Number.isFinite(base) ? base + (e.deltaY < 0 ? step : -step) : (e.deltaY < 0 ? Math.max(min, 0) : 0));
  }, { passive: false });
  let drag = null;
  input.addEventListener('pointerdown', e => {
    if (document.activeElement === input || e.button !== 0) return;
    drag = { x: e.clientX, start: current() ?? (Number.isFinite(min) ? min : 0), moved: false };
    input.setPointerCapture(e.pointerId);
  });
  input.addEventListener('pointermove', e => {
    if (!drag) return;
    const steps = Math.trunc((e.clientX - drag.x) / 6);
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 4) return;
    drag.moved = true;
    e.preventDefault();
    set(drag.start + steps * step);
  });
  input.addEventListener('pointerup', e => {
    if (drag && !drag.moved) input.focus();
    drag = null;
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set((current() ?? 0) + (e.key === 'ArrowUp' ? step : -step));
    }
  });
  return { set, get value() { return current(); } };
}

// ---------- Selection (§6) ----------

// Holds the selected ids and the anchor. click() implements the gesture table:
//   mod → toggle · shift → new range · mod+shift → add range.
// Returns true when the click was a selection gesture (don't open the item).
export class Selection {
  constructor(onChange) {
    this.ids = new Set();
    this.anchor = null;
    this.onChange = onChange;
  }
  get size() { return this.ids.size; }
  has(id) { return this.ids.has(id); }
  set(ids, anchor = this.anchor) {
    this.ids = new Set(ids);
    this.anchor = anchor;
    this.onChange?.();
  }
  clear() {
    if (!this.ids.size && this.anchor === null) return false;
    const had = this.ids.size > 0;
    this.ids.clear();
    this.anchor = null;
    this.onChange?.();
    return had;
  }
  delete(id) {
    if (this.ids.delete(id)) this.onChange?.();
  }
  click(id, orderedIds, { mod = false, shift = false } = {}) {
    if (!mod && !shift) return false;
    if (shift) {
      const a = orderedIds.indexOf(this.anchor ?? id), b = orderedIds.indexOf(id);
      const range = a < 0 || b < 0 ? [id] : orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      this.ids = mod ? new Set([...this.ids, ...range]) : new Set(range);
      if (this.anchor === null || a < 0) this.anchor = id;
    } else {
      if (this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
      this.anchor = id;
    }
    this.onChange?.();
    return true;
  }
  // The ids an action on `id` should touch: the selection when id is in it.
  targetsFor(id) {
    return this.ids.has(id) ? [...this.ids] : [id];
  }
}

// ---------- Marquee (§6) ----------

// Drag a rectangle over the list to select rows. Starts on mousedown inside
// `container` when the target isn't a row or a control, after 4px. Rows are
// found with rowSelector and identified with idOf(rowEl). additive(e) decides
// whether the marquee adds to `selection` (Mod held) or starts fresh.
// Auto-scrolls `scroller` near its edges.
export function attachMarquee(container, { scroller = container, rowSelector, idOf, selection, additive = e => e.metaKey || e.ctrlKey, ignore = 'button, a, input, select, textarea, [role="button"], [contenteditable], .ui-select, .col-resizer' }) {
  let state = null, box = null, raf = 0;

  container.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest(rowSelector) || e.target.closest(ignore)) return;
    if (e.target.closest('.ui-thead')) return;
    const sr = scroller.getBoundingClientRect();
    // Ignore clicks on the scroller's own scrollbar.
    if (e.clientX > sr.left + scroller.clientWidth || e.clientY > sr.top + scroller.clientHeight) return;
    state = {
      x0: e.clientX, y0: e.clientY + scroller.scrollTop, x: e.clientX, y: e.clientY,
      base: additive(e) ? new Set(selection.ids) : new Set(), started: false,
    };
    e.preventDefault();
    addEventListener('mousemove', onMove);
    addEventListener('mouseup', onUp, { once: true });
  });

  function onMove(e) {
    state.x = e.clientX;
    state.y = e.clientY;
    if (!state.started) {
      if (Math.hypot(e.clientX - state.x0, e.clientY + scroller.scrollTop - state.y0) < 4) return;
      state.started = true;
      closeFloating();
      document.body.classList.add('marquee-active');
      box = document.createElement('div');
      box.className = 'ui-marquee';
      document.body.appendChild(box);
      tick();
    }
    update();
  }

  function update() {
    const sr = scroller.getBoundingClientRect();
    const y0 = state.y0 - scroller.scrollTop;
    const top = Math.max(sr.top, Math.min(y0, state.y)), bottom = Math.min(sr.bottom, Math.max(y0, state.y));
    const left = Math.min(state.x0, state.x), right = Math.max(state.x0, state.x);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${Math.max(0, bottom - top)}px` });
    // Rows hit in content coordinates, so rows scrolled out of view stay hit.
    const yTop = Math.min(state.y0, state.y + scroller.scrollTop), yBottom = Math.max(state.y0, state.y + scroller.scrollTop);
    const ids = new Set(state.base);
    for (const row of container.querySelectorAll(rowSelector)) {
      const r = row.getBoundingClientRect();
      const rTop = r.top + scroller.scrollTop, rBottom = r.bottom + scroller.scrollTop;
      if (rBottom >= yTop && rTop <= yBottom && r.right >= left && r.left <= right) ids.add(idOf(row));
    }
    const same = ids.size === selection.ids.size && [...ids].every(id => selection.ids.has(id));
    if (!same) selection.set(ids, selection.anchor);
  }

  function tick() {
    if (!state?.started) return;
    const sr = scroller.getBoundingClientRect();
    const edge = 36;
    let dy = 0;
    if (state.y < sr.top + edge) dy = -Math.ceil((sr.top + edge - state.y) / 4);
    else if (state.y > sr.bottom - edge) dy = Math.ceil((state.y - (sr.bottom - edge)) / 4);
    if (dy) { scroller.scrollTop += dy; update(); }
    raf = requestAnimationFrame(tick);
  }

  function onUp() {
    removeEventListener('mousemove', onMove);
    cancelAnimationFrame(raf);
    if (state?.started) {
      box?.remove();
      document.body.classList.remove('marquee-active');
      // Swallow the click that ends the drag (dispatched right after mouseup).
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
      addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', swallow, true), 0);
    } else if (!state?.base.size) {
      // A plain click on empty space clears the selection.
      selection.clear();
    }
    box = null;
    state = null;
  }
}

// ---------- Column resize (§5) ----------

// Header cells get a .col-resizer; dragging sets --col-template on `host`
// (shared by header and rows). widths: px per resizable column (the last
// column is the flexible one and isn't listed). save(widths) persists.
export function setupColumnResize(header, host, { mins, widths, lastTrack = 'minmax(140px, 1fr)', save }) {
  const cells = [...header.children].slice(0, mins.length);
  let current = widths && widths.length === mins.length ? [...widths] : null;
  const apply = () => {
    if (current) host.style.setProperty('--col-template', `${current.map(w => `${Math.round(w)}px`).join(' ')} ${lastTrack}`);
  };
  apply();
  cells.forEach((cell, i) => {
    const h = document.createElement('div');
    h.className = 'col-resizer';
    h.addEventListener('click', e => e.stopPropagation());
    h.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      current ||= cells.map(c => c.getBoundingClientRect().width);
      const startX = e.clientX, start = current[i];
      h.classList.add('dragging');
      document.body.classList.add('col-resizing');
      const move = ev => {
        current[i] = Math.max(mins[i], start + ev.clientX - startX);
        apply();
      };
      const up = () => {
        removeEventListener('mousemove', move);
        h.classList.remove('dragging');
        document.body.classList.remove('col-resizing');
        save?.([...current]);
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up, { once: true });
    });
    h.addEventListener('dblclick', e => {
      e.stopPropagation();
      current = null;
      host.style.removeProperty('--col-template');
      save?.(null);
    });
    cell.appendChild(h);
  });
}

// ---------- Filter chips (§7) ----------

// Next state of a tri-state chip after a click on `side` ('in' | 'out').
export function toggleSide(current, side) {
  return current === side ? null : side;
}

export const CHIP_TOOLTIP = 'Left click: only these · Right click: exclude';
