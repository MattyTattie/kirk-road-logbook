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
| `js/sections.js` | **The list of sections** (Jobs, Receipts, Warranties, Electricity bills, Insurance) with their icon and colour, plus settings like "60 days counts as soon". Start here when you want to change things. |
| `js/app.js` | The main program. Draws each screen (welcome, dashboard, list, add/edit form, detail, backup & settings) and reacts to taps. |
| `js/stats.js` | The sums behind the dashboard: spend this year, monthly spend, next due item, meter usage per day, energy bills. |
| `js/charts.js` | Tiny SVG bar charts and sparklines, drawn by our own code (no chart library, nothing downloaded, works offline). |
| `js/periodcard.js` | The swipeable detail card under the meter chart and the dashboard spending chart (see section 4b). |
| `js/scan.js` | **Scan receipt or bill**: opens a PDF (pdf.js) or reads a photo with OCR (Tesseract). Only loaded when you open the scanner. |
| `js/tariff.js` | Unit rates (pence per kWh) and standing charges (pence a day): reads them from bill notes and from what you type in the meter form. Small, so the main screens use it without loading the scanner. |
| `js/parse.js` | Turns the scanned text into title, date, total, supplier and, for energy bills, the period and meter readings. Plain JavaScript, no browser needed (so it can be tested with Node). |
| `js/sync.js` | **Optional Google Drive sync**: merges this phone's entries with the shared folder, entry by entry (section 9). Does nothing while sync is off. |
| `js/gdrive.js` | Google sign-in, Drive file calls and the Google file picker. Google's scripts are only loaded once you tap Connect. |
| `vendor/` | The two bundled libraries for the scanner, with their licences (see section 4c). Nothing is fetched from the internet. |
| `js/icons.js` | The line icons, as plain SVG path strings. |
| `js/prefs.js` | **Settings for this phone only** (in `localStorage`, never in backups or sync): which sections are hidden and their order, reminders on/off and which reminders were already shown, and whether the quick tour was seen. |
| `js/house.js` | The **house picture** on the home screen: an SVG drawing whose sky, window glow and roof flag follow your data. |
| `js/homeui.js` | Home-screen parts: the house card, *Ask Hearthbook*, the quick tour, the editable section tiles, and the Settings cards for sections and reminders. |
| `js/search.js` | **Ask Hearthbook**: searching every entry on the phone, with small typos allowed and simple questions ("when does the car insurance renew?"). Plain JavaScript, tested with Node. |
| `js/reminders.js` | Reminder notifications for renewals, warranties and jobs due within 30 days. |
| `js/motion.js` | Small animations: totals counting up, screen transitions, light vibration on taps. All switched off when the phone asks for reduced motion. |
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
| `tests/` | `test_app.py` (end-to-end test), `test_upgrade.py` (old app's data → new app), `scan_accuracy.mjs` (how well the scanner reads real bills), `test_sync.py` + `fake_drive.py` (two phones syncing through a pretend Google Drive), `sync_plan.mjs` (the merge rules), `test_insurance.py` (Insurance, unit rates, year pickers, the EDF gap-fill backup, older app versions), `tariff_parse.mjs` (reading rate lines), `test_foreign_receipt.py` + `lpa-airport-receipt.jpg` (a holiday receipt in euros), `test_v10.py` (house picture, Ask, tour, customising sections, reminders, share target, motion), `search.mjs` and `reminders_house.mjs` (search, reminder and house-picture rules), `screenshots.py`, `screenshots_cards.py` and `make_comparison.py` (phone screenshots), plus made-up sample documents `demo-receipt.png`, `demo-bill.pdf` and `demo-bill-e7.pdf` (a day/night bill with a price change; `make_e7_bill.py` makes it). See section 7. |

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

On the **Electricity** screen, tap a bar in *Daily use between readings* (or
Tab to it and press Enter/Space; the arrow keys, Home and End move along the
bars). The bar is highlighted and a card opens with that period's dates,
kWh used, average kWh a day, the bill, the **unit rate** and **standing
charge** from the bill (with what the standing charge cost for the period,
before VAT), the **all-in cost per kWh** (bill ÷ kWh, so it includes the
standing charge and VAT), and the change from the period before (kWh and £).

Where the rates come from: the meter form's *Tariff from the bill* fields
(filled in by the scanner, or typed: `21.074`, `Day 30.1, Night 15.2`, or
`24.51 to 13 May, 21.074 from 14 May` when the price changed part way
through). If those are empty, the app reads the bill's notes (e.g. "at
21.074p/kWh … standing 57.972p/day"). A price change shows as
`24.51p → 21.07p` with "new rate from 14 May"; day/night meters show
`Day 30.10p · Night 15.20p`. Notes like "at 20.189/21.074p" (two rates, no
dates) show as `20.19p / 21.07p`, "tariff changed in this period". If a bill is logged for that period, its photo is shown with an
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

**Year picker / year on year.** Both charts have chips above them:
*12 months* (or *Last 12 months* on the Electricity screen, where the years
are listed newest first: 2026, 2025, 2024) and the last three years
with data (2024, 2025, 2026). Pick a year and you get Jan–Dec bars for that
year with the same months of the year before as slim grey bars behind them.
The heading compares like with like: for this year it's January to the
current month against the same months last year. On the Electricity screen, kWh
are spread evenly over the days between two readings and added up per
calendar month (pale = no readings that month), and the card compares the
month with the same month last year. Months with no logged bill count as
£0, so gaps in the logbook (e.g. early 2025) make a year look cheaper.

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
   text (about 1–4 seconds a page on a recent phone). For a photo of a
   receipt lying on a table or seat, `scan.js` first crops to the paper (the
   biggest patch of light pixels) because a dark background can make the OCR
   skip whole blocks, like the shop name. Tesseract then straightens tilted
   text itself (`rotateAuto`).
3. `js/parse.js` picks out the supplier (from a list of UK energy companies
   and shops, else the name at the top), the date, the total, and for energy
   bills the charges for the period, the period dates, kWh used and the
   opening and closing readings. A bill is dated on its closing-reading date
   (or the day after the period ends), the same way bills are logged here.

**Holiday receipts (another currency).** When a receipt is mostly in euros
(or dollars), for example "Total EUR 11.90" or "MONEDA DE TRANSACCION: EUR":

- **Total:** the parser takes the amount you actually *paid*, i.e. the card
  line ("PLANET MASTERCARD 11.90") or the card slip ("CANTIDAD TOTAL: 11,90").
  If several lines disagree, it takes the amount the receipt repeats most.
  It never takes a subtotal printed before an offer ("Total 19.00", then
  "2 for 11.90 -7.10").
- **Reading:** "11,90" is read as 11.90, and barcode numbers are ignored. It
  understands the Spanish words Total, Importe, IVA, Fecha, Cantidad and
  Precio, and dates like 14/08/26 or "3 de agosto de 2026".
- **Shop name:** an airport shop is named after the airport, e.g. "Gran
  Canaria Airport shop" (from "LPA (ES) > EDI (GB)" or "AEROPUERTO DE GRAN
  CANARIA"). Other shops come from a company line ending in S.L., S.A.,
  GmbH and so on.
- **Notes:** the items, any discount and the flight go in the notes, e.g.
  "Paid €11.90 (EUR) by Mastercard. Items: 2 × Milka Choco Swi (€9.50
  each). Discount −€7.10. Flight LS0716 LPA → EDI."
