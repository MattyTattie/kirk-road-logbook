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
//   #/scan            scan a receipt or bill (photo or PDF) and pre-fill a form
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
import { periodCard } from './periodcard.js';
import { spendInYear, monthlySpend, upcoming, overdue, readings, usageIntervals, bills, monthName } from './stats.js';
import { getTheme, setTheme, applyTheme } from './theme.js';
import * as sync from './sync.js';

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
    else if (page === 'scan') renderScan();
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
  const bare = page === 'edit' || (page === 'new' && arg) || page === 'welcome' || page === 'scan';
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
    const months13 = monthlySpend(source, 13); // one extra so the first month has a "previous"
    const months = months13.slice(1);
    // Default to the latest month that actually has some spending.
    let pick = state.chartPick;
    if (pick < 0) { pick = months.length - 1; while (pick > 0 && !months[pick].value) pick--; }
    const total = totalCost(months.map((m) => ({ cost: m.value })));
    const seg = (mode, label) =>
      el('button', { type: 'button', class: 'seg-btn' + (state.chartMode === mode ? ' active' : ''), 'aria-pressed': String(state.chartMode === mode), 'data-mode': mode,
        onclick: () => { state.chartMode = mode; state.chartPick = -1; drawChart(); } }, label);
    let chart;
    const card = periodCard({
      id: 'month-card',
      label: 'month',
      count: months.length,
      index: pick,
      render: (i) => monthDetail(months[i], months13[i], source),
      onChange: (i) => { state.chartPick = i; chart.select(i); },
    });
    chart = barChart(months, { height: 150, selected: pick, format: (v) => money(v).replace(/\.\d\d$/, ''), onSelect: (i) => { state.chartPick = i; chart.select(i); card.show(i); } });
    chartCard.replaceChildren(
      el('div', { class: 'card-head' },
        el('div', {}, el('h2', { class: 'card-title', id: 'chart-title' }, 'Spending'), el('p', { class: 'card-sub' }, `Last 12 months · ${money(total)}`)),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Chart shows' }, seg('all', 'All'), seg('bills', 'Bills'))
      ),
      chart,
      card
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
  const all = usageIntervals(everything);
  const intervals = all.slice(-12);
  const offset = all.length - intervals.length; // so the first shown period still has a "previous"
  const b = bills(everything);
  const latest = r[r.length - 1];
  if (!latest) return null;
  const recent = intervals.slice(-3);
  const avg = recent.length ? recent.reduce((s, i) => s + i.used, 0) / recent.reduce((s, i) => s + i.days, 0) : null;
  const year = new Date().getFullYear();
  const billsYear = totalCost(b.filter((x) => (x.date || '').startsWith(String(year))));
  const unit = latest.meterUnit || '';

  // Tap (or Enter/Space on) a bar to open the detail card; swipe or use the arrows to move.
  const slot = el('div', { class: 'period-slot' });
  const hint = el('p', { class: 'chart-hint', id: 'meter-hint' }, 'Tap a bar to see that period');
  let card = null;
  let chart = null;
  const pick = (i) => {
    chart.select(i);
    if (card) return card.show(i);
    card = periodCard({
      id: 'period',
      label: 'period',
      count: intervals.length,
      index: i,
      render: (k) => periodDetail(all[offset + k], all[offset + k - 1], everything),
      onChange: (k) => chart.select(k),
    });
    hint.remove();
    slot.replaceChildren(card);
  };
  if (intervals.length > 1) {
    chart = barChart(
      intervals.map((i) => ({ label: new Date(i.to.date).toLocaleDateString('en-GB', { month: 'short' }).slice(0, 1), title: `${niceDate(i.from.date)} to ${niceDate(i.to.date)}`, value: Math.round(i.perDay * 10) / 10 })),
      { height: 120, selected: -1, format: (v) => v.toFixed(1), describe: (bar, v) => `${bar.title}: ${v.toFixed(1)} ${unit} a day`, onSelect: pick }
    );
  }
  return el(
    'section',
    { class: 'card meter-card', id: 'meter-insights', 'aria-label': 'Meter summary' },
    el('div', { class: 'meter-stats' },
      el('div', {}, el('span', { class: 'stat-label' }, 'Latest'), el('span', { class: 'stat-value' }, Number(latest.meterValue).toLocaleString('en-GB')), el('span', { class: 'stat-title' }, `${unit} · ${niceDate(latest.date)}`)),
      el('div', {}, el('span', { class: 'stat-label' }, 'Daily use'), el('span', { class: 'stat-value' }, avg !== null ? avg.toFixed(1) : '–'), el('span', { class: 'stat-title' }, `${unit}/day, recent`)),
      el('div', {}, el('span', { class: 'stat-label' }, `Bills ${year}`), el('span', { class: 'stat-value' }, money(billsYear).replace(/\.\d\d$/, '')), el('span', { class: 'stat-title' }, `${b.filter((x) => (x.date || '').startsWith(String(year))).length} bills`))
    ),
    chart ? [el('p', { class: 'card-sub chart-caption' }, `Daily use between readings (${unit}/day)`), chart, hint, slot] : null
  );
}

