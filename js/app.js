// =====================================================================
// app.js — the main program: draws each screen and reacts to taps.
// =====================================================================
//
// HOW THE SCREENS WORK ("routing")
// The whole app is ONE web page (index.html). Instead of loading new
// pages, we change the part of the address after the "#" (the "hash"):
//
//   #/home            the dashboard (home screen)
//   #/welcome         the first-run welcome screen
//   #/list/all        every entry
//   #/list/warranty   one section's list
//   #/new             "what do you want to add?" chooser
//   #/new/receipt     blank form for a new receipt
//   #/view/<id>       one entry, with its photos
//   #/edit/<id>       the form, filled in, for editing
//   #/export          backup / restore / report / appearance
//
// Whenever the hash changes, the browser fires a "hashchange" event and we
// call render(), which looks at the hash and draws the matching screen
// into the <main id="app"> box. A nice side effect: the phone's Back button
// works, because each screen has its own address in the history.

import { SECTIONS, getSection, SOON_DAYS, BACKUP_REMINDER_DAYS } from './sections.js';
import { APP_NAME, APP_TAGLINE, ADDRESS } from './config.js';
import * as db from './db.js';
import { compressImage } from './photos.js';
import { exportBackup, importBackup } from './backup.js';
import { el, money, totalCost, niceDate, todayISO, daysUntil, dueText, newestFirst } from './utils.js';
import { icon } from './icons.js';
import { barChart, sparkline } from './charts.js';
import { spendInYear, monthlySpend, upcoming, overdue, readings, usageIntervals, bills, monthName } from './stats.js';
import { getTheme, setTheme, applyTheme } from './theme.js';

const app = document.getElementById('app');
const WELCOME_KEY = 'hearthbook.welcomed';

// Things we remember while the app is open (not saved to the database).
const state = {
  query: '', // what's typed in the search box
  chartMode: 'all', // dashboard chart: 'all' spending or just 'bills'
  chartPick: -1, // which bar is tapped
};

// The name comes from config.js, so renaming is a one-line change.
document.title = APP_NAME;
document.querySelectorAll('[data-app-name]').forEach((n) => (n.textContent = APP_NAME));
applyTheme();

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

// Small helpers for the welcome flag (a display preference, so it's kept
// in localStorage rather than in the logbook database).
const welcomed = () => { try { return localStorage.getItem(WELCOME_KEY) === 'yes'; } catch { return true; } };
const markWelcomed = () => { try { localStorage.setItem(WELCOME_KEY, 'yes'); } catch {} };

// ---------------------------------------------------------------------
// The router: pick a screen based on the address hash
// ---------------------------------------------------------------------
async function render() {
  releasePhotoURLs();
  const parts = location.hash.replace(/^#\/?/, '').split('/'); // "#/list/all" -> ["list","all"]
  const [page, arg] = parts;
  window.scrollTo(0, 0);
  setChrome(page, arg);
  try {
    if (page === 'new' && arg) await renderForm(arg, null);
    else if (page === 'new') renderChooser();
    else if (page === 'edit') await renderForm(null, arg);
    else if (page === 'view') await renderDetail(arg);
    else if (page === 'export') await renderExport();
    else if (page === 'list') await renderList(arg || 'all');
    else if (page === 'welcome') renderWelcome();
    else await renderHome();
  } catch (err) {
    console.error(err);
    app.replaceChildren(el('div', { class: 'card error' }, 'Something went wrong: ' + err.message));
  }
  // Replay the gentle "slide in" animation for the new screen.
  app.classList.remove('screen-in');
  void app.offsetWidth;
  app.classList.add('screen-in');
}

// Bottom navigation: highlight the current tab and point "+" at the
// right section. Hidden on the form and welcome screens.
function setChrome(page, arg) {
  const tab =
    page === 'list' && arg === 'meter' ? 'meter'
    : page === 'list' || page === 'view' || page === 'new' ? 'list'
    : page === 'export' ? 'export'
    : 'home';
  document.querySelectorAll('.bottom-nav [data-tab]').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const add = document.getElementById('add');
  if (add) add.href = page === 'list' && arg && arg !== 'all' ? `#/new/${arg}` : '#/new';
  const bare = page === 'edit' || (page === 'new' && arg) || page === 'welcome';
  document.body.classList.toggle('no-nav', bare);
}

// The pill-shaped section filters at the top of the list.
function tabs(current) {
  const all = [{ id: 'all', label: 'All', glyph: 'list', tone: 'brand' }, ...SECTIONS];
  return el(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    all.map((s) =>
      el(
        'a',
        { href: `#/list/${s.id}`, class: 'tab' + (s.id === current ? ' active' : ''), 'data-section': s.id, 'data-tone': s.tone, 'aria-current': s.id === current ? 'page' : null },
        icon(s.glyph, 18),
        s.label
      )
    )
  );
}

// A coloured rounded square with the section's icon.
function sectionBadge(section, size = 'md') {
  return el('span', { class: `badge badge-${size}`, 'data-tone': section.tone || 'slate' }, icon(section.glyph, size === 'lg' ? 28 : size === 'sm' ? 18 : 22));
}

// A little pop-up message at the bottom of the screen, e.g. "Saved".
function toast(message) {
  const t = el('div', { class: 'toast', role: 'status' }, icon('check', 18), message);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2600);
}

