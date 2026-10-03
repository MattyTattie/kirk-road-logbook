// =====================================================================
// motion.js — small touches of movement and feel.
// =====================================================================
// Everything here switches itself off when the phone asks for reduced
// motion (Settings → Accessibility → Remove animations).

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Count a money total up from 0. The real text is in the element from the
// start (so screen readers and copy/paste always get the true value); the
// rolling number is only drawn on top by CSS (::after, see .counting).
export function countUp(node, value, format, ms = 650) {
  if (!node || reducedMotion() || !(value > 0) || typeof requestAnimationFrame !== 'function') return;
  node.style.setProperty('--count-color', getComputedStyle(node).color);
  node.classList.add('counting');
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    node.dataset.count = format(value * ease(t));
    if (t < 1 && node.isConnected) requestAnimationFrame(step);
    else { node.classList.remove('counting'); delete node.dataset.count; }
  };
  node.dataset.count = format(0);
  requestAnimationFrame(step);
}

// Swap screens with the View Transitions API where the browser has it
// (a soft cross-fade/slide), or just run the update otherwise.
export async function transition(update, { direction = 'forward' } = {}) {
  if (reducedMotion() || typeof document.startViewTransition !== 'function') return update();
  document.documentElement.dataset.nav = direction;
  try {
    const vt = document.startViewTransition(() => update());
    vt.ready.catch(() => {}); // skipped transitions reject these; the update still ran
    vt.finished.catch(() => {}).then(() => { delete document.documentElement.dataset.nav; });
    await vt.updateCallbackDone;
  } catch (err) {
    // A transition can be skipped (e.g. another one started): that's fine.
    if (err && err.name !== 'AbortError' && err.name !== 'InvalidStateError') throw err;
  }
}

// A light tap of the vibration motor on Android (ignored elsewhere).
export function haptic(ms = 8) {
  try { if (navigator.vibrate && !reducedMotion()) navigator.vibrate(ms); } catch {}
}
