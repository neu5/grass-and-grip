import type { MapDesign } from './design';

/** Small desert loop over big dunes: fast, flowing, and soft sand off the road. */
export const DUNE_RUN: MapDesign = {
  id: 'dunes',
  name: 'Dune Run',
  width: 1200,
  height: 800,
  halfWidth: 56,
  checkpointCount: 8,
  ground: 'sand',
  controlPoints: [
    { x: 400, y: 210 },
    { x: 650, y: 195 },
    { x: 900, y: 215 },
    { x: 1060, y: 300 },
    { x: 1100, y: 450 },
    { x: 1020, y: 590 },
    { x: 860, y: 650 },
    { x: 700, y: 600 },
    { x: 560, y: 520 },
    { x: 430, y: 560 },
    { x: 330, y: 680 },
    { x: 200, y: 690 },
    { x: 130, y: 560 },
    { x: 150, y: 400 },
    { x: 240, y: 270 },
  ],
  terrain: {
    base: 10,
    hills: [
      { x: 720, y: 400, r: 150, h: 80 },
      { x: 300, y: 450, r: 110, h: 60 },
      { x: 1010, y: 720, r: 140, h: 70 },
      { x: 1180, y: 80, r: 180, h: 60 },
      { x: 60, y: 780, r: 160, h: 60 },
    ],
  },
  patches: [
      // Oasis.
      {
        surface: 'grass',
        points: [
        { x: 470, y: 300 },
        { x: 600, y: 290 },
        { x: 650, y: 350 },
        { x: 600, y: 420 },
        { x: 480, y: 420 },
        { x: 430, y: 360 },
        ],
      },
      // Stony run-off past the hairpin.
      {
        surface: 'gravel',
        points: [
        { x: 90, y: 700 },
        { x: 140, y: 770 },
        { x: 260, y: 795 },
        { x: 340, y: 785 },
        { x: 300, y: 750 },
        { x: 200, y: 745 },
        { x: 150, y: 700 },
        ],
      },
  ],
  barriers: [
    { a: { x: 1182, y: 370 }, b: { x: 1182, y: 540 } },
  ],
  obstacles: [
    { x: 560, y: 562, r: 6, kind: 'cone' },
    { x: 446, y: 598, r: 6, kind: 'cone' },
    { x: 312, y: 642, r: 6, kind: 'cone' },
    { x: 1140, y: 246, r: 16, kind: 'tyres' },
    { x: 1089, y: 659, r: 16, kind: 'tyres' },
    { x: 34, y: 574, r: 16, kind: 'tyres' },
    { x: 520, y: 330, r: 14, kind: 'tree' },
    { x: 580, y: 380, r: 13, kind: 'tree' },
    { x: 470, y: 380, r: 13, kind: 'tree' },
    { x: 600, y: 320, r: 12, kind: 'tree' },
    { x: 60, y: 90, r: 15, kind: 'tree' },
    { x: 1150, y: 760, r: 16, kind: 'tree' },
    { x: 36, y: 242, r: 14, kind: 'tree' },
    { x: 759, y: 510, r: 15, kind: 'tree' },
    { x: 934, y: 767, r: 15, kind: 'tree' },
    { x: 247, y: 451, r: 17, kind: 'tree' },
  ],
};
