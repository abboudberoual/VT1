import { describe, expect, it } from 'vitest';
import {
  parseControlPointResponse, parseIndoorBikeData, resistancePercentToRaw,
  setSimulation, setTargetPower, setTargetResistance, stepValue,
} from '../src';

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe('FTMS encoders', () => {
  it('encodes target power little-endian', () => {
    expect([...setTargetPower(185)]).toEqual([0x05, 0xb9, 0x00]);
    expect([...setTargetPower(1000)]).toEqual([0x05, 0xe8, 0x03]);
  });
  it('encodes resistance as a raw byte', () => {
    expect([...setTargetResistance(300)]).toEqual([0x04, 255]);
  });
  it('maps resistance percent onto the trainer range', () => {
    expect(resistancePercentToRaw(50, 0, 200)).toBe(100);
    expect(resistancePercentToRaw(150, 10, 20)).toBe(20);
  });
  it('encodes simulation grade in 0.01 % steps', () => {
    // wind 0, grade +4.5 % = 450 = 0x01C2, crr 0.004 = 40, cw 0.51 = 51
    expect([...setSimulation({ gradePct: 4.5 })]).toEqual([0x11, 0, 0, 0xc2, 0x01, 40, 51]);
    expect([...setSimulation({ gradePct: -2 })].slice(3, 5)).toEqual([0x38, 0xff]);
  });
});

describe('FTMS decoders', () => {
  it('parses control point responses', () => {
    expect(parseControlPointResponse(view(0x80, 0x05, 0x01))).toEqual({ requestOp: 5, result: 1, ok: true });
    expect(parseControlPointResponse(view(0x80, 0x00, 0x05))?.ok).toBe(false);
    expect(parseControlPointResponse(view(0x05))).toBeNull();
  });
  it('parses speed, cadence and power from indoor bike data', () => {
    // flags 0x0044: speed present (bit0 = 0), cadence (bit2), power (bit6)
    const d = parseIndoorBikeData(view(0x44, 0x00, 0xc4, 0x09, 0xb0, 0x00, 0xb6, 0x00));
    expect(d).toEqual({ speedKph: 25, cadenceRpm: 88, powerW: 182 });
  });
});

describe('modes', () => {
  it('steps and clamps setpoints', () => {
    expect(stepValue('erg', 995, 1)).toBe(1000);
    expect(stepValue('erg', 1000, 1)).toBe(1000);
    expect(stepValue('slope', 2, -1)).toBe(1.5);
    expect(stepValue('slope', -10, -1)).toBe(-10);
  });
});
