// =====================================================================
// report.js — builds the printable report (used by report.html).
// =====================================================================
// It loads every entry, groups them by section, adds up the costs, and
// draws a simple document. Photos are shown as small thumbnails.

import { SECTIONS, getSection, soonDaysFor, insuranceTypeLabel, insuranceKindText, annualCost, insKindOf } from './sections.js';
import { APP_NAME, ADDRESS } from './config.js';
import { getAllEntries } from './db.js';
import { el, fill, money, totalCost, niceDate, daysUntil, dueText, newestFirst, todayISO } from './utils.js';
import { policyStatus, activeDue } from './duestate.js';
import { isReminder, repeatText } from './reminderlogic.js';
import { shownTitle } from './formhelp.js';
import * as M from './mortgage.js';
import { usageIntervals, runningCost } from './stats.js';

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
  // v16.1: each bill's kWh (from the readings) and what that came to per kWh
  const ivByBill = new Map(usageIntervals(entries).map((iv) => [iv.to.id, iv]));
  const ms = M.summary(entries);
  const est = ms ? M.balanceToday(ms, today) : null;

  // v16.1: about what the house costs each month right now (as Year in review)
  const dealLive = ms && (!ms.deal.end || ms.deal.end >= today);
  const rc = runningCost(entries, { mortgage: ms ? { payment: dealLive || !ms.svrPayment ? ms.deal.payment : ms.svrPayment, extra: M.extraOn(ms.changes || [], today, ms.extra || 0) } : null, policies: currentPolicies });
  if (rc.total !== null) {
    parts.push(el('h2', { id: 'report-running' }, el('span', {}, '\u{1F3E0} Running the house'), el('span', {}, `${money(rc.total)} a month`)));
    parts.push(el('p', { class: 'subhead', id: 'report-running-lines' }, [rc.mortgage !== null ? `mortgage ${money(rc.mortgage)}${rc.overpay ? ` (incl. ${money(rc.overpay)} overpayment)` : ''}` : '', rc.insurance !== null ? `insurance ${money(rc.insurance)} (${currentPolicies.length} current polic${currentPolicies.length === 1 ? 'y' : 'ies'})` : '', rc.electricity !== null ? `electricity ${money(rc.electricity)} (average bill, last ${rc.electricityMonths} month${rc.electricityMonths === 1 ? '' : 's'}, as charged)` : ''].filter(Boolean).join(' · ') + '. Right now, not a year’s total.'));
  }
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
    // v16.1: the mortgage headline is today's estimate (as on Home and the
    // Mortgage page), with the statement's figure under it.
    if (section.kind === 'mortgage') sum = ms ? (est && est.estimate ? `About ${money(Math.round(est.balance))} today (estimate)` : `Balance ${money(ms.balance)}`) : '';
    parts.push(el('h2', { id: `report-${type}` }, el('span', {}, `${section.icon} ${section.label}`), el('span', {}, sum)));
    if (section.kind === 'mortgage' && ms) parts.push(el('p', { class: 'subhead', id: 'report-mortgage-asat' }, est && est.estimate ? `${money(ms.balance)} at ${niceDate(ms.asAt)} (${ms.source || 'set-up'}), less ${est.payments} payment${est.payments === 1 ? '' : 's'} since` : `at ${niceDate(ms.asAt)} (${ms.source || 'set-up'})`));
    for (const e of items) parts.push(itemRow(e, section, { due: stillDue.has(e.id) || section.kind !== 'mortgage', iv: ivByBill.get(e.id) }));
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

const kwhText = (v) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
function itemRow(e, section, { due = true, past = false, reminder = false, iv = null } = {}) {
  const days = daysUntil(e.dueDate);
  const cls = past || days === null ? '' : days < 0 ? 'expired' : days <= soonDaysFor(e) ? 'soon' : '';
  const ins = section.kind === 'insurance';
  const line = ins
    ? [insuranceKindText(e), e.supplier, e.policyNumber ? `policy ${e.policyNumber}` : '', e.covered ? `covers ${e.covered}` : '', e.date ? `since ${niceDate(e.date)}` : ''].filter(Boolean).join(' · ')
    : [e.type === 'meter' && Number(e.cost) > 0 ? `paid ${niceDate(e.date)}` : niceDate(e.date), e.supplier].filter(Boolean).join(' · ');
  // v16.1: the bill's kWh and £ per kWh, and who paid
  const used = iv && Number(iv.used) > 0 ? Number(iv.used) : null;
  const usedLine = e.type === 'meter' && used ? `Used ${kwhText(used)} ${iv.unit || e.meterUnit || 'kWh'}${Number(e.cost) > 0 ? ` · about ${(Number(e.cost) / used * 100).toFixed(1)}p per ${iv.unit || 'kWh'} all-in (bill ÷ kWh)` : ''}` : null;
  return el(
    'div',
    { class: 'item' },
    el(
      'div',
      { class: 'main' },
      el('div', { class: 'title' }, shownTitle(e)),
      reminder ? el('div', { class: 'line' }, `Reminder · ${repeatText(e.reminder)}`) : null,
      line ? el('div', { class: 'line' }, line) : null,
      e.meterValue !== null && e.meterValue !== undefined ? el('div', { class: 'line' }, `Reading: ${isFinite(Number(e.meterValue)) && e.meterValue !== '' ? Number(e.meterValue).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : e.meterValue} ${e.meterUnit || ''}`) : null,
      usedLine ? el('div', { class: 'line report-used' }, usedLine) : null,
      String(e.paidBy || '').trim() ? el('div', { class: 'line report-paidby' }, `Paid by ${String(e.paidBy).trim()}`) : null,
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
