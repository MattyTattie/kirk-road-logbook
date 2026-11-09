// =====================================================================
// vat.js — which VAT rate applied to a home electricity period (v14.1; wording fixed v14.3).
// =====================================================================
// GB domestic electricity VAT is normally 5%. From 1 Oct 2026 to 31 Mar
// 2027 it is 0% (temporary zero rate, VAT (Supplies of Domestic
// Electricity) Order 2026), then back to 5% from 1 Apr 2027. v14.3: EDF's
// unit rate and standing charge are BEFORE VAT (3 Oct 2026 bill: 16.85p/kWh,
// 59.11p/day), so VAT is added on top of them; the rates themselves don't
// change on 1 Oct. Stored bill amounts are never changed. Northern Ireland
// stayed at 5% (not covered).
//
// A period between two readings runs from the first reading's day up to
// (not including) the second reading's day.

export const ZERO_FROM = '2026-10-01';
export const ZERO_UNTIL = '2027-04-01'; // first day back at 5%

const day = (iso) => String(iso || '').slice(0, 10);
// v15.19: the wording is worked out from ZERO_FROM / ZERO_UNTIL, so a change
// to the dates is one edit here (no dates typed into the sentences).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return { d: d.getUTCDate(), m: MON[d.getUTCMonth()], y: d.getUTCFullYear() }; };
const dayBefore = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
const words = (iso, year = true) => { const p = parts(iso); return `${p.d} ${p.m}${year ? ' ' + p.y : ''}`; };
const Z0 = words(ZERO_FROM), Z0short = words(ZERO_FROM, false), PRE = words(dayBefore(ZERO_FROM), false);
const ZLAST = words(dayBefore(ZERO_UNTIL)), Z1 = words(ZERO_UNTIL), Z1short = words(ZERO_UNTIL, false);
const RANGE = `${parts(ZERO_FROM).m}–${parts(dayBefore(ZERO_UNTIL)).m}`;

/** { kind: 'vat5' | 'none' | 'into-none' | 'out-of-none', text } for a period. */
export function vatFor(fromIso, toIso) {
  const a = day(fromIso), b = day(toIso);
  const startsZero = a >= ZERO_FROM && a < ZERO_UNTIL;
  const endsZero = b > ZERO_FROM && b <= ZERO_UNTIL; // last day used is the day before b
  if (startsZero && endsZero) return { kind: 'none', short: 'no VAT', text: `No VAT (0% until ${ZLAST}).` };
  if (!startsZero && endsZero && a < ZERO_FROM) return { kind: 'into-none', short: `5% VAT to ${PRE}`, text: `5% VAT added up to ${PRE}, then no VAT from ${Z0}.` };
  if (startsZero && b > ZERO_UNTIL) return { kind: 'out-of-none', short: `5% VAT from ${Z1short}`, text: `No VAT up to ${ZLAST}, then 5% VAT added from ${Z1}.` };
  if (a < ZERO_FROM && b > ZERO_UNTIL) return { kind: 'into-none', short: `5% VAT except ${RANGE}`, text: `5% VAT added, except ${Z0} – ${ZLAST} (no VAT then).` };
  return { kind: 'vat5', short: '5% VAT', text: 'Rates plus 5% VAT.' };
}

/** v14.3: what to multiply before-VAT charges by for a period: 1.05 when
 *  every day had 5% VAT, 1 when none did, in between for a split period
 *  (by the share of days at 5%). */
export function vatFactor(fromIso, toIso) {
  const a = Date.parse(day(fromIso)), b = Date.parse(day(toIso));
  if (!(b > a)) return day(fromIso) >= ZERO_FROM && day(fromIso) < ZERO_UNTIL ? 1 : 1.05;
  const z0 = Date.parse(ZERO_FROM), z1 = Date.parse(ZERO_UNTIL);
  const zeroDays = Math.max(0, Math.min(b, z1) - Math.max(a, z0));
  return 1 + 0.05 * (1 - zeroDays / (b - a));
}

/** v14.3: "All-in per kWh" in pence from the tariff (before VAT): unit rate +
 *  standing charge spread over the kWh used, plus VAT for the days it applied.
 *  Only for one plain unit rate and one standing charge; otherwise null (the
 *  caller then uses the bill total ÷ kWh). */
export function allInPence(tariff, used, days, fromIso, toIso) {
  if (!tariff || !(used > 0) || !(days > 0)) return null;
  const r = tariff.rates || [], s = tariff.standing || [];
  if (r.length !== 1 || s.length !== 1 || r[0].label || r[0].from || r[0].to || s[0].from || s[0].to) return null;
  const u = Number(r[0].p), st = Number(s[0].p);
  if (!isFinite(u) || !isFinite(st)) return null;
  return (u + (st * days) / used) * vatFactor(fromIso, toIso);
}

/** Sub-label for the worked-out "All-in per kWh" figure (no-break spaces keep
 *  "no VAT" / "5% VAT" together when the line wraps). */
export function allInNote(v) {
  const nb = (t) => t.replace(/ /g, '\u00a0');
  if (v.kind === 'none') return `incl. standing, ${nb('no VAT')}`;
  return `incl. standing + ${nb(v.short)}`;
}
