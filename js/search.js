// =====================================================================
// search.js — "Ask Hearthbook": on-device search across every entry.
// =====================================================================
// Plain JavaScript with no browser bits, so it's tested with Node
// (tests/search.mjs). Nothing leaves the phone.
//
// It understands a few simple kinds of question:
//   "boiler"                    words anywhere (title, shop, notes, policy…)
//   "bolier" / "fridg"          small typos and unfinished words
//   "January 2025 bill"         month / year words + section words
//   "receipts 2025", "insurance"
//   "when does the car insurance renew?"   → an answer card with the date
//   "when does the fridge warranty expire?"

import { activeDue } from './duestate.js'; // v15.22
import { insKindOf } from './sections.js'; // v16.0
import { titleMonthKey } from './billmonth.js'; // v16.1
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_WORDS = {};
MONTHS.forEach((m, i) => { MONTH_WORDS[m] = i + 1; MONTH_WORDS[m.slice(0, 3)] = i + 1; });
MONTH_WORDS.sept = 9;

// Section words → section id. (Words that are also useful search terms,
// like "electricity", still filter by section: that's what people mean.)
const SECTION_WORDS = {
  bill: 'meter', bills: 'meter', electricity: 'meter', energy: 'meter', meter: 'meter', meters: 'meter', reading: 'meter', readings: 'meter', kwh: 'meter',
  receipt: 'receipt', receipts: 'receipt', bought: 'receipt', purchase: 'receipt', purchases: 'receipt',
  warranty: 'warranty', warranties: 'warranty', guarantee: 'warranty', guarantees: 'warranty',
  insurance: 'insurance', insurances: 'insurance', policy: 'insurance', policies: 'insurance', insured: 'insurance', cover: 'insurance',
  reminder: 'job', reminders: 'job', // v15.1: reminders are stored as jobs
  job: 'job', jobs: 'job', repair: 'job', repairs: 'job', service: 'job', servicing: 'job',
  mortgage: 'mortgage', mortgages: 'mortgage', remortgage: 'mortgage', remortgaging: 'mortgage', // v16.1
};
const QUESTION_WORDS = {
  renew: 'renew', renews: 'renew', renewal: 'renew', renewals: 'renew', renewing: 'renew', renewed: 'renew', // v16.1: "renewals"
  expire: 'expire', expires: 'expire', expiry: 'expire', expiring: 'expire', expired: 'expire', ends: 'expire', end: 'expire',
  due: 'due', overdue: 'overdue', // v16.1: "what's overdue"
};
// v16.1: words that only say "the deal" of a mortgage ("when does my fixed rate end")
const DEAL_WORDS = new Set(['deal', 'deals', 'fixed', 'fix', 'rate', 'term', 'product', 'tracker']);
const PAY_WORDS = new Set(['paid', 'pay', 'pays', 'spent', 'spend', 'spends']);
const STOP = new Set(('when what which whats how much many does do did is are was were the my our a an for of in on at to from by '
  + 'and with show find me i we all any date will it its this that there their your please tell give list '
  // v15.22: "how much did I spend at Screwfix" is about Screwfix, not the word "spend"
  + 'spend spent spending cost costs costing paid pay total money').split(' '));