// The bill that belongs to a period between two readings: the closing reading
// itself if it has a cost (that's how bills are usually logged), otherwise any
// meter entry with a cost dated inside the period.
function billFor(interval, everything) {
  if (!interval) return null;
  if (Number(interval.to.cost) > 0) return interval.to;
  return everything.find((e) => e.type === 'meter' && Number(e.cost) > 0 && e.date > interval.from.date && e.date <= interval.to.date) || null;
}

const fmtNum = (n, dp = 1) => Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

function changePill(delta, fmt, id) {
  if (delta === null || !isFinite(delta)) return el('span', { class: 'pill', id }, '–');
  if (Math.abs(delta) < 0.005) return el('span', { class: 'pill', id }, 'No change');
  const up = delta > 0;
  // More use / more spending shows in red, less in green.
  return el('span', { class: 'pill ' + (up ? 'up' : 'down'), id }, `${up ? '▲' : '▼'} ${fmt(Math.abs(delta))}`);
}

function stat(label, value, small, id) {
  return el('div', { class: 'period-stat', id }, el('span', { class: 'stat-label' }, label), el('span', { class: 'v' }, value, small ? el('small', {}, ` ${small}`) : null));
}

function periodDetail(interval, prev, everything) {
  const unit = interval.unit || 'kWh';
  const bill = billFor(interval, everything);
  const prevBill = billFor(prev, everything);
  const cost = bill ? Number(bill.cost) : null;
  const perUnit = cost !== null && interval.used > 0 ? cost / interval.used : null;
  const dUsed = prev ? interval.used - prev.used : null;
  const dCost = cost !== null && prevBill ? cost - Number(prevBill.cost) : null;
  const pct = prev && prev.used > 0 ? ` (${dUsed >= 0 ? '+' : '−'}${Math.round(Math.abs(dUsed / prev.used) * 100)}%)` : '';
  const photo = bill && bill.photos && bill.photos[0] ? bill.photos[0].blob : null;
  const body = el('div', { class: 'period-body' },
    el('div', { class: 'period-stats' },
      stat('Used', fmtNum(interval.used), unit, 'pd-used'),
      stat('Average', fmtNum(interval.perDay), `${unit}/day`, 'pd-perday'),
      cost !== null ? stat('Bill', money(cost), null, 'pd-cost') : el('div', { class: 'period-stat', id: 'pd-cost' }, el('span', { class: 'stat-label' }, 'Bill'), el('span', { class: 'v muted-v' }, 'None logged')),
      perUnit !== null ? stat('Cost per ' + unit, `${fmtNum(perUnit * 100, 1)}p`, null, 'pd-perunit') : el('div', { class: 'period-stat', id: 'pd-perunit' }, el('span', { class: 'stat-label' }, `Cost per ${unit}`), el('span', { class: 'v muted-v' }, '–'))
    ),
    el('div', { class: 'period-change', id: 'pd-change' },
      el('span', {}, 'vs previous:'),
      prev ? changePill(dUsed, (v) => `${fmtNum(v)} ${unit}${pct}`, 'pd-change-use') : el('span', { class: 'pill', id: 'pd-change-use' }, 'First period'),
      prev ? changePill(dCost, (v) => money(v), 'pd-change-cost') : null
    ),
    bill
      ? el('div', { class: 'period-bill', id: 'pd-bill' },
          photo ? el('img', { src: photoURL(photo), alt: 'Bill photo', id: 'pd-bill-thumb' }) : el('span', { class: 'pb-icon' }, icon('file', 20)),
          el('div', { class: 'pb-text' }, el('strong', {}, bill.title || 'Bill'), `${niceDate(bill.date)}${perUnit !== null ? ' · incl. standing charge' : ''}`),
          el('a', { class: 'btn small', href: `#/view/${bill.id}`, id: 'pd-open-bill' }, 'Open bill'))
      : el('div', { class: 'period-bill none', id: 'pd-bill' }, el('div', { class: 'pb-text' }, 'No bill logged for this period.'),
          el('a', { class: 'btn small ghost', href: '#/new/meter' }, 'Add bill'))
  );
  return { title: `${niceDate(interval.from.date)} – ${niceDate(interval.to.date)}`, sub: `${Math.round(interval.days)} days`, body };
}

