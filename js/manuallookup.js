// =====================================================================
// manuallookup.js — "Find a manual from a label" (v14).
// =====================================================================
// Photograph the appliance's rating label (the sticker with the model
// number). The existing scanner (scan.js, on the phone) reads the text;
// this file picks out the brand and model, checks whether Hearthbook
// already has that manual (built-in or one you added), and otherwise makes
// a web search for "<brand> <model> manual pdf". Free: no paid search
// service. Nothing is saved until you pick the PDF and tap Save on the
// usual "Add a manual" form.

// Brands seen on UK appliance labels (lower-case keys → how to write them).
const BRANDS = ['AEG', 'Beko', 'Bosch', 'Siemens', 'Neff', 'Gaggenau', 'Hotpoint', 'Indesit', 'Whirlpool', 'Samsung', 'LG', 'Miele', 'Zanussi',
  'Electrolux', 'CDA', 'Quooker', 'Hive', 'Shelly', 'Dyson', 'Russell Hobbs', 'Morphy Richards', 'Panasonic', 'Sharp', 'Hisense', 'Haier',
  'Candy', 'Hoover', 'Grundig', 'Smeg', 'Belling', 'Stoves', 'Lamona', 'Logik', 'Kenwood', "De'Longhi", 'DeLonghi', 'Tefal', 'Breville', 'Ninja',
  'Vaillant', 'Worcester', 'Worcester Bosch', 'Baxi', 'Ideal', 'Glow-worm', 'Mitsubishi', 'Daikin', 'Toshiba', 'Sony', 'Philips', 'Ecostrad',
  'Beldray', 'electriQ', 'EGLO', 'Tapo', 'TP-Link', 'Luxpower', 'Mi-Fires', 'ECOSO', 'Fisher & Paykel', 'Rangemaster', 'Leisure', 'Blomberg',
  'Gorenje', 'Liebherr', 'Hitachi', 'Sage', 'Vax', 'Shark', 'Karcher', 'Kärcher', 'STIHL', 'Makita', 'DeWalt', 'Ryobi', 'Flymo', 'Bissell',
  'Swan', 'Igenix', 'Montpellier', 'Teknix', 'Cookology', 'Caple', 'Elica', 'Faber', 'Franke', 'Blanco', 'Grohe', 'Mira', 'Triton', 'Aqualisa',
  'Dimplex', 'Creda', 'Stiebel Eltron', 'Ariston', 'Heatrae Sadia', 'Megaflo', 'Nest', 'Tado', 'Ring', 'Eufy', 'Roborock', 'iRobot', 'Bauknecht',
  'Ikea', 'Kitchenaid', 'Frigidaire', 'Amica', 'Hoover-Candy', 'Lec', 'Fridgemaster', 'Russell', 'Salter', 'Instant', 'Cosori', 'Tower', 'Sunbeam'];
const BRAND_RE = BRANDS.slice().sort((a, b) => b.length - a.length)
  .map((b) => [b, new RegExp(`(^|[^A-Za-z0-9])${b.replace(/[.*+?^${}()|[\]\\']/g, '\\$&').replace(/[ -]/g, '[ -]?')}(?![A-Za-z])`, 'i')]);

// Words that are never a model number on a label.
const NOT_MODEL = /^(MADE|IN|CHINA|TURKEY|POLAND|GERMANY|ITALY|UK|EU|PRC|CE|UKCA|WEEE|IP\d\dX?|IPX\d|V|W|HZ|KW|KWH|AC|DC|MAX|MIN|CLASS|TYPE|MODEL|SERIAL|NO|NR|NUMBER|POWER|RATED|INPUT|OUTPUT|VOLTAGE|FREQUENCY|CAPACITY|NET|GROSS|LITRES?|KG|BAR|MPA|R600A|R134A|R290|GWP|DATE|PNC|SER|SN|S\/N|E-NR|FD|ZN|ENR)$/i;
const ELECTRICAL = /^\d+([.,]\d+)?([-–/]\d+([.,]\d+)?)?(V|VAC|W|KW|HZ|A|MA|KG|L|MM|CM|BAR|MPA|°C|C|G|MIN|RPM)~?$/i;
const looksSerial = (t) => /^\d{8,}$/.test(t) || /^[0-9]{2}[0-9A-Z]{10,}$/.test(t) && !/[A-Z]{3}/.test(t);

const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (t) => String(t || '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/+.-]+$|[.]+$/g, '').replace(/[,;:]+$/, '');

/** A model-number-looking token: letters and digits mixed, 4–20 characters. */
export function plausibleModel(tok) {
  const t = clean(tok);
  const flat = squash(t);
  if (flat.length < 4 || flat.length > 20) return false;
  if (NOT_MODEL.test(t) || ELECTRICAL.test(t) || looksSerial(flat)) return false;
  if (!/[0-9]/.test(flat)) return false; // models nearly always have a number in them
  if (!/[A-Z]/.test(flat) && flat.length < 5) return false;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t)) return false; // a date
  if (/^\d+[-–]\d+$/.test(t) && !/[A-Z]/i.test(t)) return false; // a range like 220-240
  if (/^[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}$/i.test(t)) return false; // a postcode
  return true;
}

