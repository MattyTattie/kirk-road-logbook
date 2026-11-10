// =====================================================================
// formhelp.js (v15.20) — small pure helpers for the streamlined screens:
// the automatic bill title, warranty quick lengths, which "More details"
// folds start open, and this year's bills vs earlier years. No DOM here,
// so the unit tests can run them in node.
// =====================================================================
import { addYears } from './autosort.js';

const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The month a bill is for, from its date. A bill is dated on its closing
// reading, so "3 Oct 2025" is the September bill: go back about half a
// month. Returns "Sep 2025", or '' without a date.
export function billMonthFromDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1, d) - 15 * 86400000);
  return `${MON_SHORT[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

// "EDF bill Sep 2025", the same as a scanned bill's title. v15.22: no
// "– £101.16" on the end any more: the amount is on the right of every
// card and big on the bill's own page (it showed two or three times).
// `cost` is still accepted (older callers) but not used.
export function billTitle({ supplier = '', date = '' } = {}) {
  const month = billMonthFromDate(date);
  return `${String(supplier || '').trim() || 'Electricity'} bill${month ? ' ' + month : ''}`;
}

// v15.22: older bills were saved as "EDF bill Sep 2025 – £101.16". Shown
// without the amount (the record isn't changed). Only an amount right at the
// end, after a dash, on an electricity bill.
export function shownTitle(e) {
  const t = String((e && e.title) || '');
  if (!e || e.type !== 'meter') return t;
  const cut = t.replace(/\s+[–-]\s+£[\d,]+\.\d\d$/, '');
  return cut.trim() ? cut : t;
}

// Does this title look like one Hearth made (so it's fine to update it as
// the supplier, date or amount change)? Typed titles are left alone.
export function isAutoBillTitle(title) {
  return !title || /^.{0,60} bill( [A-Z][a-z]{2} \d{4})?( – £[\d,]+\.\d\d)?$/.test(String(title).trim());
}

// Warranty quick lengths: the end date n years after the purchase date.
export const WARRANTY_YEARS = [1, 2, 3, 5];
export function warrantyEnd(purchaseISO, years) { return addYears(purchaseISO, years); }
// Which quick length (if any) matches the end date already set.
export function warrantyYearsOf(purchaseISO, endISO) {
  return WARRANTY_YEARS.find((n) => endISO && warrantyEnd(purchaseISO, n) === endISO) || 0;
}

// "More details" on the add/edit forms starts open when any field inside it
// already has something in it (pounds is the default, so GBP doesn't count).
export function moreDetailsOpen(entry = {}, { dueInside = false } = {}) {
  return Boolean((entry.currency && entry.currency !== 'GBP') || entry.room || String(entry.notes || '').trim() || (dueInside && entry.dueDate));
}

// Electricity tab: this year's bills shown, earlier years folded, newest
// first. bills = entries with a date. Returns { current: [...], earlier: [{ year, items }] }.
// v15.22: yearOf(e) says which year a bill counts in (the month it covers,
// from stats.js); without it, the year of its date.
export function splitByYear(bills, year, yearOf = null) {
  const current = [];
  const map = new Map();
  for (const b of bills) {
    const y = yearOf ? Number(yearOf(b)) || 0 : Number(String(b.date || '').slice(0, 4));
    if (y === year || !y) current.push(b);
    else { if (!map.has(y)) map.set(y, []); map.get(y).push(b); }
  }
  const earlier = [...map.entries()].sort((a, b) => b[0] - a[0]).map(([y, items]) => ({ year: y, items }));
  return { current, earlier };
}