function monthDetail(month, prevMonth, source) {
  const items = source.filter((e) => (e.date || '').startsWith(month.key) && Number(e.cost) > 0).sort((a, b) => Number(b.cost) - Number(a.cost));
  const delta = prevMonth ? month.value - prevMonth.value : null;
  const body = el('div', { class: 'period-body' },
    el('div', { class: 'period-stats' },
      stat('Spent', money(month.value), null, 'md-total'),
      stat('Entries', String(items.length), items.length === 1 ? 'with a cost' : 'with costs', 'md-count')
    ),
    el('div', { class: 'period-change', id: 'md-change' }, el('span', {}, `vs ${prevMonth ? prevMonth.title.split(' ')[0] : 'previous'}:`), changePill(delta, (v) => money(v), 'md-change-cost')),
    items.length
      ? el('ul', { class: 'period-items', id: 'md-items', 'aria-label': 'Biggest costs' },
          items.slice(0, 3).map((e) => el('li', {}, el('a', { href: `#/view/${e.id}` }, el('span', {}, e.title || 'Untitled'), el('span', {}, money(e.cost))))),
          items.length > 3 ? el('li', { class: 'chart-hint' }, `+ ${items.length - 3} more`) : null)
      : el('p', { class: 'chart-hint' }, 'Nothing spent this month.')
  );
  return { title: month.title, sub: `${money(month.value)} spent`, body };
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
    el('a', { class: 'scan-choice', href: '#/scan', id: 'scan-choice' },
      el('span', { class: 'scan-choice-icon' }, icon('scan', 26)),
      el('span', { class: 'scan-choice-text' },
        el('span', { class: 'choice-label' }, 'Scan receipt or bill'),
        el('span', { class: 'choice-blurb' }, 'Photo or PDF — fills in the details for you')),
      icon('chevron', 20)),
    el('p', { class: 'chooser-or' }, 'or add by hand'),
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
// SCAN: read a receipt or bill and pre-fill the form
// ---------------------------------------------------------------------
// Everything happens on the phone: PDFs are read with PDF.js (their text
// layer, or OCR if it's a scanned PDF) and photos with Tesseract OCR. Both
// libraries live in vendor/ and are only loaded when you open this screen,
// so the rest of the app stays quick. The service worker keeps a copy so
// scanning works offline too.
let pendingScan = null; // { type, fields, photos, parsed } handed to renderForm

function renderScan() {
  const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'scan-camera-input' });
  const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', hidden: true, id: 'scan-file-input' });
  const body = el('div', { class: 'scan-body', id: 'scan-body' });
  const offline = el('p', { class: 'scan-offline', id: 'scan-offline' });
  ocrReady().then((ready) => {
    offline.replaceChildren(icon(ready ? 'check' : 'download', 16), ready ? 'Works offline — nothing leaves this phone' : 'Nothing leaves this phone. The reader downloads once (about 8 MB) for offline use.');
  });

  function picker(error) {
    body.replaceChildren(
      ...[error ? el('div', { class: 'banner warn', id: 'scan-error', role: 'alert' }, icon('alert', 20), el('div', {}, el('strong', {}, 'Couldn’t read that'), el('p', {}, error))) : null,
      el('div', { class: 'scan-hero' },
        el('div', { class: 'scan-art', 'aria-hidden': 'true' }, el('span', { class: 'scan-doc' }, el('i'), el('i'), el('i'), el('i')), el('span', { class: 'scan-beam' })),
        el('h2', {}, 'Snap it, we’ll fill it in'),
        el('p', {}, 'Take a photo of a receipt, or choose a bill PDF or screenshot. You’ll check everything before it’s saved.')),
      el('div', { class: 'scan-actions' },
        el('button', { type: 'button', class: 'btn btn-lg', id: 'scan-camera', onclick: () => cameraInput.click() }, icon('camera', 20), 'Take photo'),
        el('button', { type: 'button', class: 'btn btn-lg secondary', id: 'scan-pick', onclick: () => fileInput.click() }, icon('file', 20), 'Choose photo or PDF')),
      offline].filter(Boolean)
    );
  }

  async function go(file) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const bar = el('span', { class: 'scan-bar-fill' });
    const status = el('p', { class: 'scan-status', id: 'scan-status', 'aria-live': 'polite' }, 'Getting ready…');
    const preview = el('div', { class: 'scan-preview' + (isPdf ? ' is-pdf' : '') }, el('span', { class: 'scan-beam' }));
    if (!isPdf) preview.prepend(el('img', { src: photoURL(file), alt: '' }));
    else preview.prepend(el('span', { class: 'scan-pdf-icon' }, icon('file', 40), el('span', {}, file.name || 'PDF')));
    body.replaceChildren(
      el('div', { class: 'scan-reading', id: 'scan-reading' },
        preview,
        el('h2', {}, 'Reading…'),
        el('div', { class: 'scan-bar', role: 'progressbar', 'aria-label': 'Reading progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', id: 'scan-progress' }, bar),
        status,
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { cancelled = true; picker(); } }, 'Cancel'))
    );
    let cancelled = false;
    const progress = (f, msg) => {
      const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
      bar.style.width = pct + '%';
      bar.parentElement.setAttribute('aria-valuenow', String(pct));
      if (msg) status.textContent = msg;
    };
    try {
      const [scan, parse] = await Promise.all([import('./scan.js'), import('./parse.js')]);
      const read = await scan.readFile(file, progress);
      if (cancelled) return;
      progress(1, 'Picking out the details…');
      const parsed = parse.parseDocument(read.text);
      // Keep a copy of the picture with the entry, like a normal photo.
      const source = isPdf ? await canvasToBlob(read.canvas) : file;
      const photos = [{ id: db.newId(), blob: await compressImage(source) }];
      scan.releaseOcr(); // free the OCR engine's memory
      if (cancelled) return;
      const type = parsed.kind === 'bill' ? 'meter' : 'receipt';
      pendingScan = { type, parsed, photos, source: read.source, fields: scanFields(parsed, type) };
      location.hash = `#/new/${type}`;
    } catch (err) {
      console.warn('scan failed', err);
      if (cancelled) return;
      const heic = /heic|heif/i.test(file.type + file.name);
      picker(heic ? 'iPhone HEIC photos can’t be read here. Take the photo with “Take photo”, or save it as JPEG first.' : 'That file couldn’t be opened. Try a clearer photo, or a PDF.');
    }
  }
  cameraInput.addEventListener('change', () => { go(cameraInput.files[0]); cameraInput.value = ''; });
  fileInput.addEventListener('change', () => { go(fileInput.files[0]); fileInput.value = ''; });

  picker();
  app.replaceChildren(
    el('div', { class: 'scan', id: 'scan' },
      screenHead('Scan receipt or bill', { back: { href: '#/new', label: 'Add' }, sub: 'Photo, screenshot or PDF' }),
      body, cameraInput, fileInput)
  );
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image'))), 'image/jpeg', 0.9));
}

