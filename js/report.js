// =====================================================================
// report.js — builds the printable report (used by report.html).
// =====================================================================
// It loads every entry, groups them by section, adds up the costs, and
// draws a simple document. Photos are shown as small thumbnails.

import { SECTIONS, getSection, SOON_DAYS } from './sections.js';
import { APP_NAME, ADDRESS } from './config.js';
import { getAllEntries } from './db.js';
import { el, money, totalCost, niceDate, daysUntil, dueText, newestFirst } from './utils.js';

async function build() {
  const entries = (await getAllEntries()).sort(newestFirst);
  const root = document.getElementById('report');
  document.title = `${APP_NAME} – Report`;

  const parts = [
    el(
      'header',
      { class: 'report-head' },
      el('div', { class: 'brandline' }, el('img', { src: 'icons/icon.svg', alt: '', width: '28', height: '28' }), el('span', {}, APP_NAME)),
      el('h1', {}, 'Home logbook report'),
      el('div', { class: 'address' }, ADDRESS),
      el('div', { class: 'meta' }, `Report produced ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${entries.length} entries`)
    ),
  ];

  // Known sections first (in the order of sections.js), then any unknown
  // types that might have come in from an old backup.
  const types = [...SECTIONS.map((s) => s.id), ...new Set(entries.map((e) => e.type).filter((t) => !SECTIONS.some((s) => s.id === t)))];

  for (const type of types) {
    const section = getSection(type);
    const items = entries.filter((e) => e.type === type);
    if (!items.length) continue;
    parts.push(el('h2', {}, el('span', {}, `${section.icon} ${section.label}`), el('span', {}, money(totalCost(items)))));
    for (const e of items) parts.push(itemRow(e, section));
  }

  if (!entries.length) parts.push(el('p', { class: 'empty' }, 'No entries yet.'));
  else parts.push(el('div', { class: 'grand', id: 'grand-total' }, `Total of all costs: ${money(totalCost(entries))}`));

  root.replaceChildren(...parts);

  // Wait until every thumbnail has loaded, then mark the page "ready" —
  // otherwise printing straight away could miss some pictures.
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  document.body.dataset.ready = 'yes';
}

function itemRow(e, section) {
  const days = daysUntil(e.dueDate);
  const cls = days === null ? '' : days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : '';
  const line = [niceDate(e.date), e.supplier].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: 'item' },
    el(
      'div',
      { class: 'main' },
      el('div', { class: 'title' }, e.title),
      line ? el('div', { class: 'line' }, line) : null,
      e.meterValue !== null && e.meterValue !== undefined ? el('div', { class: 'line' }, `Reading: ${e.meterValue} ${e.meterUnit || ''}`) : null,
      e.dueDate ? el('div', { class: 'line ' + cls }, `${section.dueWord === 'expires' ? 'Expires' : 'Next due'} ${niceDate(e.dueDate)} (${dueText(section.dueWord || 'due', days)})`) : null,
      e.notes ? el('div', { class: 'notes' }, e.notes) : null,
      e.photos && e.photos.length
        ? el('div', { class: 'thumbs' }, e.photos.map((p) => el('img', { src: URL.createObjectURL(p.blob), alt: 'Photo' })))
        : null
    ),
    e.cost ? el('div', { class: 'cost' }, money(e.cost)) : null
  );
}

document.getElementById('print-btn').addEventListener('click', () => window.print());
build().catch((err) => {
  document.getElementById('report').textContent = 'Could not build report: ' + err.message;
});
