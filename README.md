# VT-1

A one-screen controller for Bluetooth smart trainers. Pick **ERG**, **resistance** or **slope**, turn it up or down, and pedal. No workouts, no account, no feed.

VT-1 is two things:

- **A hardware controller** — an ESP32-S3 in a 3D-printed case, with a knob and a round watt gauge, that talks to the trainer directly over Bluetooth.
- **A web app** — the same three modes in the browser, using Web Bluetooth. Runs in Chrome and Edge on desktop and Chrome on Android. Has a demo mode if you don't own a trainer.

## Try it

```bash
npm install
npm run dev      # http://localhost:5173
```

Click **Try demo mode**, or **Connect trainer** with any trainer that supports Bluetooth FTMS.

## Repo

| Path | What |
| --- | --- |
| `packages/core` | FTMS protocol encoders/decoders and mode limits, unit-tested |
| `apps/web` | Web app (Vite + TypeScript) |
| `firmware/VT1_Controller` | ESP32-S3 firmware (Arduino) |
| `hardware` | STL files and case dimensions |
| `prototypes` | First Web Bluetooth prototype |
| `docs` | Plan and notes |

## Status

- [x] FTMS control verified on an Elite Tuo (web prototype)
- [x] Hardware case printed (VT-1 Solo)
- [ ] Firmware bench test
- [ ] Web app on GitHub Pages
- [ ] Tacx FE-C and power-meter support
- [ ] Browser extension

## Legal

The Bluetooth® word mark and logos are registered trademarks owned by Bluetooth SIG, Inc. Trainer brand names are trademarks of their respective owners; VT-1 is not affiliated with or endorsed by them.

MIT licensed.
