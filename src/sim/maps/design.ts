import type { TrackDef } from '../track';

/** A built-in map before the shared pit complex is added. */
export type MapDesign = Omit<TrackDef, 'pitLane' | 'pitBoxes'>;