// Screen header: optional back link, large title, optional subtitle.
function screenHead(title, { back, sub, id, action } = {}) {
  return el(
    'header',
    { class: 'screen-head' },
    back ? el('a', { class: 'back', href: back.href }, icon('back', 20), back.label) : null,
    el('div', { class: 'screen-title-row' },
      el('h1', { class: 'screen-title', id }, title),
      action || null
    ),
    sub ? el('p', { class: 'screen-sub' }, sub) : null
  );
}

// "You haven't made a backup" banner, if it's due.
async function backupReminder(count) {
  if (count === 0) return null;
  const lastBackup = await db.getMeta('lastBackup');
  const days = lastBackup ? Math.floor((Date.now() - new Date(lastBackup)) / 86400000) : null;
  if (days !== null && days <= BACKUP_REMINDER_DAYS) return null;
  return el(
    'div',
    { class: 'banner warn compact', id: 'backup-reminder', role: 'note' },
    el('span', { class: 'banner-icon' }, icon('alert', 20)),
    el('div', { class: 'banner-body' },
      el('p', { class: 'banner-title' }, days === null ? 'No backup yet' : `Last backup was ${days} days ago.`),
      el('p', { class: 'small' }, 'Your logbook only lives on this phone.')
    ),
    el('a', { class: 'btn small-btn', href: '#/export' }, 'Back up')
  );
}

// Short "in 5 months" style text for the small dashboard chips.
function shortDue(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days >= 730) return `In ${Math.round(days / 365.25)} years`;
  if (days > 90) return `In ${Math.round(days / 30.44)} months`;
  return `In ${days} days`;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

// ---------------------------------------------------------------------
// WELCOME screen (first run)
// ---------------------------------------------------------------------
function renderWelcome() {
  document.body.classList.add('no-nav'); // a clean, full-screen first impression
  const point = (glyph, tone, title, text) =>
    el('li', { class: 'welcome-point' }, el('span', { class: 'badge badge-md', 'data-tone': tone }, icon(glyph)), el('div', {}, el('strong', {}, title), el('span', {}, text)));
  app.replaceChildren(
    el(
      'section',
      { class: 'welcome', id: 'welcome', 'aria-labelledby': 'welcome-title' },
      el('img', { class: 'welcome-logo', src: 'icons/icon.svg', alt: '', width: '88', height: '88' }),
      el('h1', { id: 'welcome-title' }, `Welcome to ${APP_NAME}`),
      el('p', { class: 'welcome-lead' }, `${APP_TAGLINE} Receipts, warranties, jobs and meter readings for ${ADDRESS.toLowerCase() === 'my home' ? 'your home' : ADDRESS} — in one tidy place.`),
      el(
        'ul',
        { class: 'welcome-points' },
        point('receipt', 'teal', 'Snap it, file it', 'Photograph receipts and labels; they’re shrunk to save space.'),
        point('shield', 'violet', 'Never miss an expiry', 'Warranties and services due in the next 60 days are flagged.'),
        point('lock', 'indigo', 'Private by design', 'Everything stays on this phone. No account, no cloud — works offline.')
      ),
      el('div', { class: 'welcome-actions' },
        el('button', { class: 'btn btn-lg', id: 'welcome-start', type: 'button', onclick: () => { markWelcomed(); location.replace('#/home'); } }, 'Get started'),
        el('button', { class: 'btn btn-lg ghost', id: 'welcome-restore', type: 'button', onclick: () => { markWelcomed(); location.replace('#/export'); } }, icon('upload', 20), 'I have a backup file')
      )
    )
  );
}

