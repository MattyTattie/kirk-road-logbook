// =====================================================================
// periodcard.js — the swipeable detail card under a bar chart.
// =====================================================================
// Shows one "period" (a month, or the time between two meter readings).
// Move to the next/previous period by:
//   • swiping the card left/right (it follows your finger, then slides)
//   • the ‹ › arrow buttons (also for keyboard / screen-reader users)
//   • the arrow keys while the card has focus
// It stops at the first and last period. onChange(i) lets the chart
// highlight the matching bar.

import { el, fill } from './utils.js';
import { icon } from './icons.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function periodCard({ id, count, index, render, onChange, label = 'period' }) {
  let current = index;
  let busy = false;

  const title = el('strong', { class: 'period-title' });
  const sub = el('span', { class: 'period-sub' });
  const prev = el('button', { type: 'button', class: 'period-arrow', id: `${id}-prev`, 'aria-label': `Previous ${label}` }, icon('back', 20));
  const next = el('button', { type: 'button', class: 'period-arrow', id: `${id}-next`, 'aria-label': `Next ${label}` }, icon('chevron', 20));
  const slide = el('div', { class: 'period-slide' });
  const viewport = el('div', { class: 'period-viewport' }, slide);
  const pos = el('p', { class: 'period-pos', 'aria-hidden': 'true' });
  const card = el(
    'section',
    { class: 'period-card', id, tabindex: '-1', 'aria-roledescription': 'carousel', 'aria-label': `${label} details` },
    el('div', { class: 'period-nav' }, prev, el('div', { class: 'period-heading', 'aria-live': 'polite' }, title, sub), next),
    viewport,
    pos
  );

  function showAt(i) {
    const r = render(i);
    title.textContent = r.title;
    sub.textContent = r.sub || '';
    fill(slide, r.body);
    prev.disabled = i <= 0;
    next.disabled = i >= count - 1;
    fill(pos, ...Array.from({ length: count }, (_, k) => el('span', { class: 'dot' + (k === i ? ' on' : '') })));
    card.dataset.index = String(i);
  }

  // Slide the current content out towards `dir` (-1 = left, 1 = right), swap, slide in.
  async function go(i, dir) {
    if (i < 0 || i >= count || i === current || busy) return snapBack();
    busy = true;
    current = i;
    onChange && onChange(i);
    if (reduceMotion()) {
      showAt(i);
      busy = false;
      return;
    }
    slide.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
    slide.style.transform = `translateX(${dir * -60}%)`;
    slide.style.opacity = '0';
    await wait(180);
    showAt(i);
    slide.style.transition = 'none';
    slide.style.transform = `translateX(${dir * 60}%)`;
    void slide.offsetWidth;
    slide.style.transition = 'transform .26s cubic-bezier(.2,.8,.2,1), opacity .26s';
    slide.style.transform = 'translateX(0)';
    slide.style.opacity = '1';
    await wait(260);
    slide.style.transition = '';
    busy = false;
  }
  function snapBack() {
    slide.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
    slide.style.transform = 'translateX(0)';
  }

  prev.addEventListener('click', () => go(current - 1, 1));
  next.addEventListener('click', () => go(current + 1, -1));
  card.addEventListener('keydown', (ev) => {
    if (ev.target.closest('a, button:not(.period-arrow)')) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(current - 1, 1); }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); go(current + 1, -1); }
  });

  // --- Swipe (pointer events work for touch, pen and mouse) ---
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
  viewport.addEventListener('pointerdown', (ev) => {
    if (busy || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    dragging = true; decided = false; dx = 0;
    startX = ev.clientX; startY = ev.clientY;
  });
  viewport.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const mx = ev.clientX - startX, my = ev.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; } // vertical: let the page scroll
      viewport.setPointerCapture(ev.pointerId);
      card.classList.add('dragging');
    }
    dx = mx;
    // rubber-band at the ends
    const atEdge = (dx > 0 && current === 0) || (dx < 0 && current === count - 1);
    const shown = atEdge ? dx / 3 : dx;
    slide.style.transition = 'none';
    slide.style.transform = `translateX(${shown}px)`;
    slide.style.opacity = String(1 - Math.min(0.5, Math.abs(shown) / 600));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    justDragged = decided;
    setTimeout(() => (justDragged = false), 0);
    card.classList.remove('dragging');
    slide.style.opacity = '';
    if (dx < -50) go(current + 1, -1);
    else if (dx > 50) go(current - 1, 1);
    else snapBack();
    dx = 0;
  };
  // A drag shouldn't also count as a tap on "Open bill" etc.
  let justDragged = false;
  viewport.addEventListener('click', (ev) => {
    if (justDragged) { ev.preventDefault(); ev.stopPropagation(); justDragged = false; }
  }, true);
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  showAt(current);
  card.show = (i) => { if (i !== current) { const dir = i > current ? -1 : 1; go(i, dir); } };
  card.getIndex = () => current;
  return card;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
