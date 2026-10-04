// =====================================================================
// homeui.js — the newer home-screen pieces (v10):
//   the house picture, "Ask Hearthbook", the first-run tour, editable
//   section tiles, and the Settings cards for sections and reminders.
// =====================================================================
// app.js hands in the few helpers these need (entryCard, sectionTile…),
// so this file doesn't depend on app.js.

import { el, money, niceDate } from './utils.js';
import { icon } from './icons.js';
import { SECTIONS, getSection } from './sections.js';
import { houseSVG, skyPhase, glowLevel } from './house.js';
import { search, whenText } from './search.js';
import { searchManuals } from './manuals.js';
import { list as userManuals, searchUser } from './usermanuals.js';
import { bills } from './stats.js';
import * as prefs from './prefs.js';
import * as reminders from './reminders.js';
import * as native from './native.js';
import { haptic, reducedMotion } from './motion.js';

const daysTo = (iso, now = new Date()) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};

// ---------------------------------------------------------------------
// House picture
// ---------------------------------------------------------------------
export function houseFacts(everything, now = new Date()) {
  const b = bills(everything);
  const latest = b[b.length - 1] || null;
  const prev = b.slice(-13, -1).map((x) => Number(x.cost)).filter((c) => c > 0);
  const average = prev.length ? prev.reduce((a, c) => a + c, 0) / prev.length : 0;
  const due = everything.filter((e) => { const d = daysTo(e.dueDate, now); return d !== null && d >= 0 && d <= 30; }).length;
  // Battery: a meter entry titled "...battery..." with the unit "%".
  const bat = everything.filter((e) => e.type === 'meter' && /battery/i.test(e.title || '') && /%/.test(e.meterUnit || '') && isFinite(Number(e.meterValue)) && e.meterValue !== '' && e.meterValue !== null)
    .sort((x, y) => (x.date || '').localeCompare(y.date || '')).pop();
  return { latest, average, glow: glowLevel(latest && Number(latest.cost), average), due, battery: bat ? { pct: Number(bat.meterValue) } : null };
}

