// =====================================================================
// mortgageui.js — the Mortgage page's overview (v14.7).
// =====================================================================
// Above the list of statements: the balance (with a small chart), the
// current deal, overpayments and interest per year, and when it'll be paid
// off. The sums are in mortgage.js. The "Without overpayments" switch (this
// phone only, like "After EDF credits") swaps the balance, the chart and the
// mortgage-free date for the same mortgage with no overpayments: an
// estimate, and always labelled as one.

import { el, fill, money, niceDate, daysUntil } from './utils.js';
import { icon } from './icons.js';
import * as prefs from './prefs.js';
import * as M from './mortgage.js';

const pounds = (v) => money(Math.round(v)).replace(/\.\d\d$/, '');
const monthsText = (n) => { const y = Math.floor(n / 12), m = n % 12; return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 months'; };
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const longMonth = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
function inTime(iso) {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d < 0) return 'ended';
  if (d <= 31) return d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`;
  const m = Math.round(d / 30.44);
  return m >= 24 ? `in about ${Math.round(d / 365.25)} years` : `in ${m} months`;
}

// Balance over time: the real line, and the shadow one (dashed) when shown.
export function balanceChart(points, shadowPoints = null) {
  const W = 340, H = 150, top = 16, bottom = 22, left = 6, right = 8;
  const all = [...points, ...(shadowPoints || [])];
  const t = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const t0 = Math.min(...all.map((p) => t(p.date))), t1 = Math.max(...all.map((p) => t(p.date)));
  const vmax = Math.max(...all.map((p) => p.balance)), vmin = Math.min(...all.map((p) => p.balance));
  const lo = Math.floor((vmin - (vmax - vmin) * 0.25) / 1000) * 1000, hi = Math.ceil((vmax + (vmax - vmin) * 0.12) / 1000) * 1000; // room above the first point for the labels
  const x = (d) => left + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - left - right);
  const y = (v) => top + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - top - bottom);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg mortgage-chart" role="img" aria-label="Balance: ${points.map((p) => `${niceDate(p.date)} ${money(p.balance)}`).join('; ')}${shadowPoints ? `. Without overpayments (estimate): ${shadowPoints.map((p) => `${niceDate(p.date)} ${money(p.balance)}`).join('; ')}` : ''}">`;
  for (const v of [hi, (hi + lo) / 2]) svg += `<line x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="chart-grid"/><text x="2" y="${(y(v) - 3).toFixed(1)}" text-anchor="start" class="chart-axis">${pounds(v).replace(/,\d{3}$/, 'k')}</text>`;
  svg += `<line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" class="chart-base"/>`;
  const years = [...new Set(all.map((p) => p.date.slice(0, 4)))];
  for (const yr of years) { const d = `${yr}-12-31`; if (t(d) <= t1 && t(d) >= t0) svg += `<text x="${Math.min(W - 14, x(d)).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="chart-axis">${yr}</text>`; }
  if (shadowPoints) svg += `<path d="${path(shadowPoints)}" class="mortgage-line shadow"/>` + shadowPoints.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.balance).toFixed(1)}" r="3" class="mortgage-dot shadow"/>`).join('');
  svg += `<path d="${path(points)}" class="mortgage-line"/>` + points.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.balance).toFixed(1)}" r="3.4" class="mortgage-dot"/>`).join('');
  const box = el('div', { class: 'mortgage-chart-box', id: 'mortgage-chart' });
  box.innerHTML = svg + '</svg>';
  return box;
}

// "2 Mar · 2 Jun · 2 Aug 2027" (the year once when they're all in it)
function reminderText(list) {
  const same = list.every((r) => r.date.slice(0, 4) === list[0].date.slice(0, 4));
  return same ? `${list.map((r) => niceDate(r.date).replace(/ \d{4}$/, '')).join(' · ')} ${list[0].date.slice(0, 4)}` : list.map((r) => niceDate(r.date)).join(' · ');
}
const cash = (v) => (Number(v) % 1 ? money(v) : pounds(v)); // £222, £533.29

const row = (label, value, id, note) => el('div', { class: 'mrow', id }, el('span', { class: 'mrow-k' }, label), el('span', { class: 'mrow-v' }, value, note ? el('small', {}, note) : null));

