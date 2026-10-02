// =====================================================================
// app.js — the main program: draws each screen and reacts to taps.
// =====================================================================
//
// HOW THE SCREENS WORK ("routing")
// The whole app is ONE web page (index.html). Instead of loading new
// pages, we change the part of the address after the "#" (the "hash"):
//
//   #/list/all        the All list (home screen)
//   #/list/warranty   one section's list
//   #/new             "what do you want to add?" chooser
//   #/new/receipt     blank form for a new receipt
//   #/view/<id>       one entry, with its photos
//   #/edit/<id>       the form, filled in, for editing
//   #/export          backup / restore / print report
//
// Whenever the hash changes, the browser fires a "hashchange" event and we
// call render(), which looks at the hash and draws the matching screen
// into the <main id="app"> box. A nice side effect: the phone's Back button
// works, because each screen has its own address in the history.

import { SECTIONS, getSection, SOON_DAYS, BACKUP_REMINDER_DAYS } from './sections.js';
import * as db from './db.js';
import { compressImage } from './photos.js';
import { exportBackup, importBackup } from './backup.js';
import { el, money, totalCost, niceDate, todayISO, daysUntil, dueText, newestFirst } from './utils.js';

const app = document.getElementById('app');

// Things we remember while the app is open (not saved to the database).
const state = {
  query: '', // what's typed in the search box
};

// ---------------------------------------------------------------------
// Photo previews
// ---------------------------------------------------------------------
// To show a Blob (photo) on screen we make a temporary "object URL" for
// it. Those use memory until released, so we keep a list and release
// them all each time we draw a new screen.
let objectURLs = [];
function photoURL(blob) {
  const url = URL.createObjectURL(blob);
  objectURLs.push(url);
  return url;
}
function releasePhotoURLs() {
  objectURLs.forEach((u) => URL.revokeObjectURL(u));
  objectURLs = [];
}