export function houseCard(everything) {
  const card = el('section', { class: 'house-card', id: 'house', 'aria-label': 'Your house at a glance' });
  const draw = () => {
    const now = new Date();
    const phase = skyPhase(now);
    const f = houseFacts(everything, now);
    const pic = el('div', { class: 'house-pic' });
    pic.innerHTML = houseSVG({ phase, glow: f.glow, due: f.due, battery: f.battery });
    const chips = [];
    if (f.latest && f.average) {
      const pct = Math.round((Number(f.latest.cost) / f.average - 1) * 100);
      chips.push(el('a', { class: 'hc-chip', href: `#/view/${f.latest.id}`, id: 'house-bill' }, icon('bolt', 14),
        `Last bill ${money(f.latest.cost)} · ${pct === 0 ? 'about average' : `${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'} average`}`));
    }
    if (f.due) chips.push(el('a', { class: 'hc-chip due', href: '#coming-up', id: 'house-due' }, icon('clock', 14), `${f.due} due within 30 days`));
    card.replaceChildren(pic, el('div', { class: 'house-caption' }, chips));
    card.dataset.phase = phase;
    card.dataset.glow = f.glow.toFixed(2);
    card.dataset.due = String(f.due);
  };
  // The flag (and the "due" chip) scroll to Coming up instead of changing page.
  card.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href="#coming-up"]');
    if (!a) return;
    ev.preventDefault();
    const target = document.getElementById('coming-up');
    if (target) {
      target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const h = target.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
  });
  draw();
  // Keep the sky right while the home screen stays open.
  const timer = setInterval(() => { if (!card.isConnected) clearInterval(timer); else draw(); }, 60_000);
  return card;
}

// ---------------------------------------------------------------------
// Ask Hearthbook
// ---------------------------------------------------------------------
const EXAMPLES = ['When does the car insurance renew?', 'Electricity bills 2026', 'Receipts this year', 'When does the warranty expire?'];

function answerCard(answer) {
  if (!answer) return null;
  if (answer.kind === 'none') return el('div', { class: 'answer-card none', id: 'ask-answer', role: 'status' }, icon('search', 18), el('p', {}, answer.text));
  const e = answer.entry;
  if (answer.kind === 'nodate') {
    return el('a', { class: 'answer-card', id: 'ask-answer', href: `#/view/${e.id}` }, icon(getSection(e.type).glyph, 20),
      el('div', {}, el('strong', {}, e.title), el('p', {}, `No ${answer.verb === 'renews' ? 'renewal' : answer.verb === 'expires' ? 'expiry' : 'due'} date saved yet. Tap to add one.`)));
  }
  const past = answer.days < 0;
  const verb = past ? { renews: 'renewed', expires: 'expired', 'is due': 'was due' }[answer.verb] : answer.verb;
  return el('div', { class: 'answer-wrap' },
    el('a', { class: 'answer-card', id: 'ask-answer', href: `#/view/${e.id}`, 'data-tone': getSection(e.type).tone },
      el('span', { class: 'badge badge-md', 'data-tone': getSection(e.type).tone }, icon(getSection(e.type).glyph, 22)),
      el('div', { class: 'answer-text' },
        el('span', { class: 'answer-title' }, e.title),
        el('span', { class: 'answer-date', id: 'ask-answer-date' }, `${verb} on ${niceDate(answer.date)}`),
        el('span', { class: 'answer-when' }, whenText(answer.days))),
      icon('chevron', 18)),
    (answer.others || []).length ? el('p', { class: 'answer-also small muted' }, 'Also: ', answer.others.map((o, i) => [i ? ' · ' : '', el('a', { href: `#/view/${o.id}` }, `${o.title} (${niceDate(o.dueDate)})`)])) : null);
}

export function askBox({ getEntries, entryCard, autofocus = false, onAsking = () => {}, examples = false, initial = '' }) {
  const input = el('input', { type: 'search', id: 'ask', class: 'search ask-input', placeholder: 'Ask Hearthbook…', 'aria-label': 'Ask Hearthbook: search everything', autocomplete: 'off', enterkeyhint: 'search', value: initial });
  const results = el('div', { class: 'ask-results', id: 'ask-results', 'aria-live': 'polite' });
  const hints = examples ? el('div', { class: 'ask-examples', id: 'ask-examples' }, EXAMPLES.map((t) => el('button', { type: 'button', class: 'year-chip', onclick: () => { input.value = t; run(); input.focus(); } }, t))) : null;
  let t = null;
  async function run() {
    const q = input.value.trim();
    onAsking(Boolean(q));
    if (hints) hints.hidden = Boolean(q);
    if (!q) { results.replaceChildren(); return; }
    const entries = await getEntries();
    const r = search(entries, q);
    const shown = r.results.slice(0, 40).map((x) => x.entry);
    const total = shown.reduce((a, e) => a + (e.type === 'insurance' ? 0 : Number(e.cost) || 0), 0);
    const p = r.query;
    const scope = [p.types.length === 1 ? getSection(p.types[0]).label.toLowerCase() : 'entries', p.month ? `in ${new Date(2000, p.month - 1, 1).toLocaleDateString('en-GB', { month: 'long' })}` : '', p.year ? String(p.year) : ''].filter(Boolean).join(' ');
    // Manuals that match ("dishwasher filter", "hive manual", a model number).
    // v13: plus the manuals you added yourself (by name, notes, room).
    let mine = [];
    try { mine = searchUser(await userManuals(), q).slice(0, 4); } catch {}
    const mans = searchManuals(q).slice(0, 4);
    const count = mans.length + mine.length;
    const manualHits = count
      ? el('div', { class: 'ask-manuals', id: 'ask-manuals' },
          el('p', { class: 'ask-summary' }, `${count} manual${count === 1 ? '' : 's'}`),
          el('div', { class: 'list' },
            mine.map((m) => el('a', { class: 'entry manual-hit user-manual-hit', href: `#/manual/u:${encodeURIComponent(m.id)}`, 'data-user-manual': m.id },
              el('div', { class: 'thumb placeholder', 'data-tone': 'slate' }, icon('book', 24)),
              el('div', { class: 'entry-text' }, el('div', { class: 'entry-title' }, m.name),
                el('div', { class: 'entry-sub' }, m.notes || 'Your manual')))),
            mans.map((a) => el('a', { class: 'entry manual-hit', href: a.files.length === 1 ? `#/manual/${encodeURIComponent(a.files[0].file)}` : `#/manuals/${a.id}`, 'data-appliance': a.id },
              el('div', { class: 'thumb placeholder', 'data-tone': 'slate' }, icon('book', 24)),
              el('div', { class: 'entry-text' }, el('div', { class: 'entry-title' }, `${a.name} manual${a.files.length > 1 ? 's' : ''}`),
                el('div', { class: 'entry-sub' }, a.notes || a.model))))))
      : null;
    results.replaceChildren(...[
      answerCard(r.answer),
      r.results.length ? null : manualHits,
      el('p', { class: 'ask-summary', id: 'ask-summary' }, r.results.length
        ? `${r.results.length} ${r.results.length === 1 ? (scope === 'entries' ? 'entry' : scope.replace(/ies\b/, 'y').replace(/s\b/, '')) : scope}${r.fuzzy ? ' (closest matches)' : ''}${total ? ' · ' + money(total) : ''}`
        : count ? `No entries for “${q}”, but here’s what’s in Manuals:` : `Nothing found for “${q}”.`),
      el('div', { class: 'list', id: 'ask-list' }, shown.map(entryCard)),
      r.results.length ? manualHits : null,
    ].filter(Boolean));
  }
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 120); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { clearTimeout(t); run(); input.blur(); } if (ev.key === 'Escape') { input.value = ''; run(); } });
  const box = el('div', { class: 'ask', id: 'ask-box', role: 'search' }, el('label', { class: 'search-wrap ask-wrap' }, icon('sparkle', 20), input), hints, results);
  if (autofocus) setTimeout(() => input.focus(), 50);
  if (initial) run();
  return box;
}