// v14.8: "What if" boxes in the Mortgage-free card. Try a different monthly
// overpayment and/or a one-off payment; nothing is saved.
function whatIfBox(s) {
  const d = s.deal;
  const thisYear = Number(s.asAt.slice(0, 4));
  const already = s.latest && s.latest.mortgage.partial && Number(s.latest.mortgage.year) === thisYear ? Number(s.latest.mortgage.overpaid) || 0 : 0;
  const now = s.pace; // today's plan
  const monthly = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', id: 'whatif-monthly', value: String(s.extra || 0) });
  const lump = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '100', id: 'whatif-lump', placeholder: '0' });
  // the month the one-off goes in (payment days from the next one, 5 years ahead)
  const opts = Array.from({ length: 60 }, (_, k) => M.addMonths(s.firstAfter, k));
  const pick = (iso) => opts.find((o) => o >= iso) || opts[0];
  const defWhen = pick(d.end || s.firstAfter);
  const when = el('select', { id: 'whatif-date' }, opts.map((o) => el('option', { value: o, selected: o === defWhen }, M.monthText(o))));
  const out = el('div', { class: 'whatif-out', id: 'whatif-result', 'aria-live': 'polite' });
  const num = (i) => Math.max(0, Number(i.value) || 0);
  const update = () => {
    const extra = num(monthly), l = num(lump);
    const plan = { balance: s.balance, rate: d.rate, payment: d.payment, extra, firstDay: s.firstAfter, lump: l, lumpDate: l ? when.value || s.firstAfter : null };
    const r = M.whatIf(plan);
    if (!r) { fill(out, el('p', { class: 'small' }, 'That wouldn’t pay it off.')); return; }
    const diff = monthsBetween(r.last, now.last); // + = sooner
    const saved = Math.round((now.interest - r.interest) * 100) / 100;
    const same = diff === 0 && Math.abs(saved) < 1;
    const warn = M.overAllowance({ ...plan, ercUntil: d.ercUntil || d.end, alreadyThisYear: already, thisYear });
    fill(out,
      el('div', { class: 'mrow', id: 'whatif-free' }, el('span', { class: 'mrow-k' }, 'Mortgage-free'), el('span', { class: 'mrow-v' }, longMonth(r.last),
        el('small', { id: 'whatif-months' }, same ? 'same as now' : diff > 0 ? `${monthsText(diff)} sooner than now` : diff < 0 ? `${monthsText(-diff)} later than now` : 'same month as now'))),
      same ? null : el('div', { class: 'mrow', id: 'whatif-interest' }, el('span', { class: 'mrow-k' }, saved >= 0 ? 'Interest saved' : 'Extra interest'),
        el('span', { class: 'mrow-v' + (saved >= 0 ? ' good' : ' bad') }, pounds(Math.abs(saved)), el('small', {}, 'compared with now'))),
      warn.length ? el('p', { class: 'whatif-warn', id: 'whatif-warn' }, icon('alert', 16), el('span', {},
        warn.map((w) => `${w.year}: ${pounds(w.total)} overpaid, more than the usual 10% a year (about ${pounds(w.allowed)}).`).join(' '),
        ' Santander may charge an early repayment charge on the extra, so check with them first.')) : null,
      el('p', { class: 'small muted' }, `Just trying it out: nothing is saved. Now: ${cash(s.extra || 0)} a month extra, mortgage-free ${longMonth(now.last)}.`));
  };
  for (const i of [monthly, lump, when]) { i.addEventListener('input', update); i.addEventListener('change', update); }
  const reset = el('button', { type: 'button', class: 'btn link-btn', id: 'whatif-reset', onclick: () => { monthly.value = String(s.extra || 0); lump.value = ''; when.value = defWhen; update(); } }, 'Reset');
  update();
  return el('div', { class: 'whatif', id: 'whatif' },
    el('h3', { class: 'whatif-title' }, 'What if…', reset),
    el('label', { class: 'whatif-field' }, el('span', {}, 'Overpay each month (£)'), monthly),
    el('div', { class: 'whatif-pair' },
      el('label', { class: 'whatif-field' }, el('span', {}, 'One-off payment (£)'), lump),
      el('label', { class: 'whatif-field' }, el('span', {}, 'Paid in'), when)),
    out);
}

