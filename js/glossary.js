// =====================================================================
// glossary.js — v15.2: tap-to-explain words (ported from Sparky's symbols).
// One list of terms feeds the little pop-ups (dotted-underlined words on
// any screen) and the Glossary page under More. Pure data + DOM helpers;
// nothing here is saved or synced.
// =====================================================================

// [key, full name, one plain line, group, pattern (case-insensitive, whole words)]
export const TERMS = [
  ['overpayment', 'Overpayment', 'Money paid off the mortgage on top of the normal monthly payment. It cuts the balance, so less interest builds up.', 'Mortgage', 'overpayments?|overpaid|overpay'],
  ['contractual', 'Contractual payment', 'The monthly payment the lender asks for. Paying only this finishes the mortgage at the end of the term.', 'Mortgage', 'contractual payments?'],
  ['interest', 'Interest', 'What the lender charges for the loan: roughly the balance × the yearly rate ÷ 12, each month.', 'Mortgage', 'interest'],
  ['rate', 'Interest rate', 'The yearly percentage the lender charges on what you owe. A fixed rate stays the same until the deal ends.', 'Mortgage', 'interest rate|fixed rate'],
  ['dealend', 'Fixed rate end (deal ends)', 'The date your current deal finishes. After it the rate usually jumps to the lender’s follow-on rate unless you pick a new deal.', 'Mortgage', 'deal ends?|fixed rate ends?|deal end'],
  ['followon', 'Follow-on rate (SVR)', 'The lender’s standard variable rate you move to when a deal ends. It’s usually much higher, so pick a new deal before then.', 'Mortgage', 'follow-on rate|SVR|standard variable rate'],
  ['erc', 'Early repayment charge (ERC)', 'A fee for paying off more than the allowed amount (usually 10% a year) or leaving during a deal.', 'Mortgage', 'ERCs?|early repayment charges?'],
  ['ltv', 'Loan to value (LTV)', 'What you owe as a share of the house’s value. Lower LTV usually gets cheaper deals.', 'Mortgage', 'LTV|loan to value'],
  ['apr', 'APR', 'Annual percentage rate: the yearly cost of borrowing including fees, so deals can be compared.', 'Mortgage', 'APRC?'],
  ['term', 'Mortgage term', 'How long the mortgage is set up to last, e.g. 25 years.', 'Mortgage', 'original term|mortgage term'],
  ['mortgagefree', 'Mortgage-free date', 'The month the last payment would clear the balance, if the rate and payments stayed as they are.', 'Mortgage', 'mortgage-free'],
  ['kwh', 'Kilowatt hour (kWh)', 'The unit electricity is sold in: a 1,000 W heater running for one hour uses 1 kWh.', 'Electricity', 'kWh'],
  ['unitrate', 'Unit rate', 'The price for each kWh you use, in pence.', 'Electricity', 'unit rates?'],
  ['standing', 'Standing charge', 'A fixed daily fee for being connected, paid even if you use nothing.', 'Electricity', 'standing charges?'],
  ['allin', 'All-in per kWh', 'The whole bill (units, standing charge and VAT) divided by the kWh used: what each unit really cost.', 'Electricity', 'all-in per kWh|all-in'],
  ['vat', 'VAT', 'Tax added to energy bills, normally 5% for homes.', 'Electricity', 'VAT'],
  ['sunday', 'Sunday Saver credit', 'An EDF credit for using electricity in your Sunday Saver hours. It comes off the bill.', 'Electricity', 'Sunday Saver'],
  ['weekend', 'Weekend Saver credit', 'An EDF credit for electricity used at weekends on that tariff. It comes off the bill.', 'Electricity', 'Weekend Saver'],
  ['credits', 'EDF credits', 'Money EDF takes off a bill (Sunday Saver, Weekend Saver and the like). “After credits” shows what you actually paid.', 'Electricity', 'EDF credits|after credits'],
  ['tariff', 'Tariff', 'The energy price plan you’re on: its unit rates and standing charge.', 'Electricity', 'tariff'],
  ['reading', 'Meter reading', 'The number on the meter. Two readings apart give the kWh used in between.', 'Electricity', 'meter readings?'],
  ['warranty', 'Warranty', 'The maker’s or shop’s promise to fix or replace something that goes wrong before the end date.', 'House', 'warranty|warranties|guarantee'],
  ['prorata', 'Pro rata', 'Shared out by time: a yearly policy counts only the part of the cost that falls in that year.', 'House', 'pro rata'],
  ['renewal', 'Renewal date', 'When a policy runs out and renews. Check the price before then, it’s often cheaper to switch.', 'House', 'renews|renewal'],
  ['excess', 'Excess', 'The part of an insurance claim you pay yourself before the insurer pays the rest.', 'House', 'excess'],
  ['estimate', 'Estimate (est.)', 'Worked out by Hearth from your figures, not a figure from the lender or supplier.', 'House', 'estimate|est\\.'],
];
export const TERM = Object.fromEntries(TERMS.map(([key, name, desc, group, pat]) => [key, { key, name, desc, group, re: new RegExp(`(^|[^A-Za-z0-9])(${pat})(?![A-Za-z0-9])`, 'i') }]));
export const GROUPS = [...new Set(TERMS.map((t) => t[3]))];

