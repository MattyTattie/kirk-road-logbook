// =====================================================================
// billmonth.js (v16.1) — the ONE rule for which month an energy bill is for.
// =====================================================================
// Before v16.1 three files each had their own "bill month" (Ask Hearth,
// the Drive photo names and the scanner's title) and they could disagree
// for an odd bill. Now they all ask this file. Pure functions, no DOM.
//
// The rule, in order:
//   1. the month the period between two meter readings mostly covers
//      (the middle day of the period; `cover` = stats.coverMonths()),
//   2. the month named in the bill's title ("EDF bill Sep 2025"),
//   3. a "2025-09" in the title,
//   4. the bill's own date.
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

// "3 Sep → 3 Oct" is September: the month of the middle day.
export function midMonthKey(fromIso, toIso) {
  const a = dayNum(fromIso), b = dayNum(toIso);
  const d = new Date(Math.floor((a + b) / 2) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// "YYYY-MM" named in a title, or ''.
export function titleMonthKey(title) {
  const t = String(title || '');
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (m) return `${m[2]}-${String(MON.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
  const iso = t.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);
  return iso ? `${iso[1]}-${iso[2]}` : '';
}

// "YYYY-MM" an energy bill is for (rule above), or '' if there's nothing to go on.
export function billMonthKey(entry, cover = null) {
  const c = cover && entry && entry.id ? (cover.get ? cover.get(entry.id) : cover[entry.id]) : null;
  if (c && /^\d{4}-\d{2}$/.test(c)) return c;
  const t = titleMonthKey(entry && entry.title);
  if (t) return t;
  return /^\d{4}-\d{2}/.test((entry && entry.date) || '') ? entry.date.slice(0, 7) : '';
}

// "2025-09" → "Sep 2025"
export const shortMonthLabel = (key) => (/^\d{4}-\d{2}$/.test(key || '') ? `${MON_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : '');
