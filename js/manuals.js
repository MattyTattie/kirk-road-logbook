// =====================================================================
// manuals.js — the appliance manuals bundled with the app (v12).
// =====================================================================
// The PDFs live in the app's manuals/ folder. They're big (about 57 MB
// together), so they are NOT downloaded when the app installs: the first
// time you open More → Manuals, the service worker (sw.js "warm-manuals")
// saves them all for offline use. A manual you open before that is saved
// as you open it.
//
// PDFs open inside Hearthbook (the viewer in app.js draws the pages with
// the bundled pdf.js), because the installed Android app can't show a PDF
// on its own. "Open in another app" is there too.
//
// v13: each appliance has `rooms` (pre-tagged; change them per phone under
// More → Rooms) and a `group` used as the heading when it has no room.
// Ask Hearthbook also searches manuals you add yourself (usermanuals.js).
//
// Warranty entries whose title / notes / supplier mention one of these
// model numbers (or the distinctive product name) get a "Manual" button.

export const MANUALS_CACHE = 'hearthbook-manuals-v1';
export const DIR = 'manuals/';

export const APPLIANCES = [
  {
    id: 'oven', name: 'AEG oven', model: 'BPX535061B', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['BPX535061B', 'BPX535061'],
    words: 'aeg oven cooker steambake pyrolytic',
    notes: 'Clock, timers, cooking functions and cleaning are all in the user manual.',
    files: [{ file: 'AEG-BPX535061B-user-manual.pdf', label: 'User manual', pages: 28 }],
  },
  {
    id: 'microwave', name: 'AEG combi microwave', model: 'KMX365060B', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['KMX365060B', 'KMX365060'],
    words: 'aeg microwave combi oven compact',
    notes: 'Combination oven and microwave: check the manual for which dishes suit each mode.',
    files: [{ file: 'AEG-KMX365060B-user-manual.pdf', label: 'User manual', pages: 24 }],
  },
  {
    id: 'hob', name: 'AEG induction hob', model: 'IAX64411CB', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['IAX64411CB', 'IAX64411'],
    words: 'aeg induction hob cooktop hob2hood',
    notes: 'Induction: pans need a magnetic base.',
    files: [{ file: 'AEG-IAX64411CB-user-manual.pdf', label: 'User manual', pages: 24 }],
  },
  {
    id: 'dishwasher', name: 'Beko dishwasher', model: 'DIS15020', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['DIS15020'],
    words: 'beko dishwasher dish washer integrated slimline',
    notes: 'Clean the filter weekly.',
    files: [{ file: 'Beko-DIS15020-user-manual.pdf', label: 'User manual', pages: 44 }],
  },
  {
    id: 'hood', name: 'CDA cooker hood', model: 'CCA52WH', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['CCA52WH', 'CCA52'],
    words: 'cda hood cooker extractor fan chimney',
    notes: 'Wash the grease filter monthly.',
    files: [{ file: 'CDA-CCA52WH-instruction-manual.pdf', label: 'Instruction manual', pages: 14 }],
  },
  {
    id: 'radiator', name: 'ECOSO Aruba Ardus radiator', model: 'DRDH178354D', group: 'Living room', rooms: ['Living room'],
    match: ['DRDH178354D', 'DRDH178354', 'ARUBA ARDUS', 'ARUBAARDUS'],
    words: 'ecoso aruba ardus radiator electric heater heating dry',
    notes: 'Switched on and off by the Hive single-channel receiver (living room).',
    files: [{ file: 'ECOSO-Aruba-Ardus-DRDH178354D-installation-manual.pdf', label: 'Installation manual', pages: 8 }],
  },
  {
    id: 'beldray', name: 'Beldray bedroom radiators', model: 'EH3110V2', group: 'Bedroom', rooms: ['Bedroom'],
    match: ['EH3110V2', 'EH3110W', 'EH3110', 'EH3109V2', 'BELDRAY'],
    words: 'beldray smart ceramic core radiator electric heater 2000w 2kw bedroom wifi tuya smart life child lock',
    about: 'Two 2000 W Beldray Smart Ceramic Core radiators in the bedroom.',
    notes: 'Child lock: hold + and − together till the padlock shows (same to undo; not in standby). ' +
      'Reset: in standby, hold power till every symbol lights. Frost mode keeps 7°C; open-window mode drops to frost if the room cools 2°C in 5 min. ' +
      'Cut out? Unplug, cool 30 min. Don’t run it off a timer or smart plug. ' +
      'Clean: unplug, cool, soft damp cloth. Wi-Fi: Smart Life/Tuya app, 2.4 GHz only. 12-month guarantee, 2 years if registered within 30 days.',
    files: [{ file: 'Beldray-EH3110V2-2000W-Smart-Ceramic-Core-Radiator-instruction-manual.pdf', label: 'Instruction manual (2000 W, EH3110V2)', pages: 24 }],
  },
  {
    // v13.4: before the Ecostrad towel rail so a warranty naming electriQ finds this one.
    id: 'electriq-towel', name: 'electriQ bathroom towel rail', model: 'Smart Electric Towel Rail 600W (VSTR9-650-0.6)', group: 'Bathroom', rooms: ['Bathroom'],
    match: ['VSTR9-650', 'VSTR96500.6', 'VSTR9650', 'ELECTRIQ'],
    words: 'electriq smart electric towel rail radiator heater 600w bathroom tuya smart app boost timer child lock',
    about: 'The 600 W electriQ smart towel rail in the bathroom, from Buy It Direct / Appliances Direct.',
    notes: 'Power: on/standby; hold 10 s to reset. Mode cycles Comfort, Eco (7–30°C), Anti-frost (7°C), Weekly timer, and Radiator/Boost for towels (40–80°C for 2 h; hold Mode 3 s to change how long). ' +
      'Child lock: hold + and − 5 s (same to undo). Settings: in standby hold + 10 s, Mode to step: F1 open window (off/30/60), F2/F3 max rail temp, F4 Wi-Fi. ' +
      'App: Tuya Smart, 2.4 GHz; pair by Bluetooth via Add device, or in standby hold Mode 5 s (3 min). ' +
      'Don’t use a timer or extension lead; not under a socket; RCD in a bathroom. Clean: unplug, soft damp cloth. Support 0330 390 3061. ' +
      'Guarantee: none in the manual; Appliances Direct says 5 years electrics, 10 years radiator.',
    files: [{ file: 'electriQ-VSTR9-650-0.6-600W-Smart-Electric-Towel-Rail-user-manual-2023.pdf', label: 'User manual (VSTR9-650-0.6, 2023)', pages: 30 }],
  },
  {
    // Before the bedroom Ecostrad so a warranty naming the element/towel rail finds this one
    // (the bedroom entry matches the plain word "Ecostrad").
    id: 'ecostrad-towel', name: 'Ecostrad bathroom towel rail element', model: 'iQ WiFi Heating Element 600W (iQ-HE-C6)', group: 'Bathroom', rooms: ['Bathroom'],
    match: ['IQ-HE-C6', 'IQHEC6', 'IQ WIFI HEATING ELEMENT', 'IQ WIFI ELEMENT', 'TOWEL RAIL'],
    words: 'ecostrad iq wifi heating element towel rail radiator electric 600w bathroom smart life timer child lock',
    about: 'The 600 W Ecostrad iQ WiFi Heating Element in the bathroom towel rail.',
    notes: 'Radiator mode is towel-drying mode (30–70°C). Timer: in radiator mode hold the timer key till “2H”, then arrows for 0–8 hours. ' +
      'Child lock: hold both arrows 5 s (same to undo). Open-window detection is on by default (change it in the app only). ' +
      'Wi-Fi: Smart Life app, 2.4 GHz; in standby hold the Wi-Fi key to pair (99 s). Er1 = room sensor fault, Er2 = internal sensor fault: contact the seller. ' +
      'Never switch it on in an empty rail; don’t power it through a timer or smart plug. ' +
      'Guarantee: 2 years, claim via the seller with proof of purchase.',
    files: [{ file: 'Ecostrad-iQ-WiFi-Heating-Element-iQ-HE-C6-600W-manual-V1-10-Knaresborough-era.pdf', label: 'User manual (iQ WiFi Element, V1-10)', pages: 21 }],
  },
  {
    id: 'ecostrad', name: 'Ecostrad bedroom radiator', model: 'iQ Ceramic 1800W (HCT180T)', group: 'Bedroom', rooms: ['Bedroom'],
    match: ['HCT180T', 'E-IQ-C-1800', 'EIQC1800', 'IQ CERAMIC', 'ECOSTRAD'],
    words: 'ecostrad iq ceramic radiator electric heater 1800w 1.8kw bedroom wifi smart life alexa google child lock',
    about: 'The 1800 W Ecostrad iQ Ceramic in the bedroom, from Electric Radiators Direct.',
    notes: 'Child lock: hold + and − for 5 s (same to undo). Reset: in standby, hold power for 15 s. ' +
      'Anti-freeze mode keeps 7°C. Open-window detection (off by default): standby, hold + 5 s, ✓ to F2, pick 60 or 90 min. ' +
      'Don’t cover it; don’t run it off a timer, smart plug or switched circuit. Er1/Er2 = sensor fault, contact the seller. ' +
      'Clean: unplug, cool, damp cloth only. Wi-Fi: Smart Life app, 2.4 GHz; turn on F4, then in standby hold ✓ to pair (3 min). ' +
      'Guarantee: 2 years electrics, 3 paintwork, 10 body; claim via the seller with proof of purchase.',
    files: [{ file: 'Ecostrad-iQ-Ceramic-HCT180T-1800W-manual-V1.7-pre2024.pdf', label: 'User manual (iQ Ceramic, V1.7)', pages: 29 }],
  },
  {
    id: 'stove', name: 'Mi-Fires Loughrigg stove', model: 'Loughrigg', group: 'Living room', rooms: ['Living room'],
    match: ['LOUGHRIGG'],
    words: 'mi-fires mi fires mifires loughrigg stove woodburner wood burner log burner fire chimney sweep',
    notes: 'Sweep the chimney once a year. Test the CO alarm. Burn logs under 20% moisture.',
    files: [{ file: 'Mi-Fires-Loughrigg-user-installation-manual.pdf', label: 'User & installation manual', pages: 16 }],
  },
  {
    id: 'quooker', name: 'Quooker Flex tap', model: '3XCHR', group: 'Kitchen', rooms: ['Kitchen'],
    match: ['QUOOKER', '3XCHR'],
    words: 'quooker flex tap boiling water tank descale descaling',
    notes: 'Descale the tank as shown in the descaling guide.',
    files: [
      { file: 'Quooker-Flex-3XCHR-installation-guide-tap-and-tank.pdf', label: 'Installation guide (tap & tank)', pages: 38 },
      { file: 'Quooker-tank-descaling-guide.pdf', label: 'Descaling guide', pages: 12 },
    ],
  },
  {
    id: 'tapo', name: 'TP-Link Tapo smart plug', model: 'P110M', group: 'Around the house', rooms: [],
    match: ['P110M'],
    words: 'tp-link tplink tapo smart plug socket energy monitoring matter',
    notes: 'Smart plug with energy monitoring; set up and timers in the Tapo app.',
    files: [{ file: 'TP-Link-Tapo-P110M-UK-user-guide.pdf', label: 'User guide', pages: 20 }],
  },
  {
    id: 'ha-green', name: 'Home Assistant Green', model: 'Green', group: 'Around the house', rooms: [],
    match: ['HOME ASSISTANT GREEN', 'HOMEASSISTANTGREEN', 'HA GREEN'],
    words: 'home assistant green hub smart home automation nabu casa',
    notes: 'The smart-home hub. Quick start guide plus warranty and safety information.',
    files: [
      { file: 'Home-Assistant-Green-quick-start-guide.pdf', label: 'Quick start guide', pages: 4 },
      { file: 'Home-Assistant-Green-warranty-safety-info.pdf', label: 'Warranty & safety information', pages: 15 },
    ],
  },
  {
    id: 'hive', name: 'Hive heating', model: 'SLT3 · SLR1 · SLR2', group: 'Heating', rooms: ['Kitchen', 'Living room'],
    match: ['SLT3', 'SLR1', 'SLR2', 'HIVE'],
    words: 'hive heating thermostat receiver boost frost schedule batteries heating kitchen living room hub',
    about: 'Dual channel = kitchen heating. Single channel = living room (switches the radiator).',
    notes: 'Boost from the thermostat or app. Frost protection 7°C. Thermostat takes 4×AA batteries.',
    files: [
      { file: 'Hive-Thermostat-SLT3-user-guide-2026.pdf', label: 'Hive Thermostat (SLT3) user guide', pages: 13 },
      { file: 'Hive-Thermostat-SLT3-SLR1-SLR2-Hub-installation-guide.pdf', label: 'Hive Thermostat installation guide (SLR1/SLR2, hub)', pages: 20 },
      { file: 'Hive-Active-Heating-2-SLT3b-SLR1b-SLR2b-user-guide.pdf', label: 'Hive Active Heating 2 user guide (SLT3b)', pages: 24 },
      { file: 'Hive-Active-Heating-2-SLR1-SLR2-Hub-installation-guide.pdf', label: 'Hive Active Heating 2 installation guide', pages: 36 },
    ],
  },
  {
    id: 'shelly', name: 'Shelly Pro 4PM', model: 'Pro 4PM', group: 'Hot water', rooms: [],
    match: ['PRO 4PM', 'PRO4PM', 'SHELLY'],
    words: 'shelly pro 4pm relay immersion heater hot water contactor din',
    about: 'Switches the immersion heaters through two 20A contactors.',
    notes: 'V1 and V2 user & safety guides; check which version is printed on the unit.',
    files: [
      { file: 'Shelly-Pro-4PM-V1-user-safety-guide.pdf', label: 'User & safety guide (V1)', pages: 2 },
      { file: 'Shelly-Pro-4PM-V2-user-safety-guide.pdf', label: 'User & safety guide (V2)', pages: 2 },
    ],
  },
];