export function normalise(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’](s|t|re|ve|ll|d)\b/g, '$1') // v16.1: "what’s" = "whats" (was "what" + a stray "s")
    .replace(/&/g, ' and ').replace(/[–—]/g, ' ').replace(/[^a-z0-9£.@\s-]/g, ' ').replace(/(\D)\.|\.(\D)/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

// Split a question into filters + plain words.
export function parseQuery(q, now = new Date(), { sectionWords = true } = {}) {
  const words = normalise(q).replace(/-/g, ' ').split(' ').filter(Boolean);
  const out = { words: [], year: null, month: null, types: [], question: null, payer: null, raw: q };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    // v16.1: who paid ("paid by Sam", "how much did Sam pay", "Sam paid") — the Paid by field only
    if (PAY_WORDS.has(w) && next === 'by' && words[i + 2] && !STOP.has(words[i + 2])) { out.payer = words[i + 2]; i += 2; continue; }
    if (w === 'did' && next && !STOP.has(next) && PAY_WORDS.has(words[i + 2] || '')) { out.payer = next; i += 2; continue; }
    if (next && (next === 'paid' || next === 'pays') && !STOP.has(w) && !MONTH_WORDS[w] && !SECTION_WORDS[w] && !/^\d/.test(w) && i + 2 >= words.length) { out.payer = w; i++; continue; }
    if (/^(19|20)\d\d$/.test(w)) { out.year = Number(w); continue; }
    if (w === 'this' && next === 'year') { out.year = now.getFullYear(); i++; continue; }
    if (w === 'last' && next === 'year') { out.year = now.getFullYear() - 1; i++; continue; }
    // v16.0: "this month" / "last month" (a month and its year)
    if (w === 'this' && next === 'month') { out.year = now.getFullYear(); out.month = now.getMonth() + 1; i++; continue; }
    if (w === 'last' && next === 'month') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); out.year = d.getFullYear(); out.month = d.getMonth() + 1; i++; continue; }
    if (w === 'run' && next === 'out') { out.question = out.question || 'expire'; i++; continue; }
    if (w === 'runs' && next === 'out') { out.question = out.question || 'expire'; i++; continue; }
    if (MONTH_WORDS[w] && !(w === 'may' && i === 0 && words.length > 2)) { out.month = MONTH_WORDS[w]; continue; }
    if (QUESTION_WORDS[w]) { out.question = QUESTION_WORDS[w]; continue; }
    if (sectionWords && SECTION_WORDS[w]) { if (!out.types.includes(SECTION_WORDS[w])) out.types.push(SECTION_WORDS[w]); continue; }
    if (STOP.has(w)) continue;
    out.words.push(w);
  }
  // "when does X renew" is about insurance unless it says otherwise.
  if (sectionWords && out.question === 'renew' && !out.types.length) out.types.push('insurance');
  // v16.1: "when does my deal / fixed rate end" is the mortgage; "deal" isn't a word to match
  if (sectionWords && out.words.some((w) => DEAL_WORDS.has(w)) && (out.types.includes('mortgage') || (out.question === 'expire' && !out.types.length))) {
    out.words = out.words.filter((w) => !DEAL_WORDS.has(w));
    if (!out.types.includes('mortgage')) out.types.push('mortgage');
    if (!out.question) out.question = 'expire';
  }
  if (out.types.includes('mortgage') && out.question === 'renew') out.question = 'expire';
  return out;
}

// Small edit distance, counting a swapped pair of letters as one typo
// ("bolier" → "boiler"). Gives up early once it's clearly too far.
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return false;
  }
  return d[a.length][b.length] <= max;
}

const INS_TYPES = { home: 'home house buildings contents', car: 'car motor vehicle', life: 'life critical illness mortgage', pet: 'pet dog cat', travel: 'travel holiday', gadget: 'gadget phone mobile', other: '' }; // v16.0: pet, travel, gadget
function fieldsOf(e) {
  return {
    title: normalise(e.title),
    other: normalise([e.supplier, e.notes, e.policyNumber, e.covered, e.scanText, e.ocrText, INS_TYPES[insKindOf(e)] || '', e.currency, e.room, e.paidBy].filter(Boolean).join(' ')),
  };
}

// How well does one word match an entry? 0 = not at all.
function wordScore(w, f, cache) {
  const tw = cache.titleWords || (cache.titleWords = f.title.split(' '));
  const ow = cache.otherWords || (cache.otherWords = f.other.split(' '));
  if (tw.includes(w)) return 6;
  if (f.title.includes(w)) return 5;
  if (ow.includes(w)) return 4;
  if (w.length >= 3 && f.other.includes(w)) return 3;
  if (w.length >= 4) {
    const max = w.length >= 8 ? 2 : 1;
    if (tw.some((x) => x.length >= 3 && within(w, x, max))) return 2;
    if (ow.some((x) => x.length >= 3 && within(w, x, max))) return 1;
  }
  return 0;
}

