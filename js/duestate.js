// =====================================================================
// duestate.js (v15.22) — which dates still matter, and a few "looks like"
// checks. Pure functions (no screen code), tested in tests/v15_22_units.mjs.
//
// Everything here reads OPTIONAL fields that older copies of Hearth simply
// ignore (they keep working, they just don't know about them):
//   dueDismissed  'YYYY-MM-DD'  the due/expiry date you said "Dismiss"/"Done"
//                 to. It only counts while it matches the entry's dueDate, so
//                 changing the date brings it back.
//   renewedBy     '<id>'        insurance: the policy that replaced this one.
//   policyEnded   'YYYY-MM-DD'  insurance: you said the policy ended (not renewed).
// =====================================================================
import { withoutSuperseded } from './mortgage.js';

const day = (iso) => String(iso || '').slice(0, 10);
const dayNum = (iso) => { const [y, m, d] = day(iso).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000; };
const isDay = (iso) => /^\d{4}-\d\d-\d\d/.test(String(iso || ''));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "Dismiss" on an expired warranty, "Done" on a job's due date.
export const dueDismissed = (e) => Boolean(e && e.dueDismissed && isDay(e.dueDate) && day(e.dueDismissed) === day(e.dueDate));

export const policyEnded = (e) => Boolean(e && e.type === 'insurance' && e.policyEnded);

// Policies replaced by a newer one: either linked by "Renewed" (renewedBy),
// or the same kind of cover from the same insurer (or the same policy
// number) starting within 60 days either side of this one's renewal date.
export function supersededPolicyIds(entries) {
  const pol = (entries || []).filter((e) => e && e.type === 'insurance');
  const ids = new Set(pol.map((e) => e.id));
  const out = new Set();
  for (const e of pol) {
    if (e.renewedBy && ids.has(e.renewedBy) && e.renewedBy !== e.id) { out.add(e.id); continue; }
    if (!isDay(e.dueDate) || !isDay(e.date)) continue;
    const due = dayNum(e.dueDate);
    for (const o of pol) {
      if (o === e || !isDay(o.date) || day(o.date) <= day(e.date)) continue;
      if ((o.insType || 'home') !== (e.insType || 'home')) continue;
      const same = (norm(o.supplier) && norm(o.supplier) === norm(e.supplier)) || (norm(o.policyNumber) && norm(o.policyNumber) === norm(e.policyNumber));
      if (!same) continue;
      const od = dayNum(o.date);
      if (od >= due - 60 && od <= due + 60) { out.add(e.id); break; }
    }
  }
  return out;
}

// 'current' | 'renewed' (replaced by a newer policy) | 'ended' | 'lapsed' (renewal date passed, nothing logged)
export function policyStatus(e, entries, today) {
  if (policyEnded(e)) return 'ended';
  if (supersededPolicyIds(entries).has(e.id)) return 'renewed';
  if (isDay(e.dueDate) && day(e.dueDate) < day(today)) return 'lapsed';
  return 'current';
}
// The policy that replaced this one (Renewed link, or the automatic match).
export function replacementOf(e, entries) {
  const pol = (entries || []).filter((x) => x && x.type === 'insurance' && x !== e);
  if (e.renewedBy) { const r = pol.find((x) => x.id === e.renewedBy); if (r) return r; }
  if (!supersededPolicyIds(entries).has(e.id)) return null;
  return pol.filter((o) => isDay(o.date) && day(o.date) > day(e.date) && (o.insType || 'home') === (e.insType || 'home')).sort((a, b) => day(a.date).localeCompare(day(b.date)))[0] || null;
}

// Entries whose due / expiry / renewal date still matters (Coming up,
// Overdue, notifications): not dismissed, not a replaced or ended policy,
// and only the latest mortgage statement (mortgage.js).
export function activeDue(entries) {
  const sup = supersededPolicyIds(entries);
  return withoutSuperseded(entries).filter((e) => e && isDay(e.dueDate) && !dueDismissed(e) && !sup.has(e.id) && !policyEnded(e));
}

// ---------- the same bill twice (two phones scanning the same email) ----------
const pennies = (v) => Math.round(Number(v) * 100);
const monthOf = (iso) => { const t = new Date(dayNum(iso) * 86400000 - 15 * 86400000); return `${t.getUTCFullYear()}-${t.getUTCMonth()}`; };
export const pairKey = (a, b) => [a.id, b.id].sort().join('|');
export function sameBill(a, b) {
  if (!a || !b || a === b || a.id === b.id || a.type !== 'meter' || b.type !== 'meter') return false;
  if (!(Number(a.cost) > 0) || pennies(a.cost) !== pennies(b.cost)) return false;
  if (norm(a.supplier) !== norm(b.supplier)) return false;
  if (!isDay(a.date) || !isDay(b.date)) return false;
  const close = Math.abs(dayNum(a.date) - dayNum(b.date)) <= 7 || monthOf(a.date) === monthOf(b.date);
  if (!close) return false;
  const ra = a.meterValue, rb = b.meterValue;
  const has = (v) => v !== null && v !== undefined && v !== '';
  if (has(ra) && has(rb) && Number(ra) !== Number(rb)) return false;
  return true;
}
// Pairs of bills that look like the same bill, minus the pairs you said are different.
export function likelyDuplicateBills(entries, notDup = []) {
  const skip = new Set(notDup);
  const list = (entries || []).filter((e) => e && e.type === 'meter' && Number(e.cost) > 0).sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && dayNum(list[j].date) - dayNum(list[i].date) <= 40; j++) {
      if (sameBill(list[i], list[j]) && !skip.has(pairKey(list[i], list[j]))) out.push([list[i], list[j]]);
    }
  }
  return out;
}
// Of a duplicate pair, the copy to keep: the one with photos, then the older one.
export function keeperOf([a, b]) {
  const pa = (a.photos || []).length, pb = (b.photos || []).length;
  if (pa !== pb) return pa > pb ? a : b;
  return String(a.createdAt || a.updatedAt || '') <= String(b.createdAt || b.updatedAt || '') ? a : b;
}

// ---------- a logged job that is a reminder's task ----------
const NOISE = new Set(['done', 'the', 'a', 'an', 'and', 'of', 'for', 'to', 'check', 'checked', 'job', 'annual', 'yearly', 'monthly', 'test', 'tested', 'my', 'our']);
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 3 && !NOISE.has(w));
// Reminders (jobs with a `reminder` object and a due date) that a new job
// title is about: every main word of the reminder's title is in the job's
// title ("Boiler service" ↔ "Boiler service done"), due within 60 days
// either way (or overdue). Nearest due first.
export function remindersForJob(job, entries, today) {
  if (!job || job.type !== 'job' || job.reminder) return [];
  const jt = norm(job.title);
  const jw = new Set(words(job.title));
  const t = dayNum(today);
  return (entries || []).filter((r) => {
    if (!r || r === job || r.id === job.id || r.type !== 'job' || !r.reminder || !isDay(r.dueDate)) return false;
    const rw = words(r.title);
    const main = rw.length ? rw : norm(r.title).split(' ').filter((w) => w.length >= 3);
    if (!main.length) return false;
    const hit = main.every((w) => jw.has(w) || jt.includes(w));
    return hit && dayNum(r.dueDate) - t <= 60;
  }).sort((a, b) => Math.abs(dayNum(a.dueDate) - t) - Math.abs(dayNum(b.dueDate) - t));
}

// ---------- typo dates ----------
// A date more than `days` ahead of today (e.g. 2027 typed for 2026).
export function farFuture(iso, today, days = 31) {
  return isDay(iso) && dayNum(iso) - dayNum(today) > days;
}
