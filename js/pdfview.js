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

// v13: sharp when zoomed. Pages are drawn at the phone's pixel density
// times the zoom: the + / − buttons AND a two-finger pinch. After a pinch
// ends (a short pause), only the pages on screen are redrawn at the new
// sharpness; pages scrolled away go back to normal size to save memory.
// A page canvas is capped at about 16 million pixels so a big zoom can't
// run the phone out of memory.
const MAX_PIXELS = 16_000_000;
const pinchScale = () => (window.visualViewport ? Math.max(1, Math.min(window.visualViewport.scale || 1, 5)) : 1);

/**
 * Draws the PDF at `url` (or `data`, a Blob/ArrayBuffer) into `box`
 * (pages appear as they scroll into view).
 * Returns { doc, pages, zoom(factor), sharpen(), destroy() }.
 */
export async function showPdf(url, box, { onStatus = () => {}, onPage = () => {}, data = null } = {}) {
  onStatus('Opening…');
  let bytes;
  if (data) bytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
  else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status === 503 ? 'offline' : `HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
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
  const drawn = new Map(); // page number → pixel width it was drawn at
  const busy = new Map(); // page number → width being drawn
  const again = new Set();
  let destroyed = false;
  // Pixel width a page should have now: CSS width × density × pinch.
  function wantWidth(slot, vp1, pinch) {
    const cssWidth = slot.clientWidth || box.clientWidth || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let w = cssWidth * dpr * pinch;
    const h = (w * vp1.height) / vp1.width;
    if (w * h > MAX_PIXELS) w = Math.sqrt((MAX_PIXELS * vp1.width) / vp1.height);
    return Math.round(w);
  }
  async function draw(slot, pinch = 1) {
    if (destroyed) return;
    const n = Number(slot.dataset.page);
    if (busy.has(n)) { again.add(n); return; }
    try {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const width = wantWidth(slot, vp1, pinch);
      if (drawn.get(n) === width) return;
      busy.set(n, width);
      const viewport = page.getViewport({ scale: width / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      slot.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (destroyed) return;
      // Free the old canvas's memory straight away.
      const old = slot.querySelector('canvas');
      slot.replaceChildren(canvas);
      if (old) { old.width = 0; old.height = 0; }
      drawn.set(n, width);
      slot.dataset.px = String(width);
      page.cleanup();
    } catch (err) {
      console.warn('page', n, err);
    } finally {
      busy.delete(n);
      if (again.delete(n)) draw(slot, pinchScale());
    }
  }
  // Which pages are on screen (inside the pinch-zoomed view)?
  function visibleSlots(margin = 0) {
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight;
    return slots.filter((s) => { const r = s.getBoundingClientRect(); return r.bottom > top - margin && r.top < top + h + margin; });
  }
  function sharpen() {
    const pinch = pinchScale();
    const vis = visibleSlots(pinch > 1 ? 0 : 600);
    vis.forEach((s) => draw(s, pinch));
    // Pages drawn extra-sharp earlier but now off screen: back to normal size.
    const near = new Set(visibleSlots(600));
    for (const s of slots) {
      const n = Number(s.dataset.page);
      if (!near.has(s) && drawn.has(n)) {
        const c = s.querySelector('canvas');
        if (c) { c.width = 0; c.height = 0; s.replaceChildren(); }
        drawn.delete(n);
      }
    }
  }
  const io = new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { draw(e.target, pinchScale()); onPage(Number(e.target.dataset.page), doc.numPages); }
  }, { rootMargin: '600px 0px' });
  slots.forEach((s) => io.observe(s));
  // Pinch zoom: wait until the fingers have stopped for a moment.
  let pinchTimer = null, lastScale = pinchScale();
  const onViewport = () => {
    clearTimeout(pinchTimer);
    pinchTimer = setTimeout(() => {
      const sc = pinchScale();
      if (Math.abs(sc - lastScale) < 0.05 && sc <= 1) return;
      lastScale = sc;
      sharpen();
    }, 250);
  };
  const vv = window.visualViewport;
  if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); }
  onStatus('');
  return {
    doc,
    pages: doc.numPages,
    zoom(f) {
      zoom = Math.max(1, Math.min(3, f));
      box.style.setProperty('--pdf-zoom', String(zoom));
      box.classList.toggle('zoomed', zoom > 1);
      // Redraw what's on screen at the new size (others redraw when scrolled to).
      requestAnimationFrame(() => sharpen());
      return zoom;
    },
    sharpen,
    destroy() {
      destroyed = true;
      clearTimeout(pinchTimer);
      if (vv) { vv.removeEventListener('resize', onViewport); vv.removeEventListener('scroll', onViewport); }
      io.disconnect();
      for (const s of slots) { const c = s.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; } }
      doc.destroy();
    },
  };
}
