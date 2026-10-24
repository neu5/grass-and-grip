import type { Heading, TrackDef } from '../track';

/** A built-in map before its pit complex is laid out beside the start line. */
export type MapDesign = Omit<TrackDef, 'pitLane' | 'pitBoxes'> & {
  /** Which way cars cross the start line, and which side of the road the pits are on. */
  pits: { heading: Heading; side: 'left' | 'right' };
};