// ---------------------------------------------------------------------
// First-run tour (once per phone, skippable). Inline on the home screen,
// so it never blocks anything.
// ---------------------------------------------------------------------
const TOUR = [
  { glyph: 'home', tone: 'brand', title: 'Your home’s logbook', text: 'Receipts, warranties, jobs, electricity bills and insurance in one tidy place. Kept on this phone (and in your own Google Drive if you turn on sharing).' },
  { glyph: 'scan', tone: 'teal', title: 'Snap it, we’ll fill it in', text: 'Tap + then Scan. You can also share a photo or PDF to Hearthbook straight from your gallery or email.' },
  { glyph: 'sparkle', tone: 'violet', title: 'Ask Hearthbook', text: 'Search everything, or ask “when does the car insurance renew?” and get the date.' },
  { glyph: 'pencil', tone: 'amber', title: 'Make it yours', text: 'Press and hold a section tile to hide or reorder sections. Turn on reminders, find appliance manuals and back up under More.' },
];
export function tourCard() {
  if (prefs.toured()) return null;
  let step = 0;
  const card = el('section', { class: 'card tour-card', id: 'tour', 'aria-label': 'Quick tour', 'aria-roledescription': 'carousel' });
  const finish = () => {
    prefs.markToured();
    if (reducedMotion()) card.remove();
    else { card.classList.add('tour-out'); setTimeout(() => card.remove(), 260); }
  };
  const draw = () => {
    const s = TOUR[step];
    const last = step === TOUR.length - 1;
    card.dataset.step = String(step + 1);
    card.replaceChildren(
      el('div', { class: 'tour-body', role: 'group', 'aria-label': `Step ${step + 1} of ${TOUR.length}` },
        el('span', { class: 'badge badge-lg', 'data-tone': s.tone }, icon(s.glyph, 26)),
        el('div', {}, el('h2', { class: 'tour-title', id: 'tour-title' }, s.title), el('p', { class: 'tour-text' }, s.text))),
      el('div', { class: 'tour-foot' },
        el('span', { class: 'tour-dots', 'aria-hidden': 'true' }, TOUR.map((_, i) => el('i', { class: i === step ? 'on' : '' }))),
        el('button', { type: 'button', class: 'btn link-btn', id: 'tour-skip', onclick: finish }, last ? '' : 'Skip'),
        el('button', { type: 'button', class: 'btn small-btn', id: 'tour-next', onclick: () => { haptic(); if (last) finish(); else { step++; draw(); card.querySelector('#tour-title').focus?.(); } } }, last ? 'Got it' : 'Next')));
    if (last) card.querySelector('#tour-skip').hidden = true;
  };
  draw();
  return card;
}

