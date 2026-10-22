// =====================================================================
// outcomes.js — v15.2: the "is this good or bad?" answers behind the green,
// red and amber result boxes. Pure (no screen code), so it's tested.
// =====================================================================
import { bills, coverMonths, spendMonthKey, netCost } from './stats.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Electricity bills in one calendar year against the same months the year
// before (by the month each bill covers). For the year we're in, only the
// months up to the latest bill count, so it's like for like. Returns null
// when last year has too few bills to compare (under 3/4 as many months).
export function billsVsLastYear(entries, year, net = false) {
  if (!year) return null;
  const cv = coverMonths(entries);
  const by = {};
  for (const b of bills(entries)) {
    const k = spendMonthKey(b, cv); const y = Number(k.slice(0, 4)), m = Number(k.slice(5, 7));
    if (y !== year && y !== year - 1) continue;
    const slot = (by[y] ||= {}); slot[m] = (slot[m] || 0) + (net ? netCost(b) : Number(b.cost) || 0);
  }
  const now = by[year] || {}, then = by[year - 1] || {};
  const months = Object.keys(now).map(Number);
  if (!months.length) return null;
  const upTo = Math.max(...months);
  const range = Array.from({ length: upTo }, (_, i) => i + 1);
  const nowMonths = range.filter((m) => now[m] !== undefined), thenMonths = range.filter((m) => then[m] !== undefined);
  if (thenMonths.length < Math.max(1, Math.ceil(nowMonths.length * 0.75))) return null;
  const sum = (o) => Math.round(range.reduce((t, m) => t + (o[m] || 0), 0) * 100) / 100;
  const a = sum(now), b = sum(then), diff = Math.round((a - b) * 100) / 100;
  const label = upTo === 12 ? '' : upTo === 1 ? 'Jan' : `Jan–${MON[upTo - 1]}`;
  return { year, now: a, then: b, diff, pct: b ? Math.round((diff / b) * 100) : null, months: label, nowCount: nowMonths.length, thenCount: thenMonths.length,
    kind: Math.abs(diff) < 1 ? 'plain' : diff < 0 ? 'good' : 'bad' };
}

// How the Coming up list looks overall: red if something's overdue, amber
// if something's due in the next 30 days, green if nothing is.
export function comingUpState(overdueCount, soonCount) {
  if (overdueCount > 0) return { kind: 'bad', head: `${overdueCount} overdue`, sub: 'Past their date: renew, sort or mark done.' };
  if (soonCount > 0) return { kind: 'warn', head: `${soonCount} due in the next 30 days`, sub: 'Worth checking prices before renewals.' };
  return { kind: 'good', head: 'Nothing due in the next 30 days', sub: 'You’re all caught up.' };
}