/**
 * Text read off an appliance label → { brand, model, candidates }.
 * Prefers a value after "Model", "Model No", "Type", "Mod.", "M/N", "E-Nr",
 * "Prod. No"; otherwise the first code that looks like a model number.
 */
export function readLabel(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  let brand = '';
  // "Brand: X" / "Manufacturer: X" lines first, then any known brand name.
  for (const l of lines) {
    const m = l.match(/^(brand|manufacturer|make)\s*[:.]?\s*(.+)$/i);
    if (m) { brand = clean(m[2].split(/\s{2,}|,/)[0]); break; }
  }
  if (!brand) {
    let best = null;
    for (const [name, re] of BRAND_RE) {
      const m = raw.match(re);
      if (m && (best === null || m.index < best.index)) best = { name, index: m.index };
    }
    if (best) brand = best.name;
  }
  const candidates = [];
  const add = (t) => { const c = clean(t); if (c && plausibleModel(c) && !candidates.some((x) => squash(x) === squash(c)) && squash(c) !== squash(brand)) candidates.push(c); };
  const LABELLED = /\b(model\s*(?:no\.?|number|nr\.?)?|mod(?:el)?\.|m\/n|type(?:\s*(?:no\.?|ref\.?))?|typ|e-?nr\.?|prod(?:uct)?\.?\s*(?:no\.?|code|ref\.?)|ref\.?|item\s*(?:no\.?|code)|art\.?\s*(?:no\.?|nr\.?))\s*[:#.]?\s*([A-Z0-9][A-Z0-9 ./+-]{2,28})/i;
  for (const l of lines) {
    if (/\b(serial|s\/n|sn\s*[:#])/i.test(l) && !/\bmodel\b/i.test(l)) continue;
    const m = l.match(LABELLED);
    if (!m) continue;
    // "Model: BPX 535 061 B  230V" → join short chunks of a spaced-out code.
    const parts = m[2].trim().split(/\s+/);
    let joined = '';
    for (const p of parts) {
      if (ELECTRICAL.test(p) || NOT_MODEL.test(p) || /^(serial|s\/n|sn)$/i.test(p)) break;
      if (joined && squash(joined).length >= 6 && squash(p).length > 3) break;
      joined += (joined ? ' ' : '') + p;
      if (squash(joined).length >= 14) break;
    }
    if (plausibleModel(joined.replace(/\s+/g, ''))) add(joined.replace(/\s+(?=[A-Z0-9]{1,3}\b)/gi, ''));
    else add(parts[0]);
  }
  for (const l of lines) {
    if (/\b(serial|s\/n|sn\s*[:#]|ser\.?\s*no|fd\b|date)/i.test(l)) continue;
    for (const tok of l.split(/\s+/)) add(tok);
  }
  // Bosch/Siemens/Neff "E-Nr. WAN28281GB/01": the /01 is the production run, not needed to find the manual.
  const tidy = candidates.map((c) => c.replace(/\/\d{2}$/, ''));
  return { brand, model: tidy[0] || '', candidates: tidy.slice(0, 6) };
}

/**
 * Does Hearthbook already have this manual?
 *   builtins: manuals.APPLIANCES; mine: your own manuals (usermanuals.list()).
 * → { kind: 'builtin', appliance } | { kind: 'mine', manual } | null
 * Matches on the model number only (brand alone could be the wrong product).
 */
export function findExisting(brand, model, builtins = [], mine = []) {
  const q = squash(model);
  if (q.length < 4) return null;
  for (const a of builtins) {
    const codes = [a.model, ...(a.match || [])].map(squash).filter((c) => c.length >= 4);
    if (codes.some((c) => c === q || (c.length >= 6 && q.includes(c)) || (q.length >= 6 && c.includes(q)))) return { kind: 'builtin', appliance: a };
  }
  for (const m of mine) {
    const hay = squash([m.name, m.notes, m.fileName].join(' '));
    if (hay.includes(q)) return { kind: 'mine', manual: m };
  }
  return null;
}

/** The web search to open: "<brand> <model> manual pdf" (free, in a new tab). */
export function searchUrl(brand, model) {
  const q = [brand, model, 'manual pdf'].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

/** What to call the manual on the "Add a manual" form. */
export const suggestedName = (brand, model) => [brand, model].map((s) => String(s || '').trim()).filter(Boolean).join(' ').slice(0, 80);