// ---------------------------------------------------------------------
// Section tiles with an edit mode (press and hold, or the Edit button):
// tiles wiggle, (–) hides, drag to reorder, (+) in the tray brings back.
// Only changes this phone's home screen and menus (prefs.js).
// ---------------------------------------------------------------------
export function tilesSection({ everything, sectionTile, thisYear, onChange = () => {} }) {
  let editing = false;
  let year = thisYear;
  const title = el('h2', { id: 'tiles-title' });
  const editBtn = el('button', { type: 'button', class: 'btn link-btn tiles-edit', id: 'tiles-edit', 'aria-pressed': 'false', onclick: () => setEditing(!editing) }, 'Edit');
  const grid = el('div', { class: 'section-grid', id: 'section-tiles' });
  const tray = el('div', { class: 'tiles-tray', id: 'tiles-tray', hidden: true });
  const hint = el('p', { class: 'small muted tiles-hint', id: 'tiles-hint', hidden: true }, 'Drag to reorder · tap − to hide. Hidden sections keep all their entries.');
  const box = el('section', { class: 'group tiles-group', id: 'tiles', 'aria-labelledby': 'tiles-title' },
    el('div', { class: 'group-head' }, title, editBtn), hint, grid, tray);

  function draw(y = year) {
    year = y;
    title.textContent = y === new Date().getFullYear() ? `${y} so far` : `In ${y}`;
    box.dataset.year = String(y);
    const shown = prefs.orderedSections();
    grid.replaceChildren(...shown.map((s) => {
      const t = sectionTile(s, everything, y);
      if (editing) {
        t.setAttribute('aria-describedby', 'tiles-hint');
        t.append(el('button', { type: 'button', class: 'tile-hide', 'aria-label': `Hide ${s.label}`, 'data-hide': s.id }, icon('minus', 14)));
      }
      return t;
    }));
    const hidden = prefs.orderedSections({ includeHidden: true }).filter((s) => prefs.isHidden(s.id));
    tray.hidden = !editing || !hidden.length;
    tray.replaceChildren(el('span', { class: 'tray-label' }, 'Hidden'), ...hidden.map((s) =>
      el('button', { type: 'button', class: 'tray-chip', 'data-show': s.id, 'aria-label': `Show ${s.label}`, 'data-tone': s.tone }, icon('plus', 14), s.label)));
  }
  function setEditing(on) {
    editing = on;
    box.classList.toggle('editing', on);
    editBtn.textContent = on ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(on));
    hint.hidden = !on;
    draw();
  }

  // Hide / show
  box.addEventListener('click', (ev) => {
    const hide = ev.target.closest('[data-hide]');
    const show = ev.target.closest('[data-show]');
    if (hide) { ev.preventDefault(); ev.stopPropagation(); haptic(); prefs.setHidden(hide.dataset.hide, true); draw(); onChange(); return; }
    if (show) { ev.preventDefault(); haptic(); prefs.setHidden(show.dataset.show, false); draw(); onChange(); return; }
    if (editing && ev.target.closest('.section-tile')) ev.preventDefault(); // no navigating while editing
    if (suppressClick) { ev.preventDefault(); suppressClick = false; }
  }, true);
  box.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.section-tile')) ev.preventDefault(); });

  // Press and hold → edit mode; in edit mode, drag a tile to reorder.
  let press = null, dragging = null, suppressClick = false;
  grid.addEventListener('pointerdown', (ev) => {
    const tile = ev.target.closest('.section-tile');
    if (!tile || ev.target.closest('.tile-hide') || ev.button > 0) return;
    if (!editing) {
      press = { x: ev.clientX, y: ev.clientY, timer: setTimeout(() => { press = null; suppressClick = true; haptic(15); setEditing(true); }, 520) };
      return;
    }
    dragging = grid.querySelector(`.section-tile[data-section="${tile.dataset.section}"]`);
    dragging.classList.add('dragging');
    try { dragging.setPointerCapture(ev.pointerId); } catch {}
    ev.preventDefault();
  });
  grid.addEventListener('pointermove', (ev) => {
    if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
    if (!dragging) return;
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest && n.closest('.section-tile')).find((n) => n && n !== dragging && grid.contains(n));
    if (!over) return;
    const tiles = [...grid.querySelectorAll('.section-tile')];
    if (tiles.indexOf(over) > tiles.indexOf(dragging)) over.after(dragging); else over.before(dragging);
  });
  const endPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  const endDrag = () => {
    endPress();
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    const visible = [...grid.querySelectorAll('.section-tile')].map((t) => t.dataset.section);
    const all = prefs.sectionPrefs().order;
    prefs.setOrder([...visible, ...all.filter((id) => !visible.includes(id))]);
    haptic();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    onChange();
  };
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);
  grid.addEventListener('pointerleave', endPress);

  draw();
  return { element: box, draw, setEditing, isEditing: () => editing };
}

