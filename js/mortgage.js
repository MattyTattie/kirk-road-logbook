// =====================================================================
// mortgage.js — the sums behind the Mortgage section (v14.7).
// =====================================================================
// Pure functions (no screen, no database) so they're easy to test.
//
// A mortgage is a few entries of type 'mortgage', each with a `mortgage`
// object (an extra field: older versions keep it untouched):
//   kind 'setup'     – amount borrowed, term, first payment, the starting
//                      deal (rate, payment), the rate after a deal (`svr`:
//                      the lender's follow-on / standard variable rate).
//   kind 'statement' – one annual statement: balance at 31 Dec, opening
//                      balance, current deal (rate, fixed/variable, monthly
//                      payment, deal end, ERC and when ERCs end), the
//                      year's overpayments and interest, any deal switch.
// The deal end of a statement is kept in the entry's dueDate, so the usual
// "Coming up" list and reminders see it (only the latest statement counts).
//
// Money is worked in whole pence. Interest each month = balance × yearly
// rate ÷ 12, rounded to the penny, added on the payment date (how the
// Santander statements work it out). Everything projected is an ESTIMATE.

const p = (x) => Math.round(Number(x) * 100); // £ → pence
const L = (pence) => Math.round(pence) / 100; // pence → £
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isMortgage = (e) => e && e.type === 'mortgage' && e.mortgage && typeof e.mortgage === 'object';
export const setupOf = (entries) => entries.filter((e) => isMortgage(e) && e.mortgage.kind === 'setup').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null;
export const statementsOf = (entries) => entries.filter((e) => isMortgage(e) && e.mortgage.kind === 'statement' && Number(e.mortgage.year) > 1900)
  .sort((a, b) => Number(a.mortgage.year) - Number(b.mortgage.year) || (a.date || '').localeCompare(b.date || ''));
export const latestStatement = (entries) => { const s = statementsOf(entries); return s[s.length - 1] || null; };

// Only the latest statement's deal end counts for Coming up / reminders
// (an older statement of the same deal would repeat it).
// (Without a statement yet, the set-up entry's deal end counts.)
export function supersededIds(entries) {
  const keep = latestStatement(entries) || setupOf(entries);
  return new Set(entries.filter((e) => isMortgage(e) && e !== keep).map((e) => e.id));
}
export const withoutSuperseded = (entries) => { const s = supersededIds(entries); return s.size ? entries.filter((e) => !s.has(e.id)) : entries; };

// Monthly payment for a repayment loan, rounded to the penny.
export function payment(balance, ratePct, months) {
  const i = Number(ratePct) / 1200;
  if (months <= 0) return L(p(balance));
  if (!i) return L(Math.ceil(p(balance) / months));
  return L(p(balance) * i / (1 - (1 + i) ** -months));
}

// ISO date helpers (no time zones: dates are calendar days)
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function addMonths(isoDate, n) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  const yy = Math.floor(t / 12), mm = t % 12 + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return iso(yy, mm, Math.min(d, last));
}
export const monthText = (isoDate) => (isoDate ? `${MON[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}` : '');
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// The rate in force on a day, from the deals listed on the statements
// (each { from, rate, payment, end }). The setup's deal comes first.
export function dealTimeline(entries) {
  const setup = setupOf(entries);
  const out = [];
  if (setup) out.push({ from: setup.date || setup.mortgage.start, rate: Number(setup.mortgage.rate), payment: Number(setup.mortgage.payment), end: setup.mortgage.dealEnd || null, rateType: setup.mortgage.rateType || 'fixed' });
  for (const s of statementsOf(entries)) {
    // typed in by hand (no deals listed): its rate from the end of the
    // previous deal if that was in or before its year, or else 1 January
    const sm = s.mortgage;
    if (!(sm.deals || []).length && Number(sm.rate) > 0) {
      const prev = out[out.length - 1];
      const from = prev && prev.end && prev.end.slice(0, 4) <= String(sm.year) && prev.end > prev.from ? prev.end : `${sm.year}-01-01`;
      if (!out.some((x) => Number(x.rate) === Number(sm.rate) && x.from <= from)) out.push({ from, rate: Number(sm.rate), payment: Number(sm.payment) || null, end: sm.dealEnd || null, rateType: sm.rateType || 'fixed' });
    }
  }
  for (const s of statementsOf(entries)) for (const d of s.mortgage.deals || []) {
    if (!d || !d.from || !(Number(d.rate) > 0)) continue;
    if (out.some((x) => x.from === d.from && Number(x.rate) === Number(d.rate))) continue;
    if (Number(d.days) > 0 && Number(d.days) < 7) continue; // a day or two between deals: left out
    out.push({ from: d.from, rate: Number(d.rate), payment: Number(d.payment) || null, end: d.end || null, rateType: d.rateType || 'fixed' });
  }
  out.sort((a, b) => a.from.localeCompare(b.from));
  // the same rate carried on into a new statement year is not a new deal
  return out.filter((d, i) => i === 0 || d.rate !== out[i - 1].rate);
}
const rateOn = (timeline, day) => { let r = timeline[0] ? timeline[0].rate : 0; for (const d of timeline) if (d.from <= day) r = d.rate; else break; return r; };