// ---------------------------------------------------------------------
// HOME: the dashboard
// ---------------------------------------------------------------------
async function renderHome() {
  const everything = (await db.getAllEntries()).sort(newestFirst);
  if (everything.length === 0 && !welcomed()) return renderWelcome();
  if (everything.length) markWelcomed(); // existing users never see it

  const year = new Date().getFullYear();
  const head = el(
    'header',
    { class: 'dash-head' },
    el('p', { class: 'eyebrow' }, greeting()),
    el('h1', { class: 'screen-title' }, ADDRESS),
    el('p', { class: 'screen-sub' }, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))
  );

  if (everything.length === 0) {
    app.replaceChildren(
      el('div', { class: 'dash', id: 'dashboard' },
        head,
        el('div', { class: 'empty empty-hero' },
          el('div', { class: 'empty-art' }, icon('home', 44)),
          el('h2', {}, 'Your logbook is empty'),
          el('p', {}, 'Add your first receipt, warranty, job or meter reading. It takes a few seconds.'),
          el('div', { class: 'stack' },
            el('a', { class: 'btn btn-lg', href: '#/new', id: 'empty-add' }, icon('plus', 20), 'Add first entry'),
            el('a', { class: 'btn btn-lg secondary', href: '#/export' }, icon('upload', 20), 'Restore a backup')
          )
        ),
        el('div', { class: 'section-grid' }, SECTIONS.map((s) => sectionTile(s, [])))
      )
    );
    return;
  }

  const thisYear = spendInYear(everything, year);
  const lastYear = spendInYear(everything, year - 1);
  const countThisYear = everything.filter((e) => (e.date || '').startsWith(String(year))).length;

  // --- Hero: spend this year ---
  const hero = el(
    'a',
    { class: 'hero', href: '#/list/all', id: 'spend-card' },
    el('p', { class: 'hero-label' }, `Spent in ${year}`),
    el('p', { class: 'hero-value', id: 'spend-year' }, money(thisYear)),
    el('p', { class: 'hero-sub' }, `${countThisYear} entr${countThisYear === 1 ? 'y' : 'ies'} this year · ${money(lastYear)} in ${year - 1}`),
    el('div', { class: 'hero-split' },
      SECTIONS.map((s) => {
        const v = spendInYear(everything.filter((e) => e.type === s.id), year);
        const name = s.id === 'meter' ? 'Bills' : s.label.split(' ')[0];
        return v > 0 ? el('span', { class: 'hero-chip' }, icon(s.glyph, 14), `${name} ${money(v).replace(/\.\d\d$/, '')}`) : null;
      })
    )
  );

  // --- Next due / expiring ---
  const next = upcoming(everything)[0];
  const late = overdue(everything);
  const nextCard = el(
    'a',
    { class: 'stat-card', id: 'next-due', href: next ? `#/view/${next.id}` : '#/list/warranty' },
    el('span', { class: 'stat-label' }, icon('clock', 16), 'Next due'),
    next
      ? [
          el('span', { class: 'stat-value' }, niceDate(next.dueDate)),
          el('span', { class: 'stat-title' }, next.title),
          el('span', { class: 'pill ' + (daysUntil(next.dueDate) <= SOON_DAYS ? 'soon' : 'calm'), title: dueText(getSection(next.type).dueWord || 'due', daysUntil(next.dueDate)) }, shortDue(daysUntil(next.dueDate))),
        ]
      : [el('span', { class: 'stat-value muted' }, 'Nothing due'), el('span', { class: 'stat-title' }, 'Add warranty expiry or service dates to see them here.')],
    late.length ? el('span', { class: 'stat-foot' }, `${late.length} expired / overdue`) : null
  );

  // --- Latest meter reading ---
  const r = readings(everything);
  const latest = r[r.length - 1];
  const intervals = usageIntervals(everything);
  const lastInterval = intervals[intervals.length - 1];
  const meterCard = el(
    'a',
    { class: 'stat-card', id: 'latest-reading', href: '#/list/meter' },
    el('span', { class: 'stat-label' }, icon('gauge', 16), 'Latest reading'),
    latest
      ? [
          el('span', { class: 'stat-value' }, Number(latest.meterValue).toLocaleString('en-GB'), el('small', {}, ` ${latest.meterUnit || ''}`)),
          el('span', { class: 'stat-title' }, niceDate(latest.date)),
          lastInterval && lastInterval.to === latest
            ? el('span', { class: 'pill calm' }, `≈ ${lastInterval.perDay.toFixed(1)} ${lastInterval.unit}/day`)
            : null,
        ]
      : [el('span', { class: 'stat-value muted' }, 'No readings'), el('span', { class: 'stat-title' }, 'Log a meter reading to track usage.')]
  );

  // --- Last bill ---
  const b = bills(everything);
  const lastBill = b[b.length - 1];
  const prevBill = b[b.length - 2];
  let billCard = null;
  if (lastBill) {
    const diff = prevBill ? lastBill.cost - prevBill.cost : null;
    billCard = el(
      'a',
      { class: 'stat-card wide', id: 'last-bill', href: `#/view/${lastBill.id}` },
      el('div', { class: 'wide-main' },
        el('span', { class: 'stat-label' }, icon('bolt', 16), 'Last bill'),
        el('span', { class: 'stat-value' }, money(lastBill.cost)),
        el('span', { class: 'stat-title' }, `${lastBill.supplier || getSection('meter').single} · ${niceDate(lastBill.date)}`),
        diff !== null
          ? el('span', { class: 'pill ' + (diff > 0 ? 'up' : 'down') }, `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))} vs previous`)
          : null
      ),
      sparkline(b.slice(-12).map((x) => x.cost), { width: 112, height: 48 })
    );
  }

  // --- Spending chart ---
  const chartCard = el('section', { class: 'card chart-card', id: 'spend-chart', 'aria-labelledby': 'chart-title' });
  function drawChart() {
    const source = state.chartMode === 'bills' ? everything.filter((e) => e.type === 'meter') : everything;
    const months = monthlySpend(source, 12);
    // Default to the latest month that actually has some spending.
    let pick = state.chartPick;
    if (pick < 0) { pick = months.length - 1; while (pick > 0 && !months[pick].value) pick--; }
    const total = totalCost(months.map((m) => ({ cost: m.value })));
    const seg = (mode, label) =>
      el('button', { type: 'button', class: 'seg-btn' + (state.chartMode === mode ? ' active' : ''), 'aria-pressed': String(state.chartMode === mode), 'data-mode': mode,
        onclick: () => { state.chartMode = mode; state.chartPick = -1; drawChart(); } }, label);
    chartCard.replaceChildren(
      el('div', { class: 'card-head' },
        el('div', {}, el('h2', { class: 'card-title', id: 'chart-title' }, 'Spending'), el('p', { class: 'card-sub' }, `Last 12 months · ${money(total)}`)),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Chart shows' }, seg('all', 'All'), seg('bills', 'Bills'))
      ),
      el('p', { class: 'chart-readout', id: 'chart-readout', 'aria-live': 'polite' },
        el('strong', {}, money(months[pick].value)), ` in ${months[pick].title}`),
      barChart(months, { height: 150, selected: pick, format: (v) => money(v).replace(/\.\d\d$/, ''), onSelect: (i) => { state.chartPick = i; drawChart(); } })
    );
  }
  drawChart();

  // --- Coming up & recent ---
  const soonList = upcoming(everything).slice(0, 3);
  const recent = everything.slice(0, 4);

  app.replaceChildren(
    el('div', { class: 'dash', id: 'dashboard' },
      head,
      hero,
      await backupReminder(everything.length),
      el('div', { class: 'stat-grid' }, nextCard, meterCard, billCard),
      chartCard,
      el('div', { class: 'section-grid' }, SECTIONS.map((s) => sectionTile(s, everything))),
      soonList.length
        ? el('section', { class: 'group' },
            el('div', { class: 'group-head' }, el('h2', {}, 'Coming up'), el('a', { href: '#/list/warranty', class: 'link' }, 'Warranties')),
            el('div', { class: 'list' }, soonList.map(entryCard)))
        : null,
      el('section', { class: 'group' },
        el('div', { class: 'group-head' }, el('h2', {}, 'Recent'), el('a', { href: '#/list/all', class: 'link' }, 'See all')),
        el('div', { class: 'list' }, recent.map(entryCard)))
    )
  );
}

