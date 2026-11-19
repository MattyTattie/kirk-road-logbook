// =====================================================================
// report.js — builds the printable report (used by report.html).
// =====================================================================
// It loads every entry, groups them by section, adds up the costs, and
// draws a simple document. Photos are shown as small thumbnails.

import { SECTIONS, getSection, soonDaysFor, insuranceTypeLabel, annualCost, insKindOf } from './sections.js';
import { APP_NAME, ADDRESS } from './config.js';
import { getAllEntries } from './db.js';
import { el, fill, money, totalCost, niceDate, daysUntil, dueText, newestFirst, todayISO } from './utils.js';
import { policyStatus, activeDue } from './duestate.js';
import { isReminder, repeatText } from './reminderlogic.js';
import { shownTitle } from './formhelp.js';
import * as M from './mortgage.js';

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
      el('div', { class: 'meta' }, `Report produced ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${(() => { const rc = entries.filter((x) => isReminder(x)).length, n = entries.length - rc; return `${n} entr${n === 1 ? 'y' : 'ies'}${rc ? ` + ${rc} reminder${rc === 1 ? '' : 's'}` : ''}`; })()}`)
    ),
  ];

  // Known sections first (in the order of sections.js), then any unknown
  // types that might have come in from an old backup.
  const types = [...SECTIONS.map((s) => s.id), ...new Set(entries.map((e) => e.type).filter((t) => !SECTIONS.some((s) => s.id === t)))];

  // v16.0: the report matches the app. Only current policies count in the
  // insurance total (renewed and ended ones are listed apart, not in red);
  // reminders have their own heading (the Jobs list leaves them out); the
  // mortgage heading shows the balance, not "£0.00"; only the latest
  // mortgage entry carries the deal end; bill titles drop an old "– £amount".
  const today = todayISO();
  const stillDue = new Set(activeDue(entries).map((e) => e.id));
  const currentPolicies = entries.filter((e) => e.type === 'insurance' && ['current', 'lapsed'].includes(policyStatus(e, entries, today)));
  const yearly = (list) => money(totalCost(list.map((e) => ({ cost: annualCost(e) }))));
  for (const type of types) {
    const section = getSection(type);
    let items = entries.filter((e) => e.type === type && !isReminder(e));
    if (type === 'insurance') {
      const past = items.filter((e) => !currentPolicies.includes(e));
      items = items.filter((e) => currentPolicies.includes(e)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      if (!items.length && !past.length) continue;
      parts.push(el('h2', { id: 'report-insurance' }, el('span', {}, `${section.icon} ${section.label}`), el('span', {}, `${yearly(items)} a year`)));
      if (items.length) parts.push(el('p', { class: 'subhead' }, `${items.length} current polic${items.length === 1 ? 'y' : 'ies'}`));
      for (const e of items) parts.push(itemRow(e, section, { due: true }));
      if (past.length) {
        parts.push(el('h3', { class: 'subhead', id: 'report-past-policies' }, `Past policies (${past.length}, renewed or ended · not in the total)`));
        for (const e of past) parts.push(itemRow(e, section, { past: true }));
      }
      continue;
    }
    if (!items.length) continue;
    let sum = money(totalCost(items));
    if (section.kind === 'mortgage') { const ms = M.summary(entries); sum = ms ? `Balance ${money(ms.balance)}` : ''; }
    parts.push(el('h2', { id: `report-${type}` }, el('span', {}, `${section.icon} ${section.label}`), el('span', {}, sum)));
    if (section.kind === 'mortgage') { const ms = M.summary(entries); if (ms) parts.push(el('p', { class: 'subhead' }, `at ${niceDate(ms.asAt)} (${ms.source || 'set-up'})`)); }
    for (const e of items) parts.push(itemRow(e, section, { due: stillDue.has(e.id) || section.kind !== 'mortgage' }));
    if (type === 'job') {
      const rems = entries.filter((e) => isReminder(e)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      if (rems.length) {
        parts.push(el('h2', { id: 'report-reminders' }, el('span', {}, '\u{1F514} Reminders'), el('span', {}, `${rems.length}`)));
        for (const e of rems) parts.push(itemRow(e, { ...section, dueWord: 'due' }, { due: true, reminder: true }));
      }
    }
  }

  if (!entries.length) parts.push(el('p', { class: 'empty' }, 'No entries yet.'));
  else {
    // Insurance premiums are a yearly running cost, shown under their own heading.
    parts.push(el('div', { class: 'grand', id: 'grand-total' }, `Total of all costs: ${money(totalCost(entries.filter((e) => e.type !== 'insurance')))} (excl. insurance; electricity bills as charged, by date paid)`,
      currentPolicies.length ? ` · insurance ${yearly(currentPolicies)} a year (current policies)` : ''));
  }

  fill(root, ...parts);

  // Wait until every thumbnail has loaded, then mark the page "ready" —
  // otherwise printing straight away could miss some pictures.
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  document.body.dataset.ready = 'yes';
}

function itemRow(e, section, { due = true, past = false, reminder = false } = {}) {
  const days = daysUntil(e.dueDate);
  const cls = past || days === null ? '' : days < 0 ? 'expired' : days <= soonDaysFor(e) ? 'soon' : '';
  const ins = section.kind === 'insurance';
  const line = ins
    ? [insKindOf(e) ? `${insuranceTypeLabel(insKindOf(e))} insurance` : '', e.supplier, e.policyNumber ? `policy ${e.policyNumber}` : '', e.covered ? `covers ${e.covered}` : '', e.date ? `since ${niceDate(e.date)}` : ''].filter(Boolean).join(' · ')
    : [e.type === 'meter' && Number(e.cost) > 0 ? `paid ${niceDate(e.date)}` : niceDate(e.date), e.supplier].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: 'item' },
    el(
      'div',
      { class: 'main' },
      el('div', { class: 'title' }, shownTitle(e)),
      reminder ? el('div', { class: 'line' }, `Reminder · ${repeatText(e.reminder)}`) : null,
      line ? el('div', { class: 'line' }, line) : null,
      e.meterValue !== null && e.meterValue !== undefined ? el('div', { class: 'line' }, `Reading: ${isFinite(Number(e.meterValue)) && e.meterValue !== '' ? Number(e.meterValue).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : e.meterValue} ${e.meterUnit || ''}`) : null,
      e.dueDate && past ? el('div', { class: 'line' }, `Ran to ${niceDate(e.dueDate)}`)
        : e.dueDate && due ? el('div', { class: 'line ' + cls }, `${section.dueWord === 'expires' ? 'Expires' : section.dueWord === 'renews' ? 'Renews' : section.dueWord === 'deal ends' ? 'Deal ends' : 'Next due'} ${niceDate(e.dueDate)} (${dueText(section.dueWord || 'due', days)})`) : null,
      e.notes ? el('div', { class: 'notes' }, e.notes) : null,
      e.photos && e.photos.length
        ? el('div', { class: 'thumbs' }, e.photos.map((p) => el('img', { src: URL.createObjectURL(p.blob), alt: 'Photo' })))
        : null
    ),
    e.cost ? el('div', { class: 'cost' }, money(e.cost, e.currency) + (ins ? (e.costFreq === 'monthly' ? '/month' : '/year') : '')) : null
  );
}

document.getElementById('print-btn').addEventListener('click', () => window.print());
build().catch((err) => {
  document.getElementById('report').textContent = 'Could not build report: ' + err.message;
});