- **Currency:** the form's **Currency** box is set to € EUR. The entry
  stores `currency: 'EUR'` as an extra field. The database, the backup
  format and the Drive sync are unchanged, and older app versions show the
  amount with a £. Pound entries have no `currency` field, exactly as before.
- **Totals:** euro amounts count at face value. For exact £ totals, type the
  £ amount from your bank statement and pick £.

UK documents are read exactly as before. The currency and airport rules
only apply when the receipt isn't in pounds.

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

## 4d. Insurance

**+ → Insurance policy.** Fields: type (Home / Car / Life / Other), insurer,
policy number, cost and whether it's paid yearly or monthly, start date,
**renewal date**, who's covered, notes, and photos or documents (choose a
PDF and page 1 is kept as a picture). Leave the name empty and it becomes
e.g. "Car insurance – Aviva".

The Insurance list is sorted by renewal date and shows the total yearly cost
(monthly premiums × 12). A renewal within **30 days** is highlighted, always
appears under **Coming up** on the dashboard (even if three other things are
due sooner), and the **Next due** card adds "… renews within 30 days".
Premiums are a running cost, not one-off spending, so they're left out of the
*Spent in* total and the Spending chart; the Insurance tile shows them per
year instead.

How it's stored (so nothing breaks): an ordinary entry with
`type: 'insurance'`, the insurer in `supplier`, the start date in `date` and
the renewal date in `dueDate`, plus `insType`, `policyNumber`, `costFreq`
('annual'/'monthly') and `covered`. Same database, same backup format
(version 1), and Drive sync carries every field. Older copies of the app
(the original one and the published v5–v6) restore and sync these entries
without errors: they show them as a plain "insurance" section with the
renewal as a due date, and editing one there keeps the policy fields
(tested in `tests/test_insurance.py`).

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

   (Insurance is now built in like this. It also has `kind: 'insurance'`,
   which turns on the extra policy fields, and `soonDays: 30`.)

