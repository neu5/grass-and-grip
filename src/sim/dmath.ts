// Deterministic math helpers. Only IEEE-754 basic ops (+ - * / sqrt) are
// guaranteed bit-identical across JS engines; Math.sin/cos/atan2 are not, so the
// simulation uses these polynomial versions to stay lockstep-safe across
// browsers and a future server.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

export function normalizeAngle(a: number): number {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}

export function dsin(x: number): number {
  x = normalizeAngle(x);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Taylor series to x^13; max error ~1e-10 on [-pi/2, pi/2].
  let p = 1 / 6227020800;
  p = -1 / 39916800 + x2 * p;
  p = 1 / 362880 + x2 * p;
  p = -1 / 5040 + x2 * p;
  p = 1 / 120 + x2 * p;
  p = -1 / 6 + x2 * p;
  p = 1 + x2 * p;
  return x * p;
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

function atanUnit(z: number): number {
  // |z| <= 1; max error ~0.0015 rad, plenty for steering decisions.
  const az = z < 0 ? -z : z;
  return z * (PI / 4) - z * (az - 1) * (0.2447 + 0.0663 * az);
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let a: number;
  if (ax >= ay) {
    a = atanUnit(ay / ax);
  } else {
    a = HALF_PI - atanUnit(ax / ay);
  }
  if (x < 0) a = PI - a;
  if (y < 0) a = -a;
  return a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Shortest-path interpolation on the circle. `t` is 0..1. */
export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}
