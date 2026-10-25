import type { MapDesign } from './design';

/** Small and green: a quick loop round a pond, S-bends on the far side, sand traps and cones. */
export const MEADOW: MapDesign = {
  id: 'meadow',
  name: 'Meadow Ring',
  width: 1200,
  height: 800,
  halfWidth: 72,
  checkpointCount: 8,
  // Start heading south down the west side; pits on the west.
  pits: { heading: 'south', side: 'right' },
  controlPoints: [
    { x: 250, y: 230 },
    { x: 250, y: 360 },
    { x: 250, y: 500 },
    { x: 262, y: 625 },
    { x: 330, y: 710 },
    { x: 470, y: 712 },
    { x: 620, y: 700 },
    { x: 730, y: 620 },
    { x: 860, y: 640 },
    { x: 990, y: 708 },
    { x: 1110, y: 640 },
    { x: 1105, y: 510 },
    { x: 990, y: 430 },
    { x: 975, y: 335 },
    { x: 1010, y: 235 },
    { x: 960, y: 135 },
    { x: 800, y: 105 },
    { x: 600, y: 110 },
    { x: 430, y: 100 },
    { x: 320, y: 108 },
    { x: 262, y: 150 },
  ],
  // A pond in the middle: water to steer clear of, no bridge needed.
  rivers: [
    {
      halfWidth: 60,
      points: [
        { x: 470, y: 380 },
        { x: 560, y: 350 },
        { x: 660, y: 370 },
        { x: 730, y: 420 },
      ],
    },
  ],
  terrain: {
    base: 12,
    hills: [
      { x: 860, y: 420, r: 120, h: 40 },
      { x: 420, y: 560, r: 110, h: 30 },
      { x: 1200, y: 0, r: 200, h: 45 },
      { x: 1200, y: 800, r: 180, h: 40 },
      { x: 0, y: 800, r: 160, h: 35 },
    ],
  },
  patches: [
    // Sand traps on the outside of the S-bends and the last corner.
    {
      surface: 'sand',
      points: [
        { x: 1135, y: 540 },
        { x: 1185, y: 560 },
        { x: 1185, y: 720 },
        { x: 1120, y: 760 },
        { x: 1150, y: 650 },
      ],
    },
    {
      surface: 'sand',
      points: [
        { x: 1065, y: 160 },
        { x: 1110, y: 200 },
        { x: 1100, y: 290 },
        { x: 1060, y: 280 },
      ],
    },
  ],
  obstacles: [
    // Apex cones in the S-bends.
    { x: 905, y: 600, r: 6, kind: 'cone' },
    { x: 1170, y: 110, r: 15, kind: 'tyres' },
    { x: 777, y: 256, r: 16, kind: 'tree' },
    { x: 566, y: 571, r: 15, kind: 'tree' },
    { x: 392, y: 309, r: 16, kind: 'tree' },
    { x: 1106, y: 349, r: 13, kind: 'tree' },
    { x: 576, y: 428, r: 18, kind: 'tree' },
    { x: 759, y: 510, r: 15, kind: 'tree' },
    { x: 396, y: 537, r: 15, kind: 'tree' },
    { x: 459, y: 212, r: 14, kind: 'tree' },
    { x: 829, y: 413, r: 17, kind: 'tree' },
    { x: 38, y: 587, r: 14, kind: 'tree' },
    { x: 1084, y: 39, r: 18, kind: 'tree' },
    { x: 31, y: 39, r: 13, kind: 'tree' },
    { x: 680, y: 237, r: 18, kind: 'tree' },
    { x: 643, y: 508, r: 16, kind: 'tree' },
    { x: 491, y: 507, r: 17, kind: 'tree' },
    { x: 1136, y: 227, r: 15, kind: 'tree' },
    { x: 538, y: 273, r: 13, kind: 'tree' },
    { x: 769, y: 719, r: 14, kind: 'tree' },
  ],
};
