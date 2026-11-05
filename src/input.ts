/**
 * Keyboard (arrows / WASD), a floating virtual joystick for touch, tap to fly (touch)
 * and click to fly (mouse; hold and move to steer the point).
 */

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

/** A screen point (client px) to fly to; `held` while the mouse button is still down. */
export interface Aim {
  x: number;
  y: number;
  held: boolean;
}

export const JOYSTICK_RADIUS = 50;
const JOYSTICK_DEAD_ZONE = 6;
const JOYSTICK_FULL_SPEED = 30;
/** A touch that lifts within TAP_MS and moves less than TAP_SLOP px is a tap, not the joystick. */
const TAP_MS = 250;
const TAP_SLOP = 10;
/** A tap this soon after a joystick drag is the thumb re-gripping, not a point to fly to. */
const REGRIP_MS = 400;

export class Input {
  private pressed = new Set<string>();
  private touchId: number | null = null;
  private touchStart = { x: 0, y: 0, time: 0, moved: false };
  /** When the last joystick drag ended (ms). */
  private stickEnd = -Infinity;
  private mouseId: number | null = null;
  private aim: Aim | null = null;
  private stick: Joystick | null = null;
  /** Keys only steer (and keep the page from scrolling) while a game is being played. */
  active = false;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // Shortcuts such as Cmd+S get no keyup on macOS, so the key would stick.
      if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code in KEYS) {
        this.pressed.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());

    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button !== 0 || !this.active || this.mouseId !== null) return;
        this.mouseId = e.pointerId;
        surface.setPointerCapture(e.pointerId);
        this.aim = { x: e.clientX, y: e.clientY, held: true };
        return;
      }
      if (this.touchId !== null) return;
      this.touchId = e.pointerId;
      surface.setPointerCapture(e.pointerId);
      this.touchStart = { x: e.clientX, y: e.clientY, time: performance.now(), moved: false };
      this.stick = { baseX: e.clientX, baseY: e.clientY, knobX: e.clientX, knobY: e.clientY };
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.mouseId && this.aim) {
        this.aim.x = e.clientX;
        this.aim.y = e.clientY;
        return;
      }
      if (e.pointerId !== this.touchId || !this.stick) return;
      const s = this.touchStart;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP) s.moved = true;
      const j = this.stick;
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
      if (e.pointerId === this.mouseId) {
        this.mouseId = null;
        if (this.aim) this.aim.held = false;
        return;
      }
      if (e.pointerId !== this.touchId) return;
      const s = this.touchStart;
      const now = performance.now();
      if (this.joystick) this.stickEnd = now;
      else if (e.type === 'pointerup' && this.active && s.time - this.stickEnd > REGRIP_MS) {
        this.aim = { x: s.x, y: s.y, held: false };
      }
      this.touchId = null;
      this.stick = null;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  /**
   * The joystick once it is really one: the finger moved, or stayed down longer than a tap.
   * Until then a touch may still turn out to be a tap, so it is not drawn and does not cancel
   * a flight (it does steer at once, see direction).
   */
  get joystick(): Joystick | null {
    const s = this.touchStart;
    return this.stick && (s.moved || performance.now() - s.time >= TAP_MS) ? this.stick : null;
  }

  /** True while keys or the joystick steer; that cancels flying to a clicked point. */
  get steering(): boolean {
    return this.pressed.size > 0 || this.joystick !== null;
  }

  /** The point to fly to, if any. A clicked or tapped point is handed out once; a held one every frame. */
  takeAim(): Aim | null {
    const aim = this.aim;
    if (aim && !aim.held) this.aim = null;
    return aim;
  }

  /** Desired direction, length 0..1. */
  direction(): { x: number; y: number } {
    // The stick itself, not `joystick`: waiting for a tap would make every drag start late.
    // While flying to a point the game ignores it until the touch turns out to be a drag.
    const j = this.stick;
    if (j) {
      const dx = j.knobX - j.baseX;
      const dy = j.knobY - j.baseY;
      const len = Math.hypot(dx, dy);
      if (len < JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
      // Full speed is reached after a short drag, so a finger near the
      // screen edge can still fly at full speed.
      const power = Math.min(1, (len - JOYSTICK_DEAD_ZONE) / (JOYSTICK_FULL_SPEED - JOYSTICK_DEAD_ZONE));
      return { x: (dx / len) * power, y: (dy / len) * power };
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
    this.mouseId = null;
    this.stick = null;
    this.aim = null;
  }
}
