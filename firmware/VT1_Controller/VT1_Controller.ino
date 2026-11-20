/*
  VT-1 Solo controller firmware
  --------------------------------------------------------------
  Board   : Waveshare ESP32-S3-Pico
  Trainer : any Bluetooth FTMS smart trainer (tested target: Elite Tuo)
  Display : Waveshare 1.28" round LCD (GC9A01, 240 x 240)

  Arduino IDE setup
    1. Boards Manager: install "esp32" by Espressif Systems.
    2. Library Manager: install "GFX Library for Arduino" by moononournation.
    3. Tools > Board: "ESP32S3 Dev Module"
       Tools > USB CDC On Boot: Enabled      (so Serial Monitor works over USB-C)
       Tools > Flash Size: 16MB
       Tools > PSRAM: QSPI PSRAM
    4. Plug in USB-C, pick the port, Upload. If upload fails: hold BOOT, tap RESET, release BOOT, upload again.

  Controls
    Knob turn   : change the value (ERG 5 W, RES 1 %, SLOPE 0.5 % per click)
    Knob press  : next mode, ERG > RES > SLOPE  (until the toggle is fitted)
    HOLD button : drop to minimum resistance; press again to resume
    Lamps       : show the mode; blink slowly while searching, fast while on HOLD

  Wiring (every "GND" can go to any GND pin on the ESP32)
    Display VCC -> 3V3       Display GND -> GND
    Display DIN -> GPIO 11   Display CLK -> GPIO 12
    Display CS  -> GPIO 10   Display DC  -> GPIO 9
    Display RST -> GPIO 8    Display BL  -> GPIO 7
    Encoder CLK -> GPIO 4    Encoder DT  -> GPIO 5
    Encoder SW  -> GPIO 6    Encoder +   -> 3V3     Encoder GND -> GND
    HOLD button : one tab -> GPIO 13, other tab -> GND
    Lamp ERG    : GPIO 14 -> 220 ohm -> LED long leg; LED short leg -> GND
    Lamp RES    : GPIO 15 -> 220 ohm -> LED long leg; LED short leg -> GND
    Lamp SLOPE  : GPIO 16 -> 220 ohm -> LED long leg; LED short leg -> GND
    Toggle (later): centre tab -> GND, outer tabs -> GPIO 17 and GPIO 18, then set USE_TOGGLE to 1
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <Arduino_GFX_Library.h>

// ---------------- pins: change here if your wiring differs ----------------
#define PIN_TFT_DIN    11
#define PIN_TFT_CLK    12
#define PIN_TFT_CS     10
#define PIN_TFT_DC      9
#define PIN_TFT_RST     8
#define PIN_TFT_BL      7
#define PIN_ENC_CLK     4
#define PIN_ENC_DT      5
#define PIN_ENC_SW      6
#define PIN_HOLD       13
#define PIN_LED_ERG    14
#define PIN_LED_RES    15
#define PIN_LED_SLOPE  16
#define PIN_TOG_A      17   // toggle up   = ERG
#define PIN_TOG_B      18   // toggle down = SLOPE (centre = RES)

// ---------------- options ----------------
#define USE_TOGGLE            0    // 1 once the ON-OFF-ON toggle is wired
#define TFT_ROTATION          0    // 0-3: rotate the dial to match how the display is mounted
#define ENC_STEPS_PER_DETENT  4    // set to 2 if one click moves the value by two steps
#define ENC_REVERSE           0    // set to 1 if clockwise turns the value down
#define TRAINER_NAME          ""   // e.g. "Tuo" to connect only to a matching name; "" = first FTMS trainer found

// ---------------- colours (RGB565) ----------------
#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
const uint16_t C_BG     = RGB565(0, 0, 0);
const uint16_t C_FACE   = RGB565(16, 18, 17);
const uint16_t C_CREAM  = RGB565(236, 230, 216);
const uint16_t C_GREY   = RGB565(150, 150, 140);
const uint16_t C_GREEN  = RGB565(143, 191, 138);
const uint16_t C_ORANGE = RGB565(226, 116, 43);
const uint16_t C_RED    = RGB565(200, 67, 42);
const uint16_t C_WINDOW = RGB565(28, 30, 29);

// ---------------- modes ----------------
enum Mode : uint8_t { ERG = 0, RES = 1, SLOPE = 2 };
struct ModeCfg { const char* name; float val, step, minV, maxV; };
ModeCfg modes[3] = {
  {"ERG",   150.0f, 5.0f,   0.0f, 1000.0f},
  {"RES",    30.0f, 1.0f,   0.0f,  100.0f},
  {"SLOPE",   2.0f, 0.5f, -10.0f,   20.0f},
};
volatile Mode mode = ERG;
volatile bool hold = false;

// ---------------- display ----------------
Arduino_DataBus* bus = new Arduino_ESP32SPI(PIN_TFT_DC, PIN_TFT_CS, PIN_TFT_CLK, PIN_TFT_DIN, GFX_NOT_DEFINED);
Arduino_GFX* panel   = new Arduino_GC9A01(bus, PIN_TFT_RST, TFT_ROTATION, true);
Arduino_Canvas* gfx  = new Arduino_Canvas(240, 240, panel);   // draw off-screen, then flush: no flicker

// ---------------- encoder (interrupt driven) ----------------
volatile int32_t encCount = 0;
volatile uint8_t encState = 0;
const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};

void IRAM_ATTR encISR() {
  uint8_t s = (digitalRead(PIN_ENC_CLK) << 1) | digitalRead(PIN_ENC_DT);
  encState = ((encState << 2) | s) & 0x0F;
  encCount += QDEC[encState];
}

struct Button {
  uint8_t pin; bool stable = true, last = true; uint32_t changedAt = 0;
  explicit Button(uint8_t p) : pin(p) {}
  bool pressed() {                       // true once per press, 25 ms debounce, active LOW
    bool now = digitalRead(pin);
    if (now != last) { last = now; changedAt = millis(); }
    if (millis() - changedAt > 25 && now != stable) { stable = now; return !stable; }
    return false;
  }
};
Button encBtn(PIN_ENC_SW), holdBtn(PIN_HOLD);

// ---------------- FTMS over Bluetooth LE ----------------
static BLEUUID FTMS_SVC((uint16_t)0x1826);
static BLEUUID IBD_UUID((uint16_t)0x2AD2);    // Indoor Bike Data (notify)
static BLEUUID CP_UUID((uint16_t)0x2AD9);     // Control Point (write + indicate)
static BLEUUID RR_UUID((uint16_t)0x2AD6);     // Supported Resistance Level Range (read)

BLEAdvertisedDevice* found = nullptr;
BLEClient* client = nullptr;
BLERemoteCharacteristic* cpChar = nullptr;
volatile bool linkUp = false, doConnect = false;
volatile bool cpGotReply = false;
volatile uint8_t cpLastOp = 0, cpLastRes = 0;
int16_t resMin = 0, resMax = 200;

volatile float power = 0, cadence = 0, speedKph = 0;
volatile uint32_t lastDataMs = 0;
volatile bool sendPending = false;
volatile uint32_t lastChangeMs = 0;

void markChanged() { sendPending = true; lastChangeMs = millis(); }

class AdvCB : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    if (!dev.haveServiceUUID() || !dev.isAdvertisingService(FTMS_SVC)) return;
    String name = String(dev.getName().c_str());
    if (strlen(TRAINER_NAME) && name.indexOf(TRAINER_NAME) < 0) return;
    Serial.printf("Found FTMS trainer: %s\n", name.c_str());
    BLEDevice::getScan()->stop();
    if (found) delete found;
    found = new BLEAdvertisedDevice(dev);
    doConnect = true;
  }
};

class ClientCB : public BLEClientCallbacks {
  void onConnect(BLEClient*) override {}
  void onDisconnect(BLEClient*) override {
    linkUp = false; cpChar = nullptr;
    Serial.println("Trainer disconnected");
  }
};

static uint16_t rd16(const uint8_t* d, size_t i) { return (uint16_t)(d[i] | (d[i + 1] << 8)); }

void onIndoorBikeData(BLERemoteCharacteristic*, uint8_t* d, size_t n, bool) {
  if (n < 2) return;
  uint16_t f = rd16(d, 0); size_t o = 2;
  if (!(f & 0x0001)) { if (o + 2 <= n) speedKph = rd16(d, o) / 100.0f; o += 2; }  // instantaneous speed
  if (f & 0x0002) o += 2;                                                          // average speed
  if (f & 0x0004) { if (o + 2 <= n) cadence = rd16(d, o) / 2.0f; o += 2; }         // cadence
  if (f & 0x0008) o += 2;                                                          // average cadence
  if (f & 0x0010) o += 3;                                                          // total distance
  if (f & 0x0020) o += 2;                                                          // resistance level
  if (f & 0x0040) { if (o + 2 <= n) power = (int16_t)rd16(d, o); o += 2; }         // power
  lastDataMs = millis();
}

void onControlPoint(BLERemoteCharacteristic*, uint8_t* d, size_t n, bool) {
  if (n >= 3 && d[0] == 0x80) { cpLastOp = d[1]; cpLastRes = d[2]; cpGotReply = true; }
}

bool cpWrite(uint8_t* buf, size_t len) {          // write, then wait up to 600 ms for the trainer's reply
  if (!cpChar || !linkUp) return false;
  cpGotReply = false;
  cpChar->writeValue(buf, len, true);
  uint32_t t0 = millis();
  while (!cpGotReply && millis() - t0 < 600) vTaskDelay(pdMS_TO_TICKS(5));
  if (cpGotReply && cpLastRes != 0x01) Serial.printf("Trainer refused op 0x%02X (code %u)\n", cpLastOp, cpLastRes);
  return cpGotReply && cpLastRes == 0x01;
}

uint8_t resRaw(float pct) {                        // same scaling as the web panel that felt right on the Tuo
  float raw = resMin + (resMax - resMin) * pct / 100.0f;
  return (uint8_t)lroundf(constrain(raw, 0.0f, 255.0f));
}

void sendSetpoint() {
  uint8_t b[7];
  if (hold) { b[0] = 0x04; b[1] = resRaw(0); cpWrite(b, 2); return; }
  float v = modes[mode].val;
  if (mode == ERG) {
    int16_t w = (int16_t)lroundf(v);
    b[0] = 0x05; b[1] = w & 0xFF; b[2] = (w >> 8) & 0xFF; cpWrite(b, 3);
  } else if (mode == RES) {
    b[0] = 0x04; b[1] = resRaw(v); cpWrite(b, 2);
  } else {
    int16_t g = (int16_t)lroundf(v * 100.0f);          // grade in 0.01 %
    b[0] = 0x11; b[1] = 0; b[2] = 0;                   // wind 0
    b[3] = g & 0xFF; b[4] = (g >> 8) & 0xFF;
    b[5] = 40; b[6] = 51;                              // Crr 0.0040, CwA 0.51
    cpWrite(b, 7);
  }
  if (cpGotReply && cpLastRes == 0x05) {               // control not permitted: ask again, resend
    uint8_t req[] = {0x00}; cpWrite(req, 1); markChanged();
  }
}

bool connectTrainer() {
  Serial.println("Connecting...");
  if (!client->connect(found)) return false;
  BLERemoteService* svc = client->getService(FTMS_SVC);
  if (!svc) { client->disconnect(); return false; }
  BLERemoteCharacteristic* ibd = svc->getCharacteristic(IBD_UUID);
  cpChar = svc->getCharacteristic(CP_UUID);
  if (!ibd || !cpChar) { client->disconnect(); cpChar = nullptr; return false; }
  if (ibd->canNotify()) ibd->registerForNotify(onIndoorBikeData);
  if (cpChar->canIndicate()) cpChar->registerForNotify(onControlPoint, false);
  BLERemoteCharacteristic* rr = svc->getCharacteristic(RR_UUID);
  if (rr && rr->canRead()) {
    auto v = rr->readValue();
    if (v.length() >= 4) {
      resMin = (int16_t)((uint8_t)v[0] | ((uint8_t)v[1] << 8));
      resMax = (int16_t)((uint8_t)v[2] | ((uint8_t)v[3] << 8));
      Serial.printf("Resistance range %d..%d\n", resMin, resMax);
    }
  }
  linkUp = true;
  uint8_t req[] = {0x00}; cpWrite(req, 1);    // request control
  uint8_t st[]  = {0x07}; cpWrite(st, 1);     // start / resume
  markChanged();
  Serial.println("Linked");
  return true;
}

void bleTask(void*) {                         // runs on core 0 so Bluetooth never freezes the dial
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new AdvCB());
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(99);
  for (;;) {
    if (!linkUp) {
      if (doConnect) {
        doConnect = false;
        if (!connectTrainer()) { Serial.println("Connect failed, retrying"); vTaskDelay(pdMS_TO_TICKS(1000)); }
      } else {
        scan->start(3, false);
        scan->clearResults();
      }
    } else if (sendPending && millis() - lastChangeMs > 150) {
      sendPending = false;
      sendSetpoint();
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ---------------- dial drawing ----------------
const int CX = 120, CY = 120;
float needle = 0;
float avgBuf[30]; int avgIdx = 0; float avg3 = 0;

float angOf(float w) { return radians(135.0f + constrain(w, 0.0f, 800.0f) / 800.0f * 270.0f); }

void radial(float a, float r1, float r2, uint16_t c, int width) {
  float ca = cosf(a), sa = sinf(a), px = -sa, py = ca;
  for (int k = 0; k < width; k++) {
    float off = (k - (width - 1) / 2.0f) * 0.9f;
    gfx->drawLine(CX + ca * r1 + px * off, CY + sa * r1 + py * off,
                  CX + ca * r2 + px * off, CY + sa * r2 + py * off, c);
  }
}

void textCentered(const char* s, int y, uint8_t size, uint16_t c) {
  gfx->setTextSize(size); gfx->setTextColor(c);
  gfx->setCursor(CX - (int)strlen(s) * 3 * size, y);
  gfx->print(s);
}

void drawDial(bool live) {
  gfx->fillScreen(C_BG);
  gfx->fillCircle(CX, CY, 119, C_FACE);

  for (float w = 600; w <= 800; w += 1.5f) radial(angOf(w), 106, 113, C_RED, 2);   // red zone
  for (int v = 0; v <= 800; v += 20) {                                              // scale
    bool major = v % 100 == 0, mid = v % 50 == 0;
    radial(angOf(v), 113, major ? 96 : (mid ? 102 : 106), C_CREAM, major ? 3 : (mid ? 2 : 1));
    if (major) {
      char lbl[2] = {(char)('0' + v / 100), 0};
      float a = angOf(v);
      gfx->setTextSize(2); gfx->setTextColor(C_CREAM);
      gfx->setCursor(CX + cosf(a) * 82 - 6, CY + sinf(a) * 82 - 7);
      gfx->print(lbl);
    }
  }
  textCentered("WATT x100", 76, 1, C_GREEN);

  if (live && mode == ERG && !hold) {                                               // ERG target chevron
    float a = angOf(modes[ERG].val);
    gfx->fillTriangle(CX + cosf(a) * 112, CY + sinf(a) * 112,
                      CX + cosf(a - 0.05f) * 119, CY + sinf(a - 0.05f) * 119,
                      CX + cosf(a + 0.05f) * 119, CY + sinf(a + 0.05f) * 119, C_ORANGE);
  }

  // digital window: 3 s average power
  gfx->fillRoundRect(CX - 44, 146, 88, 32, 4, C_WINDOW);
  char buf[24];
  if (live) snprintf(buf, sizeof buf, "%d", (int)lroundf(avg3)); else snprintf(buf, sizeof buf, "---");
  gfx->setTextSize(3); gfx->setTextColor(C_ORANGE);
  gfx->setCursor(CX + 38 - (int)strlen(buf) * 18, 151); gfx->print(buf);

  // mode line
  if (hold) snprintf(buf, sizeof buf, "HOLD");
  else if (mode == ERG) snprintf(buf, sizeof buf, "ERG %dW", (int)lroundf(modes[ERG].val));
  else if (mode == RES) snprintf(buf, sizeof buf, "RES %d%%", (int)lroundf(modes[RES].val));
  else snprintf(buf, sizeof buf, "SLOPE %.1f%%", modes[SLOPE].val);
  textCentered(buf, 186, 2, hold ? C_RED : C_CREAM);

  if (live) snprintf(buf, sizeof buf, "%d RPM", (int)lroundf(cadence));
  else snprintf(buf, sizeof buf, (millis() / 500) % 2 ? "SEARCHING" : "SEARCHING.");
  textCentered(buf, 208, 1, C_GREY);

  // needle
  float a = angOf(needle), ca = cosf(a), sa = sinf(a), px = -sa, py = ca;
  float tx = CX + ca * 100, ty = CY + sa * 100, bx = CX - ca * 18, by = CY - sa * 18;
  gfx->fillTriangle(tx, ty, bx + px * 4, by + py * 4, bx - px * 4, by - py * 4, C_ORANGE);
  gfx->fillCircle(CX, CY, 8, C_WINDOW);
  gfx->drawCircle(CX, CY, 8, C_GREY);

  gfx->flush();
}

// ---------------- lamps ----------------
void setLamps(bool live) {
  bool on = true;
  if (!live) on = (millis() / 600) % 2;          // slow blink while searching
  else if (hold) on = (millis() / 150) % 2;      // fast blink on HOLD
  digitalWrite(PIN_LED_ERG,   on && mode == ERG);
  digitalWrite(PIN_LED_RES,   on && mode == RES);
  digitalWrite(PIN_LED_SLOPE, on && mode == SLOPE);
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_ERG, OUTPUT); pinMode(PIN_LED_RES, OUTPUT); pinMode(PIN_LED_SLOPE, OUTPUT);
  pinMode(PIN_ENC_CLK, INPUT_PULLUP); pinMode(PIN_ENC_DT, INPUT_PULLUP); pinMode(PIN_ENC_SW, INPUT_PULLUP);
  pinMode(PIN_HOLD, INPUT_PULLUP);
  pinMode(PIN_TOG_A, INPUT_PULLUP); pinMode(PIN_TOG_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_CLK), encISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_DT), encISR, CHANGE);

  pinMode(PIN_TFT_BL, OUTPUT); digitalWrite(PIN_TFT_BL, HIGH);
  gfx->begin();
  gfx->fillScreen(C_BG);
  textCentered("VT-1", 100, 4, C_CREAM);
  textCentered("TRAINER CONTROL", 140, 1, C_GREY);
  gfx->flush();

  BLEDevice::init("VT-1");
  client = BLEDevice::createClient();
  client->setClientCallbacks(new ClientCB());
  xTaskCreatePinnedToCore(bleTask, "ble", 8192, nullptr, 1, nullptr, 0);
  delay(800);
}

void loop() {
  static uint32_t lastFrame = 0, lastSample = 0;
  static int32_t encUsed = 0;

  // knob
  int32_t c; noInterrupts(); c = encCount; interrupts();
  int32_t steps = (c - encUsed) / ENC_STEPS_PER_DETENT;
  if (steps) {
    encUsed += steps * ENC_STEPS_PER_DETENT;
    if (ENC_REVERSE) steps = -steps;
    ModeCfg& m = modes[mode];
    float v = roundf((m.val + steps * m.step) / m.step) * m.step;
    m.val = constrain(v, m.minV, m.maxV);
    if (!hold) markChanged();
  }

  // mode select
#if USE_TOGGLE
  Mode t = !digitalRead(PIN_TOG_A) ? ERG : (!digitalRead(PIN_TOG_B) ? SLOPE : RES);
  if (t != mode) { mode = t; markChanged(); }
  encBtn.pressed();
#else
  if (encBtn.pressed()) { mode = (Mode)((mode + 1) % 3); markChanged(); }
#endif

  if (holdBtn.pressed()) { hold = !hold; markChanged(); }

  bool live = linkUp && millis() - lastDataMs < 3000;
  setLamps(linkUp);

  uint32_t now = millis();
  if (now - lastSample >= 100) {                   // 3 s rolling average at 10 Hz
    lastSample = now;
    avgBuf[avgIdx] = live ? power : 0; avgIdx = (avgIdx + 1) % 30;
    float s = 0; for (float x : avgBuf) s += x; avg3 = s / 30.0f;
  }
  if (now - lastFrame >= 50) {                     // about 20 frames per second
    float dt = (now - lastFrame) / 1000.0f; lastFrame = now;
    float target = live ? power : 0;
    needle += (target - needle) * constrain(dt * 6.0f, 0.0f, 1.0f);
    drawDial(live);
  }
}
