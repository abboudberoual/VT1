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
  const status = $('status');
  status.innerHTML = `<span class="dot"></span>${connected ? `${escapeHtml(state.trainer!.name.toUpperCase())} · ${state.trainer!.protocol}` : 'NOT CONNECTED'}`;
  status.classList.toggle('off', !connected);
  status.title = connected ? 'Disconnect' : '';
  $('empty').hidden = connected;
  $('live').hidden = !connected;
  $('readouts').hidden = !connected;
  $('label').textContent = state.hold ? 'ON HOLD' : ({ erg: 'TARGET', res: 'RESISTANCE', slope: 'GRADE' })[state.mode];
  $('value').textContent = fmt(state.mode, v);
  $('value').style.color = state.hold ? '#5B6068' : '';
  $('unit').textContent = ({ erg: 'watts', res: 'percent', slope: 'percent grade' })[state.mode];
  $('liveLine').textContent = `${state.live} W live`;
  $('power').textContent = `${state.live} W`;
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

function escapeHtml(t: string) {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Turn browser and Bluetooth errors into something a rider can act on. */
function friendlyError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotFoundError' && /cancel/i.test(msg)) return 'No trainer selected. Pedal to wake it up, then try again.';
  if (name === 'NotFoundError') return 'No trainer found. Make sure it is powered, nearby and not connected to another app.';
  if (name === 'SecurityError') return 'Bluetooth is blocked on this page. Check your browser’s site permissions.';
  if (name === 'NetworkError') return 'The trainer dropped the connection. Pedal to wake it and try again.';
  if (/another app/i.test(msg)) return msg;
  return `Couldn’t connect: ${msg}`;
}

function showError(e: unknown) {
  const el = $('error');
  el.textContent = friendlyError(e);
  el.hidden = false;
  state.trainer = null;
  render();
}

function clearError() {
  $('error').hidden = true;
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

const connectBtn = $<HTMLButtonElement>('connectBtn');
connectBtn.onclick = () => {
  clearError();
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  connectFtms(onData, () => { state.trainer = null; render(); })
    .then(onConnected)
    .catch(showError)
    .finally(() => { connectBtn.disabled = !navigator.bluetooth; connectBtn.textContent = 'Connect trainer'; });
};
$('demoBtn').onclick = () => { clearError(); onConnected(connectDemo(onData)); };

if (!navigator.bluetooth) {
  connectBtn.disabled = true;
  $('emptyTitle').textContent = 'Bluetooth isn’t available here';
  $('note').hidden = true;
  $('emptyText').textContent = 'Open this page in Chrome or Edge on a computer, or Chrome on Android. Demo mode works anywhere.';
}
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