// ---------------------------------------------------------------------
// The router: pick a screen based on the address hash
// ---------------------------------------------------------------------
async function render() {
  releasePhotoURLs();
  const parts = location.hash.replace(/^#\/?/, '').split('/'); // "#/list/all" -> ["list","all"]
  const [page, arg] = parts;
  window.scrollTo(0, 0);
  try {
    if (page === 'new' && arg) await renderForm(arg, null);
    else if (page === 'new') renderChooser();
    else if (page === 'edit') await renderForm(null, arg);
    else if (page === 'view') await renderDetail(arg);
    else if (page === 'export') await renderExport();
    else await renderList(arg || 'all');
  } catch (err) {
    console.error(err);
    app.replaceChildren(el('div', { class: 'card error' }, 'Something went wrong: ' + err.message));
  }
}

// Shared top part of each screen: the section tabs.
function tabs(current) {
  const all = [{ id: 'all', label: 'All', icon: '📚' }, ...SECTIONS];
  return el(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    all.map((s) =>
      el(
        'a',
        { href: `#/list/${s.id}`, class: 'tab' + (s.id === current ? ' active' : ''), 'data-section': s.id },
        `${s.icon} ${s.label}`
      )
    )
  );
}

// A little pop-up message at the bottom of the screen, e.g. "Saved".
function toast(message) {
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}

// ---------------------------------------------------------------------
// LIST screen (home)
// ---------------------------------------------------------------------
async function renderList(type) {
  const everything = (await db.getAllEntries()).sort(newestFirst);
  const inSection = type === 'all' ? everything : everything.filter((e) => e.type === type);
  const section = type === 'all' ? null : getSection(type);

  const screen = [tabs(type)];

  // --- Backup reminder ---
  const lastBackup = await db.getMeta('lastBackup');
  if (everything.length > 0) {
    const days = lastBackup ? Math.floor((Date.now() - new Date(lastBackup)) / 86400000) : null;
    if (days === null || days > BACKUP_REMINDER_DAYS) {
      screen.push(
        el(
          'div',
          { class: 'banner warn', id: 'backup-reminder' },
          el('p', {}, days === null ? "⚠️ You haven't made a backup yet." : `⚠️ Last backup was ${days} days ago.`),
          el('p', { class: 'small' }, 'Your logbook only lives on this phone. Make a backup file and keep a copy somewhere safe.'),
          el('a', { class: 'btn small-btn', href: '#/export' }, 'Back up now')
        )
      );
    }
  }

  // --- "Coming up" banner on the All screen: things due/expiring soon ---
  if (type === 'all') {
    const soon = everything.filter((e) => {
      const d = daysUntil(e.dueDate);
      return d !== null && d >= 0 && d <= SOON_DAYS;
    });
    if (soon.length) {
      screen.push(
        el(
          'a',
          { class: 'banner soon', href: '#/list/warranty', id: 'soon-banner' },
          `⏰ ${soon.length} item${soon.length === 1 ? '' : 's'} due or expiring in the next ${SOON_DAYS} days`
        )
      );
    }
  }

  // --- Search box and total ---
  const search = el('input', {
    type: 'search',
    class: 'search',
    id: 'search',
    placeholder: 'Search title, notes, supplier…',
    value: state.query,
    'aria-label': 'Search',
  });
  const summary = el('div', { class: 'summary', id: 'summary' });
  const list = el('div', { class: 'list', id: 'list' });
  screen.push(search, summary, list);

  // Draw (or redraw) just the list part. We call this on every key press
  // in the search box, instead of redrawing the whole screen, so the
  // keyboard doesn't close while you type.
  function drawList() {
    releasePhotoURLs();
    const q = state.query.trim().toLowerCase();
    const shown = q
      ? inSection.filter((e) => [e.title, e.notes, e.supplier].some((f) => (f || '').toLowerCase().includes(q)))
      : inSection;

    summary.replaceChildren(
      el('span', {}, `${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}`),
      el('span', { class: 'total' }, 'Total: ', el('strong', { id: 'total' }, money(totalCost(shown))))
    );

    if (shown.length === 0) {
      list.replaceChildren(
        el(
          'p',
          { class: 'empty' },
          q ? 'Nothing matches your search.' : `No ${section ? section.label.toLowerCase() : 'entries'} yet. Tap + to add one.`
        )
      );
      return;
    }
    list.replaceChildren(...shown.map(entryCard));
  }
  search.addEventListener('input', () => {
    state.query = search.value;
    drawList();
  });
  drawList();

  // --- The big round "+" button ---
  screen.push(
    el('a', { class: 'fab', href: type === 'all' ? '#/new' : `#/new/${type}`, 'aria-label': 'Add entry', id: 'add' }, '+')
  );

  app.replaceChildren(...screen);
}

// One row in the list.
function entryCard(e) {
  const section = getSection(e.type);
  const days = daysUntil(e.dueDate);
  let dueClass = '';
  if (days !== null && days < 0) dueClass = ' expired';
  else if (days !== null && days <= SOON_DAYS) dueClass = ' soon';

  const thumb =
    e.photos && e.photos.length
      ? el('img', { class: 'thumb', src: photoURL(e.photos[0].blob), alt: '' })
      : el('div', { class: 'thumb placeholder' }, section.icon);

  const details = [niceDate(e.date), e.supplier].filter(Boolean).join(' · ');

  return el(
    'a',
    { class: 'entry' + dueClass, href: `#/view/${e.id}`, 'data-id': e.id },
    thumb,
    el(
      'div',
      { class: 'entry-text' },
      el('div', { class: 'entry-title' }, e.title),
      el('div', { class: 'entry-sub' }, details),
      e.meterValue !== null && e.meterValue !== undefined && e.meterValue !== ''
        ? el('div', { class: 'entry-meter' }, `${e.meterValue} ${e.meterUnit || ''}`)
        : null,
      e.dueDate ? el('div', { class: 'due' + dueClass }, dueText(section.dueWord || 'due', days)) : null
    ),
    e.cost ? el('div', { class: 'entry-cost' }, money(e.cost)) : null
  );
}

// ---------------------------------------------------------------------
// CHOOSER: "What do you want to add?"
// ---------------------------------------------------------------------
function renderChooser() {
  app.replaceChildren(
    el('h2', {}, 'What do you want to add?'),
    el(
      'div',
      { class: 'chooser' },
      SECTIONS.map((s) => el('a', { class: 'choice', href: `#/new/${s.id}`, 'data-section': s.id }, el('span', { class: 'choice-icon' }, s.icon), s.single))
    ),
    el('a', { class: 'btn secondary', href: '#/list/all' }, 'Cancel')
  );
}

// ---------------------------------------------------------------------
// FORM: add or edit an entry
// ---------------------------------------------------------------------
async function renderForm(type, id) {
  // Editing? Load the existing entry. Adding? Start a blank one.
  let entry;
  if (id) {
    entry = await db.getEntry(id);
    if (!entry) throw new Error('That entry no longer exists.');
  } else {
    entry = { id: null, type, title: '', date: todayISO(), cost: null, supplier: '', notes: '', dueDate: null, meterValue: null, meterUnit: '', photos: [] };
  }
  const section = getSection(entry.type);
  // A working copy of the photo list; only saved when you press Save.
  let photos = [...(entry.photos || [])];

  // A labelled input field. "name" is how we find it again on save.
  const field = (label, input, hint) =>
    el('label', { class: 'field' }, el('span', { class: 'label' }, label), input, hint ? el('span', { class: 'hint' }, hint) : null);

  const form = el('form', { class: 'form', id: 'entry-form', novalidate: true });

  form.append(
    el('h2', {}, `${section.icon} ${id ? 'Edit' : 'Add'} ${section.single.toLowerCase()}`),
    field('Title *', el('input', { name: 'title', required: true, value: entry.title, maxlength: '200', autocomplete: 'off' })),
    field('Date *', el('input', { name: 'date', type: 'date', required: true, value: entry.date || todayISO() })),
    field(
      'Cost £ (optional)',
      // type="text" + inputmode="decimal" shows the number keypad but still
      // lets us accept things like "£12.50" or "1,200".
      el('input', { name: 'cost', inputmode: 'decimal', value: entry.cost ?? '', placeholder: '0.00', autocomplete: 'off' })
    ),
    field('Supplier / who (optional)', el('input', { name: 'supplier', value: entry.supplier || '', autocomplete: 'off', list: 'supplier-list' }))
  );

  // Suggest suppliers you've used before (a "datalist" gives autocomplete).
  const allEntries = await db.getAllEntries();
  const suppliers = [...new Set(allEntries.map((e) => e.supplier).filter(Boolean))].sort();
  form.append(el('datalist', { id: 'supplier-list' }, suppliers.map((s) => el('option', { value: s }))));

  if (section.showMeter) {
    form.append(
      el(
        'div',
        { class: 'row' },
        field('Reading', el('input', { name: 'meterValue', inputmode: 'decimal', value: entry.meterValue ?? '', autocomplete: 'off' })),
        field('Unit', el('input', { name: 'meterUnit', value: entry.meterUnit || 'kWh', list: 'unit-list', autocomplete: 'off' }))
      ),
      el('datalist', { id: 'unit-list' }, ['kWh', 'm³', 'litres', 'gallons'].map((u) => el('option', { value: u })))
    );
  }
  if (section.showDue) {
    form.append(field(section.dueLabel, el('input', { name: 'dueDate', type: 'date', value: entry.dueDate || '' })));
  }
  form.append(field('Notes', el('textarea', { name: 'notes', rows: '4' }, entry.notes || '')));

  // --- Photos ---
  // Two hidden file pickers. capture="environment" opens the back camera
  // straight away; the other opens the gallery and allows several at once.
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'camera-input' });
  const galleryInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'gallery-input' });
  const photoGrid = el('div', { class: 'photo-grid', id: 'photo-grid' });
  const busy = el('p', { class: 'hint', hidden: true }, 'Shrinking photo…');

  function drawPhotos() {
    photoGrid.replaceChildren(
      ...photos.map((p, i) =>
        el(
          'div',
          { class: 'photo' },
          el('img', { src: photoURL(p.blob), alt: `Photo ${i + 1}` }),
          el('button', { type: 'button', class: 'remove-photo', 'aria-label': 'Remove photo', onclick: () => { photos.splice(i, 1); drawPhotos(); } }, '✕')
        )
      )
    );
  }

  async function addFiles(fileList) {
    busy.hidden = false;
    for (const file of fileList) {
      try {
        const blob = await compressImage(file);
        photos.push({ id: db.newId(), blob });
      } catch (err) {
        alert(err.message);
      }
    }
    busy.hidden = true;
    drawPhotos();
  }
  cameraInput.addEventListener('change', () => { addFiles([...cameraInput.files]); cameraInput.value = ''; });
  galleryInput.addEventListener('change', () => { addFiles([...galleryInput.files]); galleryInput.value = ''; });

  form.append(
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Photos'), photoGrid, busy,
      el(
        'div',
        { class: 'row' },
        el('button', { type: 'button', class: 'btn secondary', onclick: () => cameraInput.click() }, '📷 Take photo'),
        el('button', { type: 'button', class: 'btn secondary', onclick: () => galleryInput.click() }, '🖼️ Gallery')
      ),
      cameraInput,
      galleryInput
    )
  );
  drawPhotos();

  const errorBox = el('p', { class: 'error', id: 'form-error', hidden: true });
  form.append(
    errorBox,
    el('div', { class: 'row sticky-actions' },
      el('button', { type: 'button', class: 'btn secondary', onclick: () => history.back() }, 'Cancel'),
      el('button', { type: 'submit', class: 'btn', id: 'save' }, 'Save')
    )
  );

  // --- Saving ---
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // stop the browser doing an old-style page reload
    if (!busy.hidden) return; // still shrinking a photo — wait

    const v = (name) => (form.elements[name] ? form.elements[name].value.trim() : '');
    const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center' }); };

    if (!v('title')) return showError('Please give it a title.');
    if (!v('date')) return showError('Please choose a date.');

    const cost = parseMoney(v('cost'));
    if (cost === undefined) return showError('The cost should be a number, like 12.50');
    let meterValue = null;
    if (section.showMeter && v('meterValue') !== '') {
      meterValue = Number(v('meterValue').replace(/,/g, ''));
      if (!isFinite(meterValue)) return showError('The meter reading should be a number.');
    }

    const now = new Date().toISOString();
    const saved = {
      ...entry,
      id: entry.id || db.newId(),
      title: v('title'),
      date: v('date'),
      cost,
      supplier: v('supplier'),
      notes: v('notes'),
      dueDate: section.showDue ? v('dueDate') || null : entry.dueDate || null,
      meterValue: section.showMeter ? meterValue : entry.meterValue ?? null,
      meterUnit: section.showMeter ? v('meterUnit') : entry.meterUnit || '',
      photos,
      createdAt: entry.createdAt || now,
      updatedAt: now,
    };
    await db.saveEntry(saved);
    toast('Saved ✓');
    // replace() instead of a normal link, so pressing Back afterwards
    // doesn't take you back into the form.
    location.replace(`#/view/${saved.id}`);
  });

  app.replaceChildren(form);
  if (!id) form.elements.title.focus();
}

