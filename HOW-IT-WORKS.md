# Hearthbook — how it works

*(Formerly "Kirk Road Logbook". Only the look and name changed: your data,
the database and the backup file format are exactly the same, so old
backups restore as before.)*

A beginner's guide to this little app: what each file does, how your data
moves around, and how to change things.

> ⚠️ **The most important bit first: BACK UP.**
> Your logbook lives **only on your phone**, inside Chrome's storage. If you
> clear Chrome's *site data* / *storage* for this app (Settings → Apps →
> Chrome → Storage → Clear, or Chrome → Settings → Site settings → All sites →
> Clear & reset), uninstall Chrome, or lose the phone, **the logbook is gone**.
> Tap **Backup** (bottom bar) **→ Download backup file** regularly (the app nags you after
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
| `index.html` | The single page of the app. Nearly empty: a slim top bar, a `<main>` box that the JavaScript fills in, and the bottom navigation bar. |
| `styles.css` | All the looks: colours (light **and** dark), type, cards, tap-friendly buttons, animations. Colours are variables at the top (`--brand`, `--bg` …). |
| `js/config.js` | **The app's name and your home's label** (`APP_NAME`, `ADDRESS` = `'My home'` by default). Rename the app here. |
| `js/sections.js` | **The list of sections** (Jobs, Receipts, Warranties, Meter readings) with their icon and colour, plus settings like "60 days counts as soon". Start here when you want to change things. |
| `js/app.js` | The main program. Draws each screen (welcome, dashboard, list, add/edit form, detail, backup & settings) and reacts to taps. |
| `js/stats.js` | The sums behind the dashboard: spend this year, monthly spend, next due item, meter usage per day, energy bills. |
| `js/charts.js` | Tiny SVG bar charts and sparklines, drawn by our own code (no chart library, nothing downloaded, works offline). |
| `js/periodcard.js` | The swipeable detail card under the meter chart and the dashboard spending chart (see section 4b). |
| `js/scan.js` | **Scan receipt or bill**: opens a PDF (pdf.js) or reads a photo with OCR (Tesseract). Only loaded when you open the scanner. |
| `js/parse.js` | Turns the scanned text into title, date, total, supplier and, for energy bills, the period and meter readings. Plain JavaScript, no browser needed (so it can be tested with Node). |
| `vendor/` | The two bundled libraries for the scanner, with their licences (see section 4c). Nothing is fetched from the internet. |
| `js/icons.js` | The line icons, as plain SVG path strings. |
| `js/theme.js` | Light / Dark / Auto appearance (remembered in `localStorage`). |
| `fonts/inter-latin.woff` | The Inter typeface (Latin letters only, ~38 KB), stored with the app so it works offline. Licence: SIL Open Font License, see `fonts/LICENSE-Inter.txt`. |
| `js/db.js` | Saves and loads entries in **IndexedDB**, the phone's built-in browser database. |
| `js/photos.js` | Shrinks photos to max 1600 px JPEG before saving, and converts photos to/from text for backups. |
| `js/backup.js` | Creates the backup `.json` file and restores from one. |
| `js/utils.js` | Small helpers: building page elements safely, £ formatting, dates, "expires in X days". |
| `report.html`, `report.css`, `js/report.js` | The printable report. The Print button calls `window.print()`; choose **Save as PDF** as the printer. |
| `manifest.json` | The **web app manifest**: name, icons, colours, start page. This is what makes Chrome offer "Install app". |
| `sw.js` | The **service worker**: keeps a copy of the app's files so it opens offline. |
| `icons/` | App icon: `icon.svg` (master + favicon) and PNGs (192 px, 512 px, and a "maskable" one Android can crop into a circle). All made by `make_icons.py` from the SVG. |
| `tests/` | `test_app.py` (end-to-end test), `test_upgrade.py` (old app's data → new app), `scan_accuracy.mjs` (how well the scanner reads real bills), `screenshots.py`, `screenshots_cards.py` and `make_comparison.py` (phone screenshots), plus two made-up sample documents `demo-receipt.png` / `demo-bill.pdf`. See section 7. |

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
(`#/home`, `#/list/all`, `#/new/receipt`, `#/edit/<id>`, `#/export`…).
The very first time the app opens with an empty logbook it shows a
**welcome screen**; once dismissed it's remembered (in `localStorage`, not
in your logbook data). If the phone already has entries it's skipped. When it
changes, `render()` in `app.js` draws the matching screen. That's also why
the phone's Back button works.

**Backup** (`backup.js`): reads every entry, turns each photo into base64
text, writes it all into one JSON file and downloads it. **Restore** reads
such a file, checks it, turns the text back into photos and saves the
entries. Entries with the same id are replaced; nothing else is deleted, so
restoring twice doesn't make duplicates.

## 4b. Chart detail cards

On the **Meters** screen, tap a bar in *Daily use between readings* (or
Tab to it and press Enter/Space; the arrow keys, Home and End move along the
bars). The bar is highlighted and a card opens with that period's dates,
kWh used, average kWh a day, the bill and the cost per kWh (bill ÷ kWh, so
it includes the standing charge), and the change from the period before
(kWh and £). If a bill is logged for that period, its photo is shown with an
**Open bill** button; if not, the card says so and offers **Add bill**.

The bill for a period is the closing reading itself if it has a cost (the
way bills are usually logged), otherwise any meter entry with a cost dated
inside the period.

Swipe the card left or right (or use the ‹ › buttons, or ←/→ while it has
focus) to move to the next or previous period. The card follows your finger,
then slides across, and the highlighted bar moves with it. It stops at the
first and last period, where that arrow is greyed out. A mostly vertical drag
still scrolls the page.

The dashboard's 12-month **Spending** chart has the same card: month total,
number of entries with a cost, change from the month before, and the three
biggest costs (tap one to open it).

## 4c. Scan a receipt or bill

**+ → Scan receipt or bill**: take a photo, or choose a photo, screenshot or
PDF. The app shows *Reading…* with a progress bar, then opens a normal
**New receipt** form (or a **New meter reading** form for an energy bill)
with the details filled in, the fields it filled lightly tinted, and a
**Check these details** note saying what it couldn't find. The picture (or
page 1 of the PDF) is attached as the entry's photo. Nothing is saved until
you press Save.

