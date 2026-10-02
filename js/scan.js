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
export async function ocr(image, onProgress) {
  progressHandler = (m) => {
    if (!onProgress) return;
    if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * m.progress, 'Reading text…');
    else onProgress(0.05 + 0.25 * (m.progress || 0), 'Loading OCR engine…');
  };
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
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
  const scale = bitmap.width < 1000 ? 2 : bitmap.width > 2600 ? 2600 / bitmap.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  const text = await ocr(canvas, onProgress);
  return { canvas, text, source: 'image-ocr' };
}

// Free the OCR worker's memory (e.g. when leaving the scan screen).
export async function releaseOcr() {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try { (await p).terminate(); } catch {}
}