// Month filter: for a bill whose title names its month ("EDF bill Jan
// 2025", dated 3 Feb) that month counts; otherwise the entry's date.
// v16.1: the shared rule (billmonth.js), same as the Drive photo names.
const keyToMY = (k) => (k ? { month: Number(k.slice(5, 7)), year: Number(k.slice(0, 4)) } : null);
function titleMonth(e) { return keyToMY(titleMonthKey(e.title)); }
// v15.22: the month a bill covers, worked out from the readings (stats.js
// coverMonths, passed in as `cover`), so Ask adds up a year's bills the same
// way as the Electricity page; the title's month if there's no cover month.
let coverMap = null;
function billMonth(e) {
  const k = coverMap && coverMap.get(e.id);
  return k ? keyToMY(k) : titleMonth(e);
}
function monthMatches(e, month, year) {
  const tm = e.type === 'meter' ? billMonth(e) : null;
  if (tm) return tm.month === month && (!year || tm.year === year);
  const d = e.date || '';
  return Number(d.slice(5, 7)) === month && (!year || d.startsWith(String(year)));
}

const VERB = { insurance: 'renews', warranty: 'expires', job: 'is due', mortgage: 'deal ends' }; // v16.1: the mortgage deal end

/**
 * search(entries, query, { now, labelOf }) →
 *   { query: parsed, results: [{ entry, score }], fuzzy: bool, answer: null | {...} }
 * answer.kind: 'date'  { entry, verb, date, days }
 *              'nodate' { entry, verb }   (found it, but it has no date)
 *              'none'  { text }
 */