// ---------------------------------------------------------------------
// Settings: show/hide + order sections (a tick list with drag handles,
// and ↑ ↓ buttons for keyboards and screen readers).
// ---------------------------------------------------------------------
export function customiseCard(cardHead, onChange = () => {}) {
  const list = el('ul', { class: 'customise-list', id: 'customise-list' });
  function draw() {
    const all = prefs.orderedSections({ includeHidden: true });
    list.replaceChildren(...all.map((s, i) => {
      const shown = !prefs.isHidden(s.id);
      return el('li', { class: 'customise-row' + (shown ? '' : ' is-hidden'), 'data-section': s.id, 'data-tone': s.tone },
        el('span', { class: 'drag-handle', 'aria-hidden': 'true', title: 'Drag to reorder' }, el('i'), el('i'), el('i')),
        el('label', { class: 'customise-label' },
          el('input', { type: 'checkbox', id: `show-${s.id}`, checked: shown, onchange: (ev) => { prefs.setHidden(s.id, !ev.currentTarget.checked); haptic(); draw(); onChange(); } }),
          el('span', { class: 'badge badge-sm', 'data-tone': s.tone }, icon(s.glyph, 16)),
          el('span', {}, s.label)),
        el('span', { class: 'customise-move' },
          el('button', { type: 'button', class: 'icon-btn move-up', 'aria-label': `Move ${s.label} up`, disabled: i === 0, onclick: () => { prefs.moveSection(s.id, i - 1); draw(); focusMove(s.id, 'up'); onChange(); } }, '↑'),
          el('button', { type: 'button', class: 'icon-btn move-down', 'aria-label': `Move ${s.label} down`, disabled: i === all.length - 1, onclick: () => { prefs.moveSection(s.id, i + 1); draw(); focusMove(s.id, 'down'); onChange(); } }, '↓')));
    }));
  }
  const focusMove = (id, dir) => { const b = list.querySelector(`[data-section="${id}"] .move-${dir}:not([disabled])`) || list.querySelector(`[data-section="${id}"] input`); if (b) b.focus(); };
  // Drag by the handle (touch or mouse).
  let drag = null;
  list.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest('.drag-handle');
    if (!h) return;
    drag = h.closest('li');
    drag.classList.add('dragging');
    try { h.setPointerCapture(ev.pointerId); } catch {}
    ev.preventDefault();
  });
  list.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest && n.closest('.customise-row')).find((n) => n && n !== drag && list.contains(n));
    if (!over) return;
    const rows = [...list.children];
    if (rows.indexOf(over) > rows.indexOf(drag)) over.after(drag); else over.before(drag);
  });
  const end = () => {
    if (!drag) return;
    drag.classList.remove('dragging');
    drag = null;
    prefs.setOrder([...list.children].map((li) => li.dataset.section));
    haptic(); draw(); onChange();
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  draw();
  return el('section', { class: 'card', id: 'customise-card' }, cardHead('list', 'slate', 'Home screen & sections'),
    el('p', { class: 'small muted' }, 'Choose which sections show on this phone and in what order. Hidden sections keep all their entries — they still back up and sync, and appear in search and in All. (Tip: press and hold a tile on the home screen.)'),
    list,
    el('button', { type: 'button', class: 'btn link-btn', id: 'customise-reset', onclick: () => { prefs.saveSectionPrefs({ order: SECTIONS.map((s) => s.id), hidden: [] }); draw(); onChange(); } }, 'Reset to normal'));
}

