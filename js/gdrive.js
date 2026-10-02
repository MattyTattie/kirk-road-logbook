// =====================================================================
// gdrive.js — talking to Google: sign-in, Drive files, the file picker.
// =====================================================================
// Only loaded once you turn on "Sync with Google Drive". Nothing here runs
// for phone-only use. There's no server: the phone signs in with Google
// directly ("Google Identity Services" token flow) and calls the Drive
// REST API with fetch().
//
// PERMISSION ("scope"): drive.file. The app can only see files it created
// itself, or files you hand it in Google's own file picker. It can't see
// anything else in your Drive. See HOW-IT-WORKS.md section 9 for why.

import { GOOGLE_CLIENT_ID, GOOGLE_API_KEY, GOOGLE_APP_ID } from './config.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'hearthbook.gtoken';

export const isConfigured = () => Boolean(GOOGLE_CLIENT_ID) && !/^PASTE/.test(GOOGLE_CLIENT_ID);

// Errors the sync code reacts to differently.
export class AuthError extends Error { constructor(m = 'Please sign in to Google again.') { super(m); this.name = 'AuthError'; } }
export class OfflineError extends Error { constructor(m = 'No internet connection.') { super(m); this.name = 'OfflineError'; } }
export class NotFoundError extends Error { constructor(m = 'File not found in Drive.') { super(m); this.name = 'NotFoundError'; } }

// ---------- loading Google's scripts (only when needed) ----------
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new OfflineError('Could not reach Google. Are you online?')); };
      document.head.append(s);
    });
  }
  return scripts[src];
}

// ---------- sign-in (access tokens) ----------
// Google gives a short-lived (1 hour) access token. We keep it in
// localStorage so a quick re-open of the app can sync straight away.
// When it has run out, a tap on "Sync" / "Sign in" fetches a new one
// (Google only shows a pop-up if it needs you to choose or agree).
let tokenClient = null;
let pending = null;

function storedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}
export const hasToken = () => Boolean(storedToken());
export function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

async function getTokenClient() {
  await loadScript('https://accounts.google.com/gsi/client');
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending; pending = null;
        if (!p) return;
        if (resp.error) return p.reject(new AuthError(resp.error_description || resp.error));
        const t = { accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {}
        p.resolve(t.accessToken);
      },
      error_callback: (err) => {
        const p = pending; pending = null;
        if (p) p.reject(new AuthError(err && err.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Google sign-in did not finish.'));
      },
    });
  }
  return tokenClient;
}

// interactive=true only from a tap (browsers block pop-ups otherwise).
export async function getToken({ interactive = false, email = '' } = {}) {
  const t = storedToken();
  if (t) return t.accessToken;
  if (!interactive) throw new AuthError();
  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: email ? '' : 'select_account', login_hint: email || undefined });
  });
}

export async function revoke() {
  const t = storedToken();
  forgetToken();
  try {
    if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t.accessToken, () => {});
  } catch {}
}

// ---------- Drive REST ----------
async function call(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await getToken();
  let res;
  try {
    res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401) { forgetToken(); throw new AuthError(); }
  if (res.status === 404) throw new NotFoundError();
  if (!res.ok) {
    let msg = `Google Drive said ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const q = (s) => encodeURIComponent(s);
const FIELDS = 'id,name,version,modifiedTime,parents,mimeType,capabilities(canEdit,canShare)';

export function whoAmI() {
  return call(`${API}/about?fields=${q('user(displayName,emailAddress)')}`).then((r) => r.user);
}
export function getMeta(id) {
  return call(`${API}/files/${id}?fields=${q(FIELDS)}&supportsAllDrives=true`);
}
export async function list(query) {
  const r = await call(`${API}/files?q=${q(query)}&fields=${q(`files(${FIELDS})`)}&pageSize=100&spaces=drive&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  return r.files || [];
}
export async function readJSON(id) {
  const res = await call(`${API}/files/${id}?alt=media&supportsAllDrives=true`, { raw: true });
  const text = await res.text();
  try { return JSON.parse(text || 'null'); } catch { throw new Error('A sync file in Drive is damaged.'); }
}
export function writeJSON(id, data) {
  return call(`${UPLOAD}/files/${id}?uploadType=media&fields=${q(FIELDS)}&supportsAllDrives=true`, {
    method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' },
  });
}
export function createFolder(name) {
  return call(`${API}/files?fields=${q(FIELDS)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', appProperties: { hearthbook: 'folder' } }),
  });
}
export async function createJSON(name, parentId, data) {
  const meta = await call(`${API}/files?fields=${q(FIELDS)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/json', appProperties: { hearthbook: 'data' } }),
  });
  await writeJSON(meta.id, data);
  return meta;
}
// Give someone edit access to the shared folder (Google emails them).
export function shareFolder(folderId, email) {
  return call(`${API}/files/${folderId}/permissions?sendNotificationEmail=true&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
}

// ---------- Google Picker ----------
// The person joining picks the shared Hearthbook files once; that is what
// gives this app (and only this app) access to them under drive.file.
export async function pickFiles({ query = 'hearthbook', title = 'Select all the Hearthbook files' } = {}) {
  const token = await getToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject }));
  const P = window.google.picker;
  return new Promise((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCS).setQuery(query).setMode(P.DocsViewMode.LIST).setIncludeFolders(false);
    const picker = new P.PickerBuilder()
      .setAppId(GOOGLE_APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .addView(view)
      .setTitle(title)
      .setCallback((data) => {
        if (data.action === P.Action.PICKED) resolve((data.docs || []).map((d) => ({ id: d.id, name: d.name, parentId: d.parentId })));
        else if (data.action === P.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