// Turn what the parser found into form fields.
function scanFields(p, type) {
  const f = { title: p.title || '', date: p.date || todayISO(), cost: p.total != null ? Number(p.total).toFixed(2) : null, supplier: p.supplier || '', notes: p.notes || '' };
  if (type === 'meter') {
    f.meterValue = p.meter && p.meter.closing != null ? p.meter.closing : null;
    f.meterUnit = (p.meter && p.meter.unit) || 'kWh';
  }
  return f;
}

// The "check these details" banner at the top of a scanned form.
function scanHint(scan) {
  const p = scan.parsed;
  const want = [['supplier', 'supplier'], ['date', 'date'], ['total', 'total']];
  if (scan.type === 'meter') want.push(['reading', 'meter reading']);
  const missing = want.filter(([k]) => !p.found[k]).map(([, label]) => label);
  return el('div', { class: 'scan-hint', id: 'scan-hint', role: 'status' },
    icon('sparkle', 20),
    el('div', {},
      el('strong', {}, 'Check these details'),
      el('p', {}, `Filled in from your ${scan.source === 'pdf-text' ? 'PDF' : 'scan'} — tinted fields were read automatically. ` +
        (missing.length ? `Couldn’t find the ${listText(missing)}, so please add ${missing.length > 1 ? 'them' : 'it'}.` : 'Everything was found, but give it a quick look.'))));
}
const listText = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`);

// Has the service worker already stored the OCR files (so scanning works offline)?
async function ocrReady() {
  try {
    if (!('caches' in window)) return false;
    return Boolean(await caches.match('vendor/tesseract/eng.traineddata.gz'));
  } catch { return false; }
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
  // Coming from the scanner? Start from what it read (used once).
  const scan = !id && pendingScan && pendingScan.type === type ? pendingScan : null;
  pendingScan = null;
  if (scan) Object.assign(entry, scan.fields, { photos: scan.photos });
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
    scan ? scanHint(scan) : null,
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
    sync.recordSave(saved.id); // tell sync (does nothing if sync is off)
    toast('Saved');
    // replace() instead of a normal link, so pressing Back afterwards
    // doesn't take you back into the form.
    location.replace(`#/view/${saved.id}`);
  });

  if (scan) {
    // Tint the fields the scanner filled in, so it's clear what to check.
    for (const name of Object.keys(scan.fields)) {
      const input = form.elements[name];
      if (input && String(scan.fields[name] ?? '') !== '') input.classList.add('prefilled');
    }
  }
  app.replaceChildren(form);
  if (!id && !scan) form.elements.title.focus();
}