// ---------------------------------------------------------------------
// Settings: reminders (notifications) + house picture options.
// ---------------------------------------------------------------------
export function remindersBlock({ compact = false, getEntries, rerender = () => {} } = {}) {
  // Installed Android app (app-v13+): the app's native part checks every
  // morning, even when Hearthbook is closed. We hand it the dates (native.js).
  if (native.inApp()) return appRemindersBlock({ compact, getEntries, rerender });
  const p = reminders.permission();
  const on = prefs.remindersOn() && p === 'granted';
  const note = el('p', { class: 'small muted', id: 'reminders-note' }, 'Hearthbook checks when you open it (a web page can’t run in the background), and reminds you 30 days and 7 days before an insurance renewal, warranty expiry or job due date, and on the day. Tap a reminder to open that entry. In the Hearthbook Android app, reminders arrive even when it’s closed.');
  if (compact) {
    if (p === 'unsupported' || p === 'denied' || on) return null;
    return el('div', { class: 'remind-nudge', id: 'coming-up-remind' },
      icon('clock', 18), el('span', { class: 'remind-text' }, 'Get a reminder on this phone before these are due?'),
      el('button', { type: 'button', class: 'btn small-btn secondary', id: 'coming-up-remind-btn', onclick: async () => { haptic(); const r = await reminders.enable(); if (r === 'granted') await reminders.check(getEntries); rerender(); } }, 'Remind me'));
  }
  const status = el('p', { id: 'reminders-status', class: 'reminders-status' + (on ? ' ok' : '') },
    p === 'unsupported' ? 'This browser can’t show notifications.'
      : p === 'denied' ? 'Notifications are blocked for Hearthbook. To allow them: Chrome → ⋮ → Settings → Site settings → Notifications.'
      : on ? '✓ Reminders are on for this phone.' : 'Reminders are off.');
  const btns = [];
  if (p !== 'unsupported' && p !== 'denied') {
    if (on) {
      btns.push(el('button', { type: 'button', class: 'btn secondary', id: 'reminders-check', onclick: async (ev) => { const btn = ev.currentTarget; const n = (await reminders.check(getEntries)).length; btn.textContent = n ? `Sent ${n} reminder${n === 1 ? '' : 's'}` : 'Nothing new to remind you about'; } }, 'Check now'));
      btns.push(el('button', { type: 'button', class: 'btn link-btn', id: 'reminders-off', onclick: async () => { await reminders.disable(); rerender(); } }, 'Turn off'));
    } else {
      btns.push(el('button', { type: 'button', class: 'btn', id: 'reminders-enable', onclick: async () => { haptic(); const r = await reminders.enable(); if (r === 'granted') await reminders.check(getEntries); rerender(); } }, icon('clock', 20), 'Remind me on this phone'));
    }
  }
  return el('div', { class: 'reminders-block' }, status, note, el('div', { class: 'stack' }, btns));
}

// The Android app version: hand the dates to the app straight from the tap
// (Chrome only allows that during a tap), and the app asks Android for
// notification permission itself if it needs to.
function appRemindersBlock({ compact, getEntries, rerender }) {
  const on = native.isOn();
  const turnOn = async () => {
    haptic();
    native.setOn(true);
    prefs.setRemindersOn(true);
    native.send(native.payload(await getEntries(), new Date(), prefs.notifiedLog()));
    setTimeout(rerender, 600);
  };
  if (compact) {
    if (on) return null;
    return el('div', { class: 'remind-nudge', id: 'coming-up-remind' },
      icon('clock', 18), el('span', { class: 'remind-text' }, 'Get a reminder on this phone before these are due, even when Hearthbook is closed?'),
      el('button', { type: 'button', class: 'btn small-btn secondary', id: 'coming-up-remind-btn', onclick: turnOn }, 'Remind me'));
  }
  const text = native.statusText();
  const status = el('p', { id: 'reminders-status', class: 'reminders-status' + (native.active() ? ' ok' : '') }, on ? text : 'Phone reminders are off.');
  const note = el('p', { class: 'small muted', id: 'reminders-note' }, 'Every morning at about 08:30 the Hearthbook app checks your renewals, warranty expiries and job due dates and reminds you 30 days and 7 days before, and on the day, even when Hearthbook is closed. Tap a reminder to open that entry. The dates are handed to the app on this phone only; nothing goes online.');
  const btns = on
    ? [el('button', { type: 'button', class: 'btn secondary', id: 'reminders-resend', onclick: turnOn }, 'Update phone reminders now'),
       el('button', { type: 'button', class: 'btn link-btn', id: 'reminders-off', onclick: () => {
         // Hand over an empty list so the app stops reminding.
         native.send({ v: 1, h: 'off', items: [], n: [] });
         native.setOn(false);
         prefs.setRemindersOn(false);
         setTimeout(rerender, 600);
       } }, 'Turn off')]
    : [el('button', { type: 'button', class: 'btn', id: 'reminders-enable', onclick: turnOn }, icon('clock', 20), 'Remind me on this phone')];
  return el('div', { class: 'reminders-block' }, status, note, el('div', { class: 'stack' }, btns));
}
