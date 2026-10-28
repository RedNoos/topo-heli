/**
 * Gameplay tuning. Times in seconds. Distances (and speed) are in km for a map
 * with viewKm = referenceViewKm; other maps scale them by viewKm / referenceViewKm
 * so every map plays at the same on-screen pace.
 */
export const CONFIG = {
  referenceViewKm: 260,

  startTime: 180,
  citiesPerLevel: 10,
  levelTimeBonus: 60,
  skipPenalty: 10,

  heli: {
    maxSpeed: 65, // km/s (it's a very fast helicopter)
    responsiveness: 2.6, // higher = less inertia
    turnRate: 8,
  },

  /** How close the helicopter must be to the target to count as found. */
  catchRadius: 7,
  /**
   * Calm camera: still while the helicopter is inside the dead zone (share of the play area),
   * then eases after it (`ease` per second). `edgeMargin`: closest the helicopter gets to the
   * edge (share of the short screen side). `lead`: seconds ahead the camera looks at speed.
   */
  camera: { deadZoneX: 0.5, deadZoneY: 0.4, ease: 3, edgeMargin: 0.12, lead: 0.6 },

  /** Mountain ranges cover an area, so their (peak) target is easier to hit. */
  mountainCatchFactor: 2,

  /**
   * Rivers are found by following them, not by crossing them: river length within
   * `coverRadius` of the helicopter counts as covered, and the river is found once
   * `followKm` (or `maxShare` of a short river) is covered. Crossing one covers ~8 km.
   */
  river: { followKm: 40, maxShare: 0.6, coverRadius: 4, sampleKm: 1 },

  /**
   * Areas (provinces, islands, ...) are found by flying into them: at least `insideKm`
   * (real km, not scaled) from the edge, or half the depth of a narrow area.
   */
  area: { insideKm: 2, maxShare: 0.5 },

  /** Distance at which the target's flashing dot becomes visible, per level. */
  revealRadius: (level: number) => Math.max(12, 50 - (level - 1) * 7),
  /** "Find them all" has a fixed reveal distance: that of this level. */
  practiceRevealLevel: 3,

  /** Number of best-known cities (by population) in play at a level. */
  poolSize: (level: number) => 15 + (level - 1) * 15,

  /** Basislijst mode: skipping adds this many seconds to the time (the name comes back later). */
  practiceSkipPenalty: 20,

  /** New targets are not picked this close to the helicopter (when possible). */
  minTargetDistance: 40,
};
