/** Gameplay tuning. Distances in km, times in seconds. */
export const CONFIG = {
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

  /** Distance at which the target's flashing dot becomes visible, per level. */
  revealRadius: (level: number) => Math.max(12, 50 - (level - 1) * 7),

  /** Number of best-known cities (by population) in play at a level. */
  poolSize: (level: number) => 15 + (level - 1) * 15,

  /** New targets are not picked this close to the helicopter (when possible). */
  minTargetDistance: 40,
};
