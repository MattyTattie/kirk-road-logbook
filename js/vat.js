// =====================================================================
// vat.js — which VAT rate applied to a home electricity period (v14.1).
// =====================================================================
// GB domestic electricity VAT is normally 5%. From 1 Oct 2026 to 31 Mar
// 2027 it is 0% (temporary zero rate, VAT (Supplies of Domestic
// Electricity) Order 2026), then back to 5% from 1 Apr 2027. Bills already
// include whatever VAT was charged, so this is only wording: stored bill
// amounts are never changed. Northern Ireland stayed at 5% (not covered).
//
// A period between two readings runs from the first reading's day up to
// (not including) the second reading's day.

export const ZERO_FROM = '2026-10-01';
export const ZERO_UNTIL = '2027-04-01'; // first day back at 5%

const day = (iso) => String(iso || '').slice(0, 10);

/** { kind: 'vat5' | 'none' | 'into-none' | 'out-of-none', text } for a period. */
export function vatFor(fromIso, toIso) {
  const a = day(fromIso), b = day(toIso);
  const startsZero = a >= ZERO_FROM && a < ZERO_UNTIL;
  const endsZero = b > ZERO_FROM && b <= ZERO_UNTIL; // last day used is the day before b
  if (startsZero && endsZero) return { kind: 'none', short: 'no VAT', text: 'No VAT (0% until 31 Mar 2027).' };
  if (!startsZero && endsZero && a < ZERO_FROM) return { kind: 'into-none', short: 'VAT to 30 Sep only', text: '5% VAT up to 30 Sep, then no VAT from 1 Oct 2026 (0% until 31 Mar 2027).' };
  if (startsZero && b > ZERO_UNTIL) return { kind: 'out-of-none', short: 'VAT from 1 Apr only', text: 'No VAT up to 31 Mar 2027, then 5% VAT from 1 Apr 2027.' };
  if (a < ZERO_FROM && b > ZERO_UNTIL) return { kind: 'into-none', short: 'part VAT', text: '5% VAT except 1 Oct 2026 – 31 Mar 2027 (no VAT then).' };
  return { kind: 'vat5', short: '5% VAT', text: 'Rates include 5% VAT.' };
}

/** Sub-label for the worked-out "All-in per kWh" figure (no-break spaces keep
 *  "no VAT" / "5% VAT" together when the line wraps). */
export function allInNote(v) {
  const nb = (t) => t.replace(/ /g, '\u00a0');
  if (v.kind === 'none') return `incl. standing, ${nb('no VAT')}`;
  if (v.kind === 'vat5') return `incl. standing & ${nb('5% VAT')}`;
  if (v.kind === 'into-none') return `incl. standing & ${nb('VAT to 30 Sep')}`;
  return `incl. standing, ${nb(v.short)}`;
}
