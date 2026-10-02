// =====================================================================
// scan.js — read a receipt or bill from a photo, screenshot or PDF.
// =====================================================================
// Everything happens ON THE PHONE. Two big libraries are bundled in
// vendor/ (nothing is fetched from the internet):
//   • pdf.js (Mozilla)  — opens a PDF and draws page 1 as a picture
//   • Tesseract.js      — OCR ("optical character recognition"): turns
//                         the picture into text, using the English model
// They're large (~10 MB together), so this file is only loaded when you
// actually tap "Scan", and the service worker keeps a copy for offline use.
// Turning that text into title/date/amount is done by parse.js.

const VENDOR = new URL('../vendor/', import.meta.url).href;

// ---------- PDF -> picture (+ its text layer, if it has one) ----------
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(VENDOR + 'pdfjs/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Returns { canvas, text } for page 1. Most bills emailed as PDFs contain
// real text, which is 100% accurate — we use that when it's there and only
// fall back to OCR for scanned (picture-only) PDFs.
export async function renderPdfFirstPage(file, { width = 1600 } = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Text from the first few pages (bills often put the meter readings on page 2).
    const texts = [];
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const pg = n === 1 ? page : await doc.getPage(n);
      texts.push(textLayerToLines((await pg.getTextContent()).items));
    }
    return { canvas, text: texts.join('\n'), firstPageText: texts[0], pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

// pdf.js gives text in little pieces with positions; put pieces that sit
// on the same line together, top to bottom, left to right.
function textLayerToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}

// ---------- OCR ----------
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine'));
    document.head.append(s);
  });
}

// Pick the faster SIMD build when the phone supports it (almost all do).
function hasSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

let progressHandler = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(VENDOR + 'tesseract/tesseract.min.js');
      const core = hasSimd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js';
      return window.Tesseract.createWorker('eng', 1 /* LSTM only */, {
        workerPath: VENDOR + 'tesseract/worker.min.js',
        corePath: VENDOR + 'tesseract/' + core,
        langPath: VENDOR + 'tesseract',
        workerBlobURL: false, // load the worker as a normal file, so the service worker can serve it offline
        cacheMethod: 'none', // the service worker already caches the model; don't make a second database
        gzip: true,
        logger: (m) => progressHandler && progressHandler(m),
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// image: a canvas, Blob or File. onProgress gets 0..1.
// rotateAuto lets Tesseract straighten a tilted photo (it measures the
// slant of the text lines and rotates before reading).
export async function ocr(image, onProgress) {
  progressHandler = (m) => {
    if (!onProgress) return;
    if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * m.progress, 'Reading text…');
    else onProgress(0.05 + 0.25 * (m.progress || 0), 'Loading OCR engine…');
  };
  const worker = await getWorker();
  const { data } = await worker.recognize(image, { rotateAuto: true });
  progressHandler = null;
  return data.text || '';
}

// Turn any picked file into { canvas, text, source } ready for parsing.
// source: 'pdf-text' (PDF had real text), 'pdf-ocr' or 'image-ocr'.
export async function readFile(file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (isPdf) {
    onProgress(0.05, 'Opening PDF…');
    const { canvas, text, firstPageText } = await renderPdfFirstPage(file);
    if (firstPageText.replace(/\s/g, '').length > 80) {
      onProgress(1, 'Done');
      return { canvas, text, source: 'pdf-text' };
    }
    const t = await ocr(canvas, onProgress);
    return { canvas, text: t, source: 'pdf-ocr' };
  }
  // Images: decode (respecting phone rotation), upscale small screenshots a
  // little — Tesseract reads text best at ~30px letter height.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // A photo of a receipt lying on a table/seat: read just the paper. The
  // dark background otherwise confuses the OCR's layout step, which can
  // drop whole blocks of text (e.g. the shop's name at the top).
  const box = paperBox(bitmap) || { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const scale = box.w < 1000 ? 2 : box.w > 2600 ? 2600 / box.w : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.w * scale);
  canvas.height = Math.round(box.h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  const text = await ocr(canvas, onProgress);
  return { canvas, text, source: 'image-ocr' };
}

// Where's the paper? Look at a small copy of the photo, split pixels into
// light and dark (Otsu's method), and take the rows/columns that are mostly
// light. Returns null (= use the whole picture) unless there's a clear,
// light document on a darker background — screenshots and close-ups are
// left alone.
export function paperBox(bitmap) {
  const W = 240, H = Math.max(1, Math.round((bitmap.height / bitmap.width) * W));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = new Uint8Array(W * H), hist = new Array(256).fill(0);
  for (let i = 0; i < W * H; i++) { const v = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000 | 0; lum[i] = v; hist[v]++; }
  // Otsu threshold
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let wB = 0, sB = 0, best = 0, t = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue; const wF = W * H - wB; if (!wF) break;
    sB += v * hist[v]; const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = v; }
  }
  let nLight = 0, sLight = 0, sDark = 0;
  for (let i = 0; i < W * H; i++) { if (lum[i] > t) { nLight++; sLight += lum[i]; } else sDark += lum[i]; }
  const frac = nLight / (W * H);
  if (frac < 0.08 || frac > 0.8 || sLight / nLight - sDark / (W * H - nLight) < 60) return null;
  // The biggest connected patch of light pixels is the paper (a white wall
  // or table edge elsewhere in the photo is a separate, smaller patch).
  const seen = new Uint8Array(W * H), stack = [];
  let bestN = 0, x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || lum[start] <= t) continue;
    let n = 0, ax = W, ay = H, bx = 0, by = 0;
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      n++; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !seen[j] && lum[j] > t) { seen[j] = 1; stack.push(j); }
      }
    }
    if (n > bestN) { bestN = n; x0 = ax; y0 = ay; x1 = bx; y1 = by; }
  }
  if (bestN < 0.06 * W * H) return null;
  // a little margin, so a tilted edge isn't clipped
  const m = 0.01, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw * bh > 0.85 * W * H || bw < W * 0.2 || bh < H * 0.2) return null;
  const k = bitmap.width / W;
  const x = Math.max(0, (x0 - bw * m) * k), y = Math.max(0, (y0 - bh * m) * k);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(bitmap.width - x, bw * (1 + 2 * m) * k)), h: Math.round(Math.min(bitmap.height - y, bh * (1 + 2 * m) * k)) };
}

// Free the OCR worker's memory (e.g. when leaving the scan screen).
export async function releaseOcr() {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try { (await p).terminate(); } catch {}
}
