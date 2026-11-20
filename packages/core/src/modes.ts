/** Control modes and their limits. Matches the VT-1 firmware and the design canvas. */
export type Mode = 'erg' | 'res' | 'slope';

export interface ModeSpec {
  label: string;
  unit: string;
  start: number;
  step: number;
  min: number;
  max: number;
}

export const MODES: Record<Mode, ModeSpec> = {
  erg: { label: 'ERG', unit: 'W', start: 150, step: 5, min: 0, max: 1000 },
  res: { label: 'RES', unit: '%', start: 30, step: 1, min: 0, max: 100 },
  slope: { label: 'SLOPE', unit: '%', start: 2, step: 0.5, min: -10, max: 20 },
};

/** Step a setpoint up (+1) or down (-1), clamped and rounded to 0.1. */
export function stepValue(mode: Mode, value: number, dir: 1 | -1, step = MODES[mode].step): number {
  const m = MODES[mode];
  const next = Math.round((value + dir * step) * 10) / 10;
  return Math.min(m.max, Math.max(m.min, next));
}
