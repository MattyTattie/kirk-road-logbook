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
//   soonDays  – (optional) how many days ahead counts as "soon" for this
//               section, instead of SOON_DAYS below
//   kind      – (optional) 'insurance' turns on the policy fields
//
// Older copies of the app don't know newer sections (e.g. Insurance). They
// still open, back up and sync those entries using the fallback in
// getSection() at the bottom, so nothing is lost.

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
    label: 'Electricity bills', // was 'Meter readings' (id stays 'meter')
    single: 'Electricity bill', // v14.6 (was 'Meter reading')
    icon: '⚡',
    showDue: false,
    showMeter: true,
  },
  {
    // Policies: renewal date is stored in dueDate (so older app versions
    // still show it as a due date), the insurer in supplier, and the start
    // date in date. Extra fields: insType, policyNumber, costFreq, covered.
    id: 'insurance',
    glyph: 'umbrella',
    tone: 'rose',
    label: 'Insurance',
    single: 'Insurance policy',
    icon: '☂️',
    kind: 'insurance',
    showDue: true,
    dueLabel: 'Renewal date',
    dueWord: 'renews',
    soonDays: 30,
    showMeter: false,
  },
];

// Insurance policy types (stored as the short id).
export const INSURANCE_TYPES = [
  { id: 'home', label: 'Home' },
  { id: 'car', label: 'Car' },
  { id: 'life', label: 'Life' },
  { id: 'other', label: 'Other' },
];
export const insuranceTypeLabel = (id) => (INSURANCE_TYPES.find((t) => t.id === id) || { label: 'Other' }).label;

// Yearly cost of a policy: monthly premiums × 12.
export function annualCost(e) {
  const c = Number(e && e.cost) || 0;
  return e && e.costFreq === 'monthly' ? Math.round(c * 1200) / 100 : c;
}

// How many days ahead counts as "coming up soon" (gets highlighted).
export const SOON_DAYS = 60;

// "Soon" window for one entry (insurance renewals: 30 days).
export const soonDaysFor = (e) => getSection(e && e.type).soonDays || SOON_DAYS;

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
