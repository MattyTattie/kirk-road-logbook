// =====================================================================
// parse.js — turn the text of a receipt or bill into form fields.
// =====================================================================
// The input is plain text (from OCR or a PDF's text layer), which is
// messy: OCR mixes up O/0, l/1, drops spaces, and puts two columns on one
// line. So everything here is "best guess", and the app always asks you to
// check the result before saving.
//
//   parseDocument(text) -> {
//     kind: 'bill' | 'receipt',
//     supplier, date ('YYYY-MM-DD'), total (number),
//     reference,                       // order / invoice / bill number
//     meter: { closing, closingDate, opening, openingDate, used, unit,
//              periodStart, periodEnd } // energy bills only
//     tariff: { rates: [{ p, label, from, to }], standing: [{ p, from, to }] }
//              // unit rates (pence/kWh) and standing charges (pence/day),
//              // energy bills only; several when the tariff changed or for
//              // day/night (Economy 7) meters
//     title, notes, found: { … }       // which fields we're confident about
//   }
//
// Pure functions only (no browser APIs), so the tests can run it in Node.

import { addRate } from './tariff.js';

// ---------- Known suppliers ----------
// kind 'energy' makes the scan a meter-reading/bill entry.
export const SUPPLIERS = [
  { name: 'EDF', kind: 'energy', re: /\bEDF\b|edfenergy|EDF Energy/i },
  { name: 'OVO Energy', kind: 'energy', re: /\bOVO\b|ovoenergy/i },
  { name: 'Octopus Energy', kind: 'energy', re: /octopus\s*energy|octopus\.energy/i },
  { name: 'British Gas', kind: 'energy', re: /british\s*gas/i },
  { name: 'E.ON Next', kind: 'energy', re: /\bE\.?ON\b(?:\s*next)?|eonnext/i },
  { name: 'Scottish Power', kind: 'energy', re: /scottish\s*power/i },
  { name: 'SSE', kind: 'energy', re: /\bSSE\s+(?:energy|airtricity)\b/i },
  { name: 'Shell Energy', kind: 'energy', re: /shell\s*energy/i },
  { name: 'Utility Warehouse', kind: 'energy', re: /utility\s*warehouse/i },
  { name: 'So Energy', kind: 'energy', re: /\bso\s*energy\b/i },
  { name: 'Outfox the Market', kind: 'energy', re: /outfox/i },
  { name: 'Scottish Water', kind: 'water', re: /scottish\s*water/i },
  { name: 'Screwfix', kind: 'shop', re: /screwfix|screwlix/i },
  { name: 'Toolstation', kind: 'shop', re: /toolstation/i },
  { name: 'B&Q', kind: 'shop', re: /\bB\s?&\s?Q\b|\bdiy\.com\b/i },
  { name: 'Wickes', kind: 'shop', re: /\bwickes\b/i },
  { name: 'Currys', kind: 'shop', re: /\bcurrys\b/i },
  { name: 'AO', kind: 'shop', re: /\bao\.com\b|\bAO Retail\b/i },
  { name: 'Amazon', kind: 'shop', re: /\bamazon\b/i },
  { name: 'Wren Kitchens', kind: 'shop', re: /wren\s*kitchens|wrenkitchens|\bwren\b/i },
  { name: 'Argos', kind: 'shop', re: /\bargos\b/i },
  { name: 'IKEA', kind: 'shop', re: /\bikea\b/i },
  { name: 'Homebase', kind: 'shop', re: /\bhomebase\b/i },
  { name: 'Travis Perkins', kind: 'shop', re: /travis\s*perkins/i },
  { name: 'Jewson', kind: 'shop', re: /\bjewson\b/i },
  { name: 'Howdens', kind: 'shop', re: /\bhowdens\b/i },
  { name: 'Topps Tiles', kind: 'shop', re: /topps\s*tiles/i },
  { name: 'City Plumbing', kind: 'shop', re: /city\s*plumbing/i },
  { name: 'Plumbase', kind: 'shop', re: /\bplumbase\b/i },
  { name: 'Selco', kind: 'shop', re: /\bselco\b/i },
  { name: 'Halfords', kind: 'shop', re: /\bhalfords\b/i },
  { name: 'John Lewis', kind: 'shop', re: /john\s*lewis/i },
  { name: 'Dunelm', kind: 'shop', re: /\bdunelm\b/i },
  { name: 'The Range', kind: 'shop', re: /\bthe\s*range\b/i },
  { name: 'B&M', kind: 'shop', re: /\bB\s?&\s?M\b/i },
  { name: 'eBay', kind: 'shop', re: /\bebay\b/i },
  { name: 'BestHeating', kind: 'shop', re: /best\s*heating/i },
  { name: 'Luxury Flooring', kind: 'shop', re: /luxury\s*flooring/i },
  { name: 'Conserv', kind: 'shop', re: /\bconserv\b|eonserv/i },
  { name: 'Tesco', kind: 'shop', re: /\btesco\b/i },
  { name: "Sainsbury's", kind: 'shop', re: /sainsbury/i },
  { name: 'Asda', kind: 'shop', re: /\basda\b/i },
  { name: 'Morrisons', kind: 'shop', re: /morrisons/i },
  { name: 'Aldi', kind: 'shop', re: /\baldi\b/i },
  { name: 'Lidl', kind: 'shop', re: /\blidl\b/i },
];

