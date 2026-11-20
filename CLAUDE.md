# VT-1 — agent guide

VT-1 is a minimal smart-trainer controller: ERG (target watts), resistance (%) and slope (%) over Bluetooth.
It has two halves: an ESP32-S3 hardware controller (knob + round gauge) and a free web app. This is a
public portfolio project for mechanical/aerospace internship applications, so clarity and polish matter
more than features.

## Layout
- `packages/core` — pure TypeScript: FTMS encoders/decoders (`ftms.ts`) and mode limits (`modes.ts`). No DOM, no Bluetooth calls. Every byte format has a unit test.
- `apps/web` — Vite + vanilla TypeScript web app. `trainer.ts` = Web Bluetooth FTMS transport + demo trainer; `main.ts` = UI.
- `firmware/VT1_Controller` — Arduino sketch for the ESP32-S3 controller (GC9A01 round display, KY-040 encoder).
- `hardware/` — STL files and case dimensions.
- `prototypes/` — the original single-file Web Bluetooth panel (tested on an Elite Tuo, Oct 2026). Reference only.
- `docs/` — plan and protocol notes.

## Commands (run from repo root)
- `npm install` — install
- `npm run dev` — web app at http://localhost:5173 (Web Bluetooth needs Chrome/Edge; localhost counts as secure)
- `npm test` — core unit tests (vitest)
- `npm run typecheck` — TypeScript across workspaces
- `npm run build` — production build to `apps/web/dist`

Run `npm test && npm run typecheck && npm run build` before every commit. CI runs the same.

## Rules
- Protocol logic lives in `packages/core` only, with a byte-exact test. The web app must not build FTMS packets itself.
- Keep firmware and web app values in sync: ERG 150 W start / 5 W step / 0–1000; RES 30 % / 1 / 0–100; SLOPE 2 % / 0.5 / −10…20. Setpoint debounce 150 ms, control-point reply timeout 600 ms.
- Handle FTMS result 0x05 (Control Not Permitted) with a clear "another app is controlling the trainer" message.
- Design: dark ground #0B0C0E, text #F2F2F0, muted #8B9098, one accent #FF4F00 used ONLY for live power. Inter Tight + IBM Plex Mono. Touch targets ≥ 44 px.
- No accounts, analytics, trackers or network calls besides Google Fonts. Ride data stays on the device.
- Demo mode must keep working: reviewers and recruiters won't have a trainer.
- Don't name trainer brands in UI copy except as factual compatibility; no brand logos.
- Small, focused commits with clear messages. Open a PR for anything non-trivial.

## Roadmap (web-first)
1. FTMS web app polish + GitHub Pages deploy
2. Tacx FE-C over BLE and read-only Cycling Power (0x1818) adapters
3. Chrome/Edge extension (side panel; Web Bluetooth does not survive the popup)
4. Case study write-up in `docs/` (requirements → firmware → CAD → app)