// ---------------------------------------------------------------------
// SYNC WITH GOOGLE DRIVE (settings card on the Backup screen)
// ---------------------------------------------------------------------
const SYNC_TEXT = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline — will sync when you’re back online',
  signin: 'Sign in again to keep syncing',
  error: 'Sync problem',
  nofolder: 'Choose a shared logbook',
};

let syncMsg = null; // { text, bad } shown once under the buttons

async function syncCard(cardHead) {
  const st = sync.getStatus();
  const card = el('section', { class: 'card sync-card', id: 'sync-card', 'data-state': st.state });
  const add = (...kids) => card.append(...kids.flat().filter(Boolean));
  const head = cardHead('backup', 'violet', 'Share with Google Drive');
  const rerender = async () => { if (card.isConnected) card.replaceWith(await syncCard(cardHead)); };
  const busyBtn = async (btn, label, fn) => {
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.textContent = label;
    try { await fn(); } catch (err) { syncMsg = { text: err.message || String(err), bad: true }; }
    btn.innerHTML = old;
    btn.disabled = false;
    rerender();
  };
  const help = el('ul', { class: 'sync-help' },
    el('li', {}, 'Keeps one logbook on two phones, e.g. yours and your partner’s.'),
    el('li', {}, 'Entries and photos are copied to a “Hearthbook” folder in your own Google Drive, which you share with them. No other company or server is involved.'),
    el('li', {}, 'Each phone keeps its own full copy, so the app still works with no signal. Changes are swapped when you open the app, a few seconds after you save, and when you tap Sync now.'),
    el('li', {}, 'If you both change the same entry before syncing, the most recent save wins.'),
    el('li', {}, 'The app can only open its own Hearthbook files, nothing else in your Drive.'));
  const msg = syncMsg ? el('p', { class: 'sync-msg' + (syncMsg.bad ? ' bad' : ''), id: 'sync-msg', role: 'status' }, syncMsg.text) : null;
  syncMsg = null;

  if (st.state === 'unconfigured') {
    add(head, el('p', {}, 'Off. Everything stays on this phone.'), help,
      el('p', { class: 'small muted', id: 'sync-unconfigured' }, 'Not set up in this copy of the app yet: it needs a free Google Cloud “client ID” first (HOW-IT-WORKS.md, section 9).'),
      el('button', { type: 'button', class: 'btn secondary', disabled: true }, 'Connect Google account'));
    return card;
  }
  if (st.state === 'off') {
    add(head, el('p', {}, 'Off. Everything stays on this phone.'), help,
      el('button', { type: 'button', class: 'btn', id: 'sync-connect', onclick: (ev) => busyBtn(ev.currentTarget, 'Opening Google…', async () => {
        await sync.connect();
        syncMsg = { text: sync.getStatus().state === 'nofolder' ? 'Signed in. Now start a shared logbook, or join one.' : 'Connected.' };
      }) }, 'Connect Google account'), msg);
    return card;
  }
  const who = st.account ? `${st.account.name ? st.account.name + ' · ' : ''}${st.account.email}` : '—';
  if (st.state === 'nofolder') {
    add(head,
      el('ul', { class: 'sync-facts' }, el('li', {}, el('span', {}, 'Signed in as'), el('span', { id: 'sync-account' }, who))),
      el('p', {}, 'Is this the first phone? Start a shared logbook. It creates a “Hearthbook” folder in your Drive and copies this phone’s entries into it. Then share the folder with your partner.'),
      el('p', {}, 'If someone has already shared a Hearthbook folder with you, tap Join. Google’s file picker opens: tick all 9 files whose names start with “hearthbook” and tap Select. You only do this once.'),
      el('div', { class: 'sync-actions' },
        el('button', { type: 'button', class: 'btn', id: 'sync-create', onclick: (ev) => busyBtn(ev.currentTarget, 'Creating…', async () => {
          await sync.createShared();
          syncMsg = { text: 'Shared logbook created. Now share it: type your partner’s Gmail address below.' };
        }) }, 'Start a new shared logbook'),
        el('button', { type: 'button', class: 'btn secondary', id: 'sync-join', onclick: (ev) => busyBtn(ev.currentTarget, 'Opening picker…', async () => {
          const r = await sync.joinShared();
          if (r.cancelled) return;
          if (r.missing) syncMsg = { text: `Some files weren’t selected: ${r.missing.join(', ')}. Tap Join again and tick all 9 files.`, bad: true };
          else syncMsg = { text: 'Joined. Both phones now share one logbook.' };
        }) }, 'Join a logbook shared with me'),
        el('button', { type: 'button', class: 'btn link-btn', id: 'sync-disconnect', onclick: async () => { await sync.disconnect(); rerender(); } }, 'Cancel and sign out')),
      msg);
    return card;
  }

  const stateText = st.state === 'error' ? st.message || SYNC_TEXT.error : SYNC_TEXT[st.state] || st.state;
  const inviteInput = el('input', { type: 'email', id: 'sync-invite-email', placeholder: 'partner@gmail.com', autocomplete: 'off', 'aria-label': 'Email address to share with' });
  add(head,
    el('div', { class: 'sync-status', 'data-state': st.state, id: 'sync-status', role: 'status', 'aria-live': 'polite' },
      el('span', { class: 'dot' }),
      el('div', {}, el('strong', {}, stateText), el('span', { id: 'sync-last' }, `Last synced: ${sync.ago(st.lastSync)}`))),
    el('ul', { class: 'sync-facts' },
      el('li', {}, el('span', {}, 'Signed in as'), el('span', { id: 'sync-account' }, who)),
      el('li', {}, el('span', {}, 'Shared folder'), el('span', { id: 'sync-folder' }, `${st.folderName || 'Hearthbook'}${st.owner ? ' (yours)' : ' (shared with you)'}`))),
    el('div', { class: 'sync-actions' },
      st.state === 'signin'
        ? el('button', { type: 'button', class: 'btn', id: 'sync-signin', onclick: (ev) => busyBtn(ev.currentTarget, 'Signing in…', () => sync.syncNow({ interactive: true })) }, 'Sign in to Google again')
        : el('button', { type: 'button', class: 'btn', id: 'sync-now', disabled: st.state === 'syncing', onclick: (ev) => busyBtn(ev.currentTarget, 'Syncing…', () => sync.syncNow({ interactive: true })) }, icon('backup', 20), 'Sync now'),
      msg,
      st.owner
        ? el('div', { class: 'field' }, el('span', { class: 'label' }, 'Share the folder with'),
            el('div', { class: 'sync-invite' }, inviteInput,
              el('button', { type: 'button', class: 'btn secondary', id: 'sync-invite', onclick: (ev) => busyBtn(ev.currentTarget, 'Sharing…', async () => {
                const email = inviteInput.value.trim();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please type a full email address.');
                await sync.invite(email);
                syncMsg = { text: `Shared with ${email}. Google emails them a link. On their phone, open ${APP_NAME} → Backup → Connect → Join.` };
              }) }, 'Share')),
            el('span', { class: 'hint' }, 'They get edit access to this one folder only. You can also share it from the Google Drive app.'))
        : null,
      el('button', { type: 'button', class: 'btn link-btn', id: 'sync-disconnect', onclick: async () => {
        if (!confirm('Stop syncing on this phone?\n\nYour entries stay on this phone, and the shared folder stays in Google Drive. You can connect again later.')) return;
        await sync.disconnect();
        rerender();
      } }, 'Disconnect this phone')),
    el('details', { class: 'sync-more' }, el('summary', {}, 'How sync works'), help));
  // Redraw this card when the sync status changes (while it's on screen).
  let off = null;
  setTimeout(() => {
    off = sync.onStatus((s) => {
      if (!card.isConnected) { if (off) off(); return; }
      if (s.state !== card.dataset.state || s.lastSync !== st.lastSync) { if (off) off(); rerender(); }
    });
  }, 0);
  return card;
}

