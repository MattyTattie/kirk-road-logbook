// =====================================================================
// review.js — "Year in review": what the house cost in one year (v13).
// =====================================================================
// Pure sums over the entries already in the app; nothing new is stored.
//   • Electricity bills, receipts, jobs (and any warranty with a price):
//     entries dated in that year, as on the spending chart.
//   • Insurance: what the policies cost in that year, pro rata (monthly
//     payments made; a yearly premium spread over its months), as on the
//     home tiles (stats.js insurancePaidInYear).
// For the year we're in, it's "so far", and the comparison with last year
// is like for like (1 Jan to the same date last year). Tested in
// tests/review.mjs.

import { insurancePaidInYear, monthlyUsage } from './stats.js';

const P = (n) => Math.round((Number(n) || 0) * 100); // pennies
const toPounds = (p) => p / 100;
export const CATEGORIES = [
  { id: 'meter', label: 'Electricity bills' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'receipt', label: 'Receipts' },
  { id: 'job', label: 'Jobs' },
  { id: 'warranty', label: 'Warranties' },
];
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Sums for one year, counting only up to `until` (YYYY-MM-DD, inclusive).
function sums(entries, year, until, now) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c.id, { pennies: 0, count: 0 }]));
  const items = [];
  const months = Array(12).fill(0);
  for (const e of entries) {
    if (!by[e.type]) continue;
    if (e.type === 'insurance') {
      const v = P(insurancePaidInYear(e, year, now));
      if (v > 0) { by.insurance.pennies += v; by.insurance.count++; items.push({ entry: e, pennies: v, insurance: true }); }
      continue;
    }
    const d = e.date || '';
    if (!d.startsWith(String(year)) || d.slice(0, 10) > until) continue;
    const v = P(e.cost);
    if (!v) continue;
    by[e.type].pennies += v; by[e.type].count++;
    months[Number(d.slice(5, 7)) - 1] += v;
    items.push({ entry: e, pennies: v });
  }
  const total = Object.values(by).reduce((a, b) => a + b.pennies, 0);
  return { by, total, items, months };
}

/**
 * yearReview(entries, year, now) → {
 *   year, partial (true for this year), total, categories: [{ id, label, total, count, prev, change }],
 *   biggest: [{ entry, amount, insurance }], prevTotal (null if no data), change, busiestMonth, kwh, otherCurrency
 * }
 */
export function yearReview(entries, year, now = new Date()) {
  const thisYear = now.getFullYear();
  const partial = year === thisYear;
  const until = partial ? isoDay(now) : `${year}-12-31`;
  const cur = sums(entries, year, until, now);
  // Last year, like for like: up to the same day if this year isn't over.
  const prevNow = partial ? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 12) : now;
  const prevUntil = partial ? isoDay(prevNow) : `${year - 1}-12-31`;
  const prev = sums(entries, year - 1, prevUntil, partial ? prevNow : now);
  const hasPrev = prev.items.length > 0;
  const categories = CATEGORIES.map((c) => {
    const t = cur.by[c.id].pennies, pv = prev.by[c.id].pennies;
    return { id: c.id, label: c.label, total: toPounds(t), count: cur.by[c.id].count, prev: hasPrev ? toPounds(pv) : null, change: hasPrev && (t || pv) ? toPounds(t - pv) : null };
  }).filter((c) => c.total || (c.prev || 0));
  const biggest = cur.items.slice().sort((a, b) => b.pennies - a.pennies).slice(0, 5).map((x) => ({ entry: x.entry, amount: toPounds(x.pennies), insurance: Boolean(x.insurance) }));
  let busiestMonth = null;
  cur.months.forEach((v, i) => { if (v > 0 && (!busiestMonth || v > P(busiestMonth.amount))) busiestMonth = { month: i + 1, amount: toPounds(v) }; });
  const usage = monthlyUsage(entries, year).filter((m) => m.unit === 'kWh' || !m.unit);
  const kwh = Math.round(usage.reduce((a, m) => a + m.value, 0));
  const otherCurrency = cur.items.filter((x) => x.entry.currency && x.entry.currency !== 'GBP').length;
  return {
    year, partial, until, total: toPounds(cur.total), categories, biggest,
    prevTotal: hasPrev ? toPounds(prev.total) : null,
    change: hasPrev ? toPounds(cur.total - prev.total) : null,
    busiestMonth, kwh: kwh > 0 ? kwh : null, kwhDays: usage.reduce((a, m) => a + m.days, 0), otherCurrency,
  };
}

/** Years worth reviewing: any year with a cost or a running policy, newest first. */
export function reviewYears(entries, now = new Date()) {
  const ys = new Set([now.getFullYear()]);
  for (const e of entries) {
    const y = Number((e.date || '').slice(0, 4));
    if (!(y > 1990 && y <= now.getFullYear())) continue;
    if (e.type === 'insurance') { for (let k = y; k <= now.getFullYear(); k++) if (insurancePaidInYear(e, k, now) > 0) ys.add(k); }
    else if (Number(e.cost) > 0) ys.add(y);
  }
  return [...ys].sort((a, b) => b - a);
}