// --------------------------------------------------------------------
// The "without overpayments" mortgage: the same loan, same rates and same
// dates, but only the contractual payment. At each deal switch the payment
// is worked out again on ITS balance over the rest of the original term.
// Returns month by month: { date, interest, capital, balance, payment }.
// --------------------------------------------------------------------
export function shadowSchedule(entries, { until = null } = {}) {
  const setup = setupOf(entries);
  if (!setup) return null;
  const m = setup.mortgage;
  const tl = dealTimeline(entries);
  const term = Number(m.termMonths) || 300;
  const first = m.firstPayment || addMonths(setup.date, 1);
  let bal = p(m.amount);
  let pay = p(m.payment || payment(m.amount, m.rate, term));
  const rows = [];
  for (let k = 0; k < term + 600 && bal > 0; k++) {
    const day = addMonths(first, k);
    if (until && day > until) break;
    const rate = rateOn(tl, k ? addMonths(first, k - 1) : setup.date); // the rate for the month before this payment
    // first payment: the interest for the odd days since the loan started (from the statement if known)
    const monthly = Math.round(bal * rate / 1200);
    // first payment: a month's interest plus the odd days since the loan
    // started, paid on top (the statement's figure when we have it)
    const interest = k > 0 ? monthly : Number(m.firstInterest) > 0 ? p(m.firstInterest) : Math.round(bal * rate / 100 * dayDiff(setup.date, day) / 365);
    let cap = pay - monthly;
    if (cap > bal) cap = bal;
    bal -= cap;
    rows.push({ date: day, interest: L(interest), capital: L(cap), balance: L(bal), payment: L(pay) });
    // a new deal starts from this payment: work the payment out again
    const sw = tl.find((d, i) => i > 0 && d.from > (k ? addMonths(first, k - 1) : setup.date) && d.from <= day);
    if (sw && bal > 0) { const left = term - (k + 1); pay = p(payment(L(bal), sw.rate, Math.max(1, left))); }
  }
  return rows;
}
function dayDiff(a, b) { return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000); }
function ymd(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return [y, m - 1, d]; }

// Balance of a schedule at the end of a day, and interest paid up to it.
export function atDate(rows, day, start) {
  let bal = start, interest = 0;
  for (const r of rows) { if (r.date > day) break; bal = r.balance; interest += p(r.interest); }
  return { balance: bal, interest: L(interest) };
}

// --------------------------------------------------------------------
// Real figures per year, from the statements. A year with no statement
// between two that have (closing, then the next one's opening balance) is
// ESTIMATED: the same payment each month plus an equal overpayment each
// month that lands exactly on the next opening balance.
// --------------------------------------------------------------------
export function yearsTable(entries) {
  const setup = setupOf(entries);
  const st = statementsOf(entries);
  const byYear = new Map(st.map((s) => [Number(s.mortgage.year), s]));
  const out = [];
  if (!st.length) return out;
  const firstYear = setup ? Number(setup.date.slice(0, 4)) : Number(st[0].mortgage.year);
  const lastYear = Number(st[st.length - 1].mortgage.year);
  const tl = dealTimeline(entries);
  for (let y = firstYear; y <= lastYear; y++) {
    const s = byYear.get(y);
    if (s) { out.push({ year: y, overpaid: Number(s.mortgage.overpaid) || 0, interest: Number(s.mortgage.interest) || 0, balance: Number(s.mortgage.balance), est: false, id: s.id }); continue; }
    const prev = byYear.get(y - 1), next = byYear.get(y + 1);
    const open = prev ? Number(prev.mortgage.balance) : null, close = next && hasNum(next.mortgage.opening) ? Number(next.mortgage.opening) : null;
    if (open === null || close === null) { out.push({ year: y, overpaid: null, interest: null, balance: null, est: true }); continue; }
    const pay = p(prev.mortgage.payment);
    const run = (x) => { let b = p(open), i = 0; for (let mth = 1; mth <= 12; mth++) { const day = iso(y, mth, 1); const it = Math.round(b * rateOn(tl, day) / 1200); i += it; b -= pay - it + x; } return { b, i }; };
    let lo = 0, hi = p(open);
    for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; if (run(mid).b > p(close)) lo = mid; else hi = mid; }
    const x = (lo + hi) / 2, r = run(x);
    out.push({ year: y, overpaid: L(x * 12), interest: L(r.i), balance: close, est: true });
  }
  return out;
}
const hasNum = (v) => v !== null && v !== undefined && v !== '' && isFinite(Number(v));