How it reads the document, all on the phone:

1. **PDF with real text** (most emailed bills): the text is read directly with
   pdf.js. This is exact.
2. **Photo, screenshot or scanned PDF**: Tesseract OCR turns the picture into
   text (about 1–4 seconds a page on a recent phone).
3. `js/parse.js` picks out the supplier (from a list of UK energy companies
   and shops, else the name at the top), the date, the total, and for energy
   bills the charges for the period, the period dates, kWh used and the
   opening and closing readings. A bill is dated on its closing-reading date
   (or the day after the period ends), the same way bills are logged here.

**Limits.** OCR can misread blurry photos, so always check the amounts. The
first page of an EDF bill doesn't show the meter readings (they're on
page 2), so a photo of page 1 fills everything **except the reading**, which
you type in. A PDF bill includes all its pages, so the reading is found. iPhone
HEIC photos can't be decoded by Chrome on Android; you get a friendly message.

**Size and speed.** The scanner adds about 11 MB of files to the app folder:
`vendor/tesseract/` (OCR engine ~2.9 MB in each of two builds, English model
`eng.traineddata.gz` 2.9 MB, loader 0.2 MB) and `vendor/pdfjs/` (1.7 MB).
None of it loads when the app starts. `js/scan.js` and the libraries are only
loaded when you pick a file. A few seconds after the app opens, the service
worker quietly downloads the files the phone needs (about 8 MB, only the
build this phone uses) into a separate cache, `hearthbook-ocr-v1`, so
scanning works offline. This is skipped when Android's *Data saver* is on;
the files are then fetched the first time you scan. The scanner screen tells
you whether it's ready offline. Because that cache has its own version, a
normal app update doesn't download the 8 MB again.

