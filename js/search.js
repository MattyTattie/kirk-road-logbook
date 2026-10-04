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
  job: 'job', jobs: 'job', repair: 'job', repairs: 'job', service: 'job', servicing: 'job',
};
const QUESTION_WORDS = {
  renew: 'renew', renews: 'renew', renewal: 'renew', renewing: 'renew', renewed: 'renew',
  expire: 'expire', expires: 'expire', expiry: 'expire', expiring: 'expire', expired: 'expire', ends: 'expire', end: 'expire',
  due: 'due',
};
const STOP = new Set(('when what which whats how much many does do did is are was were the my our a an for of in on at to from by '
  + 'and with show find me i we all any date will it its this that there their your please tell give list').split(' '));

export function normalise(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[–—]/g, ' ').replace(/[^a-z0-9£.@\s-]/g, ' ').replace(/(\D)\.|\.(\D)/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

// Split a question into filters + plain words.
export function parseQuery(q, now = new Date(), { sectionWords = true } = {}) {
  const words = normalise(q).replace(/-/g, ' ').split(' ').filter(Boolean);
  const out = { words: [], year: null, month: null, types: [], question: null, raw: q };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    if (/^(19|20)\d\d$/.test(w)) { out.year = Number(w); continue; }
    if (w === 'this' && next === 'year') { out.year = now.getFullYear(); i++; continue; }
    if (w === 'last' && next === 'year') { out.year = now.getFullYear() - 1; i++; continue; }
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

const INS_TYPES = { home: 'home house buildings contents', car: 'car motor vehicle', life: 'life critical illness mortgage', other: '' };
function fieldsOf(e) {
  return {
    title: normalise(e.title),
    other: normalise([e.supplier, e.notes, e.policyNumber, e.covered, e.scanText, e.ocrText, INS_TYPES[e.insType] || '', e.currency, e.room].filter(Boolean).join(' ')),
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
function titleMonth(e) {
  const t = normalise(e.title || '').split(' ');
  for (let i = 0; i < t.length; i++) if (MONTH_WORDS[t[i]] && /^\d{4}$/.test(t[i + 1] || '')) return { month: MONTH_WORDS[t[i]], year: Number(t[i + 1]) };
  return null;
}
function monthMatches(e, month, year) {
  const tm = e.type === 'meter' ? titleMonth(e) : null;
  if (tm) return tm.month === month && (!year || tm.year === year);
  const d = e.date || '';
  return Number(d.slice(5, 7)) === month && (!year || d.startsWith(String(year)));
}

const VERB = { insurance: 'renews', warranty: 'expires', job: 'is due' };

/**
 * search(entries, query, { now, labelOf }) →
 *   { query: parsed, results: [{ entry, score }], fuzzy: bool, answer: null | {...} }
 * answer.kind: 'date'  { entry, verb, date, days }
 *              'nodate' { entry, verb }   (found it, but it has no date)
 *              'none'  { text }
 */
export function search(entries, q, { now = new Date(), sectionWords = true } = {}) {
  const p = parseQuery(q, now, { sectionWords });
  if (!normalise(q)) return { query: p, results: [], fuzzy: false, answer: null };
  let pool = entries;
  if (p.types.length) pool = pool.filter((e) => p.types.includes(e.type));
  if (p.question) {
    // A date question looks at things with a renewal/expiry/due date.
    const dated = pool.filter((e) => VERB[e.type]);
    if (dated.length) pool = dated;
  }
  if (p.year && !p.question) pool = pool.filter((e) => (p.month ? monthMatches(e, p.month, p.year) : (e.type === 'meter' && titleMonth(e) ? monthMatchesAnyInYear(e, p.year) : (e.date || '').startsWith(String(p.year)))));
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
  let fuzzy = false;
  if (!results.length && scored.length) { results = scored; fuzzy = true; }
  if (!results.length && partial.length && p.words.length > 1) { results = partial; fuzzy = true; }
  results.sort(byScore);

  let answer = null;
  if (p.question) {
    // Equally good matches: the one coming up soonest first.
    const soon = (r) => { const d = r.entry.dueDate || ''; return d >= now.toISOString().slice(0, 10) ? d : '9' + d; };
    results.sort((a, b) => b.score - a.score || soon(a).localeCompare(soon(b)));
    const best = results.find((r) => r.entry.dueDate) || results[0];
    if (!best) answer = { kind: 'none', text: `I couldn’t find ${p.words.length ? `“${p.words.join(' ')}”` : 'anything'} with ${p.question === 'renew' ? 'a renewal' : p.question === 'expire' ? 'an expiry' : 'a due'} date.` };
    else if (!best.entry.dueDate) answer = { kind: 'nodate', entry: best.entry, verb: VERB[best.entry.type] || 'is due' };
    else {
      const [y, m, d] = best.entry.dueDate.slice(0, 10).split('-').map(Number);
      const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      const others = results.filter((r) => r !== best && r.entry.dueDate && r.score === best.score).slice(0, 2).map((r) => r.entry);
      answer = { kind: 'date', entry: best.entry, verb: VERB[best.entry.type] || 'is due', date: best.entry.dueDate.slice(0, 10), days, others };
    }
  }
  return { query: p, results, fuzzy, answer };
}

function monthMatchesAnyInYear(e, year) {
  const tm = titleMonth(e);
  return Boolean(tm && tm.year === year);
}

// Plain English for the answer card ("in 3 weeks", "2 days ago").
export function whenText(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const a = Math.abs(days);
  const span = a < 14 ? `${a} days` : a < 60 ? `${Math.round(a / 7)} weeks` : a < 730 ? `${Math.round(a / 30.44)} months` : `${Math.round(a / 365.25)} years`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}
