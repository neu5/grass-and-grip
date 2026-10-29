import type { Heading, TrackDef } from '../track';

/** A built-in map before its pit complex is laid out beside the start line. */
export type MapDesign = Omit<TrackDef, 'pitLane' | 'pitBoxes'> & {
  /** Which way cars cross the start line, which side of the road the pits are on, and how many stalls (default 4). */
  pits: { heading: Heading; side: 'left' | 'right'; stalls?: number };
};
