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
//
// Keeping it fresh without bothering you: once you've agreed to Hearthbook
// once, Google hands out a new token with no questions when we ask with
// prompt '' and your email as the hint (the window it opens closes by
// itself). Browsers only allow that window straight after a tap, so we ask
// (a) when a sync starts from a tap, and (b) on your next tap anywhere in
// the app once the token is about to run out (see sync.js). We never open
// it with no tap: that would trigger a "pop-up blocked" warning.
let tokenClient = null;
let pending = null;
const HINT_KEY = 'hearthbook.ghint';

function readToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}
function storedToken() {
  const t = readToken();
  return t && t.expiresAt > Date.now() + 60_000 ? t : null;
}
export const hasToken = () => Boolean(storedToken());
// Milliseconds until the current token runs out (0 if none).
export const tokenLeft = () => { const t = readToken(); return t ? Math.max(0, t.expiresAt - Date.now()) : 0; };
// Load Google's sign-in script early, so a quiet refresh after a tap is quick.
export const warmUp = () => getTokenClient().catch(() => {});
export function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
// The last Google account used on this phone, kept as a sign-in hint
// (survives the token running out; cleared by Disconnect).
export const accountHint = () => { try { return localStorage.getItem(HINT_KEY) || ''; } catch { return ''; } };
export function rememberAccount(email) { try { if (email) localStorage.setItem(HINT_KEY, email); else localStorage.removeItem(HINT_KEY); } catch {} }
// True while the browser treats us as "just tapped" (so a window may open).
export const canOpenWindow = () => !navigator.userActivation || navigator.userActivation.isActive;

async function getTokenClient() {
  await loadScript('https://accounts.google.com/gsi/client');
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending; pending = null;
        if (!p) return;
        clearTimeout(p.timer);
        if (resp.error) return p.reject(new AuthError(resp.error_description || resp.error));
        const t = { accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {}
        p.resolve(t.accessToken);
      },
      error_callback: (err) => {
        const p = pending; pending = null;
        if (!p) return;
        clearTimeout(p.timer);
        p.reject(new AuthError(err && err.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Google sign-in did not finish.'));
      },
    });
  }
  return tokenClient;
}

function request(opts, timeoutMs = 0) {
  return getTokenClient().then((client) => new Promise((resolve, reject) => {
    if (pending) { clearTimeout(pending.timer); pending.reject(new AuthError('Google sign-in did not finish.')); }
    pending = { resolve, reject, timer: timeoutMs ? setTimeout(() => { if (pending && pending.reject === reject) { pending = null; reject(new AuthError('Google sign-in did not finish.')); } }, timeoutMs) : 0 };
    client.requestAccessToken(opts);
  }));
}

