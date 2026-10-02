// =====================================================================
// config.js — the app's name and your home's label, in ONE place.
// =====================================================================
//
// Want to rename the app? Change APP_NAME / APP_SHORT_NAME here, then also
// change "name" and "short_name" in manifest.json and the <title> in
// index.html and report.html (those files can't read JavaScript; the app
// overwrites the visible title from here anyway once it starts).
//
// NOTHING here affects your saved data: the database name and the backup
// format live in db.js and backup.js and must never change.

export const APP_NAME = 'Hearthbook';
export const APP_SHORT_NAME = 'Hearthbook';
export const APP_TAGLINE = 'Your home, on record.';

// Used in backup file names, e.g. "hearthbook-backup-2026-10-02.json".
// (Only the file NAME — the format inside the file never changes, so
// old "kirk-road-logbook-backup-…" files still restore fine.)
export const APP_SLUG = 'hearthbook';

// How your home is labelled on the dashboard and printed report.
// Keep it short and non-identifying, e.g. 'My home' or a street name.
// Don't put your full postal address here if you publish the code.
export const ADDRESS = 'My home';

// ---------------------------------------------------------------------
// Google Drive sync (optional, off until you set these up)
// ---------------------------------------------------------------------
// Sharing one logbook between two phones uses YOUR OWN free Google Cloud
// project. HOW-IT-WORKS.md, section 9, explains how to get these three
// values step by step. They are not secret: they only work for this
// app's web address (https://mattytattie.github.io) and the people you
// add as test users.
//
// While the client ID still says "PASTE…", the sync card on the Backup
// screen says it isn't set up yet and the app stays phone-only.
export const GOOGLE_CLIENT_ID = '425528310525-goun70d3ns6egm13692nn6hr1acgqfea.apps.googleusercontent.com';
export const GOOGLE_API_KEY = 'AIzaSyAVfmCDzGqeVymJyBpQg7rK9s6Hc-RiMYo'; // for the Google file picker
export const GOOGLE_APP_ID = '425528310525'; // the project NUMBER (digits)
