// Shared BLE contract. Keep these in sync with mobile/src/lib/harness.ts
// and firmware/uno-q/linux/harness_ble.py.
#pragma once

#define DEVICE_NAME          "GuideSight-Harness"
#define SERVICE_UUID         "6e8a0001-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
// Harness -> phone (notify): JSON like {"type":"stop","accel":0.04,"ms":123456}
#define EVENT_CHAR_UUID      "6e8a0002-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
// Phone -> harness (write): "short" | "double" | "long"
#define COMMAND_CHAR_UUID    "6e8a0003-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
