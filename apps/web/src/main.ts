import { MODES, Mode, stepValue } from '@vt1/core';
import { connectDemo, connectFtms, Trainer } from './trainer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RING_LEN = 697.43, RING_C = 929.91, RING_MAX_W = 800;

const state = {
  trainer: null as Trainer | null,
  mode: 'erg' as Mode,
  values: { erg: MODES.erg.start, res: MODES.res.start, slope: MODES.slope.start } as Record<Mode, number>,
  hold: false,
  live: 0,
  startedAt: 0,
};

let sendTimer: number | undefined;
function scheduleSend() {
  // 150 ms debounce, same as the firmware, so fast taps send one command.
  clearTimeout(sendTimer);
  sendTimer = window.setTimeout(() => {
    state.trainer?.send(state.mode, state.values[state.mode]).catch(showError);
  }, 150);
}

function fmt(mode: Mode, v: number) {
  return mode === 'slope' ? (v > 0 ? '+' : '') + v.toFixed(1) : String(v);
}

function render() {
  const connected = !!state.trainer;
  const m = MODES[state.mode], v = state.values[state.mode];
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('status').textContent = connected ? `${state.trainer!.name.toUpperCase()} · ${state.trainer!.protocol}` : 'NO TRAINER';
  $('label').textContent = !connected ? 'NO TRAINER' : state.hold ? 'ON HOLD' : ({ erg: 'TARGET', res: 'RESISTANCE', slope: 'GRADE' })[state.mode];
  $('value').textContent = connected ? fmt(state.mode, v) : '—';
  $('value').style.color = state.hold ? '#5B6068' : '';
  $('unit').textContent = connected ? ({ erg: 'watts', res: 'percent', slope: 'percent grade' })[state.mode] : 'not connected';
  $('live').textContent = connected ? `${state.live} W live` : '';
  $('power').textContent = connected ? `${state.live} W` : '—';
  $('step').textContent = `STEP ±${m.step} ${m.unit}`;
  $('hold').textContent = state.hold ? 'RESUME' : 'HOLD';
  $('hold').setAttribute('aria-pressed', String(state.hold));
  $('controls').hidden = !connected;
  $('connect').hidden = connected;

  const f = Math.min(1, Math.max(0, state.live / RING_MAX_W));
  $('arc').setAttribute('stroke-dasharray', `${(f * RING_LEN).toFixed(2)} ${RING_C}`);
  $('arc').style.opacity = connected ? '1' : '0';
  const th = ((135 + 270 * Math.min(1, v / RING_MAX_W)) * Math.PI) / 180;
  const marker = $('marker');
  marker.setAttribute('cx', (160 + 148 * Math.cos(th)).toFixed(2));
  marker.setAttribute('cy', (160 + 148 * Math.sin(th)).toFixed(2));
  marker.setAttribute('r', connected && state.mode === 'erg' ? '6' : '0');
}

function showError(e: unknown) {
  $('note').textContent = e instanceof Error ? e.message : String(e);
  $('connect').hidden = false;
}

function onConnected(t: Trainer) {
  state.trainer = t;
  state.startedAt = Date.now();
  render();
  scheduleSend();
}

const onData = (d: { powerW?: number; cadenceRpm?: number }) => {
  if (d.powerW !== undefined) state.live = d.powerW;
  if (d.cadenceRpm !== undefined) $('cadence').textContent = `${Math.round(d.cadenceRpm)} rpm`;
  render();
};

$('connectBtn').onclick = () =>
  connectFtms(onData, () => { state.trainer = null; render(); }).then(onConnected).catch(showError);
$('demoBtn').onclick = () => onConnected(connectDemo(onData));
$('status').onclick = () => { state.trainer?.disconnect(); state.trainer = null; render(); };
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => (b.onclick = () => {
  state.mode = b.dataset.mode as Mode; state.hold = false; render(); scheduleSend();
}));
const bump = (dir: 1 | -1) => {
  state.values[state.mode] = stepValue(state.mode, state.values[state.mode], dir);
  state.hold = false; render(); scheduleSend();
};
$('dec').onclick = () => bump(-1);
$('inc').onclick = () => bump(1);
$('hold').onclick = () => {
  state.hold = !state.hold; render();
  if (state.hold) state.trainer?.hold().catch(showError); else scheduleSend();
};

setInterval(() => {
  if (!state.trainer) return;
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  $('time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}, 1000);

// Keep the screen on while riding, where supported.
navigator.wakeLock?.request('screen').catch(() => {});

render();
