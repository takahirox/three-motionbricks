import type { Intent } from './motion';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
export function readIntent(keys: ReadonlySet<string>): Intent {
  const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const length = Math.hypot(x, z);
  return {x: length ? x / length : 0, z: length ? z / length : 0,
    speed: length ? (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.5 : 2.3) : 0};
}
export class Keyboard {
  readonly keys = new Set<string>();
  constructor(target: Window = window) {
    target.addEventListener('keydown', event => {
      if (!MOVEMENT_KEYS.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [contenteditable]')) return;
      event.preventDefault(); this.keys.add(event.code);
    });
    target.addEventListener('keyup', event => {this.keys.delete(event.code);});
    target.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {if (document.hidden) this.keys.clear();});
  }
  get intent(): Intent { return readIntent(this.keys); }
}
