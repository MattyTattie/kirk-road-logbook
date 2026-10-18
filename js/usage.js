// =====================================================================
// usage.js — reading an EDF usage download (CSV) into monthly kWh (v15.0).
// =====================================================================
// EDF's "Download your usage" gives a .csv file. It can be monthly totals
// ("Timestamp, Electricity consumption (kWh), Electricity cost (£)" with
// 01/2026 style months), daily, or half-hourly readings. This file reads any
// of those (and the common variations: a separate Time column, Start/End
// columns, ISO dates, semicolons, pence, day/night columns) and adds them
// up into calendar months. It all happens on the phone; the file is never
// uploaded anywhere and no usage figures live in the app's code.
//
// Saved as ONE entry (id USAGE_ID, type 'usage') with an extra `usage`
// object, so backups and the shared Drive sync carry it like any entry
// (same DB, same file formats). db.getAllEntries() leaves it out, so it
// never shows up as a logbook item, in totals or in search.

export const USAGE_TYPE = 'usage';
export const USAGE_ID = 'usage-electricity-edf';

export class UsageFileError extends Error {}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
export const daysInMonth = (key) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
export const monthLabel = (key) => `${MON_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- CSV ----------
function splitCSV(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => (firstLine.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const delim = [',', ';', '\t'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some((s) => s !== ''));
}

const num = (s) => {
  if (s == null) return NaN;
  const t = String(s).replace(/[£$€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (t === '' || t === '-') return NaN;
  return Number(t.replace(',', '.'));
};

// ---------- Dates ----------
// Returns { y, m, d (or 0 for a whole month), hh, mm, hasTime } or null.
function parseWhen(s, dayFirst = true) {
  if (!s) return null;
  const t = String(s).trim();
  let m;
  // 2026-01-31, 2026-01-31T00:30:00Z, 2026-01-31 00:30, 2026/01/31
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i))) {
    let [, y, mo, d, hh, mm, tz] = m;
    y = +y; mo = +mo; d = +d;
    if (hh != null && tz) { // move to UK local time so half-hours land on the right day
      const dt = new Date(t.replace(' ', 'T'));
      if (!isNaN(dt)) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).map((p) => [p.type, p.value]));
        return ok({ y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute, hasTime: true });
      }
    }
    return ok({ y, m: mo, d, hh: hh != null ? +hh : 0, mm: mm != null ? +mm : 0, hasTime: hh != null });
  }
  // 2026-01, 2026/01
  if ((m = t.match(/^(\d{4})[-/](\d{1,2})$/))) return ok({ y: +m[1], m: +m[2], d: 0, hasTime: false });
  // 01/2026, 1-2026
  if ((m = t.match(/^(\d{1,2})[-/.](\d{4})$/))) return ok({ y: +m[2], m: +m[1], d: 0, hasTime: false });
  // 31/01/2026, 31-01-2026, 31/01/26, with optional time
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/))) {
    const a = +m[1], b = +m[2];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return ok({ y, m: mo, d, hh: m[4] != null ? +m[4] : 0, mm: m[5] != null ? +m[5] : 0, hasTime: m[4] != null });
  }
  // Jan 2026, January 2026, Jan-26
  if ((m = t.match(/^([A-Za-z]{3,9})[\s\-']+(\d{2}|\d{4})$/))) {
    const i = MON.indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return ok({ y: m[2].length === 2 ? 2000 + +m[2] : +m[2], m: i + 1, d: 0, hasTime: false });
  }
  // 31 Jan 2026, 31 January 2026 (optional time)
  if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/))) {
    const i = MON.indexOf(m[2].slice(0, 3).toLowerCase());
    if (i >= 0) return ok({ y: +m[3], m: i + 1, d: +m[1], hh: m[4] != null ? +m[4] : 0, mm: m[5] != null ? +m[5] : 0, hasTime: m[4] != null });
  }
  return null;
  function ok(w) {
    if (!(w.y >= 2000 && w.y <= 2100 && w.m >= 1 && w.m <= 12)) return null;
    if (w.d && (w.d < 1 || w.d > new Date(w.y, w.m, 0).getDate())) return null;
    return w;
  }
}
const timeOf = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? { hh: +m[1], mm: +m[2] } : null; };

// ---------- Which column is which ----------
function findColumns(header) {
  const h = header.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
  const idx = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const dateCol = [
    idx(/^(timestamp|date|day|month|period|read(ing)? date|date ?\/ ?time|datetime|interval start|start( date| time| date ?\/ ?time)?|from|start ?time|period start|usage date)\b/, /kwh|consumption|usage \(|cost|£/),
    idx(/timestamp|date|period|month|start|from/, /end|to\b|cost|kwh/),
  ].find((i) => i >= 0);
  const timeCol = h.findIndex((x, i) => i !== dateCol && /^(time|start time|interval|half ?hour|period time|read(ing)? time)\b/.test(x) && !/date/.test(x));
  // kWh columns: prefer electricity totals; else gas; day/night (E7) parts are added together.
  const kwhLike = h.map((x, i) => ({ x, i })).filter(({ x }) => /kwh|consumption|usage|units|energy/.test(x) && !/cost|£|price|pence|\(p\)|rate|standing|reading$/.test(x) && !/^(timestamp|date)/.test(x));
  const elec = kwhLike.filter(({ x }) => !/gas/.test(x));
  const gas = kwhLike.filter(({ x }) => /gas/.test(x));
  const pick = elec.length ? elec : gas;
  const fuel = elec.length ? 'electricity' : gas.length ? 'gas' : 'electricity';
  let kwhCols = [];
  const total = pick.find(({ x }) => /total/.test(x)) || pick.find(({ x }) => !/day|night|peak|off|economy|low|high/.test(x));
  if (total) kwhCols = [total.i];
  else kwhCols = pick.map(({ i }) => i);
  const costPick = h.map((x, i) => ({ x, i })).filter(({ x }) => /cost|£|amount|charge|price/.test(x) && !/standing|rate|unit price|per kwh/.test(x) && (fuel === 'gas' ? true : !/gas/.test(x)));
  const cost = costPick.find(({ x }) => /total/.test(x)) || costPick[0];
  const costPence = cost ? /\(p\)|pence|\bp\b/.test(cost.x) && !/£/.test(cost.x) : false;
  const endCol = h.findIndex((x, i) => i !== dateCol && /^(end|to|interval end|end date|end time|period end)\b/.test(x));
  return { dateCol, timeCol, endCol, kwhCols, costCol: cost ? cost.i : -1, costPence, fuel };
}

// Read the file text. Gives back
//   { kind: 'monthly'|'daily'|'halfhourly', fuel, months: { 'YYYY-MM': { kwh, cost, days, partial, rows } },
//     rows, skippedEmpty: ['YYYY-MM' …], badRows, from, to }
// or throws UsageFileError with a plain message.
export function parseUsageCSV(text, { now = new Date() } = {}) {
  if (typeof text !== 'string') throw new UsageFileError('That file could not be read.');
  text = text.replace(/^\uFEFF/, '');
  if (/^\s*[{[]/.test(text) || /^%PDF/.test(text) || /<html/i.test(text.slice(0, 400))) throw notRecognised();
  const rows = splitCSV(text);
  if (rows.length < 2) throw notRecognised();
  // The header is the first row (within the first 15) that has a date-ish and a kWh-ish column.
  let hi = -1, cols = null;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const c = findColumns(rows[i]);
    if (c.dateCol >= 0 && c.kwhCols.length) { hi = i; cols = c; break; }
  }
  if (hi < 0) throw notRecognised();
  const body = rows.slice(hi + 1);
  // Day-first (UK) unless the file can only be month-first.
  const dates = body.map((r) => r[cols.dateCol]).filter(Boolean);
  const dmy = dates.map((s) => String(s).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/)).filter(Boolean);
  const dayFirst = !(dmy.length && dmy.some((m) => +m[2] > 12) && dmy.every((m) => +m[1] <= 12));

  const recs = [];
  let bad = 0;
  for (const r of body) {
    const raw = r[cols.dateCol];
    if (!raw) { bad++; continue; }
    if (/^(total|totals|sum)\b/i.test(raw)) continue;
    let w = parseWhen(raw, dayFirst);
    if (!w && /\s-\s|\bto\b/.test(raw)) w = parseWhen(raw.split(/\s-\s|\bto\b/)[0].trim(), dayFirst); // "01/01/2026 - 31/01/2026"
    if (!w) { bad++; continue; }
    if (cols.timeCol >= 0 && !w.hasTime) {
      const tm = timeOf(r[cols.timeCol]);
      if (tm) { w = { ...w, ...tm, hasTime: true }; }
    }
    let kwh = 0, any = false;
    for (const i of cols.kwhCols) { const v = num(r[i]); if (Number.isFinite(v)) { kwh += v; any = true; } }
    if (!any || kwh < 0 || kwh > 100000) { bad++; continue; }
    let cost = cols.costCol >= 0 ? num(r[cols.costCol]) : NaN;
    if (Number.isFinite(cost) && cols.costPence) cost /= 100;
    recs.push({ w, kwh, cost: Number.isFinite(cost) ? cost : null });
  }
  if (!recs.length) throw notRecognised();

  // How fine-grained? Monthly rows have no day. Several rows on one day = half-hourly (or hourly).
  const monthly = recs.every((x) => !x.w.d);
  const perDay = new Map();
  for (const x of recs) if (x.w.d) { const k = `${x.w.y}-${pad(x.w.m)}-${pad(x.w.d)}`; perDay.set(k, (perDay.get(k) || 0) + 1); }
  const multi = [...perDay.values()].some((n) => n > 1);
  const kind = monthly ? 'monthly' : multi ? 'halfhourly' : 'daily';

  const months = {};
  const daysSeen = {};
  for (const x of recs) {
    let { y, m, d } = x.w;
    // A half-hour row stamped 00:00 with an End column is the start of the day;
    // without one, EDF's "00:00" row closes the previous day (23:30–00:00).
    if (kind === 'halfhourly' && cols.endCol < 0 && x.w.hasTime && x.w.hh === 0 && x.w.mm === 0 && firstSlotIsHalfPast(recs)) {
      const prev = new Date(y, m - 1, d - 1); y = prev.getFullYear(); m = prev.getMonth() + 1; d = prev.getDate();
    }
    const key = `${y}-${pad(m)}`;
    const o = months[key] || (months[key] = { kwh: 0, cost: null, days: 0, partial: false, rows: 0 });
    o.kwh += x.kwh; o.rows++;
    if (x.cost != null) o.cost = (o.cost || 0) + x.cost;
    if (d) (daysSeen[key] || (daysSeen[key] = new Set())).add(d);
  }
  const skippedEmpty = [];
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  for (const key of Object.keys(months)) {
    const o = months[key];
    o.kwh = r3(o.kwh);
    if (o.cost != null) o.cost = r2(o.cost);
    if (key > thisMonth) { delete months[key]; continue; } // future months: ignore
    if (kind === 'monthly') {
      o.days = daysInMonth(key);
      if (key === thisMonth) { o.partial = true; o.days = Math.max(1, now.getDate() - 1); }
    } else {
      o.days = daysSeen[key] ? daysSeen[key].size : 0;
      o.partial = o.days < daysInMonth(key);
    }
    // EDF lists months before your supply started as 0 kWh, £0: those aren't readings.
    if (o.kwh === 0 && !o.cost) { skippedEmpty.push(key); delete months[key]; }
  }
  const keys = Object.keys(months).sort();
  if (!keys.length) throw new UsageFileError('That file only has months with no usage (0 kWh), so there was nothing to add.');
  return { kind, fuel: cols.fuel, months: sortObj(months), rows: recs.length, skippedEmpty: skippedEmpty.sort(), badRows: bad, from: keys[0], to: keys[keys.length - 1] };
}
function firstSlotIsHalfPast(recs) {
  const first = recs.find((x) => x.w.hasTime);
  return Boolean(first && first.w.hh === 0 && first.w.mm === 30);
}
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const notRecognised = () => new UsageFileError('Hearth didn’t recognise that file. It needs an EDF usage download saved as a CSV file: one column with the date or month (like “Timestamp” or “Date”) and one with kWh (like “Electricity consumption (kWh)”). Bills, PDFs and spreadsheets (.xlsx) won’t work here.');

// Several files picked together: one set of months (the more complete
// figure wins when two files cover the same month).
export function combineParsed(list) {
  const months = {};
  for (const p of list) for (const [k, v] of Object.entries(p.months)) {
    if (!months[k] || better(v, months[k]) >= 0) months[k] = v;
  }
  const keys = Object.keys(months).sort();
  return {
    kinds: [...new Set(list.map((p) => p.kind))],
    fuel: list.some((p) => p.fuel === 'electricity') ? 'electricity' : list[0].fuel,
    months: sortObj(months),
    rows: list.reduce((t, p) => t + p.rows, 0),
    skippedEmpty: [...new Set(list.flatMap((p) => p.skippedEmpty))].filter((k) => !months[k]).sort(),
    badRows: list.reduce((t, p) => t + p.badRows, 0),
    from: keys[0], to: keys[keys.length - 1],
  };
}

// >0: a is more complete than b; 0: same; <0: b is better.
function better(a, b) {
  const rank = (x) => (x.partial ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return (a.days || 0) - (b.days || 0);
}
const sameMonth = (a, b) => Math.abs(a.kwh - b.kwh) < 0.0005 && (a.cost == null || b.cost == null || Math.abs(a.cost - b.cost) < 0.005) && Boolean(a.partial) === Boolean(b.partial);

// What saving these months would do to what's saved already. Nothing is
// ever duplicated: one figure per month. A newer file replaces a month
// unless what's saved covers more of it.
export function planMerge(saved = {}, incoming = {}) {
  const added = [], updated = [], same = [], kept = [];
  const months = { ...saved };
  for (const [k, v] of Object.entries(incoming)) {
    const old = saved[k];
    if (!old) { added.push(k); months[k] = v; }
    else if (sameMonth(old, v)) same.push(k);
    else if (better(v, old) >= 0) { updated.push(k); months[k] = v; }
    else kept.push(k);
  }
  return { months: sortObj(months), added, updated, same, kept, changes: updated.map((k) => ({ key: k, from: saved[k].kwh, to: incoming[k].kwh })) };
}

// The saved months from the usage entry (or {}).
export const savedMonths = (entry) => (entry && entry.usage && entry.usage.months && typeof entry.usage.months === 'object' ? cleanMonths(entry.usage.months) : {});
// Only well-formed months survive (data from a backup or the sync file).
function cleanMonths(m) {
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k) || !v || !Number.isFinite(Number(v.kwh))) continue;
    out[k] = { kwh: Number(v.kwh), cost: Number.isFinite(Number(v.cost)) && v.cost !== null && v.cost !== '' ? Number(v.cost) : null, days: Number(v.days) || daysInMonth(k), partial: Boolean(v.partial), rows: Number(v.rows) || 0 };
  }
  return sortObj(out);
}

// Build / update the one usage entry.
export function usageEntry(existing, months, meta, nowIso = new Date().toISOString()) {
  const keys = Object.keys(months).sort();
  const last = keys[keys.length - 1];
  const imports = [...((existing && existing.usage && Array.isArray(existing.usage.imports)) ? existing.usage.imports : []), meta].slice(-20);
  return {
    cost: null, notes: '', dueDate: null, meterValue: null, meterUnit: '', photos: [],
    ...(existing || {}),
    id: USAGE_ID,
    type: USAGE_TYPE,
    title: 'Electricity usage (EDF file)',
    supplier: 'EDF',
    notes: 'Monthly kWh from EDF usage downloads. Shown on the Electricity page (Hearth 15 or newer).',
    date: last ? `${last}-${pad(daysInMonth(last))}` : nowIso.slice(0, 10),
    createdAt: (existing && existing.createdAt) || nowIso,
    updatedAt: nowIso,
    usage: { version: 1, fuel: 'electricity', supplier: 'EDF', months, imports },
  };
}

// Year-on-year: the months of `year` that are complete in both years
// (Jan–Sep 2026 vs Jan–Sep 2025). Part months ("Oct so far") are left out.
export function yearOnYear(months, year) {
  const both = [];
  for (let m = 1; m <= 12; m++) {
    const a = months[`${year}-${pad(m)}`], b = months[`${year - 1}-${pad(m)}`];
    if (a && b && !a.partial && !b.partial) both.push(m);
  }
  if (!both.length) return null;
  const sum = (y, f) => both.reduce((t, m) => t + (months[`${y}-${pad(m)}`][f] || 0), 0);
  const costBoth = both.every((m) => months[`${year}-${pad(m)}`].cost != null && months[`${year - 1}-${pad(m)}`].cost != null);
  const run = both.every((m, i) => i === 0 || m === both[i - 1] + 1);
  const label = both.length === 1 ? MON_SHORT[both[0] - 1] : run ? `${MON_SHORT[both[0] - 1]}–${MON_SHORT[both[both.length - 1] - 1]}` : `${both.length} months`;
  const now = r3(sum(year, 'kwh')), then = r3(sum(year - 1, 'kwh'));
  return { months: both, label, now, then, change: then ? (now - then) / then : null,
    costNow: costBoth ? r2(sum(year, 'cost')) : null, costThen: costBoth ? r2(sum(year - 1, 'cost')) : null };
}

export const yearsIn = (months) => [...new Set(Object.keys(months).map((k) => Number(k.slice(0, 4))))].sort((a, b) => a - b);
export const kindLabel = (k) => ({ monthly: 'monthly totals', daily: 'daily readings', halfhourly: 'half-hourly readings' })[k] || k;