// Months to pay a balance off (and the last payment date) with a monthly
// payment + overpayment at a rate. null if it never would.
export function payoff(balance, ratePct, monthly, extra = 0, firstDay) {
  let b = p(balance); const pay = p(monthly) + p(extra);
  let n = 0, interest = 0;
  while (b > 0 && n < 1200) { const i = Math.round(b * ratePct / 1200); if (pay <= i) return null; interest += i; b -= Math.min(b, pay - i); n++; }
  return { months: n, last: firstDay ? addMonths(firstDay, n - 1) : null, interest: L(interest) };
}

// --------------------------------------------------------------------
// Everything the Mortgage page shows. now = today (for the reminders).
// --------------------------------------------------------------------
export function summary(entries) {
  const setup = setupOf(entries);
  const st = statementsOf(entries);
  const latest = st[st.length - 1] || null;
  if (!setup && !latest) return null;
  const m = latest ? latest.mortgage : setup.mortgage;
  const asAt = latest ? latest.date : setup.date;
  const balance = latest ? Number(m.balance) : Number(setup.mortgage.amount);
  const deal = { rate: Number(m.rate), rateType: m.rateType || 'fixed', payment: Number(m.payment), end: m.dealEnd || null, erc: hasNum(m.erc) ? Number(m.erc) : null, ercUntil: m.ercUntil || null };
  const svr = setup && hasNum(setup.mortgage.svr) ? Number(setup.mortgage.svr) : null;
  const years = yearsTable(entries);
  // balance over time: the start, each statement's opening (= last year's close) and close
  const points = [];
  if (setup) points.push({ date: setup.date, balance: Number(setup.mortgage.amount) });
  for (const s of st) {
    const y = Number(s.mortgage.year);
    if (hasNum(s.mortgage.opening) && !st.some((o) => Number(o.mortgage.year) === y - 1)) points.push({ date: iso(y - 1, 12, 31), balance: Number(s.mortgage.opening), fromOpening: true });
    points.push({ date: s.date || iso(y, 12, 31), balance: Number(s.mortgage.balance) });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  // the shadow loan
  let shadow = null;
  const rows = setup ? shadowSchedule(entries) : null;
  if (rows && rows.length) {
    const at = atDate(rows, asAt, Number(setup.mortgage.amount));
    const realInterest = years.reduce((t, y) => t + p(y.interest || 0), 0);
    const realKnown = years.every((y) => y.interest !== null);
    shadow = {
      balance: at.balance, interest: at.interest,
      owesLess: L(p(at.balance) - p(balance)),
      interestSaved: realKnown ? L(p(at.interest) - realInterest) : null,
      realInterest: L(realInterest),
      mortgageFree: rows[rows.length - 1].date,
      payment: rows.filter((r) => r.date <= asAt).slice(-1)[0]?.payment ?? null,
      points: points.map((pt) => ({ date: pt.date, balance: pt.date < (rows[0] && rows[0].date) ? Number(setup.mortgage.amount) : atDate(rows, pt.date, Number(setup.mortgage.amount)).balance })),
      totalInterest: L(rows.reduce((t, r) => t + p(r.interest), 0)),
    };
  }
  // projections from the latest balance (rate stays as now: an estimate)
  // the first payment after the statement date (same day of the month as the first payment)
  const firstAfter = (() => { const d = setup && setup.mortgage.firstPayment ? Number(setup.mortgage.firstPayment.slice(8, 10)) : 3; return addMonths(iso(Number(asAt.slice(0, 4)), Number(asAt.slice(5, 7)), d), 1); })();
  const extra = latest && hasNum(m.lastOverpay) ? Number(m.lastOverpay) : 0;
  const contractual = payoff(balance, deal.rate, deal.payment, 0, firstAfter);
  const pace = extra > 0 ? payoff(balance, deal.rate, deal.payment, extra, firstAfter) : contractual;
  const originalEnd = setup ? addMonths(setup.mortgage.firstPayment || addMonths(setup.date, 1), (Number(setup.mortgage.termMonths) || 300) - 1) : null;
  return {
    setup, latest, asAt, balance, deal, svr, years, points, shadow,
    extra, contractual, pace, originalEnd, firstAfter,
    // the whole loan at this pace against the whole shadow loan (estimate)
    lifetimeSaved: shadow && pace && shadow.interestSaved !== null ? L(p(shadow.totalInterest) - p(shadow.realInterest) - p(pace.interest)) : null,
    // after the deal ends, on the rate after a deal: the balance then (contractual
    // payments only from the statement) over the months left
    svrPayment: (() => {
      if (!svr || !contractual || !deal.end) return null;
      let b = p(balance), n = 0;
      for (let day = firstAfter; day <= deal.end && b > 0; day = addMonths(firstAfter, ++n)) b -= p(deal.payment) - Math.round(b * deal.rate / 1200);
      return contractual.months - n > 0 ? payment(L(b), svr, contractual.months - n) : null;
    })(),
    reminders: deal.end ? reminderDates(deal.end) : [],
    termLeft: m.termLeft || null,
  };
}

// Deal-end reminders: 6, 3 and 1 month before the deal ends.
export const REMINDER_MONTHS = [6, 3, 1];
export const reminderDates = (end) => REMINDER_MONTHS.map((n) => ({ months: n, date: addMonths(end, -n) }));

// --------------------------------------------------------------------
// Santander annual mortgage statement → fields (text from the PDF).
// Returns null if the text isn't one.
// --------------------------------------------------------------------
const money = (s) => (s ? Number(String(s).replace(/[£,\s]/g, '')) : null);
const ukDate = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const MONTHS_RE = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function isMortgageStatement(text) {
  return /annual mortgage statement|mortgage account summary statement/i.test(text || '') && /loan\(?s?\)?\s+summary statement|transaction summary statement/i.test(text || '');
}
export function parseMortgageStatement(text) {
  if (!isMortgageStatement(text)) return null;
  // the statement pages only: the guide after them has made-up example figures
  const all = String(text).replace(/\r/g, '');
  const tx0 = Math.max(0, all.search(/transaction summary statement/i));
  const cut = all.slice(tx0).search(/Mortgage Loan Balance[^\n]*\n|Government Mortgage Charter|What your statement shows/i);
  const end = cut >= 0 ? tx0 + cut + (all.slice(tx0 + cut).match(/^Mortgage Loan Balance[^\n]*\n/i) || [''])[0].length : all.length;
  const t = all.slice(0, end);
  const lender = /santander/i.test(t) ? 'Santander' : (/(nationwide|halifax|barclays|natwest|lloyds|hsbc|virgin money|coventry|skipton|tsb)/i.exec(t) || [])[1] || '';
  const year = Number((/(\d{4})\s+mortgage account summary statement/i.exec(t) || /annual (?:mortgage )?statement for (\d{4})/i.exec(t) || /statement for (\d{4})/i.exec(t) || [])[1]) || null;
  const started = (() => { const m = /Date your mortgage started\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(t); return m && MONTHS_RE[m[2].slice(0, 3).toLowerCase()] ? iso(Number(m[3]), MONTHS_RE[m[2].slice(0, 3).toLowerCase()], Number(m[1])) : null; })();
  const balance = money((/Total mortgage outstanding\s+£\s?([\d,]+\.\d\d)/i.exec(t) || [])[1]);
  const total = money((/Total monthly payment\s+£\s?([\d,]+\.\d\d)/i.exec(t) || [])[1]);
  // loan blocks: "Loan 1" / "Loan 01" … up to the next one
  const loans = [];
  const parts = t.split(/\n\s*Loan\s+0?(\d+)\s+Loan product details/i);
  for (let i = 1; i < parts.length; i += 2) {
    const b = parts[i + 1].split(/Early repayment charges \(ERC\)|\n\s*Loan\s+0?\d+\s+Loan product details/i)[0];
    const g = (re) => (re.exec(b) || [])[1];
    const charged = [...b.matchAll(/Interest rate charged from (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4}) - ([\d.]+)%/g)].map((x) => ({ from: ukDate(x[1]), to: ukDate(x[2]), rate: Number(x[3]) }));
    loans.push({
      n: Number(parts[i]),
      outstanding: money(g(/Amount outstanding\s+£\s?([\d,]+\.\d\d)/i)),
      payment: money(g(/Monthly payment\s+£\s?([\d,]+\.\d\d)/i)),
      rate: Number(g(/Interest rate\s+([\d.]+)%/i)) || null,
      rateType: (g(/Interest rate type\s+(Fixed|Variable|Tracker)/i) || '').toLowerCase() || null,
      end: ukDate(g(/Product end date\s+(\d{2}\/\d{2}\/\d{4})/i)),
      ercUntil: ukDate(g(/charges apply until\s+(\d{2}\/\d{2}\/\d{4})/i)),
      erc: money(g(/Early repayment charges\s+£\s?([\d,]+\.\d\d)/i)),
      termLeft: (g(/Term remaining\s+(\d+\s+yrs?\s+\d+\s+months?)/i) || '').replace(/\s+/g, ' ') || null,
      charged,
    });
  }
  const live = loans.filter((l) => (l.outstanding || 0) > 0);
  const cur = live[live.length - 1] || loans[loans.length - 1] || {};
  // transactions
  const tx = t.slice(t.search(/transaction summary statement/i));
  const sum = (re) => [...tx.matchAll(re)].reduce((s, x) => s + Math.round(money(x[1]) * 100), 0) / 100;
  const interest = sum(/Interest due\s+([\d,]+\.\d\d)/gi);
  const overList = [...tx.matchAll(/Transfer overpay to cap\.?\s*rec\.?\s+([\d,]+\.\d\d)/gi)].map((x) => money(x[1]));
  const overpaid = Math.round(overList.reduce((s, v) => s + v * 100, 0)) / 100;
  const opening = money((/Opening Balance\s+([\d,]+\.\d\d)/i.exec(tx) || [])[1]);
  const advance = money((/Loan Advance to Borrower\s+([\d,]+\.\d\d)/i.exec(tx) || [])[1]);
  const closing = money((/Mortgage Loan Balance\s+([\d,]+\.\d\d)/i.exec(tx) || [])[1]);
  const firstInterest = (() => { const x = /(\d{2}) ([A-Z][a-z]{2}) (\d{4})\s+Interest due\s+([\d,]+\.\d\d)/.exec(tx); return x ? { date: iso(Number(x[3]), MONTHS_RE[x[2].toLowerCase()], Number(x[1])), amount: money(x[4]) } : null; })();
  // deals during the year, in date order (from the "Interest rate charged" lines)
  const deals = [];
  for (const l of loans) for (const c of l.charged) {
    const days = dayDiff(c.from, c.to) + 1;
    const isCur = l === cur && c === l.charged[l.charged.length - 1];
    deals.push({ from: c.from, to: c.to, rate: c.rate, days, ...(isCur ? { payment: cur.payment, end: cur.end, rateType: cur.rateType } : {}) });
  }
  deals.sort((a, b) => a.from.localeCompare(b.from) || b.days - a.days);
  return {
    lender, year, started, balance: hasNum(closing) ? closing : balance, monthly: total || cur.payment || null,
    rate: cur.rate || null, rateType: cur.rateType || null, dealEnd: cur.end || null, ercUntil: cur.ercUntil || null, erc: hasNum(cur.erc) ? cur.erc : null,
    termLeft: cur.termLeft || null, interest: Math.round(interest * 100) / 100, overpaid, lastOverpay: overList.length ? overList[overList.length - 1] : 0,
    opening: hasNum(opening) ? opening : null, advance: hasNum(advance) ? advance : null, firstInterest, deals, loans: loans.length,
  };
}

// Statement fields → the entry's mortgage object.
export function statementFromParsed(x) {
  return {
    kind: 'statement', year: x.year, balance: x.balance, opening: x.opening, payment: x.monthly, rate: x.rate, rateType: x.rateType || 'fixed',
    dealEnd: x.dealEnd, ercUntil: x.ercUntil, erc: x.erc, termLeft: x.termLeft, overpaid: x.overpaid, interest: x.interest, lastOverpay: x.lastOverpay,
    deals: x.deals.map((d) => ({ from: d.from, rate: d.rate, days: d.days, ...(d.payment ? { payment: d.payment, end: d.end, rateType: d.rateType } : {}) })),
  };
}
