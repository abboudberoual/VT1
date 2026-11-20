/**
 * Bluetooth Fitness Machine Service (FTMS, 0x1826) — encoders and decoders.
 * Pure functions, no Bluetooth or DOM calls, so everything here is unit-testable.
 * Values mirror the VT-1 firmware (firmware/VT1_Controller/VT1_Controller.ino).
 */

export const FTMS_SERVICE = 0x1826;
export const CHAR = {
  feature: 0x2acc,
  indoorBikeData: 0x2ad2,
  resistanceRange: 0x2ad6,
  controlPoint: 0x2ad9,
  machineStatus: 0x2ada,
} as const;

export const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  start: 0x07,
  setSimulation: 0x11,
  response: 0x80,
} as const;

export const RESULT = {
  success: 0x01,
  notSupported: 0x02,
  invalidParameter: 0x03,
  failed: 0x04,
  controlNotPermitted: 0x05,
} as const;

export const requestControl = (): Uint8Array => Uint8Array.of(OP.requestControl);
export const start = (): Uint8Array => Uint8Array.of(OP.start);

/** Target power in watts (sint16, 1 W resolution). */
export function setTargetPower(watts: number): Uint8Array {
  const b = new Uint8Array(3);
  const v = new DataView(b.buffer);
  b[0] = OP.setTargetPower;
  v.setInt16(1, clamp(Math.round(watts), -32768, 32767), true);
  return b;
}

/** Target resistance as a raw trainer level (uint8), as the firmware sends it. */
export function setTargetResistance(raw: number): Uint8Array {
  return Uint8Array.of(OP.setTargetResistance, clamp(Math.round(raw), 0, 255));
}

/** Map 0–100 % onto the trainer's reported resistance range (0x2AD6). */
export function resistancePercentToRaw(pct: number, min = 0, max = 100): number {
  const p = clamp(pct, 0, 100);
  return clamp(Math.round(min + ((max - min) * p) / 100), 0, 255);
}

export interface SimulationParams {
  gradePct: number;
  windMps?: number; // 0.001 m/s resolution
  crr?: number; // 0.0001 resolution
  cwKgPerM?: number; // 0.01 kg/m resolution
}

/** Indoor Bike Simulation Parameters (op 0x11). */
export function setSimulation({ gradePct, windMps = 0, crr = 0.004, cwKgPerM = 0.51 }: SimulationParams): Uint8Array {
  const b = new Uint8Array(7);
  const v = new DataView(b.buffer);
  b[0] = OP.setSimulation;
  v.setInt16(1, clamp(Math.round(windMps * 1000), -32768, 32767), true);
  v.setInt16(3, clamp(Math.round(gradePct * 100), -32768, 32767), true);
  v.setUint8(5, clamp(Math.round(crr * 10000), 0, 255));
  v.setUint8(6, clamp(Math.round(cwKgPerM * 100), 0, 255));
  return b;
}

export interface ControlPointResponse {
  requestOp: number;
  result: number;
  ok: boolean;
}

export function parseControlPointResponse(data: DataView): ControlPointResponse | null {
  if (data.byteLength < 3 || data.getUint8(0) !== OP.response) return null;
  const result = data.getUint8(2);
  return { requestOp: data.getUint8(1), result, ok: result === RESULT.success };
}

export interface ResistanceRange {
  min: number;
  max: number;
  increment: number;
}

/** Supported Resistance Level Range (0x2AD6): three sint16, 0.1 resolution. */
export function parseResistanceRange(data: DataView): ResistanceRange {
  return {
    min: data.getInt16(0, true) / 10,
    max: data.getInt16(2, true) / 10,
    increment: data.getUint16(4, true) / 10,
  };
}

export interface IndoorBikeData {
  speedKph?: number;
  cadenceRpm?: number;
  resistanceLevel?: number;
  powerW?: number;
  heartRateBpm?: number;
  elapsedS?: number;
}

/** Indoor Bike Data (0x2AD2). Field order follows the flags, per the FTMS spec. */
export function parseIndoorBikeData(data: DataView): IndoorBikeData {
  const flags = data.getUint16(0, true);
  let i = 2;
  const out: IndoorBikeData = {};
  const has = (bit: number) => (flags & (1 << bit)) !== 0;

  if (!has(0)) { out.speedKph = data.getUint16(i, true) / 100; i += 2; } // bit 0 = "more data": speed present when 0
  if (has(1)) i += 2; // average speed
  if (has(2)) { out.cadenceRpm = data.getUint16(i, true) / 2; i += 2; }
  if (has(3)) i += 2; // average cadence
  if (has(4)) i += 3; // total distance
  if (has(5)) { out.resistanceLevel = data.getInt16(i, true); i += 2; }
  if (has(6)) { out.powerW = data.getInt16(i, true); i += 2; }
  if (has(7)) i += 2; // average power
  if (has(8)) i += 5; // expended energy
  if (has(9)) { out.heartRateBpm = data.getUint8(i); i += 1; }
  if (has(10)) i += 1; // metabolic equivalent
  if (has(11)) { out.elapsedS = data.getUint16(i, true); i += 2; }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