function sectionTile(s, everything) {
  const items = everything.filter((e) => e.type === s.id);
  return el(
    'a',
    { class: 'section-tile', href: `#/list/${s.id}`, 'data-tone': s.tone },
    sectionBadge(s),
    el('span', { class: 'tile-label' }, s.label),
    el('span', { class: 'tile-meta' }, items.length ? `${items.length} · ${money(totalCost(items)).replace(/\.\d\d$/, '')}` : 'None yet')
  );
}

// ---------------------------------------------------------------------
// LIST screen
// ---------------------------------------------------------------------
async function renderList(type) {
  const everything = (await db.getAllEntries()).sort(newestFirst);
  const inSection = type === 'all' ? everything : everything.filter((e) => e.type === type);
  const section = type === 'all' ? null : getSection(type);

  const screen = [screenHead(section ? section.label : 'Logbook', { id: 'list-title' }), tabs(type)];

  // --- Backup reminder ---
  screen.push(await backupReminder(everything.length));

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
          el('span', { class: 'banner-icon' }, icon('clock', 20)),
          el('span', { class: 'banner-body' }, `${soon.length} item${soon.length === 1 ? '' : 's'} due or expiring in the next ${SOON_DAYS} days`),
          icon('chevron', 18)
        )
      );
    }
  }

  // --- Meter insights on the meter readings screen ---
  if (type === 'meter') screen.push(meterInsights(everything));

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
  screen.push(el('label', { class: 'search-wrap' }, icon('search', 20), search), summary, list);

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
      el('span', { class: 'total' }, 'Total ', el('strong', { id: 'total' }, money(totalCost(shown))))
    );

    if (shown.length === 0) {
      list.replaceChildren(
        el(
          'div',
          { class: 'empty' },
          el('div', { class: 'empty-art' }, icon(q ? 'search' : section ? section.glyph : 'list', 36)),
          el('p', {}, q ? 'Nothing matches your search.' : `No ${section ? section.label.toLowerCase() : 'entries'} yet. Tap + to add one.`)
        )
      );
      return;
    }
    // Group by month, with a small heading and that month's total.
    const groups = [];
    for (const e of shown) {
      const key = (e.date || '').slice(0, 7) || 'undated';
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) groups.push((g = { key, items: [] }));
      g.items.push(e);
    }
    list.replaceChildren(
      ...groups.flatMap((g) => [
        el('div', { class: 'month-head' },
          el('span', {}, g.key === 'undated' ? 'No date' : monthName(g.key)),
          el('span', {}, money(totalCost(g.items)))),
        ...g.items.map(entryCard),
      ])
    );
  }
  search.addEventListener('input', () => {
    state.query = search.value;
    drawList();
  });
  drawList();

  app.replaceChildren(...screen.filter(Boolean));
}

