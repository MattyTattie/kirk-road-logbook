// =====================================================================
// pdfview.js — show a manual's pages inside Hearthbook (v12).
// =====================================================================
// The installed Android app (a "Trusted Web Activity") has no PDF viewer
// of its own; tapping a PDF link would just download it. So we draw the
// pages ourselves with the bundled pdf.js (the same library the scanner
// uses), a page at a time as you scroll. Works offline once the manual
// is saved (sw.js keeps manuals in their own cache).

const VENDOR = new URL('../vendor/', import.meta.url).href;
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(VENDOR + 'pdfjs/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    }).catch((err) => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
}

/**
 * Draws the PDF at `url` into `box` (pages appear as they scroll into view).
 * Returns { doc, pages, zoom(factor), destroy() }.
 */
export async function showPdf(url, box, { onStatus = () => {}, onPage = () => {} } = {}) {
  onStatus('Opening…');
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 503 ? 'offline' : `HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  let zoom = 1;
  const slots = [];
  box.replaceChildren();
  for (let n = 1; n <= doc.numPages; n++) {
    const slot = document.createElement('div');
    slot.className = 'pdf-page';
    slot.dataset.page = String(n);
    slot.style.aspectRatio = `${base.width} / ${base.height}`;
    slot.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
    slot.setAttribute('role', 'img');
    box.append(slot);
    slots.push(slot);
  }
  const drawn = new Map(); // page number → zoom it was drawn at
  const busy = new Set();
  async function draw(slot) {
    const n = Number(slot.dataset.page);
    if (drawn.get(n) === zoom || busy.has(n)) return;
    busy.add(n);
    try {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const cssWidth = slot.clientWidth || box.clientWidth || 360;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: (cssWidth * dpr) / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      slot.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      slot.replaceChildren(canvas);
      drawn.set(n, zoom);
      page.cleanup();
    } catch (err) {
      console.warn('page', n, err);
    } finally { busy.delete(n); }
  }
  const io = new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { draw(e.target); onPage(Number(e.target.dataset.page), doc.numPages); }
  }, { rootMargin: '600px 0px' });
  slots.forEach((s) => io.observe(s));
  onStatus('');
  return {
    pages: doc.numPages,
    zoom(f) {
      zoom = Math.max(1, Math.min(3, f));
      box.style.setProperty('--pdf-zoom', String(zoom));
      box.classList.toggle('zoomed', zoom > 1);
      // Redraw what's on screen at the new size (others redraw when scrolled to).
      requestAnimationFrame(() => slots.forEach((s) => { const r = s.getBoundingClientRect(); if (r.bottom > -600 && r.top < innerHeight + 600) draw(s); }));
      return zoom;
    },
    destroy() { io.disconnect(); doc.destroy(); },
  };
}
