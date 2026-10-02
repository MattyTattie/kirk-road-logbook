// =====================================================================
// charts.js — tiny bar charts drawn as SVG (no chart library, no CDN).
// =====================================================================
// barChart(bars, options) gives back an element containing an <svg>.
//   bars: [{ label: 'Jan', value: 123.45, title: 'January 2026' }, …]
//
// One huge month (say, a new kitchen) would squash every other bar flat.
// So if the biggest bar is much bigger than the next one, we cap the scale
// and draw the giant bar "broken" (with a zig-zag) and its value on top —
// you can still read every month, and nothing is hidden.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function barChart(bars, { height = 150, format = (v) => String(v), onSelect, selected = -1, unitLabel = '', describe } = {}) {
  const W = 340;
  const H = height;
  const top = 18, bottom = 22;
  const plotH = H - top - bottom;
  const n = Math.max(bars.length, 1);
  const slot = W / n;
  const barW = Math.min(18, slot * 0.58);

  const values = bars.map((b) => b.value || 0);
  const sorted = [...values].sort((a, b) => b - a);
  let max = sorted[0] || 0;
  let capped = false;
  if (sorted.length > 1 && sorted[1] > 0 && sorted[0] > sorted[1] * 2.5) {
    max = sorted[1] * 1.35;
    capped = true;
  }
  if (max <= 0) max = 1;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${esc(
    bars.map((b) => `${b.title || b.label}: ${format(b.value || 0)}`).join('; ')
  )}">`;
  // gridlines
  for (const f of [0.5, 1]) {
    const y = top + plotH * (1 - f);
    svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="chart-grid"/>`;
  }
  svg += `<line x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}" class="chart-base"/>`;

  bars.forEach((b, i) => {
    const v = b.value || 0;
    const over = capped && v > max;
    const h = v <= 0 ? 0 : Math.max(3, Math.min(1, v / max) * plotH);
    const x = slot * i + (slot - barW) / 2;
    const y = top + plotH - h;
    const cls = 'chart-bar' + (i === selected ? ' is-selected' : '') + (b.muted ? ' is-muted' : '');
    // a wide invisible hit area makes small bars easy to tap
    // Each column is a keyboard-focusable "button" when the chart is interactive.
    const a11y = onSelect ? ` tabindex="${i === selected || (selected < 0 && i === bars.length - 1) ? 0 : -1}" role="button" aria-pressed="${i === selected}" aria-label="${esc(describe ? describe(b, v) : `${b.title || b.label}: ${format(v)}`)}"` : '';
    svg += `<g class="chart-col" data-i="${i}"${a11y}><rect x="${slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" class="chart-hit"/>`;
    if (h > 0) svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${Math.min(5, barW / 2)}" class="${cls}"/>`;
    if (over) {
      const zy = top + plotH * 0.35;
      svg += `<path d="M${x - 2} ${zy + 3} l${barW / 3 + 1} -5 l${barW / 3} 5 l${barW / 3 + 1} -5" class="chart-break"/>`;
      svg += `<text x="${x + barW / 2}" y="${top - 6}" text-anchor="middle" class="chart-peak">${esc(format(v))}</text>`;
    }
    svg += `<text x="${slot * i + slot / 2}" y="${H - 6}" text-anchor="middle" class="chart-label${i === selected ? ' is-selected' : ''}">${esc(b.label)}</text></g>`;
  });
  svg += '</svg>';

  const box = document.createElement('div');
  box.className = 'chart';
  box.innerHTML = svg; // safe: every dynamic piece above goes through esc()
  if (onSelect) {
    const cols = [...box.querySelectorAll('.chart-col')];
    cols.forEach((g) => {
      const i = Number(g.dataset.i);
      g.addEventListener('click', () => onSelect(i));
      // Enter/Space picks the bar; arrow keys move along the chart (roving tabindex).
      g.addEventListener('keydown', (ev) => {
        let to = null;
        if (ev.key === 'Enter' || ev.key === ' ') to = i;
        else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') to = Math.min(cols.length - 1, i + 1);
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') to = Math.max(0, i - 1);
        else if (ev.key === 'Home') to = 0;
        else if (ev.key === 'End') to = cols.length - 1;
        if (to === null) return;
        ev.preventDefault();
        onSelect(to);
        cols[to].focus();
      });
    });
  }
  box.select = (i) => selectBar(box, i);
  if (capped) {
    const note = document.createElement('p');
    note.className = 'chart-note';
    note.textContent = `Tall bar shortened to fit${unitLabel ? ' · ' + unitLabel : ''}`;
    box.append(note);
  }
  return box;
}

// Highlight bar i without redrawing the chart (keeps keyboard focus).
export function selectBar(box, i) {
  box.querySelectorAll('.chart-col').forEach((g) => {
    const on = Number(g.dataset.i) === i;
    g.querySelector('.chart-bar')?.classList.toggle('is-selected', on);
    g.querySelector('.chart-label')?.classList.toggle('is-selected', on);
    if (g.hasAttribute('role')) {
      g.setAttribute('aria-pressed', String(on));
      g.setAttribute('tabindex', on ? '0' : '-1');
    }
  });
}

// A small trend line (used for "last bills").
export function sparkline(values, { width = 120, height = 36 } = {}) {
  const box = document.createElement('div');
  box.className = 'spark';
  if (values.length < 2) return box;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [ (i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8) ]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path d="${d}" class="spark-line"/><circle cx="${lx}" cy="${ly}" r="3.2" class="spark-dot"/></svg>`;
  return box;
}