// The little chip in the top bar: "On this phone", or the sync status.
function wireSyncChip() {
  const chip = document.getElementById('sync-chip');
  const text = document.getElementById('sync-chip-text');
  if (!chip || !text) return;
  sync.onStatus((s) => {
    const on = !['off', 'unconfigured'].includes(s.state);
    chip.dataset.state = s.state;
    const svg = chip.querySelector('svg');
    if (svg) svg.replaceWith(icon(on ? 'backup' : 'lock', 14));
    chip.dataset.syncs = String(s.count || 0); // how many syncs finished (handy for tests)
    text.textContent = !on ? 'On this phone'
      : s.state === 'idle' ? `Synced ${sync.ago(s.lastSync)}`
      : s.state === 'syncing' ? 'Syncing…'
      : s.state === 'offline' ? 'Offline'
      : s.state === 'signin' ? 'Sign in to sync'
      : s.state === 'nofolder' ? 'Finish sync setup'
      : 'Sync problem';
    chip.title = !on ? 'Your data stays on this phone' : 'Google Drive sync: tap to sync now';
    chip.setAttribute('aria-label', on ? `Sync status: ${text.textContent}. Tap to sync now.` : 'Data stays on this phone. Open settings.');
  });
  chip.addEventListener('click', () => {
    const s = sync.getStatus();
    if (['off', 'unconfigured', 'nofolder', 'error'].includes(s.state)) location.hash = '#/export';
    else sync.syncNow({ interactive: true });
  });
  // keep "Synced 3 min ago" fresh
  setInterval(() => { const s = sync.getStatus(); if (s.state === 'idle') text.textContent = `Synced ${sync.ago(s.lastSync)}`; }, 30000);
}

