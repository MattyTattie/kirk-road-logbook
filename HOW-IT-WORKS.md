# Kirk Road Logbook — how it works

A beginner's guide to this little app: what each file does, how your data
moves around, and how to change things.

> ⚠️ **The most important bit first: BACK UP.**
> Your logbook lives **only on your phone**, inside Chrome's storage. If you
> clear Chrome's *site data* / *storage* for this app (Settings → Apps →
> Chrome → Storage → Clear, or Chrome → Settings → Site settings → All sites →
> Clear & reset), uninstall Chrome, or lose the phone, **the logbook is gone**.
> Tap **💾 Backup → Download backup file** regularly (the app nags you after
> 30 days) and copy that file somewhere else — email it to yourself or put it
> on Google Drive. "Clear cache" alone is usually safe; "Clear storage/data" is not.

---

## 1. What kind of app is this?

It's a **Progressive Web App (PWA)**: an ordinary website (HTML, CSS and
JavaScript) that Chrome lets you *install* like an app. Once installed it
gets its own icon, opens full-screen without the address bar, and works
with no internet connection. There's no server, no account and no cloud —
nothing you type ever leaves the phone (unless you send a backup file yourself).

No frameworks, no "build step": the files you see are exactly the files
the browser runs. Change a file, reload, and you see the change.

## 2. The files

| File | What it does |
|------|--------------|
| `index.html` | The single page of the app. Nearly empty: a header and a `<main>` box that the JavaScript fills in. |
| `styles.css` | All the looks: colours, sizes, big tap-friendly buttons. Colours are variables at the top (`--blue` …). |
| `js/sections.js` | **The list of sections** (Jobs, Receipts, Warranties, Meter readings) plus settings like "60 days counts as soon" and the address. Start here when you want to change things. |
| `js/app.js` | The main program. Draws each screen (list, add/edit form, detail, backup) and reacts to taps. |
| `js/db.js` | Saves and loads entries in **IndexedDB**, the phone's built-in browser database. |
| `js/photos.js` | Shrinks photos to max 1600 px JPEG before saving, and converts photos to/from text for backups. |
| `js/backup.js` | Creates the backup `.json` file and restores from one. |
| `js/utils.js` | Small helpers: building page elements safely, £ formatting, dates, "expires in X days". |
| `report.html`, `report.css`, `js/report.js` | The printable report. The Print button calls `window.print()`; choose **Save as PDF** as the printer. |
| `manifest.json` | The **web app manifest**: name, icons, colours, start page. This is what makes Chrome offer "Install app". |
| `sw.js` | The **service worker**: keeps a copy of the app's files so it opens offline. |
| `icons/` | App icons (192 px, 512 px, and a "maskable" one Android can crop into a circle). Made by `make_icons.py`. |
| `tests/test_app.py` | The automatic test that drives the app in a headless Chrome (see section 7). |

## 3. The three magic ingredients

**IndexedDB (your data).** Every website gets its own small private
database inside the browser. We keep two "stores" (like spreadsheet tabs):
`entries` (one record per job/receipt/etc., photos included as image
"Blobs") and `meta` (little settings, like when you last backed up). It
survives restarts, but belongs to *this Chrome on this phone* and *this web
address* — open the app from a different address and you get a different,
empty database.

**The manifest (installable).** `index.html` links to `manifest.json`. When
Chrome sees a manifest with a name, icons and a start page, *and* a service
worker, *and* the page is served securely (HTTPS or `localhost`), it offers
**Install app / Add to Home screen**.

**The service worker (offline).** `sw.js` is a script Chrome keeps running
in the background for this app. Every time the app asks for one of its
files, the service worker answers from its saved copy (the "cache") first.
So after the first visit, the app opens even with no signal. It caches the
app's *code*, not your data (that's in IndexedDB).

## 4. How data flows

```
 You tap Save on the form
        │
        ▼
 app.js  ── reads the boxes, checks them (title? valid £?)
        │   photos were already shrunk by photos.js when you picked them
        ▼
 db.js   ── saveEntry(entry)  →  IndexedDB on the phone
        │
        ▼
 app.js  ── changes the address to #/view/<id> → draws the detail screen
```

An entry looks like this (photos are image Blobs):

