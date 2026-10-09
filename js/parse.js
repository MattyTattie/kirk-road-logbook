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
//     currency: 'GBP' | 'EUR' | 'USD'  // what the amounts are in (holiday receipts)
//     items: [{ name, qty, price }]    // receipt lines, when they can be read
//     contactEmail                     // the seller's contact email (v13.5), also put in notes
//     company                          // the legal seller when it differs, e.g. 'Lampenwelt GmbH'
//     vehicleTax: { reg, months, amount } // DVLA vehicle tax confirmations (v13.5)
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
  // v13.5: lights.co.uk invoices come from Lampenwelt GmbH (Germany).
  { name: 'lights.co.uk', kind: 'shop', re: /\blights\.co\.uk\b|\blampenwelt\b/i, company: { name: 'Lampenwelt GmbH', re: /\blampenwelt\s+gmbh\b/i } },
  // v13.5: DVLA vehicle tax confirmations (emails / screenshots).
  { name: 'DVLA', kind: 'gov', re: /\bDVLA\b|\bgov\.uk\/vehicle-tax\b/i },
];

// ---------- Dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Spanish (holiday receipts): enero, abril, agosto, diciembre (the rest start the same as English)
  ene: 1, abr: 4, ago: 8, dic: 12 };
// OCR often reads O as 0 ("0ct") and l as 1 ("Ju1"), so month names allow those.
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|ju[l1](?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|[o0]ct(?:ober)?|nov(?:ember)?|dec(?:ember)?|ene(?:ro)?|febrero|marzo|abr(?:il)?|mayo|junio|julio|ago(?:sto)?|sept?iembre|octubre|noviembre|dic(?:iembre)?)\\.?';
const DMY_WORDS = new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+|de\\s+)?${MON}\\s*,?\\s*(?:de\\s+)?(\\d{4}|\\d{2}\\b)?`, 'gi');
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
  // 2026-07-30 (card terminals often print ISO dates)
  for (const m of text.matchAll(/\b(20\d\d)-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (validDate(y, mo, d)) out.push({ iso: iso(y, mo, d), index: m.index, end: m.index + m[0].length, hasYear: true });
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
// "€9.50" and "9,50 €" too; with { comma: true } (euro receipts) a bare
// "11,90" is 11.90. Long digit runs (barcodes like 7622400008948) never count.
const MONEY = /(-)?\s?[£€]\s?(-)?\s?(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))(?!\d)|(?<![\d.,£€])(-)?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?![\d%])/g;
// v13.5: "GBP 167,65" / "EUR 9,50" / "200.00 GBP" count like "£167,65".
export function findAmounts(line, { comma = false } = {}) {
  const out = [];
  line = codesToSymbols(line);
  if (comma) line = line.replace(/(?<![\d.,])(\d{1,4}),(\d{2})(?![\d,.])/g, '$1.$2');
  for (const m of line.matchAll(MONEY)) {
    if (/\d{8,}/.test(line.slice(Math.max(0, m.index - 8), m.index + m[0].length + 1).replace(/[.,]/g, ''))) continue;
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

const SYM_OF = { GBP: '£', EUR: '€' };
function codesToSymbols(line) {
  return line
    .replace(/\b(GBP|EUR)\s?(?=-?\d)/g, (m, c) => SYM_OF[c])
    .replace(/(?<![\d.,])(\d[\d.,]*[.,]\d{2})\s?(GBP|EUR)\b/g, (m, n, c) => SYM_OF[c] + n);
}

// European number style ("167,65", "1.234,56")? Then a comma before the
// last two digits is the decimal point, even on a pounds invoice (v13.5:
// lights.co.uk / Lampenwelt print "Total incl. VAT GBP 167,65").
export function europeanNumbers(text) {
  const t = codesToSymbols(text);
  const eu = (t.match(/[£€]\s?-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d.,])|(?<![\d.,])\d{1,3}(?:\.\d{3})*,\d{2}\s?[£€]/g) || []).length;
  const uk = (t.match(/[£€]\s?-?\d{1,3}(?:,\d{3})*\.\d{2}(?![\d.,])|(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}\s?[£€]/g) || []).length;
  return eu > 0 && eu > uk;
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
// v13.5: "Contact:", "Contact person", "Customer service" are labels, not the seller.
const NOT_A_NAME = /\bcontact\b|\bkontakt\b|ansprechpartner|customer\s+service|kundenservice|^[\w .'-]{1,25}:\s*$|\b\d+[a-z]?\s+[a-z]+\s+(?:road|rd|street|st|avenue|ave|lane|drive|close|way|crescent|terrace|place|court|gardens)\b|address|united kingdom|^(mr|mrs|ms|miss|dr)\b|\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b|invoice|receipt|statement|page \d|smell gas|power cut|tel\b|phone|e-?mail|www\.|https?:|@|order|customer|account|vat|date|total|bill to|deliver|ship|^your\b|^\W*$|comunitario|factura|\bfact\b|ticket|datos|vuelo|extranjero|\biva\b|cliente|tarjeta|art[ií]culos|descrip|precio|cantidad|unidad/i;

function fallbackSupplier(allLines) {
  // A line that looks like a company ("… Ltd", "… Limited") near the top…
  const company = companyName(allLines);
  if (company) return company;
  // …otherwise the first prominent line that isn't an address or boilerplate.
  for (const l of allLines.slice(0, 6)) {
    const name = tidyName(l);
    const letters = (name.match(/[A-Za-z]/g) || []).length;
    if (letters >= 4 && letters / name.length > 0.75 && name.length <= 40 && !NOT_A_NAME.test(name) && !repeats(name)) return name;
  }
  return '';
}
// The legal seller printed near the top: "Wren Kitchens Ltd", "Lampenwelt GmbH".
function companyName(allLines) {
  // v14.2: "A Share & Sons Ltd T/A ScS" -> the shop is ScS (the name you know
  // it by); the legal company goes in the notes (see legalCompany).
  for (const l of allLines.slice(0, 25)) {
    // (drop a heading from the next column first: "T/A ScS Salesperson:")
    const ta = l.replace(/\s+[A-Za-z]+:.*$/, '').match(/\b(?:Ltd|LTD|Limited|LIMITED|LLP|plc|PLC)\.?\s+(?:T\/A|t\/a|trading\s+as)\s+([A-Z][A-Za-z0-9&'’.\-]*(?:\s[A-Z][A-Za-z0-9&'’.\-]*){0,3})/);
    if (ta) return tidyName(ta[1]);
  }
  for (const l of allLines.slice(0, 25)) {
    const m = l.match(/([A-Z][A-Za-z&'’.\- ]{2,60}?\s(?:Ltd|LTD|Limited|LIMITED|LLP|plc|PLC))\b/) ||
      // European companies: "… S.L.", "… SA", "… GmbH", "… SRL", "… B.V."
      l.match(/^([A-Z][A-Za-z&'’.\- ]{5,60}?)[\s,]+(?:S\.?L\.?U?|S\.?A\.?|GmbH|S\.?R\.?L\.?|S\.?A\.?S\.?|B\.?V\.?|Lda)\.?$/) ||
      // "Lampenwelt GmbH · Rudolf-Diesel-Str. 6 · …" (a sender line on a German invoice)
      l.match(/^([A-Z][A-Za-z&'’.\- ]{2,60}?\s(?:GmbH|AG|KG|B\.V\.|S\.A\.|S\.L\.))\s*[·•|,\-–]/);
    if (m && !/trading name|registered|reg\.? office|customers ltd/i.test(l) && !/\bcontact\b/i.test(m[1])) return tidyName(m[1]);
  }
  return '';
}

// v14.2: the legal company behind a trading name ("A Share & Sons Ltd" T/A ScS).
function legalCompany(allLines) {
  for (const l of allLines.slice(0, 25)) {
    const m = l.match(/([A-Z][A-Za-z&'’.\- ]{2,60}?\s(?:Ltd|LTD|Limited|LIMITED|LLP|plc|PLC))\.?\s+(?:T\/A|t\/a|trading\s+as)\b/);
    if (m) return tidyName(m[1]);
  }
  return '';
}

// ---------- Contact email (v13.5) ----------
// The seller's email, e.g. "E-mail: info@lights.co.uk", for the notes.
// Never a personal address (that's usually yours, printed as the customer),
// and never a do-not-reply one.
const PERSONAL_MAIL = /@(?:g(?:oogle)?mail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet|sky|virginmedia|talktalk|protonmail)\./i;
export function findContactEmail(text, supplier = '') {
  const found = [];
  // v14.2: the customer's own (work) address printed in "Sell to" / "Deliver
  // to", e.g. "Miss Jane Doe … Email: jane.doe@example-nhs.org".
  const surnames = [...String(text || '').matchAll(/\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+\s+([A-Z][a-z]{2,})\b/g)].map((m) => m[1].toLowerCase());
  for (const m of String(text || '').matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    const mail = m[0].replace(/\.$/, '');
    if (PERSONAL_MAIL.test(mail) || /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon)@/i.test(mail)) continue;
    if (surnames.some((n) => mail.split('@')[0].toLowerCase().includes(n))) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    let score = 0;
    if (/contact|customer|service|support|help|e-?mail|kontakt|questions?/i.test(before)) score += 2;
    if (/^(?:info|hello|help|support|service|customer|contact|sales|orders?|enquiries|kundenservice)/i.test(mail)) score += 1;
    const dom = mail.split('@')[1].toLowerCase();
    const sup = supplier.toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (sup && (dom.includes(sup.replace(/\.(?:co\.uk|com|uk)$/, '')) || sup.includes(dom.split('.')[0]))) score += 2;
    found.push({ mail, score, index: m.index });
  }
  found.sort((a, b) => b.score - a.score || a.index - b.index);
  return found.length ? found[0].mail : '';
}

// ---------- DVLA vehicle tax (v13.5) ----------
// Confirmation emails / screenshots: "Vehicle registration number: W123 BEX",
// "Amount GBP 200.00", "Tax period 12 months", "08/06/2026".
// Current plates "AB12 CDE", older "W123 BEX" (prefix) and "ABC 123D" (suffix).
const PLATE = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}\s?[A-Z])\b/;
export function parseVehicleTax(allLines, text) {
  if (!/\bDVLA\b|vehicle\s+tax|tax(?:ed|ing)?\s+your\s+vehicle|\bV5C\b/i.test(text)) return null;
  if (!/vehicle\s+tax|\btax(?:ed|ing)?\b/i.test(text)) return null;
  let reg = '';
  // Prefer a plate on (or just after) a "registration" line.
  for (let i = 0; i < allLines.length && !reg; i++) {
    if (!/regist(?:ration|ered)|\breg\b|number plate|vehicle\s*(?:no|number)?\s*:/i.test(allLines[i])) continue;
    const m = (allLines[i].replace(/^.*?(?:number|mark|plate|reg(?:istration)?)\b\s*:?/i, '') + ' ' + (allLines[i + 1] || '')).toUpperCase().match(PLATE);
    if (m) reg = m[1];
  }
  if (!reg) { const m = text.match(PLATE); if (m) reg = m[1]; }
  reg = reg.replace(/\s+/g, '');
  // Show it the way it's printed on the plate: "W123BEX" -> "W123 BEX".
  if (reg) reg = reg.replace(/^([A-Z]{2}[0-9]{2}|[A-Z][0-9]{1,3})([A-Z]{3})$/, '$1 $2').replace(/^([A-Z]{3})([0-9]{1,3}[A-Z])$/, '$1 $2');
  const per = text.match(/\b(6|12|six|twelve)[\s-]*months?\b/i);
  const months = per ? ({ six: 6, twelve: 12 }[per[1].toLowerCase()] || Number(per[1])) : (/\bmonthly\b/i.test(text) ? 1 : 0);
  let amount = null;
  for (const l of allLines) {
    if (!/amount|total|paid|payment|cost|charge|price|£|GBP/i.test(l) || /refund/i.test(l)) continue;
    const a = findAmounts(l).filter((x) => x.value > 0);
    if (a.length) { amount = a[a.length - 1].value; if (/amount|total|paid/i.test(l)) break; }
  }
  const startM = text.match(/(?:tax(?:ed)?|starts?|valid|from)\b[^\n]{0,30}?\b(?:on|from)?\s*(\d{1,2}\s*(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i);
  const start = startM ? (findDates(startM[1])[0] || {}).iso || '' : '';
  return { reg, months, amount, start };
}
// "Jane Smith Jane Smith" = a two-column address block, not a shop.
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
    /\b(date|fecha|datum|data)\b/i,
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

// Lines that say what was actually paid: the card slip ("CANTIDAD TOTAL:
// 11,90", "IMPORTE: 11,90", "AMOUNT: £23.50") and the card line
// ("PLANET MASTERCARD 11.90", "VISA DEBIT £23.50"). OCR mangles
// "CANTIDAD" a lot ("CANTI0AD", "BANTIDAD", "EANTIOHD"), so it's loose.
const PAID = /\b(?:\w{0,3}ant\w{0,4}\s*total|\w{0,6}[a4][d0o]\s+total\s*:|importe(?:\s+total)?|total\s+a\s+pagar|a\s+pagar|total\s+pagado|amount|total\s+paid|amount\s+paid|paid|pagado|montant|betrag)\b\s*:?|\b(?:master\s*car[dlu]|visa(?:\s+debit)?|maestro|amex|american\s+express|debit\s+card|credit\s+card|card\s+payment|contactless|apple\s+pay|google\s+pay|tarjeta|efectivo|cash)\b/i;
const NOT_PAID = /tipo\s+de|type|moneda|currency|change|cambio|cashback|\bpan\b|aid\b|auth|number|no\.|saving|discount|descuento/i;
const DISCOUNT = /-\s?[£€]?\s?\d+[.,]\d{2}\b|\b(?:discount|descuento|dto\.?|promo(?:ci[oó]n)?|offer|oferta|saving|you saved|ahorro|\d\s*(?:for|x|por)\s*[£€]?\d+[.,]\d{2})\b/i;

// What did you actually pay? The amount on the card/payment lines, checked
// against the "Total" lines: on a receipt with an offer the first "Total"
// is before the discount ("Total EUR 19.00", "2 for 11.90 -7.10",
// "Total EUR 11.90"), so prefer the paid amount, and otherwise the LAST
// total after a discount.
function pickPaid(allLines, opts) {
  const paid = [], totals = [];
  let lastDiscount = -1;
  allLines.forEach((l, i) => {
    if (DISCOUNT.test(l)) lastDiscount = i;
    const m = l.match(PAID);
    if (m && !NOT_PAID.test(l.slice(0, m.index + m[0].length + 2))) {
      const a = findAmounts(l.slice(m.index), opts).filter((x) => x.value > 0);
      if (a.length) paid.push({ i, value: a[a.length - 1].value });
    }
    const t = l.match(/\btota[l1\]|]\b/i);
    if (t && !/sub\s?-?tota|tota[l1]\s*(?:vat|tax|iva|net|ex\b|excl|savings?|discount)/i.test(l)) {
      const a = findAmounts(l.slice(t.index), opts).filter((x) => x.value > 0);
      if (a.length) totals.push({ i, value: a[a.length - 1].value });
    }
  });
  if (paid.length) {
    // Candidates: the paid amounts, and any total after a discount. The
    // winner is the amount printed most often on the receipt (the final
    // total, the card line, the card slip and the offer all repeat it; an
    // OCR slip like "1.30" for "11.90" appears just once). Ties: paid lines
    // first, then the later line.
    const seen = new Map();
    for (const l of allLines) for (const a of findAmounts(l, opts)) seen.set(a.value, (seen.get(a.value) || 0) + 1);
    const cands = [...paid.map((c) => ({ ...c, paid: 1 })), ...totals.filter((t) => lastDiscount >= 0 && t.i > lastDiscount).map((c) => ({ ...c, paid: 0 }))];
    const key = (c) => [seen.get(c.value) || 0, c.paid, c.i];
    const better = (a, b) => { const x = key(a), y = key(b); for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k]; return false; };
    let best = cands[0];
    for (const c of cands) if (better(c, best)) best = c;
    return { value: best.value, how: 'paid' };
  }
  if (totals.length > 1 && lastDiscount > totals[0].i) {
    const after = totals.filter((t) => t.i > lastDiscount);
    if (after.length) return { value: after[after.length - 1].value, how: 'last-total' };
  }
  // Only the pre-offer total survived OCR, but the offer says it all:
  // "Total 19.00" + "2 for 11.90" + exactly two items adding up to 19.00 -> 11.90.
  const offer = allLines.join('\n').match(/\b(\d)\s*(?:for|x|por)\s*[£€]?\s?(\d+[.,]\d{2})/i);
  if (offer && totals.length) {
    const items = parseItems(allLines, opts), n = items.reduce((a, it) => a + it.qty, 0), sum = round2(items.reduce((a, it) => a + it.price, 0));
    const p = Number(offer[2].replace(',', '.')), t = totals[totals.length - 1].value;
    if (n === Number(offer[1]) && Math.abs(sum - t) < 0.01 && p < t) return { value: p, how: 'offer' };
  }
  return null;
}

function pickTotal(allLines, opts = {}) {
  if (opts.foreign) {
    const p = pickPaid(allLines, opts);
    if (p) return p.value;
  }
  const EXCLUDE = /sub\s?-?total|total\s*(?:vat|tax|goods|net|ex\b|excl|before|savings?|discount|of other credits|shipping)|vat\s*total|net\s*total|price before|save:|you saved|shipping charges/i;
  const tiers = [
    /\b(grand total|order total|total paid|amount paid|total price|total invoice|invoice total|total payable|total due|total to pay|gross total|total amount|total \(?inc(?:l|luding)?\.? vat\)?|amount \(?inc(?:l|luding)?\.? vat\)?|amount due|balance due|balance to pay)\b/i,
    /\btotal\b/i,
    /\b(balance|amount)\b/i,
  ];
  for (const re of tiers) {
    const cands = [];
    allLines.forEach((l, i) => {
      const m = l.match(re);
      if (!m || EXCLUDE.test(l.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12))) return;
      if (/last bill|previous balance|opening balance|balance on your last/i.test(l)) return;
      let amts = findAmounts(l.slice(m.index), opts);
      if (!amts.length && re === tiers[0] && allLines[i + 1]) {
        // v14.2: a table heading ("Amount Excl. VAT  VAT Amount  Amount Incl. VAT")
        // with the figures on the next line: take the figure in the same column.
        amts = findAmounts(allLines[i + 1], opts);
        if (amts.length > 1 && m.index > 0) {
          const pos = (m.index + m[0].length / 2) / l.length, next = allLines[i + 1];
          amts = [...amts].sort((a, b) => Math.abs(a.index / next.length - pos) - Math.abs(b.index / next.length - pos));
        }
      }
      if (amts.length) cands.push(amts[0].value);
    });
    const pos = cands.filter((v) => v > 0);
    if (pos.length) return Math.max(...pos);
  }
  // Last resort: the biggest £ amount on the page.
  const all = allLines.flatMap((l) => findAmounts(l, opts).filter((a) => a.pound && a.value > 0).map((a) => a.value));
  if (all.length) return Math.max(...all);
  // v14.2: no £ signs at all (ScS prints "1,450.00"): the amount printed most
  // often, if it's there at least 3 times (item, total, incl. VAT, …); ties -> the biggest.
  const seen = new Map();
  for (const l of allLines) for (const a of findAmounts(l, opts)) if (a.value > 0) seen.set(a.value, (seen.get(a.value) || 0) + 1);
  const rep = [...seen].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return rep.length ? rep[0][0] : null;
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

// ---------- Holiday receipts: currency, airports, item lines ----------
// Which currency are the amounts in? Whichever is mentioned most; pounds
// when nothing else is (so every UK document stays exactly as before).
export function detectCurrency(text) {
  // "MONEDA DE TRANSACCION: EUR", "Currency: EUR", "Transaction currency EUR"
  const said = text.match(/\b(?:moneda|divisa|currency|devise|w[äa]hrung|transacci[oó]n|transaction)\b[^\n]{0,25}?\b(GBP|EUR|USD)\b/i);
  if (said) return said[1].toUpperCase();
  const n = (re) => (text.match(re) || []).length;
  const gbp = n(/£|\bGBP\b/g), eur = n(/€|\bEUR\b|\beuros?\b/gi), usd = n(/\bUSD\b|US\$/g);
  if (eur > gbp && eur >= usd) return 'EUR';
  if (usd > gbp) return 'USD';
  return 'GBP';
}

// Airports you're likely to fly from on holiday (IATA code -> name).
const AIRPORTS = {
  LPA: 'Gran Canaria', TFS: 'Tenerife South', TFN: 'Tenerife North', ACE: 'Lanzarote', FUE: 'Fuerteventura', SPC: 'La Palma',
  AGP: 'Malaga', ALC: 'Alicante', PMI: 'Palma', IBZ: 'Ibiza', MAH: 'Menorca', BCN: 'Barcelona', MAD: 'Madrid', VLC: 'Valencia',
  SVQ: 'Seville', REU: 'Reus', GRO: 'Girona', LEI: 'Almeria', FAO: 'Faro', LIS: 'Lisbon', OPO: 'Porto', FNC: 'Madeira',
  DLM: 'Dalaman', AYT: 'Antalya', BJV: 'Bodrum', HER: 'Heraklion', CHQ: 'Chania', RHO: 'Rhodes', CFU: 'Corfu', KGS: 'Kos',
  ZTH: 'Zante', ATH: 'Athens', LCA: 'Larnaca', PFO: 'Paphos', MLA: 'Malta', DBV: 'Dubrovnik', SPU: 'Split', NCE: 'Nice',
  CDG: 'Paris Charles de Gaulle', AMS: 'Amsterdam', FCO: 'Rome', NAP: 'Naples', VCE: 'Venice', MXP: 'Milan', PRG: 'Prague',
  BUD: 'Budapest', KRK: 'Krakow', DUB: 'Dublin', KEF: 'Reykjavik', GVA: 'Geneva', SZG: 'Salzburg', INN: 'Innsbruck',
  EDI: 'Edinburgh', GLA: 'Glasgow', ABZ: 'Aberdeen', INV: 'Inverness', MAN: 'Manchester', LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted',
};
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// "Datos del vuelo: LS 0716 > LPA (ES) > EDI (GB)", "AEROPUERTO DE GRAN
// CANARIA", "Gatwick Airport" -> { shop: 'Gran Canaria Airport shop', flight }
function airportInfo(text) {
  let from = '', to = '', flight = '';
  const route = text.match(/\b([A-Z]{3})\s*(?:\(\s*[A-Z]{2}\s*\))?\s*(?:>|->|→)\s*([A-Z]{3})\b/);
  if (route && (AIRPORTS[route[1]] || AIRPORTS[route[2]])) {
    [, from, to] = route;
    const before = text.slice(Math.max(0, route.index - 40), route.index);
    const f = before.match(/\b([A-Z0-9]{2})\s?(\d{3,4})\b[^\n]*$/);
    if (f) flight = `${f[1]}${f[2]}`;
  }
  let place = AIRPORTS[from] || '';
  if (!place) {
    const m = text.match(/\baeropuerto\s+(?:de\s+)?([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i) || text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+airport\b/);
    if (m) {
      const words = m[1].replace(/\s+(?:de|del|la|las|los)$/i, '');
      const known = Object.values(AIRPORTS).find((n) => n.toLowerCase() === words.toLowerCase());
      place = known || (/^[\p{L} ]{3,30}$/u.test(words) ? titleCase(words) : '');
    }
  }
  // OCR garbles small print ("AEROPUERTO DE GRAN 1 ANARTA"): look for an
  // airport name with up to 2 wrong letters (not UK ones - that's where
  // you're flying to).
  const airporty = /\b(aeropuerto|aeroporto|a[ée]roport|airport|flughafen|duty\s*free|datos del vuelo|vuelo|flight|boarding)\b|\(\s*GB\s*\)/i.test(text);
  if (!place && airporty) {
    const up = text.toUpperCase().replace(/[^A-Z]/g, '');
    for (const [code, name] of Object.entries(AIRPORTS)) {
      const n = name.toUpperCase().replace(/[^A-Z]/g, '');
      if (n.length < 7 || ['EDI', 'GLA', 'ABZ', 'INV', 'MAN', 'LHR', 'LGW', 'STN'].includes(code)) continue;
      for (let i = 0; i + n.length <= up.length && !place; i++) if (up[i] === n[0] && editDistance(up.slice(i, i + n.length), n) <= (n.length >= 10 ? 2 : 1)) place = name;
      if (place) break;
    }
  }
  if (!place && !flight) return airporty ? { shop: 'Airport shop', flight: '' } : null;
  return { shop: place ? `${place} Airport shop` : 'Airport shop', flight: flight ? `${flight}${from ? ' ' + from + ' → ' + to : ''}` : (from ? `${from} → ${to}` : '') };
}

const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

// Item lines between the column headings ("Descripcion … Precio",
// "Description Qty Price") and the first total. A description may have
// its numbers on the next line(s), as on this airport receipt:
//   I 2359935001 MILKA CHOCO SWI
//   7622400008948                  <- barcode (EAN), ignored
//   0.00   1   9.50   9.50          <- IVA, quantity, unit price, price
// Repeated items (even if OCR spelt them slightly differently) are added up.
export function parseItems(allLines, opts = {}) {
  const head = allLines.findIndex((l, i) => /\b(descrip\w*|description|item|art[ií]culos?)\b/i.test(l) && /\b(precio|price|importe|amount|qty|cantidad|cant\.?)\b/i.test(allLines.slice(i, i + 3).join(' ')));
  if (head < 0) return [];
  const items = [];
  let pending = '';
  for (let i = head + 1; i < allLines.length; i++) {
    const l = allLines[i];
    if (/\btota[l1\]|]\b|subtotal|\bsuma\b/i.test(l)) break;
    if (/^\s*(?:iva|vat|cantidad|qty|precio|price|ean|unidad)\b/i.test(l)) continue;
    const amts = findAmounts(l, opts);
    const text = l.replace(/\b\d{4,}\b/g, ' ').replace(/^\s*[A-Z0-9]\s+/, ' ').replace(/[£€]?\s?-?\d+[.,]\d{2}\b/g, ' ').replace(/[^\p{L}&'\- ]/gu, ' ').replace(/\s+/g, ' ').trim();
    const words = text.split(' ').filter((w) => w.length >= 2);
    if (words.length && (text.match(/\p{L}/gu) || []).length >= 4 && !amts.length) { pending = text; continue; }
    if (!amts.length) continue;
    const name = words.length && (text.match(/\p{L}/gu) || []).length >= 4 ? text : pending;
    if (!name) continue;
    const price = amts[amts.length - 1].value;
    if (price <= 0) { pending = ''; continue; }
    const ints = l.replace(/\d+[.,]\d{2}/g, ' ').match(/(?<![\d.,])\d{1,2}(?![\d.,])/g);
    let qty = ints ? Number(ints[ints.length - 1]) : 1;
    if (amts.length >= 2) { const unit = amts[amts.length - 2].value; if (unit > 0 && Math.abs(unit * Math.round(price / unit) - price) < 0.01) qty = Math.round(price / unit); }
    if (!(qty >= 1 && qty <= 99)) qty = 1;
    items.push({ name: titleCase(name).slice(0, 60), qty, price: round2(price) });
    pending = '';
  }
  const merged = [];
  for (const it of items) {
    const same = merged.find((m) => Math.abs(m.price / m.qty - it.price / it.qty) < 0.005 && editDistance(m.name.toLowerCase(), it.name.toLowerCase()) <= 2);
    if (same) { same.qty += it.qty; same.price = round2(same.price + it.price); } else merged.push({ ...it });
  }
  return merged.length <= 20 ? merged : [];
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
  const currency = kind === 'bill' ? 'GBP' : detectCurrency(clean);
  const foreign = currency !== 'GBP';
  // (only for receipts in another currency: UK documents behave as before)
  const airport = kind === 'receipt' && foreign ? airportInfo(clean) : null;
  const supplier = sup ? sup.name : (airport && airport.shop) || fallbackSupplier(allLines);
  const reference = pickReference(clean);
  // v13.5: the seller's legal name when it isn't the shop name ("Lampenwelt
  // GmbH" behind lights.co.uk; only for shops we know, because the first
  // "… Ltd" on a page is often the CUSTOMER's business), and their contact
  // email, both for the notes.
  const company = kind === 'receipt' && sup && sup.company && sup.company.re.test(clean) ? sup.company.name : (kind === 'receipt' && !sup ? legalCompany(allLines) : '');
  const companyGuess = kind === 'receipt' && !sup && supplier && supplier === companyName(allLines);
  const contactEmail = kind === 'receipt' ? findContactEmail(clean, supplier) : '';
  const vehicleTax = kind === 'receipt' ? parseVehicleTax(allLines, clean) : null;

  const result = { kind, supplier: vehicleTax ? 'DVLA' : supplier, reference, date: '', total: null, currency, items: [], meter: null, title: '', notes: '', found: {} };
  if (company) result.company = company;
  if (contactEmail) result.contactEmail = contactEmail;

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
    // Comma decimals for euro receipts, and (v13.5) for pounds invoices
    // printed European-style ("GBP 167,65").
    const opts = { foreign, comma: currency === 'EUR' || europeanNumbers(clean) };
    result.total = pickTotal(allLines, opts);
    result.date = pickDate(allLines, defaultYear);
    result.title = `${supplier || 'Receipt'}${reference ? ' order ' + reference : ' receipt'}`;
    const bits = [];
    if (vehicleTax) {
      // DVLA: "Vehicle tax W123 BEX – 12 months", the amount actually paid.
      if (vehicleTax.amount != null) result.total = vehicleTax.amount;
      const months = vehicleTax.months ? (vehicleTax.months === 1 ? 'monthly' : `${vehicleTax.months} months`) : '';
      result.title = ['Vehicle tax', vehicleTax.reg].filter(Boolean).join(' ') + (months ? ` – ${months}` : '');
      result.vehicleTax = vehicleTax;
      bits.push(['DVLA vehicle tax', vehicleTax.reg, months, result.total != null ? fmt(result.total, 'GBP') : ''].filter(Boolean).join(', '));
      if (vehicleTax.start) bits.push(`Tax starts ${ukDate(vehicleTax.start)}`);
    }
    if (foreign) {
      const card = (clean.match(/\b(master\s*car[dlu]|visa|maestro|amex|american express)\b/i) || [])[1];
      bits.push(`Paid ${fmt(result.total, currency)} (${currency})${card ? ' by ' + (/master/i.test(card) ? 'Mastercard' : titleCase(card)) : ''}`);
      result.items = parseItems(allLines, opts);
      if (result.items.length) bits.push('Items: ' + result.items.map((it) => `${it.qty > 1 ? it.qty + ' × ' : ''}${it.name} ${it.qty > 1 ? '(' + fmt(it.price / it.qty, currency) + ' each)' : fmt(it.price, currency)}`).join(', '));
      const off = allLines.map((l) => findAmounts(l, opts).filter((a) => a.value < 0)).flat();
      if (off.length) bits.push(`Discount ${off.map((a) => '−' + fmt(-a.value, currency)).join(', ')}`);
      if (airport && airport.flight) bits.push(`Flight ${airport.flight}`);
    }
    if (reference) bits.push(`Ref ${reference}`);
    if (company) bits.push(`Sold by ${company}`);
    if (contactEmail) bits.push(`Contact ${contactEmail}`);
    result.notes = bits.join('. ') + ((foreign || vehicleTax || company || contactEmail) && bits.length ? '.' : '');
  }
  result.found = {
    // v13.5: a company line ("… Ltd", "… GmbH") or a DVLA confirmation counts
    // too, so the Supplier box is tinted rather than flagged as missing.
    supplier: !!sup || !!companyGuess || !!vehicleTax,
    date: !!result.date,
    total: result.total != null,
    reading: !!(result.meter && result.meter.closing != null),
  };
  return result;
}

const SYMBOL = { GBP: '£', EUR: '€', USD: '$' };
const fmt = (v, cur) => (v == null ? '?' : `${SYMBOL[cur] || cur + ' '}${Number(v).toFixed(2)}`);

// '2026-07-03' -> '3 Jul 2026'
function ukDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
