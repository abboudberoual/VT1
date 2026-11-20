# Hardware — VT-1 Solo

ESP32-S3-Pico + 1.28" GC9A01 round display + KY-040 encoder + 16 mm illuminated pushbutton (HOLD) + three status LEDs.

## Case (printed)
- Shell 150 × 92 mm, front height 28 mm, back 45.88 mm, deck at 11°, 2.4 mm walls, 2.5 mm deck
- Deck holes (u, v from deck centre, mm): gauge (−44, −10) Ø34 · knob (44, −10) Ø7.4 · toggle (0, −5) Ø6.4 · lamps x = −10 at v = 6, −5, −16, Ø8.3 · HOLD (0, 24) Ø16.3
- Bosses at (±68, ±39), Ø9 with Ø4.1 × 6 mm insert holes (drill to 4.3 mm for D5 heat-set inserts); bottom cover with M3 × 8 countersunk screws
- USB slot on the left wall, 14 × 9 mm, R2 corners
- Knob: use `VT1-Solo-4c-knob-6mm-Dshaft` (6 mm D-shaft, M7 collar)

## Files
- `cad/VT1-Solo-1-shell.SLDPRT`: SolidWorks rebuild of the shell
- `stl/`: print files. 3MF where one exists (smaller): fit test, shell, bottom cover, display bezel. STL for the knob (4c, 6 mm D-shaft), LED bezels and plug, and printed encoder nuts
- `renders/`: early renders of the shell and cover

## Wiring (ESP32-S3 GPIO)
TFT DIN 11, CLK 12, CS 10, DC 9, RST 8, BL 7 · encoder CLK 4, DT 5, SW 6 · HOLD 13 · LEDs 14 / 15 / 16
