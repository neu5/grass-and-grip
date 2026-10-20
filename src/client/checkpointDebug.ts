import type { Gate } from '../sim';

export interface CheckpointDebugPose {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  width: number;
  yaw: number;
  finish: boolean;
}

/** World pose for a debug plane/poles on one sim checkpoint line. */
export function checkpointDebugPose(gate: Gate, index: number): CheckpointDebugPose {
  const dx = gate.b.x - gate.a.x;
  const dz = gate.b.y - gate.a.y;
  return {
    ax: gate.a.x,
    az: gate.a.y,
    bx: gate.b.x,
    bz: gate.b.y,
    cx: gate.center.x,
    cz: gate.center.y,
    width: Math.hypot(dx, dz),
    yaw: -Math.atan2(dz, dx),
    finish: index === 0,
  };
}
