/** Keyboard (arrows / WASD) and a floating virtual joystick for touch. */

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

export interface Joystick {
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
}

export const JOYSTICK_RADIUS = 60;

export class Input {
  private pressed = new Set<string>();
  private touchId: number | null = null;
  joystick: Joystick | null = null;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code in KEYS) {
        this.pressed.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());

    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.touchId !== null) return;
      this.touchId = e.pointerId;
      surface.setPointerCapture(e.pointerId);
      this.joystick = { baseX: e.clientX, baseY: e.clientY, knobX: e.clientX, knobY: e.clientY };
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.touchId || !this.joystick) return;
      const j = this.joystick;
      let dx = e.clientX - j.baseX;
      let dy = e.clientY - j.baseY;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        // Drag the base along so the stick never feels "stuck" at the edge.
        j.baseX += (dx / len) * (len - JOYSTICK_RADIUS);
        j.baseY += (dy / len) * (len - JOYSTICK_RADIUS);
        dx = e.clientX - j.baseX;
        dy = e.clientY - j.baseY;
      }
      j.knobX = j.baseX + dx;
      j.knobY = j.baseY + dy;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.touchId) return;
      this.touchId = null;
      this.joystick = null;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  /** Desired direction, length 0..1. */
  direction(): { x: number; y: number } {
    if (this.joystick) {
      const j = this.joystick;
      const x = (j.knobX - j.baseX) / JOYSTICK_RADIUS;
      const y = (j.knobY - j.baseY) / JOYSTICK_RADIUS;
      return Math.hypot(x, y) < 0.15 ? { x: 0, y: 0 } : { x, y };
    }
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      x += KEYS[code][0];
      y += KEYS[code][1];
    }
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  reset() {
    this.pressed.clear();
    this.touchId = null;
    this.joystick = null;
  }
}