export const ALL_FILES = APPLIANCES.flatMap((a) => a.files.map((f) => DIR + f.file));
export const fileUrl = (file) => DIR + file;
export const findFile = (file) => {
  for (const a of APPLIANCES) for (const f of a.files) if (f.file === file) return { appliance: a, file: f };
  return null;
};

// "BPX 535 061-B" → "BPX535061B"
const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The appliance a warranty (or any entry) belongs to, by model number / product name. */
export function manualFor(entry) {
  if (!entry) return null;
  const text = [entry.title, entry.notes, entry.supplier].filter(Boolean).join(' ');
  const flat = squash(text);
  const spaced = ' ' + String(text).toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
  for (const a of APPLIANCES) {
    for (const m of a.match) {
      const q = squash(m);
      // Short codes (HIVE, SLR1…) must be whole words; long model numbers can appear anywhere.
      if (q.length >= 7 ? flat.includes(q) : spaced.includes(' ' + m.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ')) return a;
    }
  }
  return null;
}

const STOP = new Set('the a an my our for of to in on how do does i is where what manual manuals guide guides instructions instruction booklet pdf user book handbook'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9°%]+/g, ' ').split(' ').filter(Boolean);

/** Ask Hearthbook: manuals matching a query ("dishwasher filter", "hive manual", "BPX535061B"). */
export function searchManuals(q) {
  const all = words(q);
  if (!all.length) return [];
  const wantsManual = all.some((w) => /^(manual|manuals|guide|guides|instructions?|handbook|booklet|pdf)$/.test(w));
  const key = all.filter((w) => !STOP.has(w) && w.length >= 3);
  const qflat = squash(q);
  // v13.3: a hyphenated model code made of short bits ("iQ-HE-C6") still finds its manual.
  if (!key.length) {
    const byCode = APPLIANCES.filter((a) => a.match.some((m) => squash(m).length >= 5 && qflat.includes(squash(m))));
    return byCode.length ? byCode : wantsManual ? APPLIANCES.slice() : [];
  }
  const scored = APPLIANCES.map((a) => {
    // Name, model and product words count double; the notes count once.
    const main = words([a.name, a.model, a.words, ...a.files.map((f) => f.label)].join(' '));
    const extra = words([a.group, ...(a.rooms || []), a.notes, a.about].join(' '));
    const hit = (list, w) => list.some((h) => h === w || (w.length >= 4 && h.startsWith(w)));
    let score = 0;
    for (const w of key) score += hit(main, w) ? 2 : hit(extra, w) ? 1 : 0;
    if (a.match.some((m) => squash(m).length >= 5 && qflat.includes(squash(m)))) score += 6;
    return { a, score };
  }).filter((x) => x.score > 0);
  scored.sort((x, y) => y.score - x.score);
  // Without the word "manual", only show strong matches (most words found).
  // Best matches only (so "dishwasher filter" doesn't also list the hood).
  const need = wantsManual ? 1 : Math.max(2, key.length);
  const top = scored.length ? scored[0].score : 0;
  return scored.filter((x) => x.score >= Math.max(need, top)).map((x) => x.a);
}