// ---------- Dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// OCR often reads O as 0 ("0ct") and l as 1 ("Ju1"), so month names allow those.
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|ju[l1](?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|[o0]ct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DMY_WORDS = new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MON}\\s*,?\\s*(\\d{4}|\\d{2}\\b)?`, 'gi');
const DMY_NUM = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g;

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1990 && y <= 2100;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
const monthNum = (word) => MONTHS[word.toLowerCase().replace(/^0/, 'o').replace(/1/g, 'l').slice(0, 3)];

// All dates in a piece of text, in order, as { iso, index, end }.
// `defaultYear` fills in dates like "3 Aug." that have no year.
export function findDates(text, defaultYear) {
  const out = [];
  for (const m of text.matchAll(DMY_WORDS)) {
    const d = Number(m[1]);
    const mo = monthNum(m[2]);
    let y = m[3] ? fullYear(Number(m[3])) : defaultYear;
    if (!y || !mo || !validDate(y, mo, d)) continue;
    out.push({ iso: iso(y, mo, d), index: m.index, end: m.index + m[0].length, hasYear: !!m[3] });
  }
  for (const m of text.matchAll(DMY_NUM)) {
    const d = Number(m[1]), mo = Number(m[2]), y = fullYear(Number(m[3]));
    if (!validDate(y, mo, d)) continue; // UK order: day/month/year
    out.push({ iso: iso(y, mo, d), index: m.index, end: m.index + m[0].length, hasYear: true });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// ---------- Money ----------
// "£1,234.56", "£ 390.20", "£17.757.94" (OCR turned a comma into a dot),
// "-£23.07", "168.00".
const MONEY = /(-)?\s?£\s?(-)?\s?(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))(?!\d)|(?<![\d.,£])(-)?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?![\d%])/g;
export function findAmounts(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const raw = m[3] || m[5];
    const neg = !!(m[1] || m[2] || m[4]);
    // last separator followed by exactly 2 digits = pence; others are thousands
    const cleaned = raw.replace(/[,.](?=\d{3}(?:[,.]|$))/g, '').replace(',', '.');
    const v = Number(cleaned);
    if (!isFinite(v)) continue;
    out.push({ value: neg ? -v : v, pound: !!m[3], index: m.index });
  }
  return out;
}

// ---------- helpers ----------
const lines = (text) => text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const round2 = (n) => Math.round(n * 100) / 100;

function detectSupplier(text) {
  let best = null;
  for (const s of SUPPLIERS) {
    const re = new RegExp(s.re.source, s.re.flags.includes('g') ? s.re.flags : s.re.flags + 'g');
    const hits = [...text.matchAll(re)];
    if (!hits.length) continue;
    const score = hits.length * 10 - hits[0].index / 1000;
    if (!best || score > best.score) best = { ...s, score };
  }
  return best;
}

// Customer-address-ish lines we must never mistake for the shop's name.
const NOT_A_NAME = /\b\d+[a-z]?\s+[a-z]+\s+(?:road|rd|street|st|avenue|ave|lane|drive|close|way|crescent|terrace|place|court|gardens)\b|address|united kingdom|^(mr|mrs|ms|miss|dr)\b|\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b|invoice|receipt|statement|page \d|smell gas|power cut|tel\b|phone|e-?mail|www\.|https?:|@|order|customer|account|vat|date|total|bill to|deliver|ship|^your\b|^\W*$/i;

function fallbackSupplier(allLines) {
  // A line that looks like a company ("… Ltd", "… Limited") near the top…
  for (const l of allLines.slice(0, 25)) {
    const m = l.match(/([A-Z][A-Za-z&'’.\- ]{2,60}?\s(?:Ltd|LTD|Limited|LIMITED|LLP|plc|PLC))\b/);
    if (m && !/trading name|registered|reg\.? office|customers ltd/i.test(l)) return tidyName(m[1]);
  }
  // …otherwise the first prominent line that isn't an address or boilerplate.
  for (const l of allLines.slice(0, 6)) {
    const name = tidyName(l);
    const letters = (name.match(/[A-Za-z]/g) || []).length;
    if (letters >= 4 && letters / name.length > 0.75 && name.length <= 40 && !NOT_A_NAME.test(name) && !repeats(name)) return name;
  }
  return '';
}
// "Matthew Mcintosh Matthew Mcintosh" = a two-column address block, not a shop.
const repeats = (s) => /^(.{3,})\s+\1$/i.test(s.trim());
// Strip OCR crumbs: "i' Linnorie Firewood bs!" -> "Linnorie Firewood".
function tidyName(s) {
  let words = s.replace(/^(?:by|from)\s+/i, '').split(/\s+/);
  const junk = (w) => w.length <= 3 && /[^A-Za-z&]/.test(w) || /^[^A-Za-z&]+$/.test(w) || /[!|\\{}\[\]~]/.test(w);
  while (words.length && (junk(words[0]) || /^by$/i.test(words[0]))) words.shift();
  while (words.length && junk(words[words.length - 1])) words.pop();
  let out = words.join(' ').replace(/\s+(?:LTD|Ltd|Limited|LIMITED)$/, ' Ltd').trim();
  if (/^[A-Z][A-Z\s&']+$/.test(out)) out = out.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return out;
}

function pickDate(allLines, defaultYear) {
  const tiers = [
    /\b(invoice date|tax point date|date of invoice|bill date|statement date|receipt date|date issued|issue date)\b/i,
    /\bbill reference\b/i,
    /\b(order date|order placed|date ordered|purchase date|transaction date|sale date)\b/i,
    /\bdate\b/i,
  ];
  for (const re of tiers) {
    for (let i = 0; i < allLines.length; i++) {
      const m = allLines[i].match(re);
      if (!m) continue;
      const after = allLines[i].slice(m.index);
      let ds = findDates(after, defaultYear).filter((d) => d.hasYear);
      if (!ds.length && allLines[i + 1]) {
        // header row, value row underneath (e.g. "Invoice Date  Due Date" / "06/04/2026 13/05/2026")
        // which column was the label in? count the other date-ish headers before it
        const col = (allLines[i].slice(0, m.index).match(/\b\w*\s?date\b/gi) || []).length;
        ds = findDates(allLines[i + 1], defaultYear).filter((d) => d.hasYear);
        if (ds.length > 1 && col > 0) ds = [ds[Math.min(col, ds.length - 1)]];
      }
      if (ds.length) return ds[0].iso;
    }
  }
  const any = findDates(allLines.join('\n')).filter((d) => d.hasYear);
  return any.length ? any[0].iso : '';
}

function pickTotal(allLines) {
  const EXCLUDE = /sub\s?-?total|total\s*(?:vat|tax|goods|net|ex\b|excl|before|savings?|discount|of other credits|shipping)|vat\s*total|net\s*total|price before|save:|you saved|shipping charges/i;
  const tiers = [
    /\b(grand total|order total|total paid|amount paid|total price|total invoice|invoice total|total payable|total due|total to pay|gross total|total amount|total \(?inc(?:l|luding)?\.? vat\)?|amount due|balance due|balance to pay)\b/i,
    /\btotal\b/i,
    /\b(balance|amount)\b/i,
  ];
  for (const re of tiers) {
    const cands = [];
    allLines.forEach((l, i) => {
      const m = l.match(re);
      if (!m || EXCLUDE.test(l.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12))) return;
      if (/last bill|previous balance|opening balance|balance on your last/i.test(l)) return;
      let amts = findAmounts(l.slice(m.index));
      if (!amts.length && re === tiers[0] && allLines[i + 1]) amts = findAmounts(allLines[i + 1]);
      if (amts.length) cands.push(amts[0].value);
    });
    const pos = cands.filter((v) => v > 0);
    if (pos.length) return Math.max(...pos);
  }
  // Last resort: the biggest £ amount on the page.
  const all = allLines.flatMap((l) => findAmounts(l).filter((a) => a.pound && a.value > 0).map((a) => a.value));
  return all.length ? Math.max(...all) : null;
}

function pickReference(text) {
  const res = [
    /\b(?:invoice|order|bill)\s*(?:no\.?|number|ref(?:erence)?|#)\s*(?:is\s*)?[:#\-]?\s*#?\s*([A-Z0-9][A-Z0-9\-/]{3,})/gi,
    /\b(?:invoice|order)\s*#\s*([A-Z0-9][A-Z0-9\-/]{3,})/gi,
    /\bhire no:?\s*([A-Z0-9\-]{4,})/gi,
  ];
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const ref = m[1];
      // must contain a digit and not be a date
      if (/\d/.test(ref) && !/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(ref)) return ref;
    }
  }
  return '';
}

// The year most often mentioned — used for dates written without a year.
function commonYear(text, fallback) {
  const counts = {};
  for (const m of text.matchAll(/\b(19[9]\d|20\d\d)\b/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : fallback;
}

// ---------- Energy bills ----------
function parseEnergy(allLines, text, defaultYear) {
  const meter = { unit: 'kWh' };
  // Period charge lines, e.g. "Electricity 3 Aug. 2026 - 2 Sept. 2026 £85.80"
  const charges = [];
  const periods = [];
  for (const l of allLines) {
    if (!/^(?:\W{0,3})(electricity|gas)\b/i.test(l)) continue;
    const ds = findDates(l, defaultYear);
    if (ds.length < 2) continue;
    const between = l.slice(ds[0].end, ds[1].index);
    if (!/^\s*[-–—to]+\s*$/i.test(between) && between.length > 4) continue;
    let start = ds[0], end = ds[1];
    // "3 Aug. - 2 Sept. 2026": the first date may lack a year
    if (!start.hasYear && end.hasYear) start = { ...start, iso: start.iso.replace(/^\d{4}/, end.iso.slice(0, 4)) };
    periods.push([start.iso, end.iso]);
    const amt = findAmounts(l.slice(ds[1].end)).find((a) => a.pound);
    if (amt) charges.push(amt.value);
  }
  if (periods.length) {
    meter.periodStart = periods.map((p) => p[0]).sort()[0];
    meter.periodEnd = periods.map((p) => p[1]).sort().slice(-1)[0];
  }
  // Readings: "3 Sep 2026 11911.6750 Smart meter reading", OVO "Closing read as of 14th February … 17225.000"
  const reads = [];
  for (const l of allLines) {
    if (!/read(?:ing)?\b/i.test(l)) continue;
    const ds = findDates(l, meter.periodEnd ? Number(meter.periodEnd.slice(0, 4)) : defaultYear);
    if (!ds.length) continue;
    const rest = l.slice(ds[0].end);
    const nums = [...rest.matchAll(/(?<![\d.£])(\d{2,6}\.\d{1,4}|\d{4,6})(?![\d.]|\s*(?:kwh|p\b|%|days?))/gi)]
      .map((m) => Number(m[1]))
      .filter((v) => !(Number.isInteger(v) && v >= 1990 && v <= 2100)); // not a year
    if (!nums.length) continue;
    const n = { v: nums[0] };
    reads.push({ date: ds[0].iso, value: n.v, closing: /closing|final/i.test(l), opening: /opening/i.test(l) });
  }
  if (reads.length) {
    const sorted = [...reads].sort((a, b) => a.date.localeCompare(b.date));
    const close = reads.find((r) => r.closing) || sorted[sorted.length - 1];
    const open = reads.find((r) => r.opening) || sorted[0];
    meter.closing = close.value;
    meter.closingDate = close.date;
    if (open !== close) { meter.opening = open.value; meter.openingDate = open.date; }
  }
  // kWh used: sum of "Electricity used 376.2200 kWh" lines, else "Total units 135.730 kWh", else closing - opening
  const used = allLines.map((l) => l.match(/(?:electricity|gas|energy)\s+(?:used|use)\s+(-?[\d,]+\.?\d*)\s*kwh/i)).filter(Boolean).map((m) => Number(m[1].replace(/,/g, '')));
  const units = text.match(/total units\s+([\d,]+\.?\d*)\s*kwh/i);
  if (used.length) meter.used = round2(used.reduce((a, b) => a + b, 0));
  else if (units) meter.used = round2(Number(units[1].replace(/,/g, '')));
  else if (meter.closing && meter.opening) meter.used = round2(meter.closing - meter.opening);

  // Cost for the period: the charge lines (summed, a bill can have 2 tariff
  // periods) → "Total electricity charges for this period" → "Total charges".
  let total = null;
  if (charges.length) total = round2(charges.reduce((a, b) => a + b, 0));
  else {
    const per = allLines.map((l) => l.match(/total (?:electricity|gas) charges(?: for this period)?\s*(-?£\s?[\d,]+\.\d{2})/i)).filter(Boolean).map((m) => findAmounts(m[1])[0].value);
    if (per.length) total = round2(per.reduce((a, b) => a + b, 0));
    else {
      const tc = allLines.map((l) => l.match(/total charges\s*([+-]?£\s?[\d,]+\.\d{2})/i)).filter(Boolean).map((m) => findAmounts(m[1].replace('+', ''))[0].value).filter((v) => v > 0);
      if (tc.length) total = Math.max(...tc);
      else {
        const ce = allLines.map((l) => l.match(/cost of (?:electricity|gas)\s*(£\s?[\d,]+\.\d{2})/i)).filter(Boolean).map((m) => findAmounts(m[1])[0].value);
        if (ce.length) total = round2(ce.reduce((a, b) => a + b, 0));
      }
    }
  }
  return { meter, total };
}


// ---------- Tariff: unit rates and standing charges ----------
// Lines like "Unit rate 21.074p/kWh", "Day unit rate 30.10p per kWh",
// "Electricity used 264.13 kWh @ 24.510p/kWh", "Standing charge 57.972p/day",
// "Standing charge 63.20p a day". A bill covering a tariff change has a
// heading per part, e.g. "Engage Employee Jun27 (27 February 2026 - 2 March 2026)",
// which tells us from when each rate applied.
const RATE_LABEL = /\b(day|night|peak|off[- ]?peak|economy|heating|standard)\b/i;
const tidyLabel = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase().replace(/^off[- ]?peak$/, 'Off-peak') : '');
const PENCE_KWH = /(\d{1,3}(?:\.\d{1,4})?)\s*p\s*(?:\/|per\s+)\s*kwh/i;
const PENCE_DAY = /(\d{1,3}(?:\.\d{1,4})?)\s*p\s*(?:\/\s*day|a\s+day|per\s+day)/i;

export function parseTariff(allLines, defaultYear = new Date().getFullYear()) {
  const rates = [], standing = [];
  let seg = null; // { from, to } of the tariff part we're reading
  for (let i = 0; i < allLines.length; i++) {
    let l = allLines[i];
    // A tariff-part heading, possibly wrapped: "(3 December 2025 - 31 December" + "2025)"
    if (/\(\s*\d{1,2}\s+[a-z]+\.?\s*(\d{4})?\s*-\s*\d{1,2}\s+[a-z]+/i.test(l)) {
      const joined = /\d{4}\)/.test(l) ? l : l + ' ' + (allLines[i + 1] || '');
      const ds = findDates(joined.slice(joined.indexOf('(')), defaultYear);
      if (ds.length >= 2) {
        let a = ds[0], b = ds[1];
        if (!a.hasYear && b.hasYear) a = { ...a, iso: a.iso.replace(/^\d{4}/, b.iso.slice(0, 4)) };
        seg = { from: a.iso, to: b.iso };
      }
    }
    const lab = (l.match(RATE_LABEL) || [])[1];
    const kwh = l.match(PENCE_KWH);
    if (kwh && (/unit rate|rate\b|@|\bat\b/i.test(l))) {
      const p = Number(kwh[1]);
      if (p > 1 && p < 200) addRate(rates, { p, label: tidyLabel(lab && !/standard|heating/i.test(lab) ? lab : ''), ...(seg || {}) });
    }
    const day = /standing/i.test(l) && l.match(PENCE_DAY);
    if (day) {
      const p = Number(day[1]);
      if (p > 1 && p < 500) addRate(standing, { p, ...(seg || {}) });
    }
  }
  // A single part needs no dates.
  for (const list of [rates, standing]) if (list.length === 1) { delete list[0].from; delete list[0].to; }
  return { rates, standing };
}

const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gbp = (n) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The month a bill is "for": the month containing the middle of the period.
function billMonth(start, end) {
  const a = Date.parse(start), b = Date.parse(end);
  const mid = new Date((a + b) / 2);
  return `${MON_SHORT[mid.getUTCMonth()]} ${mid.getUTCFullYear()}`;
}

// ---------- Main entry point ----------
export function parseDocument(text, { today = new Date() } = {}) {
  const clean = (text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  const allLines = lines(clean);
  const defaultYear = commonYear(clean, today.getFullYear());
  const sup = detectSupplier(clean);
  const looksEnergy = /\bkwh\b/i.test(clean) && /\b(meter|electricity|gas)\b/i.test(clean) && /\b(bill|statement|tariff|standing charge)\b/i.test(clean);
  const kind = (sup && sup.kind === 'energy') || (!sup && looksEnergy) ? 'bill' : 'receipt';
  const supplier = sup ? sup.name : fallbackSupplier(allLines);
  const reference = pickReference(clean);

  const result = { kind, supplier, reference, date: '', total: null, meter: null, title: '', notes: '', found: {} };

  if (kind === 'bill') {
    const { meter, total } = parseEnergy(allLines, clean, defaultYear);
    result.meter = meter;
    result.total = total;
    result.tariff = parseTariff(allLines, defaultYear);
    // Convention in this logbook: a bill is dated on its closing reading
    // (which is the day after the period ends).
    result.date = meter.closingDate || (meter.periodEnd ? addDays(meter.periodEnd, 1) : pickDate(allLines, defaultYear));
    const month = meter.periodStart && meter.periodEnd ? billMonth(meter.periodStart, meter.periodEnd) : '';
    result.title = `${supplier || 'Energy'} bill${month ? ' ' + month : ''}${total ? ' - ' + gbp(total) : ''}`.replace(' - ', ' – ');
    const bits = [];
    if (meter.periodStart) bits.push(`Period ${ukDate(meter.periodStart)} – ${ukDate(meter.periodEnd)}`);
    if (meter.used != null) bits.push(`Used ${meter.used} kWh`);
    if (meter.opening != null) bits.push(`Readings ${meter.opening} → ${meter.closing} kWh`);
    const tr = result.tariff;
    if (tr.rates.length) bits.push(`Unit rate ${tr.rates.map((r) => `${r.label ? r.label + ' ' : ''}${r.p}p/kWh${r.from && tr.rates.length > 1 ? ' from ' + ukDate(r.from) : ''}`).join(', ')}`);
    if (tr.standing.length) bits.push(`Standing charge ${tr.standing.map((r) => `${r.p}p/day${r.from && tr.standing.length > 1 ? ' from ' + ukDate(r.from) : ''}`).join(', ')}`);
    if (reference) bits.push(`Bill ref ${reference}`);
    result.notes = bits.join('. ') + (bits.length ? '.' : '');
  } else {
    result.total = pickTotal(allLines);
    result.date = pickDate(allLines, defaultYear);
    result.title = `${supplier || 'Receipt'}${reference ? ' order ' + reference : ' receipt'}`;
    result.notes = reference ? `Ref ${reference}` : '';
  }
  result.found = {
    supplier: !!sup,
    date: !!result.date,
    total: result.total != null,
    reading: !!(result.meter && result.meter.closing != null),
  };
  return result;
}

// '2026-07-03' -> '3 Jul 2026'
function ukDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