// A quiet refresh: no account chooser, no consent screen (Google only shows
// something if it really has to). Only call it straight after a tap.
let refreshing = null;
export function refreshSilently(email = accountHint()) {
  if (!refreshing) {
    refreshing = request({ prompt: '', login_hint: email || undefined, hint: email || undefined }, 20_000)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// interactive=true only from a tap (browsers block pop-ups otherwise).
// Not interactive: use the saved token, or refresh quietly if we're inside
// a tap anyway; otherwise say "sign in" (the app shows a gentle prompt).
export async function getToken({ interactive = false, email = '', choose = false } = {}) {
  const t = choose ? null : storedToken();
  if (t) return t.accessToken;
  const hint = choose ? '' : email || accountHint();
  if (!interactive) {
    if (hint && canOpenWindow() && navigator.userActivation) return refreshSilently(hint);
    throw new AuthError();
  }
  // From a tap: no time limit (you may need to pick an account or agree).
  return request(hint ? { prompt: '', login_hint: hint, hint } : { prompt: 'select_account' });
}

export async function revoke() {
  const t = storedToken();
  forgetToken();
  rememberAccount('');
  try {
    if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t.accessToken, () => {});
  } catch {}
}

// ---------- Drive REST ----------
// Some shared files need a "resource key" sent with every request (Google
// added these for link-shared files). The picker tells us the key; we
// remember it here and send it for that file.
const resourceKeys = {};
export function setResourceKeys(map) { Object.assign(resourceKeys, map || {}); }
function rkHeader() {
  const pairs = Object.entries(resourceKeys).filter(([, k]) => k).map(([id, k]) => `${id}/${k}`);
  return pairs.length ? { 'X-Goog-Drive-Resource-Keys': pairs.join(',') } : {};
}

async function call(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await getToken();
  let res;
  try {
    res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...rkHeader(), ...headers } });
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
const FIELDS = 'id,name,version,modifiedTime,parents,mimeType,size,resourceKey,ownedByMe,capabilities(canEdit,canShare)';

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
// Writing the shared file. v13: a "resumable" upload, which Google
// recommends for anything over 5 MB and for phones: step 1 asks Drive for
// an upload address, step 2 sends the file there. If the connection drops
// half way, we ask Drive how much arrived and send only the rest (a few
// tries). If the resumable start itself fails (an old proxy, an odd
// network), it falls back to the simple one-shot upload used before.
// The file's content is exactly the same either way.
export async function writeJSON(id, data) {
  const body = new Blob([JSON.stringify(data)], { type: 'application/json' });
  let session = null;
  try {
    const res = await call(`${UPLOAD}/files/${id}?uploadType=resumable&fields=${q(FIELDS)}&supportsAllDrives=true`, {
      method: 'PATCH', raw: true,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json', 'X-Upload-Content-Length': String(body.size) },
      body: '{}',
    });
    session = res.headers.get('Location');
  } catch (err) {
    if (err instanceof AuthError || err instanceof NotFoundError) throw err;
    session = null;
  }
  if (!session) return writeSimple(id, body);
  return sendResumable(session, body);
}
function writeSimple(id, body) {
  return call(`${UPLOAD}/files/${id}?uploadType=media&fields=${q(FIELDS)}&supportsAllDrives=true`, {
    method: 'PATCH', body, headers: { 'Content-Type': 'application/json' },
  });
}
async function sendResumable(session, body) {
  const total = body.size;
  let from = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (from > 0) headers['Content-Range'] = `bytes ${from}-${total - 1}/${total}`;
    let res;
    try {
      res = await fetch(session, { method: 'PUT', headers, body: from > 0 ? body.slice(from) : body });
    } catch {
      // Dropped connection: ask how much Drive has, then send the rest.
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      from = await uploadedSoFar(session, total, token);
      if (from === total) return null; // all there; caller re-reads metadata on the next sync
      continue;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 401) { forgetToken(); throw new AuthError(); }
    if (res.status === 404 || res.status === 410) throw new Error('Google Drive upload expired. It will try again shortly.');
    if (res.status === 308) { from = rangeEnd(res.headers.get('Range')); continue; }
    let msg = `Google Drive said ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  throw new OfflineError('The upload to Google Drive kept being interrupted. It will try again shortly.');
}
const rangeEnd = (range) => { const m = /bytes=0-(\d+)/.exec(range || ''); return m ? Number(m[1]) + 1 : 0; };
async function uploadedSoFar(session, total, token) {
  try {
    const res = await fetch(session, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${total}` } });
    if (res.ok) return total;
    if (res.status === 308) return rangeEnd(res.headers.get('Range'));
  } catch {}
  return 0;
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
export async function pickFiles({ query = 'hearthbook-sync', title = 'Select the Hearthbook file', multiselect = true } = {}) {
  const token = await getToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject }));
  const P = window.google.picker;
  const R = P.Response || {}, D = P.Document || {};
  return new Promise((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCS)
      .setQuery(query)
      .setMode(P.DocsViewMode.LIST)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    let builder = new P.PickerBuilder()
      .setAppId(GOOGLE_APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOrigin(location.protocol + '//' + location.host)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .addView(view)
      .setTitle(title);
    if (multiselect) builder = builder.enableFeature(P.Feature.MULTISELECT_ENABLED);
    const picker = builder
      .setCallback((data) => {
        const action = data[R.ACTION] || data.action;
        if (action === P.Action.PICKED) {
          const docs = data[R.DOCUMENTS] || data.docs || [];
          resolve({
            action: 'picked',
            docs: docs.map((d) => ({
              id: d[D.ID] || d.id,
              name: d[D.NAME] || d.name || '',
              mimeType: d[D.MIME_TYPE] || d.mimeType || '',
              parentId: d[D.PARENT_ID] || d.parentId || '',
              resourceKey: d.resourceKey || d[D.RESOURCE_KEY] || '',
            })),
          });
        } else if (action === P.Action.CANCEL) resolve({ action: 'cancel', docs: [] });
      })
      .build();
    picker.setVisible(true);
  });
}

// files.get, retrying a few times: right after picking, Google can take a
// moment before the new permission is visible to the API.
export async function getMetaRetry(id, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await getMeta(id); }
    catch (err) {
      if (i >= tries - 1 || !(err instanceof NotFoundError || err.status === 403)) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
}