// When the other phone's changes arrive, redraw the screen, but never
// while you're in the middle of filling in a form.
addEventListener('hearthbook:synced', () => {
  if (!/^#\/(new|edit|scan)/.test(location.hash) && !document.querySelector('.period-card.dragging')) {
    const y = scrollY;
    render().then(() => scrollTo(0, y));
  }
});

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
            sync.recordDelete(e.id); // so the delete reaches the other phone too
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
      sync.noteChange();
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
    await syncCard(cardHead),
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
    el('p', { class: 'small muted footnote' }, `${APP_NAME} · ${sync.getStatus().state === 'off' || sync.getStatus().state === 'unconfigured' ? 'everything stays on this phone' : 'synced through your own Google Drive'}`)
  );
}

// ---------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------
window.addEventListener('hashchange', render);
render();
db.requestPersistentStorage();
wireSyncChip();
sync.init();

// Register the service worker (see sw.js) so the app works offline.
// "serviceWorker in navigator" checks the browser supports it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
  // A little while after start-up, ask the service worker to fetch the
  // scanner files in the background (skipped on "data saver").
  const warm = () => {
    if (navigator.connection && navigator.connection.saveData) return;
    navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage({ type: 'warm-ocr' }));
  };
  addEventListener('load', () => setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(warm, { timeout: 10000 }) : warm()), 4000));
}
