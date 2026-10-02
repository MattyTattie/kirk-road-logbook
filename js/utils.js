// =====================================================================
// utils.js — small helper functions used by several screens.
// =====================================================================

// el() builds a piece of the page (an HTML "element") in one line, e.g.
//   el('button', { class: 'btn', onclick: save }, 'Save')
// makes <button class="btn">Save</button> that calls save() when tapped.
//
// Why not just write HTML text with the entry's title pasted in? Because
// if a title contained something like "<b>", the browser would treat it
// as code. Building elements and setting their text is always safe.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value); // e.g. onclick -> 'click'
    } else if (key === 'class') {
      node.className = value;
    } else if (key in node && typeof value !== 'string') {
      node[key] = value; // e.g. checked: true
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat(Infinity)) { // flat(Infinity) unpacks lists inside lists
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// Formats a number as pounds, e.g. 1234.5 -> "£1,234.50"
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export function money(n) {
  return gbp.format(n || 0);
}

// Adds up costs without the tiny rounding errors computers make with
// decimals (0.1 + 0.2 = 0.30000000000000004!). We add whole pennies.
export function totalCost(entries) {
  const pennies = entries.reduce((sum, e) => sum + Math.round((Number(e.cost) || 0) * 100), 0);
  return pennies / 100;
}

// "2026-10-02" -> "2 Oct 2026"
export function niceDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date)) return isoDate;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Today's date as "YYYY-MM-DD" in the phone's local time (what date inputs use).
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// How many whole days from today until a "YYYY-MM-DD" date.
// Negative means it's in the past.
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000); // 86,400,000 ms in a day
}

// Turns a number of days into friendly words, e.g. "expires in 12 days".
export function dueText(word, days) {
  if (days === null) return '';
  if (days === 0) return `${word} today`;
  if (days === 1) return `${word} tomorrow`;
  // Far-off dates read better in months/years than "in 1825 days".
  if (days >= 730) return `${word} in about ${Math.round(days / 365.25)} years`;
  if (days > 90) return `${word} in about ${Math.round(days / 30.44)} months`;
  if (days > 0) return `${word} in ${days} days`;
  const ago = -days;
  const past = word === 'expires' ? 'expired' : 'was due';
  return `${past} ${ago} day${ago === 1 ? '' : 's'} ago`;
}

// Sort newest first: by date, then by when it was created.
export function newestFirst(a, b) {
  return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
}