export function search(entries, q, { now = new Date(), sectionWords = true, cover = null } = {}) {
  coverMap = cover;
  const p = parseQuery(q, now, { sectionWords });
  if (!normalise(q)) return { query: p, results: [], fuzzy: false, answer: null };
  const today = isoDay(now);
  const liveList = activeDue(entries);
  const live = new Set(liveList.map((e) => e.id));
  const ofTypes = (list) => (p.types.length ? list.filter((e) => p.types.includes(e.type)) : list);
  const inPeriod = (iso) => Boolean(iso) && (p.year ? iso.startsWith(String(p.year)) : true) && (p.month ? Number(iso.slice(5, 7)) === p.month : true);
  const daysTo = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000); };
  const dateAnswer = (list) => {
    const best = list[0];
    if (!best) return null;
    return { kind: 'date', entry: best, verb: VERB[best.type] || 'is due', date: best.dueDate.slice(0, 10), days: daysTo(best.dueDate), others: list.slice(1, 3) };
  };
  const wordsOk = (e) => { if (!p.words.length) return true; const f = fieldsOf(e), c = {}; return p.words.every((w) => wordScore(w, f, c) >= 3); };

  // v16.1: "paid by Sam", "how much did Sam pay": the Paid by field only (not a word anywhere).
  if (p.payer) {
    const who = (e) => normalise(e.paidBy || '').split(' ').some((w) => w === p.payer || (p.payer.length >= 3 && w.startsWith(p.payer)));
    let pool = ofTypes(entries.filter((e) => e.paidBy && who(e)));
    if (p.year || p.month) pool = pool.filter((e) => (p.month ? monthMatches(e, p.month, p.year) : spendYearOf(e) === p.year));
    pool = pool.filter(wordsOk).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const counted = pool.filter((e) => e.type !== 'insurance' && e.type !== 'mortgage');
    const total = Math.round(counted.reduce((t, e) => t + Math.round((Number(e.cost) || 0) * 100), 0)) / 100;
    const name = pool.length ? String(pool[0].paidBy).trim() : p.payer[0].toUpperCase() + p.payer.slice(1);
    return { query: p, results: pool.map((e) => ({ entry: e, score: 1 })), fuzzy: false, intent: 'payer', answer: { kind: 'payer', name, total, count: counted.length } };
  }

  // v16.1: "what's overdue"
  if (p.question === 'overdue') {
    const list = ofTypes(liveList).filter((e) => e.type !== 'mortgage' && e.dueDate.slice(0, 10) < today && wordsOk(e)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { query: p, results: list.map((e) => ({ entry: e, score: 1 })), fuzzy: false, intent: 'overdue', answer: dateAnswer(list) || { kind: 'none', text: 'Nothing is overdue.' } };
  }

  // v16.1: "what's due this month", "renewals this month", "when does the warranty expire in 2027":
  // only dates that still matter (not dismissed, renewed or ended), in that month/year.
  // For this month, anything overdue comes first (it's due now too).
  if (p.question && (p.month || p.year)) {
    const pool = ofTypes(liveList).filter(wordsOk);
    const thisMonth = p.month === now.getMonth() + 1 && (!p.year || p.year === now.getFullYear());
    const inMonth = pool.filter((e) => inPeriod(e.dueDate)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const late = thisMonth ? pool.filter((e) => e.type !== 'mortgage' && e.dueDate.slice(0, 10) < today && !inMonth.includes(e)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
    const pastIn = inMonth.filter((e) => e.dueDate.slice(0, 10) < today && e.type !== 'mortgage');
    const ordered = [...late, ...pastIn, ...inMonth.filter((e) => !pastIn.includes(e))];
    const overdueCount = late.length + pastIn.length;
    return { query: p, results: ordered.map((e) => ({ entry: e, score: 1 })), fuzzy: false, intent: 'due-period', overdueCount, answer: dateAnswer(ordered) || { kind: 'none', text: `Nothing ${p.question === 'renew' ? 'renews' : p.question === 'expire' ? 'expires' : 'is due'} then.` } };
  }

  // v16.1: "insurance this month": the policies that matter that month (renewing,
  // starting, or paid monthly), current ones only, renewals first.
  if (p.types.length === 1 && p.types[0] === 'insurance' && p.month && !p.question) {
    const y = p.year || now.getFullYear(), mk = `${y}-${String(p.month).padStart(2, '0')}`;
    const sup = new Set(entries.filter((e) => e.type === 'insurance' && !live.has(e.id) && e.dueDate).map((e) => e.id));
    const pol = entries.filter((e) => e.type === 'insurance' && !sup.has(e.id) && !e.policyEnded && wordsOk(e));
    const renew = pol.filter((e) => (e.dueDate || '').startsWith(mk)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const other = pol.filter((e) => !renew.includes(e) && ((e.date || '').startsWith(mk) || (e.costFreq === 'monthly' && (e.date || '') <= `${mk}-31` && (!e.dueDate || e.dueDate.slice(0, 7) >= mk))));
    const list = [...renew, ...other];
    return { query: p, results: list.map((e) => ({ entry: e, score: 1 })), fuzzy: false, intent: 'insurance-month', renewCount: renew.length, monthKey: mk, answer: dateAnswer(renew) };
  }

  let pool = entries;
  if (p.types.length) pool = pool.filter((e) => p.types.includes(e.type));
  if (p.question) {
    // A date question looks at things with a renewal/expiry/due date.
    const dated = pool.filter((e) => VERB[e.type]);
    if (dated.length) pool = dated;
    // v16.1: with no words ("renewals", "what's due"), only dates that still matter.
    if (!p.words.length) {
      const list = pool.filter((e) => live.has(e.id)).sort((a, b) => {
        const la = a.dueDate.slice(0, 10) < today && a.type !== 'mortgage', lb = b.dueDate.slice(0, 10) < today && b.type !== 'mortgage';
        return la !== lb ? (la ? -1 : 1) : a.dueDate.localeCompare(b.dueDate);
      });
      return { query: p, results: list.map((e) => ({ entry: e, score: 1 })), fuzzy: false, intent: 'live-dates', answer: dateAnswer(list) || { kind: 'none', text: 'Nothing with a date coming up.' } };
    }
  }
  if (p.year && !p.question) pool = pool.filter((e) => (p.month ? monthMatches(e, p.month, p.year) : (e.type === 'meter' && billMonth(e) ? monthMatchesAnyInYear(e, p.year) : (e.date || '').startsWith(String(p.year)))));
  else if (p.month && !p.question) pool = pool.filter((e) => monthMatches(e, p.month, null));

  const scored = [];
  const partial = [];
  for (const e of pool) {
    if (!p.words.length) { scored.push({ entry: e, score: 1 }); continue; }
    const f = fieldsOf(e), cache = {};
    const s = p.words.map((w) => wordScore(w, f, cache));
    const total = s.reduce((a, b) => a + b, 0);
    if (s.every((x) => x > 0)) scored.push({ entry: e, score: total, exact: s.every((x) => x >= 3) });
    else if (total > 0) partial.push({ entry: e, score: total });
  }
  const byScore = (a, b) => b.score - a.score || (b.entry.date || '').localeCompare(a.entry.date || '');
  // Prefer exact matches; typo matches only if there are no exact ones.
  let results = scored.filter((r) => r.exact !== false);
  let fuzzy = false, someWords = false;
  if (!results.length && scored.length) { results = scored; fuzzy = true; }
  if (!results.length && partial.length && p.words.length > 1) { results = partial; fuzzy = true; someWords = true; }
  results.sort(byScore);

  let answer = null;
  if (p.question) {
    // Equally good matches: the one coming up soonest first.
    const soon = (r) => { const d = r.entry.dueDate || ''; return d >= today ? d : '9' + d; };
    results.sort((a, b) => b.score - a.score || soon(a).localeCompare(soon(b)));
    // v15.22: a renewed / ended policy or a dismissed date isn't the answer (or an "Also")
    const best = results.find((r) => r.entry.dueDate && live.has(r.entry.id)) || results.find((r) => r.entry.dueDate) || results[0];
    if (!best) answer = { kind: 'none', text: `I couldn’t find ${p.words.length ? `“${p.words.join(' ')}”` : 'anything'} with ${p.question === 'renew' ? 'a renewal' : p.question === 'expire' ? 'an expiry' : 'a due'} date.` };
    else if (!best.entry.dueDate) answer = { kind: 'nodate', entry: best.entry, verb: VERB[best.entry.type] || 'is due' };
    else {
      const others = results.filter((r) => r !== best && r.entry.dueDate && live.has(r.entry.id) && r.score === best.score).slice(0, 2).map((r) => r.entry);
      answer = { kind: 'date', entry: best.entry, verb: VERB[best.entry.type] || 'is due', date: best.entry.dueDate.slice(0, 10), days: daysTo(best.entry.dueDate), others };
    }
  }
  return { query: p, results, fuzzy, someWords, answer };
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The year an entry's cost counts in (a bill: the month it covers).
function spendYearOf(e) {
  const tm = e.type === 'meter' ? billMonth(e) : null;
  return tm ? tm.year : Number((e.date || '').slice(0, 4));
}

function monthMatchesAnyInYear(e, year) {
  const tm = billMonth(e);
  return Boolean(tm && tm.year === year);
}

// Plain English for the answer card ("in 3 weeks", "2 days ago").
// v16.1: the same steps as everywhere else (utils.dueText): days up to 90,
// then "about N months", then "about N years".
export function whenText(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const a = Math.abs(days);
  const span = a >= 730 ? `about ${Math.round(a / 365.25)} years` : a > 90 ? `about ${Math.round(a / 30.44)} months` : `${a} days`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}
