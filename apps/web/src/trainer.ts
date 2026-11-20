import {
  CHAR, FTMS_SERVICE, IndoorBikeData, Mode, RESULT,
  parseControlPointResponse, parseIndoorBikeData, parseResistanceRange,
  requestControl, resistancePercentToRaw, setSimulation, setTargetPower,
  setTargetResistance, start,
} from '@vt1/core';

export interface Trainer {
  name: string;
  protocol: string;
  send(mode: Mode, value: number): Promise<void>;
  hold(): Promise<void>;
  disconnect(): void;
}

export type DataListener = (d: IndoorBikeData) => void;

/** FTMS trainer over Web Bluetooth. */
export async function connectFtms(onData: DataListener, onDisconnect: () => void): Promise<Trainer> {
  if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS_SERVICE] }] });
  device.addEventListener('gattserverdisconnected', onDisconnect);
  const server = await device.gatt!.connect();
  const svc = await server.getPrimaryService(FTMS_SERVICE);

  let range = { min: 0, max: 100 };
  try { range = parseResistanceRange(await (await svc.getCharacteristic(CHAR.resistanceRange)).readValue()); } catch { /* optional */ }

  const bike = await svc.getCharacteristic(CHAR.indoorBikeData);
  bike.addEventListener('characteristicvaluechanged', (e) =>
    onData(parseIndoorBikeData((e.target as BluetoothRemoteGATTCharacteristic).value!)));
  await bike.startNotifications();

  const cp = await svc.getCharacteristic(CHAR.controlPoint);
  let pending: ((ok: number) => void) | null = null;
  cp.addEventListener('characteristicvaluechanged', (e) => {
    const r = parseControlPointResponse((e.target as BluetoothRemoteGATTCharacteristic).value!);
    if (r && pending) { pending(r.result); pending = null; }
  });
  await cp.startNotifications();

  // Writes are serialised; each waits up to 600 ms for the indication (same as the firmware).
  let chain = Promise.resolve();
  const write = (bytes: Uint8Array) => (chain = chain.then(async () => {
    const reply = new Promise<number>((res) => { pending = res; setTimeout(() => res(-1), 600); });
    await cp.writeValueWithResponse(bytes);
    const result = await reply;
    if (result === RESULT.controlNotPermitted) throw new Error('Another app is controlling this trainer. Close it and reconnect.');
  }));

  await write(requestControl());
  await write(start());

  return {
    name: device.name ?? 'Trainer',
    protocol: 'FTMS',
    send: (mode, value) =>
      write(mode === 'erg' ? setTargetPower(value)
        : mode === 'res' ? setTargetResistance(resistancePercentToRaw(value, range.min, range.max))
        : setSimulation({ gradePct: value })),
    hold: () => write(setTargetResistance(resistancePercentToRaw(0, range.min, range.max))),
    disconnect: () => device.gatt?.disconnect(),
  };
}

/** Simulated trainer for demos and for reviewers without hardware. */
export function connectDemo(onData: DataListener): Trainer {
  let mode: Mode = 'erg', value = 150, held = false;
  const timer = setInterval(() => {
    const p = held ? 40 : mode === 'erg' ? value : mode === 'res' ? 70 + value * 2.6 : 170 + value * 24;
    onData({ powerW: Math.max(0, Math.round(p + (Math.random() * 6 - 3))), cadenceRpm: 85 + Math.round(Math.random() * 6) });
  }, 1000);
  return {
    name: 'Demo trainer',
    protocol: 'DEMO',
    send: async (m, v) => { mode = m; value = v; held = false; },
    hold: async () => { held = true; },
    disconnect: () => clearInterval(timer),
  };
}
