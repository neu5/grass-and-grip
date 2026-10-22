import { carStats } from './physics';
import type { Track } from './track';
import type { CarState, Prop } from './types';

/** Traffic cones: light, knocked about by cars, never hurt them. */
export const CONE = {
  radius: 6,
  /** Cone mass relative to a rally car. */
  mass: 0.04,
  restitution: 0.4,
  /** Velocity lost per second, standing / knocked over. */
  friction: 2.2,
  downFriction: 4,
  spinFriction: 3,
  /** Closing speed that knocks a cone over. */
  knockSpeed: 70,
};

export function conesFromTrack(track: Track): Prop[] {
  return track.def.obstacles
    .filter((o) => o.kind === 'cone')
    .map((o) => ({ x: o.x, y: o.y, vx: 0, vy: 0, angle: 0, spin: 0, down: false }));
}

/** Car hits cone: the cone flies, the car barely notices. */
export function hitCone(car: CarState, cone: Prop): void {
  const dx = cone.x - car.x;
  const dy = cone.y - car.y;
  const min = carStats(car).radius + CONE.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  cone.x = car.x + nx * min;
  cone.y = car.y + ny * min;
  const rel = (car.vx - cone.vx) * nx + (car.vy - cone.vy) * ny;
  if (rel <= 0) return;
  const mc = carStats(car).mass;
  const j = ((1 + CONE.restitution) * rel) / (1 / mc + 1 / CONE.mass);
  cone.vx += (j / CONE.mass) * nx;
  cone.vy += (j / CONE.mass) * ny;
  car.vx -= (j / mc) * nx;
  car.vy -= (j / mc) * ny;
  // Glancing blows set it spinning.
  cone.spin += ((car.vx * ny - car.vy * nx) / 40) * (rel / 200);
  if (rel > CONE.knockSpeed) cone.down = true;
}

/** Slide, slow down and bounce off the map edge. */
export function stepCone(cone: Prop, width: number, height: number, dt: number): void {
  cone.x += cone.vx * dt;
  cone.y += cone.vy * dt;
  cone.angle += cone.spin * dt;
  const f = Math.min(1, (cone.down ? CONE.downFriction : CONE.friction) * dt);
  cone.vx -= cone.vx * f;
  cone.vy -= cone.vy * f;
  cone.spin -= cone.spin * Math.min(1, CONE.spinFriction * dt);
  const r = CONE.radius;
  if (cone.x < r || cone.x > width - r) {
    cone.x = cone.x < r ? r : width - r;
    cone.vx = -cone.vx * CONE.restitution;
  }
  if (cone.y < r || cone.y > height - r) {
    cone.y = cone.y < r ? r : height - r;
    cone.vy = -cone.vy * CONE.restitution;
  }
}

/** Keep a cone out of a fixed circle (tree, tyre stack). */
export function coneOffCircle(cone: Prop, ox: number, oy: number, r: number): void {
  const dx = cone.x - ox;
  const dy = cone.y - oy;
  const min = r + CONE.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  cone.x = ox + nx * min;
  cone.y = oy + ny * min;
  const vn = cone.vx * nx + cone.vy * ny;
  if (vn < 0) {
    cone.vx -= (1 + CONE.restitution) * vn * nx;
    cone.vy -= (1 + CONE.restitution) * vn * ny;
  }
}
