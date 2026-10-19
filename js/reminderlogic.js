// =====================================================================
// reminderlogic.js — standalone reminders (v15.1). Pure, easy to test.
// =====================================================================
// A reminder is stored as a normal Jobs entry (type 'job') with a due date
// and an extra `reminder` object, so the database, section ids and the
// backup/sync format don't change. Older copies of Hearth (v15.0 and
// before) simply show it as a job with a "Next due" date — and the phone
// reminders still work for it there.
//
//   reminder: {
//     v: 1,
//     every: 6, unit: 'month',   // repeat; every: 0 / unit: null = one-off
//     early: 14,                 // optional extra alert N days before (or null)
//     done: [{ due: '2026-04-01', on: '2026-04-03' }],  // history, newest last
//     lastDue: '2026-10-01',     // one-off only: the date it was done for
//   }
// A reminder is "active" while it has a dueDate. Marking a one-off done
// clears dueDate (so it leaves Coming up everywhere, old versions too).

export const UNITS = ['day', 'week', 'month', 'year'];
export const EARLY = [null, 1, 3, 14];

export const isReminder = (e) => Boolean(e && e.type === 'job' && e.reminder && typeof e.reminder === 'object');
export const repeats = (r) => Boolean(r && Number(r.every) > 0 && UNITS.includes(r.unit));

const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => String(iso).slice(0, 10).split('-').map(Number);

// Add n units to a YYYY-MM-DD date. Months/years clamp to the month end
// (31 Jan + 1 month = 28/29 Feb).
export function addInterval(iso, every, unit) {
  const [y, m, d] = parts(iso);
  if (unit === 'day' || unit === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d) + (unit === 'week' ? 7 : 1) * every * 86400000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const months = unit === 'year' ? every * 12 : every;
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

// The next due date after marking done on `today`: step on from the due
// date (keeps the schedule) until it's after today.
export function nextDue(due, r, today) {
  if (!repeats(r) || !/^\d{4}-\d\d-\d\d/.test(due || '')) return null;
  let next = addInterval(due, Number(r.every), r.unit);
  for (let i = 0; i < 1000 && next <= today; i++) next = addInterval(next, Number(r.every), r.unit);
  return next;
}

// Mark a reminder done. Returns a NEW entry (doesn't change the one given).
export function markDone(e, today, now = new Date().toISOString()) {
  const r = { ...(e.reminder || {}) };
  const due = (e.dueDate || '').slice(0, 10) || null;
  r.done = [...(Array.isArray(r.done) ? r.done : []), { due, on: today }].slice(-50);
  const out = { ...e, reminder: r, updatedAt: now };
  if (repeats(r) && due) out.dueDate = nextDue(due, r, today);
  else { r.lastDue = due; out.dueDate = null; }
  return out;
}

// Undo the last "done" (if the date wasn't changed by hand since).
export function undoDone(e, now = new Date().toISOString()) {
  const r = { ...(e.reminder || {}) };
  const done = Array.isArray(r.done) ? [...r.done] : [];
  const last = done.pop();
  if (!last) return e;
  r.done = done;
  delete r.lastDue;
  return { ...e, reminder: r, dueDate: last.due, updatedAt: now };
}

const UNIT_WORD = { day: 'day', week: 'week', month: 'month', year: 'year' };
export function repeatText(r) {
  if (!repeats(r)) return 'One-off';
  const n = Number(r.every);
  if (n === 1) return r.unit === 'day' ? 'Every day' : r.unit === 'year' ? 'Every year' : `Every ${UNIT_WORD[r.unit]}`;
  return `Every ${n} ${UNIT_WORD[r.unit]}s`;
}
export const earlyText = (n) => (!n ? '' : n === 1 ? '1 day before' : n === 7 ? '1 week before' : n === 14 ? '2 weeks before' : `${n} days before`);

// Quick picks on the Add reminder screen. Nothing is created until you save.
export const PRESETS = [
  { key: 'smoke', title: 'Test smoke & heat alarms', every: 1, unit: 'month', notes: 'Press the test button on each alarm.' },
  { key: 'co', title: 'Test CO alarm', every: 1, unit: 'month', notes: '' },
  { key: 'boiler', title: 'Boiler service', every: 1, unit: 'year', notes: '' },
  { key: 'stove', title: 'Sweep the stove chimney', every: 1, unit: 'year', notes: 'Mi-Fires Loughrigg stove.' },
  { key: 'dishwasher', title: 'Clean the dishwasher filter', every: 1, unit: 'month', notes: '' },
  { key: 'gutters', title: 'Clear the gutters', every: 1, unit: 'year', notes: 'Best after the leaves are down (Nov).' },
  { key: 'rcd', title: 'Press the RCD test buttons', every: 6, unit: 'month', notes: 'On the consumer unit.' },
];
export const preset = (key) => PRESETS.find((p) => p.key === key) || null;

// Clean the form values into a reminder object (keeps the done history).
export function buildReminder(old, { every, unit, early }) {
  const n = Math.max(0, Math.min(99, Math.round(Number(every) || 0)));
  const r = { ...(old || {}), v: 1, every: n && UNITS.includes(unit) ? n : 0, unit: n && UNITS.includes(unit) ? unit : null };
  const ea = Math.round(Number(early) || 0);
  r.early = ea > 0 && ea <= 60 ? ea : null;
  if (!Array.isArray(r.done)) r.done = [];
  return r;
}