export function overview(everything) {
  const s = M.summary(everything);
  const wrap = el('div', { class: 'mortgage-overview', id: 'mortgage-overview' });
  if (!s) {
    fill(wrap, el('section', { class: 'card', id: 'mortgage-empty' },
      el('h2', { class: 'card-title' }, 'Your mortgage'),
      el('p', { class: 'small muted' }, 'Scan an annual statement (Scan → choose the PDF) or tap + to add one. Add the set-up too (amount, term and first deal) to see what your overpayments have saved.')));
    return wrap;
  }
  const sh = s.shadow;
  const asAtText = `at ${niceDate(s.asAt)}${s.source ? ` (${s.source})` : ''}`; // v14.8: "(online banking)" for a part-year update

  const draw = () => {
    const on = Boolean(sh) && prefs.withoutOverpayOn();
    const sw = sh ? el('label', { class: 'credit-switch', id: 'without-overpay-row' },
      el('input', { type: 'checkbox', role: 'switch', id: 'without-overpay', checked: on, onchange: (ev) => { prefs.setWithoutOverpay(ev.currentTarget.checked); draw(); } }),
      el('span', {}, 'Without overpayments')) : null;

    // 1. Balance
    const balance = el('section', { class: 'card mortgage-card', id: 'mortgage-balance' },
      el('div', { class: 'mcard-head' }, el('span', { class: 'stat-label' }, icon('key', 16), 'Balance'), sw),
      el('p', { class: 'mortgage-big', id: 'mortgage-balance-value' }, money(on ? sh.balance : s.balance), on ? el('small', { class: 'est-tag' }, 'estimate') : null),
      el('p', { class: 'small muted', id: 'mortgage-asat' }, on ? `Without overpayments, ${asAtText}. Real balance ${money(s.balance)}.` : asAtText),
      on ? el('p', { class: 'overpay-saved', id: 'overpay-saved' }, icon('sparkle', 16),
        el('span', {}, `You owe ${money(sh.owesLess)} less`, sh.interestSaved !== null ? ` and save ${money(sh.interestSaved)} interest` : '', ' thanks to overpayments',
          el('small', {}, ` (estimate, to ${niceDate(s.asAt)})`))) : null,
      s.points.length > 1 ? balanceChart(s.points, on ? sh.points : null) : null,
      on ? el('p', { class: 'chart-legend', id: 'mortgage-legend' }, el('i', { class: 'lg-real' }), 'With overpayments', el('i', { class: 'lg-shadow' }), 'Without (estimate)') : null);

    // 2. Current deal
    const d = s.deal;
    const deal = el('section', { class: 'card mortgage-card', id: 'mortgage-deal' },
      el('h2', { class: 'card-title' }, 'Current deal'),
      el('div', { class: 'mrows' },
        row('Rate', `${d.rate}% ${d.rateType || 'fixed'}`, 'deal-rate'),
        row('Monthly payment', money(d.payment), 'deal-payment', s.extra ? `+ ${cash(s.extra)} overpayment a month` : null),
        d.end ? row('Deal ends', niceDate(d.end), 'deal-end', inTime(d.end)) : null,
        d.erc !== null ? row('Early repayment charge', money(d.erc), 'deal-erc', `at ${niceDate(s.asAt)}`)
          : s.knownErc ? row('Early repayment charge', money(s.knownErc.erc), 'deal-erc', `at ${niceDate(s.knownErc.date)}, the last one we have (online banking doesn’t show it)`) : null,
        d.ercUntil ? row('ERCs end', niceDate(d.ercUntil), 'deal-erc-until') : null,
        s.svr ? row('After the deal', `${s.svr}% variable`, 'deal-svr', s.svrPayment ? `about ${money(s.svrPayment)} a month if you don’t switch (estimate)` : null) : null,
        s.reminders.length ? el('a', { class: 'mrow mrow-link', id: 'deal-reminders', href: '#/upcoming/mortgage', 'aria-label': `Reminders: ${reminderText(s.reminders)}. Open Coming up` },
          el('span', { class: 'mrow-k' }, 'Reminders'), el('span', { class: 'mrow-v' }, reminderText(s.reminders), el('small', {}, '6, 3 and 1 month before · see all ›'))) : null));

    // 3. Overpayments and interest per year
    const yrs = s.years;
    const anyEst = yrs.some((y) => y.est);
    const sum = (k) => yrs.reduce((t, y) => t + Math.round((y[k] || 0) * 100), 0) / 100;
    const years = yrs.length ? el('section', { class: 'card mortgage-card', id: 'mortgage-years' },
      el('h2', { class: 'card-title' }, 'Overpayments and interest'),
      el('table', { class: 'mtable' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Year'), el('th', {}, 'Overpaid'), el('th', {}, 'Interest'))),
        el('tbody', {}, [...yrs].reverse().map((y) => el('tr', { 'data-year': String(y.year), class: y.est ? 'est' : '' }, // v14.8: newest first
          el('td', {}, String(y.year), y.partial ? el('small', {}, ' so far') : null, y.est ? el('small', {}, ' est.') : null),
          el('td', {}, y.overpaid === null ? '—' : money(y.overpaid)),
          el('td', {}, y.interest === null ? '—' : money(y.interest)))),
        el('tr', { class: 'mtotal' }, el('td', {}, 'Total'), el('td', { id: 'overpaid-total' }, money(sum('overpaid'))), el('td', { id: 'interest-total' }, money(sum('interest')))))),
      yrs.some((y) => y.partial) ? el('p', { class: 'small muted', id: 'years-sofar-note' }, `so far = to ${niceDate(yrs.find((y) => y.partial).asOf || s.asAt)}, from online banking. The annual statement will replace it.`) : null,
      anyEst ? el('p', { class: 'small muted', id: 'years-est-note' }, `est. = no statement for that year: worked out from the balances either side, as if the same amount was overpaid each month.`) : null) : null;

    // 4. Mortgage-free
    const pace = s.pace, con = s.contractual;
    const freeRows = [];
    if (on && sh) {
      freeRows.push(row('Without overpayments', longMonth(sh.mortgageFree), 'free-shadow', 'estimate'));
      if (pace && s.extra) freeRows.push(row('At your current pace', longMonth(pace.last), 'free-pace', `${monthsText(monthsBetween(pace.last, sh.mortgageFree))} sooner`));
      if (s.lifetimeSaved > 0) freeRows.push(el('p', { class: 'small muted', id: 'lifetime-saved' }, `At this pace, about ${pounds(s.lifetimeSaved)} less interest over the whole mortgage (estimate).`));
    } else {
      if (pace && s.extra) freeRows.push(row('At your current pace', longMonth(pace.last), 'free-pace', `${money(d.payment)} + ${cash(s.extra)} a month`));
      if (con) freeRows.push(row('Contractual payments only', longMonth(con.last), 'free-contractual', `${money(d.payment)} a month`));
      if (s.originalEnd) freeRows.push(row('Original term', longMonth(s.originalEnd), 'free-original'));
    }
    const free = freeRows.length ? el('section', { class: 'card mortgage-card', id: 'mortgage-free' },
      el('h2', { class: 'card-title' }, 'Mortgage-free'),
      el('div', { class: 'mrows' }, freeRows),
      el('p', { class: 'small muted' }, `Estimates from the ${niceDate(s.asAt)} balance, if the ${d.rate}% rate carried on.`),
      pace ? whatIfBox(s) : null) : null;

    // v14.8: what went in each year (normal payments and overpayments)
    const paid = M.paidYears(everything);
    const sumOf = (k) => paid.reduce((t, y) => t + y[k], 0);
    const paidRows = [...paid].reverse().map((y) => el('tr', { 'data-year': String(y.year) },
      el('td', {}, String(y.year), y.partial ? el('small', {}, ' so far') : null, y.est ? el('small', {}, ' est.') : null),
      el('td', {}, pounds(y.normal)), el('td', {}, pounds(y.overpaid)), el('td', {}, el('strong', {}, pounds(y.total)))));
    const paidTotal = el('tr', { class: 'mtotal' }, el('td', {}, 'Total'), el('td', {}, pounds(sumOf('normal'))), el('td', {}, pounds(sumOf('overpaid'))), el('td', { id: 'paid-total' }, pounds(sumOf('total'))));
    const paidCard = paid.length ? el('section', { class: 'card mortgage-card', id: 'mortgage-paid' },
      el('h2', { class: 'card-title' }, 'Mortgage paid'),
      el('table', { class: 'mtable' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Year'), el('th', {}, 'Normal'), el('th', {}, 'Overpaid'), el('th', {}, 'Total'))),
        el('tbody', {}, paidRows, paidTotal)),
      el('p', { class: 'small muted' }, `Normal = the monthly payments (${sumOf('payments')} so far). Worked out from your statements, to the nearest pound.`)) : null;

    // 5. How it's worked out
    const notes = el('details', { class: 'mortgage-notes', id: 'mortgage-assumptions' },
      el('summary', {}, 'How these are worked out'),
      el('ul', {},
        el('li', {}, 'Balances, rates, payments, overpayments and interest come from your annual statements.'),
        sh ? el('li', {}, `“Without overpayments” is an estimate: the same ${pounds(s.setup.mortgage.amount)} over ${monthsText(Number(s.setup.mortgage.termMonths) || 300)}, the same rates and dates, paying only the monthly payment. At each new deal the payment is worked out again on that balance over the rest of the term. Interest is the balance × rate ÷ 12 each month.`) : null,
        sh ? el('li', {}, 'A day or two charged at a different rate between deals is left out.') : null,
        anyEst ? el('li', {}, 'A year without a statement is estimated from the balances either side, so the interest saved depends on that estimate.') : null,
        el('li', {}, 'Mortgage-free dates assume today’s rate carries on and the payments stay the same. Your lender’s figures are the real ones.')));

    const setupHint = !s.setup ? el('a', { class: 'card mortgage-card mortgage-setup-hint', id: 'mortgage-setup-hint', href: '#/new/mortgage' },
      el('strong', {}, 'Add the set-up'), el('span', { class: 'small muted' }, 'The amount borrowed, the term and the first deal (tap +, then “Mortgage set-up”), to see what your overpayments save.')) : null;
    fill(wrap, balance, setupHint, deal, years, paidCard, free, notes);
  };
  draw();
  return wrap;
}

// A statement / set-up's own lines on its detail page.
export function detailRows(e) {
  const m = e.mortgage || {};
  if (m.kind === 'setup') return [
    ['Borrowed', hasNum(m.amount) ? money(m.amount) : null, 'key'],
    ['Term', m.termMonths ? monthsText(Number(m.termMonths)) : null, 'calendar'],
    ['First payment', m.firstPayment ? niceDate(m.firstPayment) : null, 'calendar'],
    ['Rate', hasNum(m.rate) ? `${m.rate}% ${m.rateType || 'fixed'}` : null, 'chart'],
    ['Monthly payment', hasNum(m.payment) ? money(m.payment) : null, 'receipt'],
    ['Rate after a deal', hasNum(m.svr) ? `${m.svr}% variable` : null, 'chart'],
  ];
  return [
    ['Statement year', m.year ? String(m.year) : null, 'calendar'],
    ['Balance', hasNum(m.balance) ? `${money(m.balance)} at ${niceDate(e.date)}` : null, 'key'],
    ['Opening balance', hasNum(m.opening) ? money(m.opening) : null, 'key'],
    ['Rate', hasNum(m.rate) ? `${m.rate}% ${m.rateType || 'fixed'}` : null, 'chart'],
    ['Monthly payment', hasNum(m.payment) ? money(m.payment) : null, 'receipt'],
    ['Early repayment charge', hasNum(m.erc) ? money(m.erc) : null, 'alert'],
    ['ERCs end', m.ercUntil ? niceDate(m.ercUntil) : null, 'clock'],
    ['Overpaid in the year', hasNum(m.overpaid) ? money(m.overpaid) : null, 'sparkle'],
    ['Interest in the year', hasNum(m.interest) ? money(m.interest) : null, 'chart'],
    ['Term left', m.termLeft || null, 'calendar'],
  ];
}
const hasNum = (v) => v !== null && v !== undefined && v !== '' && isFinite(Number(v));

// One line under the title in lists.
export function cardLine(e) {
  const m = e.mortgage || {};
  if (m.kind === 'setup') return [hasNum(m.amount) ? `${pounds(m.amount)} over ${monthsText(Number(m.termMonths) || 0)}` : '', e.supplier].filter(Boolean).join(' · ');
  return [hasNum(m.balance) ? `Balance ${money(m.balance)}` : '', hasNum(m.rate) ? `${m.rate}% ${m.rateType || 'fixed'}` : ''].filter(Boolean).join(' · ');
}

// Home tile: what's owed at the latest statement.
export function tileMeta(everything) {
  const s = M.summary(everything);
  return s ? { meta: `${pounds(s.balance)} owed`, note: `at ${niceDate(s.asAt)}` } : null;
}
