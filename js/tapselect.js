// =====================================================================
// tapselect.js — v15.2: tap lists instead of the phone's own drop-downs.
// Every <select> in the app gets a tap field beside it showing the picked
// option in full (wrapping onto more lines, never cut off with "…").
// Tapping it opens a sheet listing every option in full. The real
// <select> stays in the form (hidden), so saving, reading and change
// handlers work exactly as before: picking sets select.value and fires
// 'input' + 'change'. Opt out with class "no-tapsel".
// =====================================================================

function label(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : '';
}
function fieldName(sel) {
  const lab = sel.closest('label');
  const t = sel.getAttribute('aria-label') || (lab && lab.querySelector('.field-label, span') && lab.querySelector('.field-label, span').textContent) || '';
  return t.trim();
}

let sheet = null;
export function closeSheet() { if (sheet) { sheet.remove(); sheet = null; document.body.classList.remove('tapsel-open'); } }

function openSheet(sel, btn) {
  closeSheet();
  const back = document.createElement('div'); back.className = 'tapsel-back'; back.id = 'tapsel-sheet';
  const box = document.createElement('div'); box.className = 'tapsel-sheet'; box.setAttribute('role', 'listbox');
  const name = fieldName(sel);
  if (name) { const h = document.createElement('p'); h.className = 'tapsel-title'; h.textContent = name; box.append(h); box.setAttribute('aria-label', name); }
  const list = document.createElement('div'); list.className = 'tapsel-list';
  let current = null;
  for (const o of sel.options) {
    if (o.hidden) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tapsel-opt' + (o.selected ? ' on' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(o.selected));
    b.dataset.value = o.value; b.disabled = o.disabled; b.textContent = o.textContent;
    b.addEventListener('click', () => {
      sel.value = o.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sync(sel); closeSheet(); btn.focus();
    });
    if (o.selected) current = b;
    list.append(b);
  }
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn tapsel-cancel'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { closeSheet(); btn.focus(); });
  box.append(list, cancel);
  back.append(box);
  back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
  document.body.append(back); document.body.classList.add('tapsel-open');
  sheet = back;
  if (current) current.scrollIntoView({ block: 'center' });
}

function sync(sel) {
  const btn = sel._tapsel; if (!btn) return;
  btn.querySelector('.tapsel-text').textContent = label(sel) || 'Choose';
  btn.disabled = sel.disabled;
  btn.classList.toggle('prefilled', sel.classList.contains('prefilled'));
}

export function enhance(sel) {
  if (sel._tapsel || sel.multiple || sel.classList.contains('no-tapsel')) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'tapsel'; btn.setAttribute('aria-haspopup', 'listbox');
  if (sel.id) btn.id = sel.id + '-tap';
  const t = document.createElement('span'); t.className = 'tapsel-text';
  const chev = document.createElement('span'); chev.className = 'tapsel-chev'; chev.setAttribute('aria-hidden', 'true'); chev.textContent = '▾';
  btn.append(t, chev);
  const n = fieldName(sel); if (n) btn.setAttribute('aria-label', `${n}: ${label(sel)}`);
  btn.addEventListener('click', (e) => { e.preventDefault(); openSheet(sel, btn); });
  sel._tapsel = btn;
  sel.classList.add('tapsel-native');
  // the real select sits invisibly under the button (still "visible" to code and tests)
  const wrap = document.createElement('span'); wrap.className = 'tapsel-wrap' + (sel.className.includes('room-filter') ? ' room-filter-wrap' : '');
  sel.before(wrap); wrap.append(sel, btn);
  // keep the button in step when code changes the select (Reset buttons etc.)
  sel.addEventListener('change', () => sync(sel));
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(this); } });
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
  sync(sel);
}

export function enhanceAll(root) {
  if (!root || !root.querySelectorAll) return;
  for (const s of root.querySelectorAll('select')) enhance(s);
}
export function startTapSelect(root) {
  let q = false; const run = () => { q = false; enhanceAll(root); };
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  run();
}
