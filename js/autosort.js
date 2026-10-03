// =====================================================================
// autosort.js — which section does a scanned document belong in? (v12)
// =====================================================================
// After a scan that isn't an energy bill, we look at the words the reader
// found and pick Receipt, Warranty or Job. The form opens in that section
// with a "File under" switch so you can change it in one tap.
//
//   warranty / guarantee / register your product / "2 year" …  → Warranty
//   labour / fitted / installed / service / work carried out … → Job
//   receipt / invoice / total / VAT / card / change …          → Receipt
//
// Shops print "guarantee" and "returns" small print on ordinary till
// receipts, so a Warranty or Job needs clearly more evidence than the
// receipt words; when in doubt it's a Receipt (the safe default).

const RULES = {
  warranty: [
    [/\b(warranty|guarantee)\s+(certificate|card|registration|confirmation|period|cover|details)\b/i, 3],
    [/\bregist(er|ration|ered)\b[^.\n]{0,40}\b(product|appliance|warranty|guarantee)\b|\b(product|appliance)\s+registration\b/i, 3],
    [/\b(\d{1,2}|one|two|three|five|ten)[\s-]*(year|yr)s?\b[^.\n]{0,25}\b(warranty|guarantee|parts\s+(and|&)\s+labour)\b/i, 3],
    [/\b(warranty|guarantee)\b[^.\n]{0,25}\b(\d{1,2}|one|two|three|five|ten)[\s-]*(year|yr)s?\b/i, 3],
    [/\b(valid|covered)\s+(until|to|from)\b|\bexpiry\s+date\b|\bexpires?\s+on\b/i, 2],
    [/\bserial\s*(no|number|#)?\b/i, 1],
    [/\bwarrant(y|ies)\s+(type|length|starts?|details|information)\b|\byour\s+(product\s+)?(warranty|warranties|guarantee)\b/i, 2],
    [/\bwarrant(y|ies)\b/i, 1],
    [/\bguarantee[ds]?\b/i, 1],
  ],
  job: [
    [/\blabou?r\b/i, 3],
    [/\bwork\s+(carried\s+out|done|completed)\b|\bworks?\s+description\b/i, 3],
    [/\b(supply\s+(and|&)\s+fit|supplied\s+(and|&)\s+fitted|fitted|fitting)\b/i, 2],
    [/\b(installed|installation|install)\b/i, 2],
    [/\b(sweep|swept|sweeping)\b/i, 2],
    [/\b(call[\s-]?out|engineer|technician|plumber|electrician|joiner|roofer)\b/i, 2],
    [/\b(service[ds]?|servicing|repair(ed|s)?|replaced|annual\s+check|inspection|eicr|gas\s+safe)\b/i, 1],
    [/\b(\d+(\.\d+)?)\s*(hrs?|hours)\b/i, 1],
  ],
  receipt: [
    [/\breceipt\b/i, 2],
    [/\b(tax\s+)?invoice\b/i, 1],
    [/\bsub[\s-]?total\b|\btotal\b/i, 1],
    [/\bvat\b|\bvat\s+(no|reg)\b/i, 1],
    [/\b(visa|mastercard|contactless|debit|credit\s+card|card\s+payment|chip\s*&?\s*pin|cash|change\s+due|tendered)\b/i, 2],
    [/\bthank\s+you\s+for\s+(shopping|your\s+(order|purchase|custom))\b/i, 2],
    [/\b(qty|quantity|item|items)\b/i, 1],
    [/\b(order\s+(no|number|confirmation)|dispatch|delivered)\b/i, 1],
  ],
};

function score(text, rules) {
  let s = 0;
  const hits = [];
  for (const [re, w] of rules) if (re.test(text)) { s += w; hits.push(re.source.slice(0, 30)); }
  return { s, hits };
}
// A document that keeps saying "warranty" is about the warranty.
function repeats(text) {
  const n = (String(text).match(/\b(warrant(y|ies)|guarantee[sd]?)\b/gi) || []).length;
  return n >= 4 ? 3 : 0;
}

/** → { type: 'receipt' | 'warranty' | 'job', scores, years } */
export function classify(text) {
  const t = String(text || '');
  const w = score(t, RULES.warranty); w.s += repeats(t);
  const j = score(t, RULES.job), r = score(t, RULES.receipt);
  const scores = { warranty: w.s, job: j.s, receipt: r.s };
  let type = 'receipt';
  // Clear winner needed: strong evidence and more than the receipt words
  // (a till receipt can easily score 5-7 on its own).
  if (w.s >= 4 && w.s >= j.s && w.s >= r.s - 1) type = 'warranty';
  else if (j.s >= 3 && j.s >= r.s - 2) type = 'job';
  return { type, scores, years: warrantyYears(t) };
}

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
/** "2 year guarantee" / "warranty: 5 years" → 2 / 5 (or 0). */
export function warrantyYears(text) {
  const t = String(text || '');
  const m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|ten)[\s-]*(year|yr)s?\b[^.\n]{0,25}\b(warranty|guarantee)/i)
    || t.match(/\b(?:warranty|guarantee)\b[^.\n]{0,25}?\b(\d{1,2}|one|two|three|four|five|six|seven|ten)[\s-]*(?:year|yr)s?\b/i);
  if (!m) return 0;
  const n = NUM[m[1].toLowerCase()] || Number(m[1]);
  return n > 0 && n <= 25 ? n : 0;
}

/** ISO date + whole years (29 Feb → 28 Feb). */
export function addYears(iso, n) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !n) return '';
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
