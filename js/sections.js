// =====================================================================
// sections.js — the list of "sections" (entry types) in the logbook.
// =====================================================================
//
// Everything else in the app reads this one list, so if you want a new
// section (for example "Insurance") you only need to add one object here.
// See HOW-IT-WORKS.md for a step-by-step example.
//
// Each section has:
//   id        – a short code stored with every entry (never change this
//               once you have saved entries, or they'll lose their section!)
//   label     – the name shown on screen (plural, for tabs and headings)
//   single    – the name of one entry ("Add Job", "Edit Receipt"...)
//   icon      – an emoji, used in the printed report and as a fallback
//   glyph     – the name of the line icon drawn in the app (see icons.js)
//   tone      – colour theme for the section (matches --tone-<name> in styles.css)
//   showDue   – true if the form should show a date field for expiry / next due
//   dueLabel  – the label for that date field
//   dueWord   – the word used in "expires in 12 days" / "due in 12 days"
//   showMeter – true if the form should show the meter value + unit fields

export const SECTIONS = [
  {
    id: 'job',
    glyph: 'wrench',
    tone: 'indigo',
    label: 'Jobs',
    single: 'Job',
    icon: '🔧',
    showDue: true,
    dueLabel: 'Next due (optional — e.g. EICR, boiler service)',
    dueWord: 'due',
    showMeter: false,
  },
  {
    id: 'receipt',
    glyph: 'receipt',
    tone: 'teal',
    label: 'Receipts',
    single: 'Receipt',
    icon: '🧾',
    showDue: false,
    showMeter: false,
  },
  {
    id: 'warranty',
    glyph: 'shield',
    tone: 'violet',
    label: 'Warranties',
    single: 'Warranty',
    icon: '🛡️',
    showDue: true,
    dueLabel: 'Warranty expiry date',
    dueWord: 'expires',
    showMeter: false,
  },
  {
    id: 'meter',
    glyph: 'bolt',
    tone: 'amber',
    label: 'Meter readings',
    single: 'Meter reading',
    icon: '⚡',
    showDue: false,
    showMeter: true,
  },
];

// How many days ahead counts as "coming up soon" (gets highlighted).
export const SOON_DAYS = 60;

// How many days without a backup before we show the reminder.
export const BACKUP_REMINDER_DAYS = 30;

// The home's label (shown on the dashboard and report) now lives in
// config.js together with the app name. Re-exported here so older code
// that imported ADDRESS from sections.js keeps working.
export { ADDRESS } from './config.js';

// A small helper: find a section by its id. Returns a fallback if the id
// is unknown (e.g. an old backup had a section you have since removed),
// so the app never crashes because of it.
export function getSection(id) {
  return (
    SECTIONS.find((s) => s.id === id) || {
      id,
      label: id,
      single: id,
      icon: '📄',
      glyph: 'file',
      tone: 'slate',
      showDue: true,
      dueLabel: 'Date',
      dueWord: 'due',
      showMeter: true,
    }
  );
}