// Summary card + usage chart at the top of the meter readings list.
function meterInsights(everything) {
  const r = readings(everything);
  const intervals = usageIntervals(everything).slice(-12);
  const b = bills(everything);
  const latest = r[r.length - 1];
  if (!latest) return null;
  const recent = intervals.slice(-3);
  const avg = recent.length ? recent.reduce((s, i) => s + i.used, 0) / recent.reduce((s, i) => s + i.days, 0) : null;
  const year = new Date().getFullYear();
  const billsYear = totalCost(b.filter((x) => (x.date || '').startsWith(String(year))));
  return el(
    'section',
    { class: 'card meter-card', id: 'meter-insights', 'aria-label': 'Meter summary' },
    el('div', { class: 'meter-stats' },
      el('div', {}, el('span', { class: 'stat-label' }, 'Latest'), el('span', { class: 'stat-value' }, Number(latest.meterValue).toLocaleString('en-GB')), el('span', { class: 'stat-title' }, `${latest.meterUnit || ''} · ${niceDate(latest.date)}`)),
      el('div', {}, el('span', { class: 'stat-label' }, 'Daily use'), el('span', { class: 'stat-value' }, avg !== null ? avg.toFixed(1) : '–'), el('span', { class: 'stat-title' }, `${latest.meterUnit || ''}/day, recent`)),
      el('div', {}, el('span', { class: 'stat-label' }, `Bills ${year}`), el('span', { class: 'stat-value' }, money(billsYear).replace(/\.\d\d$/, '')), el('span', { class: 'stat-title' }, `${b.filter((x) => (x.date || '').startsWith(String(year))).length} bills`))
    ),
    intervals.length > 1
      ? [
          el('p', { class: 'card-sub chart-caption' }, `Daily use between readings (${latest.meterUnit || ''}/day)`),
          barChart(
            intervals.map((i) => ({ label: new Date(i.to.date).toLocaleDateString('en-GB', { month: 'short' }).slice(0, 1), title: `to ${niceDate(i.to.date)}`, value: Math.round(i.perDay * 10) / 10 })),
            { height: 120, selected: intervals.length - 1, format: (v) => v.toFixed(1) }
          ),
        ]
      : null
  );
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
      ? el('span', { class: 'thumb-wrap' }, el('img', { class: 'thumb', src: photoURL(e.photos[0].blob), alt: '' }), el('span', { class: 'thumb-tag', 'data-tone': section.tone }, icon(section.glyph, 12)))
      : el('div', { class: 'thumb placeholder', 'data-tone': section.tone }, icon(section.glyph, 24));

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
const BLURB = { job: 'Work done, services, repairs', receipt: 'Things you bought', warranty: 'Cover and expiry dates', meter: 'Readings and energy bills' };
function renderChooser() {
  app.replaceChildren(
    screenHead('Add to logbook', { back: { href: '#/home', label: 'Home' }, sub: 'What would you like to record?' }),
    el(
      'div',
      { class: 'chooser' },
      SECTIONS.map((s) =>
        el('a', { class: 'choice', href: `#/new/${s.id}`, 'data-section': s.id, 'data-tone': s.tone },
          sectionBadge(s, 'lg'),
          el('span', { class: 'choice-label' }, s.single),
          el('span', { class: 'choice-blurb' }, BLURB[s.id] || ''))
      )
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
    el('header', { class: 'form-head' },
      el('a', { class: 'back', href: id ? `#/view/${id}` : '#/new', onclick: (ev) => { ev.preventDefault(); history.back(); } }, icon('back', 20), 'Back'),
      el('div', { class: 'form-title' }, sectionBadge(section), el('h1', { class: 'screen-title' }, `${id ? 'Edit' : 'New'} ${section.single.toLowerCase()}`))
    ),
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
  form.append(field('Notes', el('textarea', { name: 'notes', rows: '4', placeholder: 'Serial numbers, what was done, anything useful…' }, entry.notes || '')));

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
          el('button', { type: 'button', class: 'remove-photo', 'aria-label': 'Remove photo', onclick: () => { photos.splice(i, 1); drawPhotos(); } }, icon('x', 18))
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
        el('button', { type: 'button', class: 'btn secondary', onclick: () => cameraInput.click() }, icon('camera', 20), 'Take photo'),
        el('button', { type: 'button', class: 'btn secondary', onclick: () => galleryInput.click() }, icon('image', 20), 'Gallery')
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
    toast('Saved');
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
    app.replaceChildren(
      el('div', { class: 'empty' }, el('div', { class: 'empty-art' }, icon('file', 36)), el('p', {}, 'That entry was not found.')),
      el('a', { class: 'btn', href: '#/list/all' }, 'Back to list')
    );
    return;
  }
  const section = getSection(e.type);
  const days = daysUntil(e.dueDate);
  let dueClass = '';
  if (days !== null && days < 0) dueClass = 'expired';
  else if (days !== null && days <= SOON_DAYS) dueClass = 'soon';

  const rows = [
    ['Section', section.single, 'list'],
    ['Date', niceDate(e.date), 'calendar'],
    ['Cost', e.cost ? money(e.cost) : null, 'receipt'],
    ['Supplier / who', e.supplier, 'home'],
    ['Reading', e.meterValue !== null && e.meterValue !== undefined ? `${e.meterValue} ${e.meterUnit || ''}` : null, 'gauge'],
    [section.dueWord === 'expires' ? 'Expires' : 'Next due', e.dueDate ? `${niceDate(e.dueDate)} (${dueText(section.dueWord || 'due', days)})` : null, 'clock'],
  ].filter(([, value]) => value);

  const photos = e.photos || [];
  app.replaceChildren(
    el('a', { class: 'back', href: `#/list/${e.type}` }, icon('back', 20), section.label),
    el(
      'header',
      { class: 'detail-hero', 'data-tone': section.tone },
      el('div', { class: 'detail-kicker' }, sectionBadge(section, 'sm'), el('span', {}, section.single), e.dueDate ? el('span', { class: 'pill ' + (dueClass || 'calm') }, dueText(section.dueWord || 'due', days)) : null),
      el('h1', { id: 'detail-title' }, e.title),
      e.cost ? el('p', { class: 'detail-amount' }, money(e.cost)) : null,
      el('p', { class: 'detail-meta' }, [niceDate(e.date), e.supplier].filter(Boolean).join(' · '))
    ),
    el('dl', { class: 'details' }, rows.map(([k, val, g]) => el('div', { class: 'detail-row' }, el('dt', {}, icon(g, 18), k), el('dd', {}, val)))),
    e.notes ? el('section', { class: 'notes-card' }, el('h2', { class: 'card-title' }, 'Notes'), el('p', { class: 'notes' }, e.notes)) : null,
    photos.length
      ? el('section', { class: 'photos-card' },
          el('h2', { class: 'card-title' }, `Photos · ${photos.length}`),
          el(
            'div',
            { class: 'photos-large' + (photos.length > 1 ? ' multi' : '') },
            photos.map((p, i) => {
              const url = photoURL(p.blob);
              return el('img', { src: url, alt: `Photo ${i + 1} of ${e.title}`, onclick: () => showFullPhoto(url) });
            })
          ))
      : null,
    el(
      'div',
      { class: 'row detail-actions' },
      el('a', { class: 'btn', href: `#/edit/${e.id}`, id: 'edit' }, icon('pencil', 20), 'Edit'),
      el(
        'button',
        {
          class: 'btn danger-soft',
          id: 'delete',
          onclick: async () => {
            // Always ask first — there's no undo!
            if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
            await db.deleteEntry(e.id);
            toast('Deleted');
            location.replace(`#/list/${e.type}`);
          },
        },
        icon('trash', 20),
        'Delete'
      )
    )
  );
}

// Tap a photo to see it full screen; tap again to close.
function showFullPhoto(url) {
  const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Photo', onclick: () => overlay.remove() },
    el('img', { src: url, alt: 'Photo' }),
    el('button', { class: 'overlay-close', type: 'button', 'aria-label': 'Close' }, icon('x', 22)));
  document.body.append(overlay);
}

// ---------------------------------------------------------------------
// EXPORT screen: backup, restore, report, appearance
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
      markWelcomed();
      toast(`Restored ${n} entries`);
      location.hash = '#/list/all';
    } catch (err) {
      alert(err.message);
    }
  });

  const cardHead = (glyph, tone, title) => el('div', { class: 'card-head' }, el('div', { class: 'card-head-title' }, el('span', { class: 'badge badge-md', 'data-tone': tone }, icon(glyph)), el('h2', { class: 'card-title' }, title)));

  const theme = getTheme();
  const themeBtn = (value, glyph, label) =>
    el('button', { type: 'button', class: 'seg-btn' + (theme === value ? ' active' : ''), 'aria-pressed': String(theme === value), id: `theme-${value}`,
      onclick: () => { setTheme(value); renderExport(); } }, icon(glyph, 16), label);

  app.replaceChildren(
    screenHead('Backup & settings', { sub: `${entries.length} entries · ${photoCount} photos` }),
    el(
      'section',
      { class: 'card' },
      cardHead('backup', 'brand', 'Back up'),
      el('p', {}, `${entries.length} entries, ${photoCount} photos. ${usage}`),
      el('p', { id: 'last-backup', class: 'last-backup' + (lastBackup ? ' ok' : '') }, lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString('en-GB')}` : 'No backup made yet.'),
      el('p', { class: 'small muted' }, 'This downloads one file (with all photos inside) to your Downloads folder. Then copy it somewhere safe — email it to yourself or put it on Google Drive.'),
      el(
        'button',
        {
          class: 'btn',
          id: 'export-btn',
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Preparing…';
            try {
              const r = await exportBackup();
              toast(`Backup saved: ${r.filename}`);
            } catch (err) {
              alert('Backup failed: ' + err.message);
            }
            renderExport();
          },
        },
        icon('download', 20),
        'Download backup file'
      )
    ),
    el(
      'section',
      { class: 'card' },
      cardHead('upload', 'teal', 'Restore'),
      el('p', { class: 'small muted' }, 'Load a backup file made by this app (e.g. on a new phone). Backups from earlier versions of the app work too.'),
      el('button', { class: 'btn secondary', id: 'import-btn', onclick: () => fileInput.click() }, 'Choose backup file…'),
      fileInput
    ),
    el(
      'section',
      { class: 'card' },
      cardHead('printer', 'indigo', 'Printable report'),
      el('p', { class: 'small muted' }, 'Opens a report of every entry with photos. Use Print → "Save as PDF" to keep or send a copy.'),
      el('a', { class: 'btn secondary', href: 'report.html', id: 'report-link' }, 'Open report')
    ),
    el(
      'section',
      { class: 'card' },
      cardHead('sun', 'amber', 'Appearance'),
      el('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Theme' }, themeBtn('system', 'auto', 'Auto'), themeBtn('light', 'sun', 'Light'), themeBtn('dark', 'moon', 'Dark'))
    ),
    el(
      'p',
      { class: 'small muted footnote' },
      persisted
        ? '✓ Chrome has agreed to keep this data (persistent storage).'
        : 'Tip: install the app to your home screen so Chrome is less likely to clear its storage.',
      el('br'),
      '⚠️ Clearing Chrome’s site data or "storage" for this app deletes the whole logbook. Keep backups!'
    ),
    el('p', { class: 'small muted footnote' }, `${APP_NAME} · everything stays on this phone`)
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