// Find the first term in a bit of text that isn't already used on screen.
// Returns { key, index, length } or null. Pure; tested.
export function findTerm(text, used = new Set()) {
  let best = null;
  for (const t of Object.values(TERM)) {
    if (used.has(t.key)) continue;
    const m = t.re.exec(text);
    if (!m) continue;
    const index = m.index + m[1].length;
    if (!best || index < best.index || (index === best.index && m[2].length > best.length)) best = { key: t.key, index, length: m[2].length };
  }
  return best;
}

// Dotted-underlined words, first time each term shows on a screen only (so
// it doesn't clutter). Skips inputs, buttons, links, titles and numbers.
const SKIP = 'input,textarea,select,option,button,a,script,style,svg,h1,.label,summary,.term,.termpop,.tapsel,.tapsel-sheet,.no-terms,.pdfview,.bottom-nav,.toast,code,[contenteditable]';
export function wrapTerms(root) {
  if (!root || !root.querySelectorAll || typeof document === 'undefined') return;
  const used = new Set([...root.querySelectorAll('.term')].map((t) => t.dataset.term));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.nodeValue || n.nodeValue.length < 3 || (n.parentElement && (n.parentElement.closest(SKIP) || n.parentElement.closest('[hidden]'))) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const todo = []; let n; while ((n = walker.nextNode())) todo.push(n);
  for (const t of todo) {
    let txt = t.nodeValue; const f = findTerm(txt, used);
    if (!f) continue;
    const parts = [];
    let hit = f;
    while (hit) {
      used.add(hit.key);
      parts.push(txt.slice(0, hit.index));
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'term'; b.dataset.term = hit.key; b.textContent = txt.slice(hit.index, hit.index + hit.length);
      b.setAttribute('aria-label', `${b.textContent}: what it means`);
      parts.push(b);
      txt = txt.slice(hit.index + hit.length);
      hit = findTerm(txt, used);
    }
    parts.push(txt);
    const span = document.createElement('span'); span.className = 'termwrap'; span.append(...parts);
    t.replaceWith(span);
  }
}

let pop = null;
export function closeTerm() { if (pop) { pop.remove(); pop = null; } }
export function openTerm(btn) {
  const d = TERM[btn.dataset.term]; if (!d) return;
  closeTerm();
  pop = document.createElement('div');
  pop.className = 'termpop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', d.name); pop.dataset.for = d.key; pop.id = 'termpop';
  const hd = document.createElement('strong'); hd.className = 'termpop-name'; hd.textContent = d.name;
  const tx = document.createElement('p'); tx.className = 'termpop-text'; tx.textContent = d.desc;
  const all = document.createElement('a'); all.className = 'termpop-all'; all.href = `#/glossary/${d.key}`; all.textContent = 'All words explained';
  pop.append(hd, tx, all);
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(); const w = Math.min(320, window.innerWidth - 16);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  const ph = pop.offsetHeight; const below = r.bottom + 8;
  pop.style.top = (below + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph - 8) : below) + 'px';
}
export function startTerms(root) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.term');
    if (b) { e.preventDefault(); e.stopPropagation(); if (pop && pop.dataset.for === b.dataset.term) return closeTerm(); openTerm(b); return; }
    if (!(e.target.closest && e.target.closest('.termpop'))) closeTerm();
  }, true);
  window.addEventListener('hashchange', closeTerm);
  let y0 = 0; document.addEventListener('click', () => { y0 = window.scrollY; }, true);
  window.addEventListener('scroll', () => { if (pop && Math.abs(window.scrollY - y0) > 40) closeTerm(); }, { passive: true });
  let q = false; const run = () => { q = false; wrapTerms(root); };
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  run();
}
