// theme.js — light / dark / follow-the-phone appearance.
// The choice is a display preference only, so it lives in localStorage
// (not in the logbook database, and not in backups).
const KEY = 'hearthbook.theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(choice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f1115' : '#f6f4ef';
}

export function setTheme(choice) {
  try { localStorage.setItem(KEY, choice); } catch {}
  applyTheme(choice);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
