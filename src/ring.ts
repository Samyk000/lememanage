import type { RingAnim } from "./api";

let timer = 0;

/**
 * Animate the resting notch. The attribute is cleared and set again so a second
 * reminder inside the first one's tail restarts the keyframes instead of doing
 * nothing.
 */
export function ringNotch(anim: RingAnim) {
  const root = document.documentElement;
  window.clearTimeout(timer);
  delete root.dataset.ring;
  void root.offsetWidth;
  root.dataset.ring = anim;
  timer = window.setTimeout(() => delete root.dataset.ring, 5000);
}
