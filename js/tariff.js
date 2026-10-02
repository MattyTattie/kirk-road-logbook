// =====================================================================
// tariff.js — unit rates (p/kWh) and standing charges (p/day) of a bill.
// =====================================================================
// A tariff is { rates: [{ p, label, from, to }], standing: [{ p, from, to }] }.
// Several rates when the price changed part way through a bill ("from" =
// first day of the new price) or for day/night meters ("label").
// Kept separate from parse.js so the main screens can use it without
// loading the scanner code. Pure functions (tested in Node).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const tidyLabel = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase().replace(/^off[- ]?peak$/, 'Off-peak') : '');

// "14 May", "27 Feb 2026", "3 December 2025" -> [{ iso, index }]
function findDayMonth(text, defaultYear) {
  const out = [];
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/gi)) {
    const mo = MONTHS[m[2].toLowerCase()];
    const d = Number(m[1]);
    if (!mo || d < 1 || d > 31) continue;
    out.push({ iso: `${m[3] || defaultYear}-${pad(mo)}-${pad(d)}`, index: m.index });
  }
  return out;
}
const dayMonthText = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${SHORT[m - 1]} ${y}`; };

export function addRate(list, item) {

  const same = list.find((r) => r.p === item.p && (r.label || '') === (item.label || ''));
  if (same) {
    if (item.from && (!same.from || item.from < same.from)) same.from = item.from;
    if (item.to && (!same.to || item.to > same.to)) same.to = item.to;
    return;
  }
  list.push(item);
}

// The same, from free text: bill notes ("at 24.510p/kWh … standing
// 56.540p/day", "at 20.189/21.074p/kWh", "3–13 May … at 24.510p and 14 May
// – 2 Jun … at 21.074p") or what you type in the form ("Day 30.1, Night 15.2",
// "21.074 to 26 Feb, 20.189 from 27 Feb 2026"). Returns null if none found.
export function ratesFromText(text, { defaultYear = new Date().getFullYear(), bare = false } = {}) {
  const t = (text || '').replace(/[–—]/g, '-');
  const rates = [], standing = [];
  // Standing charges first, and blank them out so they aren't read as unit rates.
  const rest = t.replace(/standing(?:\s+charges?)?\s*(?:of|at|@|:)?\s*(\d{1,3}(?:\.\d{1,4})?)\s*p?\s*(?:\/\s*day|a\s+day|per\s+day)?/gi, (m, p) => {
    if (/p|day/i.test(m.slice(m.indexOf(p) + p.length)) || bare) addRate(standing, { p: Number(p) });
    return ' ';
  });
  // "p" values tied to kWh, "at"/"@" or "unit rate"; with bare=true (the
  // form field) any number counts.
  const re = bare
    ? /(?:\b(day|night|peak|off[- ]?peak|economy)\b\s*:?\s*)?(\d{1,3}(?:\.\d{1,4})?(?:\s*\/\s*\d{1,3}(?:\.\d{1,4})?)*)\s*p?(?:\s*(?:\/|per\s+)\s*kwh)?((?:\s*(?:from|to|until)\s+\d{1,2}\s+[a-z]+\.?(?:\s+\d{4})?)?)/gi
    : /(?:\b(day|night|peak|off[- ]?peak|economy)\b[^\d.]{0,20})?(?:unit rate|\bat|@)\s*(\d{1,3}\.\d{1,4}(?:\s*\/\s*\d{1,3}\.\d{1,4})*)\s*p(?:\s*(?:\/|per\s+)\s*kwh)?()/gi;
  for (const m of rest.matchAll(re)) {
    const vals = m[2].split('/').map((v) => Number(v.trim())).filter((v) => v > 0.5 && v < 200);
    let from, to;
    const when = (m[3] || '').trim();
    if (when) {
      const d = findDayMonth(when, defaultYear)[0];
      if (d) { if (/^from/i.test(when)) from = d.iso; else to = d.iso; }
    } else if (!bare && vals.length === 1) {
      // ("at 20.189/21.074p" gives no order or dates, so those stay undated)
      // "14 May - 2 Jun 274.46 kWh at 21.074p": a date range just before
      const before = rest.slice(Math.max(0, m.index - 60), m.index);
      const ds = findDayMonth(before, defaultYear);
      const rng = before.match(/(\d{1,2})\s*-\s*\d{1,2}\s+([a-z]+)/i);
      if (ds.length >= 2) from = ds[ds.length - 2].iso;
      else if (rng) { const d = findDayMonth(`${rng[1]} ${rng[2]}`, defaultYear)[0]; if (d) from = d.iso; }
    }
    for (const p of vals) addRate(rates, { p, label: tidyLabel(m[1] || ''), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  if (!rates.length && !standing.length) return null;
  if (rates.length === 1 && !bare) { delete rates[0].from; delete rates[0].to; }
  return { rates, standing };
}

// Tariff -> the text shown in the form, e.g. "Day 30.1, Night 15.2" or
// "21.074 to 26 Feb 2026, 20.189 from 27 Feb 2026".
export function ratesToText(list) {
  return (list || []).map((r) => [r.label, String(r.p), r.from ? `from ${dayMonthText(r.from)}` : r.to ? `to ${dayMonthText(r.to)}` : ''].filter(Boolean).join(' ')).join(', ');
}

