// =====================================================================
// stats.js — the sums behind the dashboard (spend, next due, meters).
// =====================================================================
// Pure functions: they take the list of entries and return numbers, so
// they're easy to reason about and never touch the database.

import { daysUntil, totalCost } from './utils.js';
import { withoutSuperseded } from './mortgage.js';

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
export const isSpend = (e) => e.type !== 'insurance' && e.type !== 'mortgage'; // v14.7: a mortgage isn't spending

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

// v14.1: the month a period between two readings mostly covers = the month
// of its middle day. 3 Sep → 3 Oct is "Sep" (middle day 18 Sep).
export function midMonthKey(fromIso, toIso) {
  const a = dayNum(fromIso), b = dayNum(toIso);
  const d = new Date(Math.floor((a + b) / 2) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// The month an energy bill is "for": the middle of the period that ends at
// its reading; with no earlier reading, a bill dated on the 1st–5th is for
// the month before (EDF bills on the 3rd). Other entries: their own month.
export function coverMonths(entries) {
  const map = new Map();
  for (const iv of usageIntervals(entries)) if (iv.to.id) map.set(iv.to.id, midMonthKey(iv.from.date, iv.to.date));
  for (const e of entries) {
    if (e.type !== 'meter' || !e.date || map.has(e.id) || !(Number(e.cost) > 0)) continue;
    const d = new Date(e.date.slice(0, 10) + 'T12:00:00Z');
    if (d.getUTCDate() <= 5) d.setUTCMonth(d.getUTCMonth() - 1, 1);
    map.set(e.id, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return map;
}
// "YYYY-MM" an entry's cost counts under on the charts (cover = coverMonths()).
export const spendMonthKey = (e, cover) => (cover && cover.get(e.id)) || (e.date || '').slice(0, 7);

// Spend per calendar month of one year, Jan → Dec.
// v14.1: pass { cover: coverMonths(entries) } to put energy bills under the
// month they cover (charts); without it, every cost counts on its own date.
export function yearSpend(entries, year, { cover = null } = {}) {
  const out = MONTHS.map((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: m.slice(0, 1), short: m, title: monthName(key), value: 0 };
  });
  for (const e of entries) {
    const k = spendMonthKey(e, cover);
    if (!isSpend(e) || !k.startsWith(String(year))) continue;
    const m = out[Number(k.slice(5, 7)) - 1];
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
export function monthlySpend(entries, count = 12, now = new Date(), { cover = null } = {}) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: MONTHS[d.getMonth()].slice(0, 1), short: MONTHS[d.getMonth()], title: monthName(key), value: 0 });
  }
  const byKey = Object.fromEntries(out.map((m) => [m.key, m]));
  for (const e of entries) {
    if (!isSpend(e)) continue;
    const m = byKey[spendMonthKey(e, cover)];
    if (m) m.value = Math.round((m.value + (Number(e.cost) || 0)) * 100) / 100;
  }
  return out;
}

// Things with a due/expiry date, soonest first. Past ones are left out.
// v14.7: an older mortgage statement's deal end doesn't count (the latest does).
export function upcoming(entries) {
  return withoutSuperseded(entries)
    .filter((e) => e.dueDate && daysUntil(e.dueDate) >= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
export function overdue(entries) {
  return withoutSuperseded(entries).filter((e) => e.dueDate && daysUntil(e.dueDate) < 0);
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

// ---------- v14.4: the Electricity summary box, per tab ----------
// year = 0 → "Last 12 months" = the same last 12 periods between readings as
// the bars; a calendar year → the same per-day spread as the monthly bars
// (monthlyUsage), so the totals match the chart. Bills count under the month
// they cover (coverMonths), like the charts.
//  { used, days, perDay, from, to, firstCovered, lastCovered, missingDays,
//    partialStart, soFar, billsTotal, billsCount, latest, lastPeriod,
//    reading: { value, date, kind: 'latest' | 'year-end' | 'so-far' | 'last-in-year', est: [fromIso, toIso] } }
const isoOf = (dn) => new Date(dn * 86400000).toISOString().slice(0, 10);
export function meterSummary(entries, year = 0, now = new Date()) {
  const r = readings(entries);
  const latest = r[r.length - 1] || null;
  if (!latest) return null;
  const all = usageIntervals(entries);
  const lp = all[all.length - 1] || null;
  const cover = coverMonths(entries);
  const out = {
    year, unit: latest.meterUnit || '',
    latest: { value: Number(latest.meterValue), date: latest.date },
    lastPeriod: lp ? { perDay: lp.perDay, from: lp.from.date, to: lp.to.date } : null,
  };
  const billList = bills(entries);
  if (!year) {
    const iv = all.slice(-12);
    const used = iv.reduce((t, x) => t + x.used, 0), days = iv.reduce((t, x) => t + x.days, 0);
    const keys = new Set(iv.map((x) => midMonthKey(x.from.date, x.to.date)));
    const bl = billList.filter((b) => keys.has(spendMonthKey(b, cover)));
    return { ...out, used, days, perDay: days ? used / days : null, from: iv.length ? iv[0].from.date : null, to: iv.length ? iv[iv.length - 1].to.date : null,
      billsTotal: totalCost(bl), billsCount: bl.length, ...billCredits(bl), reading: { value: out.latest.value, date: latest.date, kind: 'latest' } };
  }
  const months = monthlyUsage(entries, year);
  const used = Math.round(months.reduce((t, m) => t + m.value, 0) * 10) / 10;
  const days = months.reduce((t, m) => t + m.days, 0);
  const y0 = dayNum(`${year}-01-01`), y1 = dayNum(`${year + 1}-01-01`);
  let first = null, last = null;
  for (const x of all) {
    const a = Math.max(dayNum(x.from.date), y0), b = Math.min(dayNum(x.to.date), y1);
    if (b <= a) continue;
    if (first === null || a < first) first = a;
    if (last === null || b > last) last = b;
  }
  const bl = billList.filter((b) => spendMonthKey(b, cover).startsWith(String(year)));
  // The reading at the end of the year (midnight going into 1 Jan), worked out
  // on the same even spread as the bars; this year → the latest reading so far.
  let reading = null;
  const exact = r.find((x) => x.date && x.date.slice(0, 10) === `${year + 1}-01-01`);
  const span = all.find((x) => dayNum(x.from.date) < y1 && dayNum(x.to.date) > y1);
  if (exact) reading = { value: Number(exact.meterValue), date: `${year}-12-31`, kind: 'year-end' };
  else if (span) reading = { value: Number(span.from.meterValue) + span.perDay * (y1 - dayNum(span.from.date)), date: `${year}-12-31`, kind: 'year-end', est: [span.from.date, span.to.date] };
  else {
    const inYear = r.filter((x) => (x.date || '').startsWith(String(year)));
    const lr = inYear[inYear.length - 1];
    if (lr) reading = { value: Number(lr.meterValue), date: lr.date, kind: year === now.getFullYear() && lr === latest ? 'so-far' : 'last-in-year' };
  }
  return { ...out, used, days, perDay: days ? used / days : null,
    firstCovered: first === null ? null : isoOf(first), lastCovered: last === null ? null : isoOf(last - 1),
    partialStart: first !== null && first > y0,
    soFar: year === now.getFullYear(),
    missingDays: first === null ? 0 : (last - first) - days,
    billsTotal: totalCost(bl), billsCount: bl.length, ...billCredits(bl), reading };
}

// ---------- v14.5: EDF credits printed on a bill ----------
// A bill (meter entry) may carry  credits: [{ type: 'sunday'|'weekend'|'other',
// amount, date, note }]  — optional, so older entries/backups just have none.
// Each credit belongs to the bill it is printed on. "After credits" = cost −
// credits (never below £0). Nothing is estimated from free hours.
export const CREDIT_TYPES = [
  { id: 'sunday', label: 'Sunday Saver' },
  { id: 'weekend', label: 'Weekend Saver' },
  { id: 'other', label: 'Other' },
];
export const creditLabel = (type) => (CREDIT_TYPES.find((t) => t.id === type) || CREDIT_TYPES[2]).label;
const pence = (v) => Math.round(Number(v) * 100);
export function creditsOf(e) {
  if (!e || !Array.isArray(e.credits)) return [];
  return e.credits
    .filter((c) => c && isFinite(Number(c.amount)) && Number(c.amount) > 0)
    .map((c) => ({ type: CREDIT_TYPES.some((t) => t.id === c.type) ? c.type : 'other', amount: pence(c.amount) / 100, date: typeof c.date === 'string' ? c.date : '', note: typeof c.note === 'string' ? c.note : '' }));
}
export const creditTotal = (e) => creditsOf(e).reduce((t, c) => t + pence(c.amount), 0) / 100;
export function netCost(e) {
  const cost = Number(e && e.cost) || 0;
  return Math.max(0, pence(cost) - pence(creditTotal(e))) / 100;
}
// The same entries with cost replaced by the amount after credits (for charts).
export const afterCredits = (entries) => entries.map((e) => (e.type === 'meter' && creditsOf(e).length ? { ...e, cost: netCost(e) } : e));
// Totals for a list of bills: { billsNet, credits: { total, sunday, weekend, other } }
export function billCredits(list) {
  const credits = { total: 0, sunday: 0, weekend: 0, other: 0 };
  let net = 0;
  for (const b of list) {
    net += pence(netCost(b));
    for (const c of creditsOf(b)) { credits[c.type] += pence(c.amount); credits.total += pence(c.amount); }
  }
  for (const k of Object.keys(credits)) credits[k] /= 100;
  return { billsNet: net / 100, credits };
}