**Licences.** Tesseract.js and tesseract.js-core: Apache 2.0
(`vendor/tesseract/LICENSE.md`, `LICENSE-tesseract-core.txt`); the English
model is from the Tesseract project (Apache 2.0). pdf.js (Mozilla):
Apache 2.0 (`vendor/pdfjs/LICENSE.txt`).

**Accuracy test.** `node tests/scan_accuracy.mjs` runs the parser over text
read from your real bills and receipts (kept in
`/workspace/logbook-scan-samples/`, *outside* the app folder because they
contain personal details) and compares it with what's in your logbook.

## 5. How to change something simple

### Example: add a new section "Insurance"

1. Open `js/sections.js` and add one more object inside `SECTIONS`:

   ```js
   {
     id: 'insurance',          // stored with each entry – don't change it later
     label: 'Insurance',       // tab name
     single: 'Insurance policy',
     icon: '📑',               // emoji used in the printed report
     glyph: 'file',            // line icon in the app (any name from js/icons.js)
     tone: 'slate',            // colour: indigo, teal, violet, amber, slate or brand
     showDue: true,            // show a date field…
     dueLabel: 'Renewal date', // …called this
     dueWord: 'renews',        // "renews in 20 days"
     showMeter: false,
   },
   ```

2. Open `sw.js` and change `CACHE_NAME`, e.g. from `'hearthbook-v3'` to
   `'hearthbook-v4'` (do this after **any** change, so phones fetch
   the new files instead of the saved old copy).

3. Reload the app (you may need to close and reopen it once). You'll have a
   new **Insurance** tab, it appears in the "What do you want to add?"
   chooser, in the report, and renewals within 60 days are highlighted —
   all from that one object.

### Other easy tweaks

- **App name:** `APP_NAME` / `APP_SHORT_NAME` in `js/config.js`, plus
  `name` / `short_name` in `manifest.json` and the `<title>` in
  `index.html` and `report.html` (those three can't read JavaScript).
- **Home label** on the dashboard and report: `ADDRESS` in `js/config.js`
  (default `'My home'`). Avoid putting your full postal address there if
  you publish the code.
- **Main colour:** `--brand` at the top of `styles.css` (light and dark
  sets), and the colours at the top of `make_icons.py` for the icon.
- **App icon:** edit the SVG in `make_icons.py`, then run
  `python3 make_icons.py` (uses Playwright's Chromium to turn it into PNGs).
- **"Soon" window (60 days) / backup reminder (30 days):**
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
cd logbook-redesign
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

It goes through the welcome screen, adds one of each entry type with
photos, checks the dashboard cards and chart, searches, edits, deletes,
checks warranty highlighting, exports a backup (checking the format string
is unchanged) and restores it into a fresh browser profile, checks the
report, offline mode and dark mode, and finally restores the real 44-entry
Gmail backup into another fresh profile. Use another port with
`LOGBOOK_BASE=http://localhost:8766/ python tests/test_app.py`.

It also taps, swipes and arrow-keys through the meter and spending chart
cards, and scans a real EDF PDF bill and a receipt photo (checking the
filled-in fields, the attached picture, a bad file, and scanning offline
after the background download).

`tests/test_upgrade.py` serves the original app and this one from the same
address, saves data with the old one and checks the new one shows it all.

## 8. What must never change (or old data/backups break)

- `DB_NAME = 'kirk-road-logbook'`, `DB_VERSION` and the `entries` / `meta`
  stores in `js/db.js`.
- `FORMAT = 'kirk-road-logbook-backup'` and `FORMAT_VERSION` in
  `js/backup.js`. (The backup *file name* now starts `hearthbook-backup-…`;
  that's only a name — restore looks at what's inside.)
- Section `id`s in `js/sections.js`.
- When you change any app file, bump `CACHE_NAME` in `sw.js` (now
  `hearthbook-v3`). Only bump `OCR_CACHE` (`hearthbook-ocr-v1`) if the files
  in `vendor/` change.
