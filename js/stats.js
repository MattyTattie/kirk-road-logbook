// =====================================================================
// stats.js — the sums behind the dashboard (spend, next due, meters).
// =====================================================================
// Pure functions: they take the list of entries and return numbers, so
// they're easy to reason about and never touch the database.

import { daysUntil, totalCost } from './utils.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${LONG[m - 1]} ${y}`;
};

const hasNumber = (v) => v !== null && v !== undefined && v !== '' && isFinite(Number(v));

// Insurance premiums are a running cost, not a one-off purchase (and a
// policy's date is its start date, maybe years ago), so they're left out of
// the spending totals and shown as a yearly cost on the Insurance list.
export const isSpend = (e) => e.type !== 'insurance';

// Total spent in a calendar year (every entry with a cost, bills included).
export function spendInYear(entries, year) {
  return totalCost(entries.filter((e) => isSpend(e) && (e.date || '').startsWith(String(year))));
}

// Years that have any dated entries, plus this year, oldest first.
export function yearsWithData(entries, now = new Date()) {
  const ys = new Set([now.getFullYear()]);
  for (const e of entries) { const y = Number((e.date || '').slice(0, 4)); if (y > 1990 && y <= now.getFullYear()) ys.add(y); }
  return [...ys].sort();
}

// Spend per calendar month of one year, Jan → Dec.
export function yearSpend(entries, year) {
  const out = MONTHS.map((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: m.slice(0, 1), short: m, title: monthName(key), value: 0 };
  });
  for (const e of entries) {
    if (!isSpend(e) || !(e.date || '').startsWith(String(year))) continue;
    const m = out[Number(e.date.slice(5, 7)) - 1];
    if (m) m.value = Math.round((m.value + (Number(e.cost) || 0)) * 100) / 100;
  }
  return out;
}

// Energy used per calendar month of one year (kWh), Jan → Dec. Each period
// between two readings is spread evenly over its days, so a reading taken
// on the 3rd counts mostly towards the month before. "days" says how many
// days of that month are covered by readings (0 = no data).
export function monthlyUsage(entries, year) {
  const out = MONTHS.map((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: m.slice(0, 1), short: m, title: monthName(key), value: 0, days: 0, unit: '' };
  });
  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
  for (const iv of usageIntervals(entries)) {
    const a = Date.parse(iv.from.date), b = Date.parse(iv.to.date);
    if (b <= y0 || a >= y1) continue;
    for (let t = Math.max(a, y0); t < Math.min(b, y1); t += 86400000) {
      const m = out[new Date(t).getUTCMonth()];
      m.value += iv.perDay; m.days += 1; m.unit = iv.unit;
    }
  }
  for (const m of out) m.value = Math.round(m.value * 10) / 10;
  return out;
}

// Spend per month for the last `count` months, oldest first.
export function monthlySpend(entries, count = 12, now = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: MONTHS[d.getMonth()].slice(0, 1), short: MONTHS[d.getMonth()], title: monthName(key), value: 0 });
  }
  const byKey = Object.fromEntries(out.map((m) => [m.key, m]));
  for (const e of entries) {
    if (!isSpend(e)) continue;
    const m = byKey[(e.date || '').slice(0, 7)];
    if (m) m.value = Math.round((m.value + (Number(e.cost) || 0)) * 100) / 100;
  }
  return out;
}