// "£1,200.50" -> 1200.5 ; "" -> null ; "abc" -> undefined (invalid)
function parseMoney(text) {
  const cleaned = text.replace(/[£,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------
// DETAIL: look at one entry
// ---------------------------------------------------------------------
async function renderDetail(id) {
  const e = await db.getEntry(id);
  if (!e) {
    app.replaceChildren(el('p', { class: 'empty' }, 'That entry was not found.'), el('a', { class: 'btn', href: '#/list/all' }, 'Back to list'));
    return;
  }
  const section = getSection(e.type);
  const days = daysUntil(e.dueDate);

  const rows = [
    ['Section', `${section.icon} ${section.single}`],
    ['Date', niceDate(e.date)],
    ['Cost', e.cost ? money(e.cost) : null],
    ['Supplier / who', e.supplier],
    ['Reading', e.meterValue !== null && e.meterValue !== undefined ? `${e.meterValue} ${e.meterUnit || ''}` : null],
    [section.dueWord === 'expires' ? 'Expires' : 'Next due', e.dueDate ? `${niceDate(e.dueDate)} (${dueText(section.dueWord || 'due', days)})` : null],
  ].filter(([, value]) => value);

  app.replaceChildren(
    el('a', { class: 'back', href: `#/list/${e.type}` }, `← ${section.label}`),
    el('h2', { id: 'detail-title' }, e.title),
    el('dl', { class: 'details' }, rows.map(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])),
    e.notes ? el('p', { class: 'notes' }, e.notes) : null,
    el(
      'div',
      { class: 'photos-large' },
      (e.photos || []).map((p) => {
        const url = photoURL(p.blob);
        return el('img', { src: url, alt: 'Photo', onclick: () => showFullPhoto(url) });
      })
    ),
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn', href: `#/edit/${e.id}`, id: 'edit' }, '✏️ Edit'),
      el(
        'button',
        {
          class: 'btn danger',
          id: 'delete',
          onclick: async () => {
            // Always ask first — there's no undo!
            if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
            await db.deleteEntry(e.id);
            toast('Deleted');
            location.replace(`#/list/${e.type}`);
          },
        },
        '🗑️ Delete'
      )
    )
  );
}

// Tap a photo to see it full screen; tap again to close.
function showFullPhoto(url) {
  const overlay = el('div', { class: 'overlay', onclick: () => overlay.remove() }, el('img', { src: url, alt: 'Photo' }));
  document.body.append(overlay);
}

// ---------------------------------------------------------------------
// EXPORT screen: backup, restore, report
// ---------------------------------------------------------------------
async function renderExport() {
  const entries = await db.getAllEntries();
  const lastBackup = await db.getMeta('lastBackup');
  const photoCount = entries.reduce((n, e) => n + (e.photos || []).length, 0);

  // How much space are we using? (Chrome can tell us roughly.)
  let usage = '';
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    usage = `About ${(est.usage / 1048576).toFixed(1)} MB used on this phone.`;
  }
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'import-input' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!confirm('Restore from this backup?\n\nEntries in the backup will be added. Any entry that is already on this phone with the same ID will be replaced by the backup copy. Nothing else is deleted.')) return;
    try {
      const n = await importBackup(file);
      toast(`Restored ${n} entries ✓`);
      location.hash = '#/list/all';
    } catch (err) {
      alert(err.message);
    }
  });

  app.replaceChildren(
    el('a', { class: 'back', href: '#/list/all' }, '← Logbook'),
    el('h2', {}, 'Backup & report'),
    el(
      'div',
      { class: 'card' },
      el('h3', {}, '💾 Back up'),
      el('p', {}, `${entries.length} entries, ${photoCount} photos. ${usage}`),
      el('p', { id: 'last-backup' }, lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString('en-GB')}` : 'No backup made yet.'),
      el('p', { class: 'small' }, 'This downloads one file (with all photos inside) to your Downloads folder. Then copy it somewhere safe — email it to yourself or put it on Google Drive.'),
      el(
        'button',
        {
          class: 'btn',
          id: 'export-btn',
          onclick: async (ev) => {
            ev.target.disabled = true;
            ev.target.textContent = 'Preparing…';
            try {
              const r = await exportBackup();
              toast(`Backup saved: ${r.filename}`);
            } catch (err) {
              alert('Backup failed: ' + err.message);
            }
            renderExport();
          },
        },
        'Download backup file'
      )
    ),
    el(
      'div',
      { class: 'card' },
      el('h3', {}, '📥 Restore'),
      el('p', { class: 'small' }, 'Load a backup file made by this app (e.g. on a new phone).'),
      el('button', { class: 'btn secondary', id: 'import-btn', onclick: () => fileInput.click() }, 'Choose backup file…'),
      fileInput
    ),
    el(
      'div',
      { class: 'card' },
      el('h3', {}, '🖨️ Printable report'),
      el('p', { class: 'small' }, 'Opens a report of every entry with photos. Use Print → "Save as PDF" to keep or send a copy.'),
      el('a', { class: 'btn secondary', href: 'report.html', id: 'report-link' }, 'Open report')
    ),
    el(
      'p',
      { class: 'small muted' },
      persisted
        ? '✓ Chrome has agreed to keep this data (persistent storage).'
        : 'Tip: install the app to your home screen so Chrome is less likely to clear its storage.',
      el('br'),
      '⚠️ Clearing Chrome’s site data or "storage" for this app deletes the whole logbook. Keep backups!'
    )
  );
}

// ---------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------
window.addEventListener('hashchange', render);
render();
db.requestPersistentStorage();

// Register the service worker (see sw.js) so the app works offline.
// "serviceWorker in navigator" checks the browser supports it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
}