2. Open `sw.js` and change `CACHE_NAME`, e.g. from `'hearthbook-v10'` to
   `'hearthbook-v11'` (do this after **any** change, so phones fetch
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
- **"Soon" window (60 days; insurance 30 via `soonDays`) / backup reminder (30 days):**
  constants in `js/sections.js`. The backup reminder is hidden while Google
  Drive sync is connected and has synced in the last 7 days without a
  problem (`isHealthy()` in `js/sync.js`), because Drive then holds a full
  copy, photos included. It comes back if sync is switched off, shows an
  error or sign-in prompt, or hasn't synced for a week.
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

`tests/test_sync.py` runs two phones (Matthew and Becca) against a fake,
in-memory Google Drive (`tests/fake_drive.py`, which follows the same
"drive.file" rules as the real one). It checks connecting, starting and
joining a shared logbook, edits, photos, deletes, offline, a clash, an
expired sign-in and disconnecting:
`LOGBOOK_BASE=http://localhost:8766/ python tests/test_sync.py`.
`node tests/sync_plan.mjs` checks the merge rules on their own.

`tests/test_insurance.py` checks the Insurance section, unit rates and
standing charges, the year pickers, the EDF gap-fill backup, and that the
original app (`OLD_APP`, default `http://localhost:8770/`) and the published
v5 (`V5_APP`, default `http://localhost:8772/old/`) cope with insurance
entries. `node tests/tariff_parse.mjs` checks the rate parsing.

`tests/test_foreign_receipt.py` scans the Gran Canaria airport receipt photo
(`tests/lpa-airport-receipt.jpg`), as taken and tilted 7° and 5°. It then
checks similar Spanish receipts, and the scan → form → save → backup flow with
the currency.

`tests/test_upgrade.py` serves the original app and this one from the same
address, saves data with the old one and checks the new one shows it all.

## 8. What must never change (or old data/backups break)

- `DB_NAME = 'kirk-road-logbook'`, `DB_VERSION` and the `entries` / `meta`
  stores in `js/db.js`.
- `FORMAT = 'kirk-road-logbook-backup'` and `FORMAT_VERSION` in
  `js/backup.js`. (The backup *file name* now starts `hearthbook-backup-…`;
  that's only a name — restore looks at what's inside.)
- Section `id`s in `js/sections.js`. (Hiding or reordering sections in
  Settings only changes this phone's `localStorage`; the ids and the entries
  stay exactly the same.)
- When you change any app file, bump `CACHE_NAME` in `sw.js` (now
  `hearthbook-v11`). Only bump `OCR_CACHE` (`hearthbook-ocr-v1`) if the files
  in `vendor/` change.

## 9. Sharing one logbook with Google Drive (optional)

Off unless you turn it on. With it off, the app is exactly as before:
everything stays on the phone and nothing is sent anywhere.

### What it does

You and Becca each keep a full copy of the logbook on your own phone, so it
still works with no signal. A folder called **Hearthbook** in Matthew's
Google Drive, shared with Becca, is the meeting point. Each phone swaps
changes with it:

- when the app opens (and when you come back to it),
- about 3 seconds after you save or delete something,
- when you tap **Sync now** (Backup screen) or the status chip at the top
  ("Synced 2 min ago"),
- when the phone gets its signal back.

**Clashes.** Changes are merged entry by entry. Becca editing the boiler
entry while you add a receipt is not a clash; both arrive. Only if you both
change *the same* entry before either phone syncs does the later save win
(by the phone's clock). Deleting leaves a small "tombstone" note in the
folder, so the delete reaches the other phone instead of the entry coming
back. If both phones already have entries the first time they sync, they
are combined by entry ID. Entries restored from the same backup on both
phones are not duplicated.

**What's in the folder:** `hearthbook-sync.json` (the text of every entry,
tombstones, and a small pointer per photo) plus a `Hearthbook photos/`
subfolder of JPEG files (from v13.7). Don't rename or delete the sync file.
Backups and restore work exactly as before. Sync uses the same database,
plus a few settings in the `meta` store (`sync`, `syncTombstones`,
`syncCache`, `syncDiag`, and optionally `photoFolderId`) that backups don't include.

*Older layouts.* v1 (2 Oct 2026) also made `hearthbook-photos-1.json` … `-8.json`.
v2 put photo bytes inside `hearthbook-sync.json`. v3 (13.7) moves photos to
separate Drive JPEGs and keeps the sync file text-only. Opening the updated
app and syncing once migrates; Sync details show "layout: v3" when done.

### Why "drive.file" permission, and why one file

Google offers two sensible levels of Drive permission ("scope"):

| | **drive.file** (what we use) | **drive** (full Drive) |
|---|---|---|
| What the app can touch | Only files it created, or that you hand it in Google's file picker | Everything in your Drive |
| Google's rating | Non-sensitive, no review needed | **Restricted**: to publish it needs Google's verification plus a paid yearly security assessment (CASA). In "Testing" mode it works for up to 100 named test users, with a warning screen |
| Someone joining | The other person taps one file once in Google's picker | The other person just picks the folder |
| File layout | One shared file | Could be one small file per entry and photo |
| Cost | Any change re-uploads the whole file (all photos: about 3 MB today, growing with every photo). Unchanged syncs only check the file's version, so they download nothing | Uploads just what changed |

`drive.file` was chosen because it's the least access that works, and
Google treats it as low risk. With `drive.file`, choosing a *folder* in the
picker does **not** let the app see the files inside it (Google confirms
this: the folder's `canListChildren` is false and listing it comes back
empty). Becca's phone also can't see any *new* file your phone creates later.
So everything lives in one file that Becca picks once.

If the logbook gets so big that uploads feel slow on mobile data (roughly
30 MB or more, i.e. hundreds of photos), the way out is the full `drive`
permission with one file per photo. That's a one-line change to the scope
plus a different file layout, and it brings Testing-mode warnings.

**Sync details.** Under the sync card, *Sync details (for troubleshooting)*
shows the layout, the shared file's id, what Google's picker last returned
(the action, and each file's name, id, type, and whether it had a resource
key), whether the app could then open each file, and, after **Refresh
details**, every Hearthbook file the app can open. A screenshot of it is
enough to diagnose most problems.

**Verification.** Because `drive.file` is non-sensitive, you never need
Google's app review. In **Testing** mode only the people you add as test
users can sign in (up to 100), and they see a short "this app is being
tested" warning before agreeing. If that warning bothers you, you can press
**Publish app**. With only `drive.file` that needs no review; the consent
screen just won't show a logo. The "unverified app" warning and the
100-user cap only apply to sensitive or restricted scopes, which this app
doesn't use.

**Sign-in.** There's no server, so Google gives the phone an access token
that lasts about an hour. It's kept on the phone (`localStorage`) for that
hour. After that, the next sync shows **Sign in to sync** and one tap fixes
it (usually without typing anything). The app never opens a Google pop-up
by itself.

### One-time setup (about 15 minutes, on a computer)

You need: Matthew's Google account, and Becca's Gmail address.

1. Go to **https://console.cloud.google.com** and sign in as Matthew. If
   asked, agree to the Google Cloud terms (it's free; no billing needed).
2. Top bar → project list → **New project**. Name: `Hearthbook` → **Create**.
   Make sure "Hearthbook" is selected in the top bar afterwards.
3. Menu ☰ → **APIs & Services → Library**. Search **Google Drive API** →
   **Enable**. Back to Library, search **Google Picker API** → **Enable**.
4. Menu ☰ → **Google Auth Platform** (older name: *OAuth consent screen*) →
   **Get started**:
   - App name `Hearthbook`, user support email = your Gmail → Next
   - Audience: **External** → Next
   - Contact email: your Gmail → Next → tick the agreement → **Create**.
5. **Audience** (left menu): leave Publishing status = **Testing**. Under
   **Test users** → **Add users** → type your Gmail and Becca's Gmail →
   **Save**.
6. **Data Access** → **Add or remove scopes** → in the filter type
   `drive.file` → tick **…/auth/drive.file** ("See, edit, create and delete
   only the specific Google Drive files you use with this app") → **Update**
   → **Save**.
7. **Clients** → **Create client**:
   - Application type: **Web application**, name `Hearthbook web`
   - **Authorised JavaScript origins** → Add URI →
     `https://mattytattie.github.io` (exactly that: no path, no slash at
     the end). Optional for testing on a PC: also add
     `http://localhost:8765`.
   - Authorised redirect URIs: leave empty → **Create**.
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`).
8. Menu ☰ → **APIs & Services → Credentials** → **Create credentials → API
   key**. Then edit the key:
   - Application restrictions: **Websites** → add
     `https://mattytattie.github.io/*`
   - API restrictions: **Restrict key** → tick **Google Picker API** →
     **Save**. Copy the key.
9. Menu ☰ → **Cloud overview → Dashboard** (or **IAM & Admin →
   Settings**): copy the **Project number** (digits only, not the ID).
10. In `js/config.js` paste the three values into `GOOGLE_CLIENT_ID`,
    `GOOGLE_API_KEY` and `GOOGLE_APP_ID`. Bump `CACHE_NAME` in `sw.js` and
    publish the site as usual.

(These values aren't secrets. They only work from your web address, and
only for your test users. The API key only allows the picker.)

### On the phones

**Matthew (first):** Hearthbook → **More** → *Share with Google Drive* →
**Connect Google account** → choose your account → Google says the app is in
testing → **Continue** → allow the Drive permission → **Start a new shared
logbook**. Then type Becca's Gmail under *Share the folder with* → **Share**.
(Or share the Hearthbook folder from the Drive app as **Editor**.)

**Becca:** open the email from Google once (so the folder shows in her
"Shared with me"). Then Hearthbook → **Backup** → **Connect Google account**
→ her account → **Continue** → allow → **Join a logbook shared with me**.
Google's file picker opens, listing the Hearthbook files: tap
**hearthbook-sync.json** (ignore any `hearthbook-photos-…` files) →
**Select**. The app says "1 of 1 linked" and syncs. If it says "0 of 1",
tap Join again. Each try remembers what's already linked.

**Stopping:** Backup → **Disconnect this phone**. Entries stay on the phone
and in Drive. To stop sharing entirely, un-share or delete the Hearthbook
folder in Google Drive.

### Home tiles and the year picker (v9)

The five section tiles on the home screen show how many entries and how
much money for one calendar year: the year picked above the Spending chart,
or this year when it shows *12 months*. *Coming up* always shows what's due
from today. Insurance shows what the policies cost that year, pro rata
(`insurancePaidInYear` in `js/stats.js`): monthly premiums count each
payment made in that year (up to today), and a yearly premium is spread
over its 12 months of cover, so you get the share of those days in that year.

### Staying signed in to Google (v9)

Google's access token lasts an hour. Browsers only let Google's sign-in
window open straight after a tap, so the app never opens it by itself.
Instead, once the token has run out (or has under 10 minutes left), your
next ordinary tap anywhere in the app asks Google quietly for a new one
(`prompt: ''` with your account as the hint; the window closes itself).
If Google needs you to choose or agree again, the chip just says
"Tap to sync" and the Backup screen shows "Continue syncing". Nothing is lost
meanwhile: entries stay on the phone and sync after that tap.

## 10. What's new in v10

**Home heading.** The tiles say *2026 so far* for this year, or *In 2025*
when you pick a past year. (v13.5: while the chart is on *12 months*, a small
line under it says *Calendar year, 1 Jan – 5 Oct*, so it's clear the tiles
are this calendar year, not the chart's last 12 months.)

**House picture.** A drawing of an end-terrace house (generic, with no
address). It changes like this:
- **Sky:** it follows the clock only: dawn (05–08), day (08–17), dusk
  (17–20), evening (20–22), and a deep blue starry night from 22:00 to 05:00.
  (v11 removed v10's "cheap rate" chip and its setting.)
- **Windows:** they glow brighter when the latest electricity bill is above
  your average bill, and dimmer when it's below.
- **Roof flag:** it appears when anything is due within 30 days.
- **Battery:** a gauge on the gable wall, which only appears once you log a
  meter entry with "battery" in its title and the unit `%`.

Tap the flag to jump to *Coming up*, the windows for Electricity bills, or
the door for the Logbook. Animations stop when the phone asks for reduced
motion.

**Ask Hearthbook.** This is the search box on the home screen, under Search
in the app shortcuts (`#/search`), and in the Logbook. It searches titles,
shops and suppliers, notes (including the details a scan keeps), policy
numbers and cover. It allows small typos and words you haven't finished
typing. It also understands:
- months and years ("January 2025 bill", "receipts this year")
- section words (bill, receipt, warranty, insurance, job)
- "when does X renew/expire/is due". These show an answer card with the date.

It all runs on the phone. The full raw text of a scan isn't stored (that
would change the backup format), only what the scanner puts in the entry.

**Reminders.** Turn them on in Settings → Reminders, or with *Remind me*
under Coming up. The app only asks Android for permission after you tap one
of those, never by itself. When the app is opened or switched back to, it
looks for renewals, warranty expiries and job dates within 30 days. It
shows one notification per item at 30 days and one at 7 days. Tapping a
notification opens that entry. Phones don't let a web app run in the
background, so reminders only come when you open Hearthbook.

**Customise sections.** Long-press a tile on the home screen (or tap
*Edit*) to change them: the tiles wiggle, **−** hides a section, you drag
tiles to reorder them, and the **+** chips put hidden sections back.
Settings → *Home screen & sections* has the same thing as a tick list, with
drag handles and ↑ ↓ buttons. A hidden section leaves the tiles, the add
menu, the Logbook tabs and (for Electricity) the bottom bar. Its entries are
never deleted: they still sync, back up, and show in *All* and in search.
This setting is per phone.

**Shortcuts and sharing.** Long-press the app icon for *Scan receipt*,
*Add electricity bill* and *Search*. Once the app is installed, you can also
share a photo or PDF from the gallery or an email to **Hearthbook**. The
service worker keeps the file for a moment (cache `hearthbook-share`) and
opens the scanner with it (`#/scan/shared`).

**Polish.** Cards slide in, totals count up, and screens cross-fade with the
View Transitions API when you tap a link (older browsers just switch
screens). Key taps give a light vibration on Android. The logo shows briefly
while the app starts. New phones get a 4-card quick tour, once, which you
can skip and replay from Settings.

## 11. v11 home layout

From top to bottom: greeting, Ask Hearthbook, the house picture (now
shorter), the five section tiles, *Coming up*, the backup reminder (if any),
a smaller *Spent in …* card, the stat cards, the Spending chart, and Recent.
The spending total is now a plain card, so one big receipt no longer
dominates the screen.

## 12. What's new in v12 (web) / app-v13 (Android)

**House picture.** One simple, generic house seen straight on (`js/house.js`):
a single front wall, pitched roof, chimney, door and four windows, plus a tree
and the battery gauge beside it. Same time-of-day sky and the same short size.

**Phone reminders that work when the app is closed** (Android app-v13+ only).
A web page can't run in the background, so the Android app now has a small
native part (`/workspace/hearthbook-android/project/app/src/main/java/.../`):

- `ReminderWorker` — a WorkManager job at about 08:30 every day. It posts a
  notification 30 days and 7 days before, and on the day of, each insurance
  renewal, warranty expiry or job due date. Tapping one opens that entry.
- `ReminderBridgeActivity` — how the dates get there. The native side can't
  read the page's database, so `js/native.js` opens
  `intent://reminders?d=<short list>#Intent;scheme=hearthbook;package=…;end`
  right after a tap (Chrome only allows it after a tap). The activity saves the
  list (SharedPreferences), books the daily job, asks Android for notification
  permission if needed, and closes. Only dated entries from today to ~13 months
  ahead are sent: id, title, date, and the word (renews/expires/is due).
- When the app starts, `LauncherActivity` adds `?hbv=13&hbn=<hash>&hbp=1` to the
  address so the page knows the app holds the current list (More → Reminders
  shows ✓). The page then stops showing its own notifications so you don't get
  each one twice. The in-app "Coming up" list is unchanged.

**Scan auto-sort** (`js/autosort.js`). A scan that isn't an energy bill goes to
Warranty (warranty/guarantee/register/"5 year…"), Job (labour/fitted/installed/
service/work carried out/sweep) or Receipt (receipt/invoice/total/VAT/card…).
Receipts are the safe default. A "File under" switch on the form changes it in
one tap (keeping what you typed and the photo). "5 year warranty" fills in the
expiry date.

**Tappable things.** House "Last bill" chip → that bill. Spending card → the
logbook for that year (`#/list/all/2026`); its Receipts/Bills/… chips → that
section for the year (`#/list/receipt/2026`), with an "All years" button. The
section badge on an entry → that section.

**More → Manuals** (`js/manuals.js`, `js/pdfview.js`, `manuals/`). The bottom
tab is now "More" (Manuals, backup and settings). 18 PDFs grouped by appliance,
each with "Handy notes". They're NOT downloaded at install: the first time
Manuals opens, the service worker saves them all (~40 MB) into their own cache
(`hearthbook-manuals-v1`), so after that they open offline. PDFs open *inside*
Hearthbook (pages drawn by the bundled pdf.js), because the installed Android
app can't show a PDF itself; "Save a copy / open in another app" is below each.
A warranty whose title/notes/supplier contains a model number (e.g. BPX535061B,
DIS15020) gets a "Manual" button. Ask Hearthbook finds manuals too
("dishwasher filter", "hive manual").

**Publishing.** Run `./check-private.sh /workspace/logbook-publish` before
committing: it fails on a postal address, postcode, personal email, MPAN,
phone number (code, docs and the PDFs' text) or a keystore file.

## 13. What's new in v13 (web)

- **Sharper manuals.** After you pinch to zoom, the pages on screen are redrawn at the new size, so small print stays crisp. **Open in another app** hands the PDF to your phone's own PDF viewer.
- **Your own manuals.** More → Manuals → *Add a manual*, or share a PDF into Hearthbook and choose *Keep it as a manual*. Give it a name, notes and rooms, and link it to entries. These are kept **on this phone only**: they are not in the shared sync file or in backups.
- **Rooms.** More → Rooms. You can tag jobs, receipts, warranties and manuals to a room, tag several at once, and filter any list by room. Deleting a room only removes the tag. Room tags on entries sync. The room list itself is per phone.
- **Year in review.** Tap *Year in review ›* on the spending card, or open it from More. It shows what the house cost in a year (bills, insurance pro rata, receipts, jobs), the biggest items, and a comparison with the year before.
- **Sync fixes.** Restoring a backup while sync is on now sticks. Deletes made during a sync stay deleted. Uploads to Drive can resume after a dropped connection. More shows the size of the shared file.
- **Updates.** When a new version arrives, the app reloads once, but never while you're filling in a form.

## v13.5 quick fixes (5 Oct 2026)

- **Electricity:** year chips read *Last 12 months*, 2026, 2025, 2024.
- **Home tiles:** *Calendar year, 1 Jan – today* line while the chart is on 12 months.
- **Scanner:** no stray "null" on the form; European-style totals on pounds
  invoices ("Total incl. VAT GBP 167,65" = £167.65); a "Contact:" label is never
  the supplier; lights.co.uk (Lampenwelt GmbH) invoices fill the Supplier box;
  the seller's contact email goes into Notes; DVLA vehicle tax confirmations
  (emails or screenshots) give the reg, amount, tax period and date.
- **Updates:** the app only clears its own old caches (names starting
  `hearthbook-`), never other apps' on the same github.io site.