// Things with a due/expiry date, soonest first. Past ones are left out.
export function upcoming(entries) {
  return entries
    .filter((e) => e.dueDate && daysUntil(e.dueDate) >= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
export function overdue(entries) {
  return entries.filter((e) => e.dueDate && daysUntil(e.dueDate) < 0);
}

// Meter entries that have a reading, oldest first.
export function readings(entries) {
  return entries
    .filter((e) => e.type === 'meter' && hasNumber(e.meterValue))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// Usage per day between consecutive readings of the same unit.
// A drop in the number (new meter / new supplier) starts a fresh series.
export function usageIntervals(entries) {
  const r = readings(entries);
  const out = [];
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    if ((a.meterUnit || '') !== (b.meterUnit || '')) continue;
    const days = (new Date(b.date) - new Date(a.date)) / 86400000;
    const used = Number(b.meterValue) - Number(a.meterValue);
    if (days <= 0 || used < 0) continue;
    out.push({ from: a, to: b, days, used, perDay: used / days, unit: b.meterUnit || '' });
  }
  return out;
}

// Energy bills = meter-reading entries with a cost, oldest first.
export function bills(entries) {
  return entries
    .filter((e) => e.type === 'meter' && Number(e.cost) > 0)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// ---------- one section in one calendar year (home tiles) ----------
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

// What a policy cost you in one calendar year, pro rata:
//  • monthly premium – one payment per month on the start day, from the
//    start date until the renewal date (no renewal date = still running)
//    and never later than today (future payments aren't paid yet);
//  • yearly premium – spread evenly over its 12 months of cover (the year
//    before the renewal date, or from the start date), and you get the share of
//    those days that fall in that year, up to today.
// So for this year it's "so far"; past years are complete.
// Returns 0 when the policy has no cost or wasn't running that year.
export function insurancePaidInYear(e, year, now = new Date()) {
  const cost = Number(e && e.cost) || 0;
  const start = (e && e.date) || '';
  if (!cost || !/^\d{4}-\d\d-\d\d/.test(start)) return 0;
  const today = isoDay(now);
  if (e.costFreq === 'monthly') {
    const end = e.dueDate && /^\d{4}-\d\d-\d\d/.test(e.dueDate) ? e.dueDate : null;
    const sy = Number(start.slice(0, 4)), sm = Number(start.slice(5, 7)), sd = Number(start.slice(8, 10));
    let n = 0;
    for (let m = 0; m < 12; m++) {
      const months = (year - sy) * 12 + m - (sm - 1);
      if (months < 0) continue;
      const last = new Date(year, m + 1, 0).getDate(); // e.g. 31st → 30 Jun
      const pay = `${year}-${String(m + 1).padStart(2, '0')}-${String(Math.min(sd, last)).padStart(2, '0')}`;
      if (pay < start || pay > today || (end && pay >= end)) continue;
      n++;
    }
    return Math.round(n * cost * 100) / 100;
  }
  // A yearly premium buys the 12 months up to the renewal date (or the 12
  // months from the start date if there's no renewal date).
  let s = dayNum(start), endDay;
  if (e.dueDate && /^\d{4}-\d\d-\d\d/.test(e.dueDate) && dayNum(e.dueDate) > s) {
    endDay = dayNum(e.dueDate);
    s = Math.max(s, dayNum(`${Number(e.dueDate.slice(0, 4)) - 1}${e.dueDate.slice(4, 10)}`));
  } else endDay = dayNum(`${Number(start.slice(0, 4)) + 1}${start.slice(4, 10)}`);
  const from = Math.max(s, dayNum(`${year}-01-01`)), to = Math.min(endDay, dayNum(`${year + 1}-01-01`), dayNum(today) + 1);
  if (to <= from) return 0;
  return Math.round((cost * (to - from)) / (endDay - s) * 100) / 100;
}

// Count and £ for one section in one year. Insurance counts the policies
// that cost something (or were running) that year; everything else counts
// entries dated in that year.
export function sectionYear(entries, sectionId, year, now = new Date()) {
  const items = entries.filter((e) => e.type === sectionId);
  if (sectionId === 'insurance') {
    let total = 0, count = 0;
    for (const e of items) {
      const v = insurancePaidInYear(e, year, now);
      const running = (e.date || '9999') <= `${year}-12-31` && (!e.dueDate || e.dueDate >= `${year}-01-01`);
      if (v > 0 || (running && !Number(e.cost))) count++;
      total += v;
    }
    return { count, total: Math.round(total * 100) / 100 };
  }
  const inYear = items.filter((e) => (e.date || '').startsWith(String(year)));
  return { count: inYear.length, total: totalCost(inYear) };
}