```js
{
  id: "6f1c…", type: "warranty", title: "Worcester boiler",
  date: "2024-11-01", cost: 2400, supplier: "Screwfix", notes: "Serial 12345",
  dueDate: "2026-11-01", meterValue: null, meterUnit: "",
  photos: [{ id: "…", blob: <JPEG> }],
  createdAt: "…", updatedAt: "…"
}
```

**Screens** are chosen by the part of the address after `#`
(`#/list/all`, `#/new/receipt`, `#/edit/<id>`, `#/export`…). When it
changes, `render()` in `app.js` draws the matching screen. That's also why
the phone's Back button works.

**Backup** (`backup.js`): reads every entry, turns each photo into base64
text, writes it all into one JSON file and downloads it. **Restore** reads
such a file, checks it, turns the text back into photos and saves the
entries. Entries with the same id are replaced; nothing else is deleted, so
restoring twice doesn't make duplicates.

## 5. How to change something simple

### Example: add a new section "Insurance"

1. Open `js/sections.js` and add one more object inside `SECTIONS`:

   ```js
   {
     id: 'insurance',          // stored with each entry – don't change it later
     label: 'Insurance',       // tab name
     single: 'Insurance policy',
     icon: '📑',
     showDue: true,            // show a date field…
     dueLabel: 'Renewal date', // …called this
     dueWord: 'renews',        // "renews in 20 days"
     showMeter: false,
   },
   ```

2. Open `sw.js` and change `CACHE_NAME` from `'kirk-road-logbook-v1'` to
   `'kirk-road-logbook-v2'` (do this after **any** change, so phones fetch
   the new files instead of the saved old copy).

3. Reload the app (you may need to close and reopen it once). You'll have a
   new **📑 Insurance** tab, it appears in the "What do you want to add?"
   chooser, in the report, and renewals within 60 days are highlighted —
   all from that one object.

### Other easy tweaks

- **Main colour:** `--blue` at the top of `styles.css` (and `theme_color`
  in `manifest.json`).
- **"Soon" window (60 days) / backup reminder (30 days) / address:**
  constants in `js/sections.js`.
- **Photo size/quality:** `MAX_SIZE` and `QUALITY` in `js/photos.js`.
- **Meter units offered:** the `['kWh', 'm³', …]` list in `js/app.js`.

Remember to bump `CACHE_NAME` in `sw.js` each time.

## 6. Getting it onto your phone

A PWA has to be loaded from a web address, and Chrome only allows
install + offline when that address is **HTTPS** or **localhost**.
(Opening the HTML file directly from the phone's file manager won't work.)
Nothing has been published anywhere — you choose:

- **Option A – free HTTPS hosting of the *code* (e.g. GitHub Pages,
  Netlify, Cloudflare Pages).** Upload this folder, open the address in
  Chrome on the phone, ⋮ menu → **Install app**. Only the app files are
  online; your entries still stay on the phone. (Anyone with the link could
  open their own empty copy of the app, but can't see your data.)
- **Option B – from your PC over USB (stays fully private).** On the PC, in
  this folder run `python -m http.server 8765`. Enable USB debugging on the
  phone, plug it in, then on the PC run `adb reverse tcp:8765 tcp:8765`
  (or use chrome://inspect → Port forwarding). On the phone open
  `http://localhost:8765` in Chrome and install it. After that it runs
  offline from the phone; the PC is only needed again to install updates.

⚠️ Data belongs to the exact address you installed from. If you later
switch addresses (e.g. from Option B to Option A), make a backup first and
restore it in the new copy.

## 7. Testing on a PC

```bash
cd logbook-app
python -m http.server 8765        # then open http://localhost:8765 in Chrome
```

Use Chrome DevTools (F12) → toggle device toolbar to see it at phone size;
**Application** tab shows the manifest, service worker and IndexedDB data.
Tip: tick *Application → Service workers → Update on reload* while you're
editing, so you always see your latest changes.

The automatic test (needs `pip install playwright` and
`python -m playwright install chromium`), with the server running:

```bash
python tests/test_app.py
```

It adds one of each entry type with photos, searches, edits, deletes,
checks warranty highlighting, exports a backup and restores it into a fresh
browser profile, checks the report and offline mode.
